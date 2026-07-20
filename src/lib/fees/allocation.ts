import { $Enums, Prisma } from '@/generated/prisma/client'
import { statusFor } from './installments'
import { toPaise, toRupees } from './money'

type FeeCategory = $Enums.FeeCategory
type PaymentMode = $Enums.PaymentMode

const CATEGORY_PRIORITY: Record<FeeCategory, number> = { SCHOOL: 0, BUS: 1, OTHER: 2 }

export class AllocationError extends Error {
  constructor(message: string, public readonly outstanding: number) {
    super(message)
    this.name = 'AllocationError'
  }
}

export interface PaymentInput {
  studentId: number
  amount: number
  /** Which fee type this payment is for. Omit for a general payment
   *  (treated like SCHOOL: past dues first, then current school fees). */
  category?: FeeCategory | null
  mode?: PaymentMode
  reference?: string | null
  remarks?: string | null
  paidAt?: string | Date | null
}

interface PendingInstallment {
  id: number
  sequence: number
  netPaise: number
  paidPaise: number
  feeItemId: number
  category: FeeCategory
  sessionStart: number
  isCurrentSession: boolean
}

/**
 * Fetch every unpaid/partially-paid installment for a student, across all of
 * their enrollments (i.e. all sessions), with the context needed to order
 * them for allocation.
 */
async function fetchPending(
  tx: Prisma.TransactionClient,
  studentId: number
): Promise<PendingInstallment[]> {
  const rows = await tx.feeInstallment.findMany({
    where: {
      status: { not: 'PAID' },
      feeItem: { enrollment: { studentId } },
    },
    include: {
      feeItem: {
        select: {
          id: true,
          category: true,
          enrollment: {
            select: { session: { select: { startDate: true, isCurrent: true } } },
          },
        },
      },
    },
  })

  return rows
    .map((r) => ({
      id: r.id,
      sequence: r.sequence,
      netPaise: toPaise(r.netAmount),
      paidPaise: toPaise(r.paidAmount),
      feeItemId: r.feeItem.id,
      category: r.feeItem.category,
      sessionStart: r.feeItem.enrollment.session.startDate.getTime(),
      isCurrentSession: r.feeItem.enrollment.session.isCurrent,
    }))
    .filter((r) => r.netPaise > r.paidPaise)
}

/**
 * Build the ordered list of installments a payment may be applied to.
 *
 * Rules (see task requirements):
 * - BUS / OTHER payments target only that category's installments —
 *   past sessions first, then the current session, in installment order.
 * - SCHOOL / general payments settle past-session dues first (ALL categories,
 *   oldest session first), then the current session's SCHOOL installments.
 */
export function orderForAllocation(
  pending: PendingInstallment[],
  category: FeeCategory | null | undefined
): PendingInstallment[] {
  const byOrder = (a: PendingInstallment, b: PendingInstallment) =>
    a.sessionStart - b.sessionStart ||
    CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category] ||
    a.feeItemId - b.feeItemId ||
    a.sequence - b.sequence

  if (category === 'BUS' || category === 'OTHER') {
    return pending.filter((p) => p.category === category).sort(byOrder)
  }
  // SCHOOL or general: every past-session due, then current-session school fees.
  return pending
    .filter((p) => !p.isCurrentSession || p.category === 'SCHOOL')
    .sort(byOrder)
}

/**
 * Record a payment and distribute it across the student's installments.
 *
 * Must be called inside a prisma interactive transaction. Creates the
 * FeeTransaction + TransactionAllocation rows and keeps installment and
 * fee-item aggregates (paidAmount, dueAmount, status) in sync.
 *
 * Throws AllocationError if the amount exceeds the outstanding balance the
 * payment is allowed to target, so money is never left unaccounted for.
 */
