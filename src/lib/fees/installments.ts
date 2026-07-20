import { $Enums } from '@/generated/prisma/client'
import { MoneyLike, splitAmount, toPaise, toRupees } from './money'

type InstallmentStatus = $Enums.InstallmentStatus
type FeeCategory = $Enums.FeeCategory

export interface InstallmentPlanInput {
  amount: number
  label?: string
  dueDate?: string | Date | null
}

export interface BuiltInstallment {
  sequence: number
  label: string
  dueDate: Date | null
  originalAmount: number
  discountAmount: number
  netAmount: number
  paidAmount: number
  status: InstallmentStatus
}

export function statusFor(netPaise: number, paidPaise: number): InstallmentStatus {
  if (paidPaise >= netPaise) return 'PAID'
  if (paidPaise > 0) return 'PARTIAL'
  return 'PENDING'
}

/**
 * Build the installment rows for a new fee item.
 *
 * - `installments` may be a count (the amount is split evenly, last piece
 *   absorbs rounding) or an explicit plan whose amounts must sum to `amount`.
 * - `discount` and `paid` (used by the legacy migration) are distributed
 *   across the installments: discount from the LAST installment backward
 *   (so early installments stay collectable), paid from the FIRST forward.
 */
export function buildInstallments(opts: {
  category: FeeCategory
  amount: number
  discount?: number
  paid?: number
  installments?: number | InstallmentPlanInput[]
  labelPrefix?: string
}): BuiltInstallment[] {
  const discount = toPaise(opts.discount ?? 0)
  const paid = toPaise(opts.paid ?? 0)
  const totalPaise = toPaise(opts.amount)

  if (totalPaise < 0) throw new Error('amount cannot be negative')
  if (discount < 0 || paid < 0) throw new Error('discount/paid cannot be negative')
  if (discount > totalPaise) throw new Error('discount cannot exceed the fee amount')
  if (paid > totalPaise - discount) throw new Error('paid cannot exceed the net fee amount')

  let plan: InstallmentPlanInput[]
  if (Array.isArray(opts.installments)) {
    plan = opts.installments
    const planTotal = plan.reduce((sum, p) => sum + toPaise(p.amount), 0)
    if (planTotal !== totalPaise) {
      throw new Error(
        `installment amounts (${toRupees(planTotal)}) must sum to the fee amount (${opts.amount})`
      )
    }
  } else {
    const count = Math.max(1, opts.installments ?? 1)
    plan = splitAmount(opts.amount, count).map((amount) => ({ amount }))
  }

  const prefix = opts.labelPrefix ?? 'Installment'
  const rows = plan.map((p, i) => ({
    sequence: i + 1,
    label: p.label ?? (plan.length === 1 ? prefix : `${prefix} ${i + 1}`),
    dueDate: p.dueDate ? new Date(p.dueDate) : null,
    originalPaise: toPaise(p.amount),
    discountPaise: 0,
    paidPaise: 0,
  }))

  // Distribute discount from the last installment backward.
  let remainingDiscount = discount
  for (let i = rows.length - 1; i >= 0 && remainingDiscount > 0; i--) {
    const take = Math.min(remainingDiscount, rows[i].originalPaise)
    rows[i].discountPaise = take
    remainingDiscount -= take
  }

  // Distribute paid from the first installment forward.
  let remainingPaid = paid
  for (let i = 0; i < rows.length && remainingPaid > 0; i++) {
    const net = rows[i].originalPaise - rows[i].discountPaise
    const take = Math.min(remainingPaid, net)
    rows[i].paidPaise = take
    remainingPaid -= take
  }

  return rows.map((r) => {
    const netPaise = r.originalPaise - r.discountPaise
    return {
      sequence: r.sequence,
      label: r.label,
      dueDate: r.dueDate,
      originalAmount: toRupees(r.originalPaise),
      discountAmount: toRupees(r.discountPaise),
      netAmount: toRupees(netPaise),
      paidAmount: toRupees(r.paidPaise),
      status: statusFor(netPaise, r.paidPaise),
    }
  })
}

export interface InstallmentSnapshot {
  id: number
  sequence: number
  discountAmount: MoneyLike
  netAmount: MoneyLike
  paidAmount: MoneyLike
}

export interface InstallmentAdjustment {
  id: number
  discountAmount: number
  netAmount: number
  status: InstallmentStatus
}

/**
 * Distribute an additional discount across a fee item's installments without
 * ever touching the already-paid portion (requirement: a discount changes
 * unpaid installment amounts but never a paid installment, so paid data
 * stays consistent).
 *
 * Reduction is applied from the LAST installment backward, and on each
 * installment is capped at `netAmount - paidAmount` (its unpaid remainder).
 * Throws if the discount exceeds the total unpaid remainder.
 */
export function applyDiscountAcrossInstallments(
  installments: InstallmentSnapshot[],
  discount: number
): InstallmentAdjustment[] {
  let remaining = toPaise(discount)
  if (remaining <= 0) throw new Error('discount must be positive')

  const unpaidTotal = installments.reduce(
    (sum, i) => sum + Math.max(0, toPaise(i.netAmount) - toPaise(i.paidAmount)),
    0
  )
  if (remaining > unpaidTotal) {
    throw new Error(
      `discount (${discount}) exceeds the unpaid balance (${toRupees(unpaidTotal)}); paid installments cannot be discounted`
    )
  }

  const ordered = [...installments].sort((a, b) => b.sequence - a.sequence)
  const updates: InstallmentAdjustment[] = []
  for (const inst of ordered) {
    if (remaining <= 0) break
    const net = toPaise(inst.netAmount)
    const paid = toPaise(inst.paidAmount)
    const reducible = net - paid
    if (reducible <= 0) continue
    const take = Math.min(remaining, reducible)
    const newNet = net - take
    updates.push({
      id: inst.id,
      discountAmount: toRupees(toPaise(inst.discountAmount) + take),
      netAmount: toRupees(newNet),
      status: statusFor(newNet, paid),
    })
    remaining -= take
  }
  return updates
}