export async function allocatePayment(tx: Prisma.TransactionClient, input: PaymentInput) {
  const amountPaise = toPaise(input.amount)
  if (amountPaise <= 0) throw new AllocationError('amount must be positive', 0)

  const pending = await fetchPending(tx, input.studentId)
  const targets = orderForAllocation(pending, input.category)
  const capacity = targets.reduce((sum, t) => sum + (t.netPaise - t.paidPaise), 0)

  if (amountPaise > capacity) {
    const scope = input.category ? `${input.category} fees` : 'school/past dues'
    throw new AllocationError(
      `amount (${input.amount}) exceeds the outstanding balance of ${toRupees(capacity)} for ${scope}`,
      toRupees(capacity)
    )
  }

  // Walk the ordered installments, filling each before moving to the next.
  let remaining = amountPaise
  const allocations: { installmentId: number; amountPaise: number }[] = []
  const perFeeItem = new Map<number, number>()
  for (const inst of targets) {
    if (remaining <= 0) break
    const take = Math.min(remaining, inst.netPaise - inst.paidPaise)
    if (take <= 0) continue
    allocations.push({ installmentId: inst.id, amountPaise: take })
    perFeeItem.set(inst.feeItemId, (perFeeItem.get(inst.feeItemId) ?? 0) + take)
    remaining -= take

    const newPaid = inst.paidPaise + take
    await tx.feeInstallment.update({
      where: { id: inst.id },
      data: {
        paidAmount: toRupees(newPaid),
        status: statusFor(inst.netPaise, newPaid),
      },
    })
  }

  for (const [feeItemId, paidPaise] of perFeeItem) {
    const item = await tx.studentFeeItem.findUniqueOrThrow({ where: { id: feeItemId } })
    const newPaid = toPaise(item.paidAmount) + paidPaise
    await tx.studentFeeItem.update({
      where: { id: feeItemId },
      data: {
        paidAmount: toRupees(newPaid),
        dueAmount: toRupees(toPaise(item.netAmount) - newPaid),
      },
    })
  }

  const transaction = await tx.feeTransaction.create({
    data: {
      receiptNo: `TMP-${input.studentId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      studentId: input.studentId,
      category: input.category ?? null,
      amount: toRupees(amountPaise),
      mode: input.mode ?? 'CASH',
      reference: input.reference ?? null,
      remarks: input.remarks ?? null,
      paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      allocations: {
        create: allocations.map((a) => ({
          installmentId: a.installmentId,
          amount: toRupees(a.amountPaise),
        })),
      },
    },
  })

  return tx.feeTransaction.update({
    where: { id: transaction.id },
    data: { receiptNo: `RCP-${String(transaction.id).padStart(6, '0')}` },
    include: {
      allocations: {
        include: {
          installment: {
            include: {
              feeItem: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  enrollment: { select: { session: { select: { name: true } } } },
                },
              },
            },
          },
        },
      },
    },
  })
}

/**
 * Reverse a COMPLETED transaction: subtract every allocation from its
 * installment and fee item, then mark the transaction CANCELLED. The
 * allocation rows are kept for the audit trail.
 */
export async function cancelTransaction(tx: Prisma.TransactionClient, transactionId: number) {
  const transaction = await tx.feeTransaction.findUnique({
    where: { id: transactionId },
    include: { allocations: { include: { installment: true } } },
  })
  if (!transaction) throw new AllocationError('transaction not found', 0)
  if (transaction.status === 'CANCELLED') {
    throw new AllocationError('transaction is already cancelled', 0)
  }

  const perFeeItem = new Map<number, number>()
  for (const alloc of transaction.allocations) {
    const inst = alloc.installment
    const allocPaise = toPaise(alloc.amount)
    const newPaid = toPaise(inst.paidAmount) - allocPaise
    if (newPaid < 0) {
      throw new AllocationError(
        `installment ${inst.id} would go negative; data inconsistency detected`,
        0
      )
    }
    await tx.feeInstallment.update({
      where: { id: inst.id },
      data: {
        paidAmount: toRupees(newPaid),
        status: statusFor(toPaise(inst.netAmount), newPaid),
      },
    })
    perFeeItem.set(inst.feeItemId, (perFeeItem.get(inst.feeItemId) ?? 0) + allocPaise)
  }

  for (const [feeItemId, reversedPaise] of perFeeItem) {
    const item = await tx.studentFeeItem.findUniqueOrThrow({ where: { id: feeItemId } })
    const newPaid = toPaise(item.paidAmount) - reversedPaise
    await tx.studentFeeItem.update({
      where: { id: feeItemId },
      data: {
        paidAmount: toRupees(newPaid),
        dueAmount: toRupees(toPaise(item.netAmount) - newPaid),
      },
    })
  }

  return tx.feeTransaction.update({
    where: { id: transactionId },
    data: { status: 'CANCELLED' },
    include: { allocations: true },
  })
}
