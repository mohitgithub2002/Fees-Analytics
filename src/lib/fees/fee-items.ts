import { $Enums, Prisma } from '@/generated/prisma/client'
import {
  applyDiscountAcrossInstallments,
  buildInstallments,
  InstallmentPlanInput,
  statusFor,
} from './installments'
import { splitAmount, toPaise, toRupees } from './money'

type FeeCategory = $Enums.FeeCategory

export class FeeItemError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'FeeItemError'
  }
}

export interface CreateFeeItemInput {
  enrollmentId: number
  category: FeeCategory
  name: string
  amount: number
  discount?: number
  /** Already-paid amount — only used by the legacy data migration. */
  paid?: number
  installments?: number | InstallmentPlanInput[]
  structureItemId?: number | null
}

/** Create a fee item with its installment plan. */
export async function createFeeItem(tx: Prisma.TransactionClient, input: CreateFeeItemInput) {
  let built
  try {
    built = buildInstallments({
      category: input.category,
      amount: input.amount,
      discount: input.discount ?? 0,
      paid: input.paid ?? 0,
      installments: input.installments,
      labelPrefix: 'Installment',
    })
  } catch (e) {
    throw new FeeItemError((e as Error).message)
  }

  const originalPaise = toPaise(input.amount)
  const discountPaise = toPaise(input.discount ?? 0)
  const paidPaise = toPaise(input.paid ?? 0)
  const netPaise = originalPaise - discountPaise

  return tx.studentFeeItem.create({
    data: {
      enrollmentId: input.enrollmentId,
      structureItemId: input.structureItemId ?? null,
      category: input.category,
      name: input.name,
      originalAmount: toRupees(originalPaise),
      discountAmount: toRupees(discountPaise),
      netAmount: toRupees(netPaise),
      paidAmount: toRupees(paidPaise),
      dueAmount: toRupees(netPaise - paidPaise),
      installments: { create: built },
      ...(discountPaise > 0
        ? { discounts: { create: { amount: toRupees(discountPaise), reason: 'Initial discount' } } }
        : {}),
    },
    include: { installments: { orderBy: { sequence: 'asc' } } },
  })
}

/**
 * Apply a discount to a fee item. Only unpaid installment balances are
 * reduced (last installment first); paid installments are never modified,
 * so past payments remain consistent.
 */
export async function applyDiscount(
  tx: Prisma.TransactionClient,
  feeItemId: number,
  amount: number,
  reason?: string | null,
  appliedBy?: string | null
) {
  const item = await tx.studentFeeItem.findUnique({
    where: { id: feeItemId },
    include: { installments: true },
  })
  if (!item) throw new FeeItemError('fee item not found', 404)

  let adjustments
  try {
    adjustments = applyDiscountAcrossInstallments(item.installments, amount)
  } catch (e) {
    throw new FeeItemError((e as Error).message)
  }

  for (const adj of adjustments) {
    await tx.feeInstallment.update({
      where: { id: adj.id },
      data: {
        discountAmount: adj.discountAmount,
        netAmount: adj.netAmount,
        status: adj.status,
      },
    })
  }

  await tx.feeDiscount.create({
    data: { feeItemId, amount, reason: reason ?? null, appliedBy: appliedBy ?? null },
  })

  const discountPaise = toPaise(item.discountAmount) + toPaise(amount)
  const netPaise = toPaise(item.originalAmount) - discountPaise
  return tx.studentFeeItem.update({
    where: { id: feeItemId },
    data: {
      discountAmount: toRupees(discountPaise),
      netAmount: toRupees(netPaise),
      dueAmount: toRupees(netPaise - toPaise(item.paidAmount)),
    },
    include: { installments: { orderBy: { sequence: 'asc' } }, discounts: true },
  })
}

/**
 * Change a fee item's amount (admin correction).
 * - Increase: added to the LAST installment.
 * - Decrease: removed from unpaid installment balances, last first — the
 *   paid portion can never be reduced.
 */
export async function changeFeeItemAmount(
  tx: Prisma.TransactionClient,
  feeItemId: number,
  newAmount: number
) {
  const item = await tx.studentFeeItem.findUnique({
    where: { id: feeItemId },
    include: { installments: { orderBy: { sequence: 'asc' } } },
  })
  if (!item) throw new FeeItemError('fee item not found', 404)

  const newOriginalPaise = toPaise(newAmount)
  const deltaPaise = newOriginalPaise - toPaise(item.originalAmount)
  if (deltaPaise === 0) return item

  if (deltaPaise > 0) {
    const last = item.installments[item.installments.length - 1]
    const newNet = toPaise(last.netAmount) + deltaPaise
    await tx.feeInstallment.update({
      where: { id: last.id },
      data: {
        originalAmount: toRupees(toPaise(last.originalAmount) + deltaPaise),
        netAmount: toRupees(newNet),
        status: statusFor(newNet, toPaise(last.paidAmount)),
      },
    })
  } else {
    // Reduce from the last installment backward, capped at each unpaid balance.
    let remaining = -deltaPaise
    const unpaidTotal = item.installments.reduce(
      (sum, i) => sum + Math.max(0, toPaise(i.netAmount) - toPaise(i.paidAmount)),
      0
    )
    if (remaining > unpaidTotal) {
      throw new FeeItemError(
        `cannot reduce by ${toRupees(-deltaPaise)}: only ${toRupees(unpaidTotal)} is still unpaid`
      )
    }
    for (const inst of [...item.installments].reverse()) {
      if (remaining <= 0) break
      const net = toPaise(inst.netAmount)
      const paid = toPaise(inst.paidAmount)
      const reducible = net - paid
      if (reducible <= 0) continue
      const take = Math.min(remaining, reducible)
      const newNet = net - take
      await tx.feeInstallment.update({
        where: { id: inst.id },
        data: {
          originalAmount: toRupees(toPaise(inst.originalAmount) - take),
          netAmount: toRupees(newNet),
          status: statusFor(newNet, paid),
        },
      })
      remaining -= take
    }
  }

  const netPaise = newOriginalPaise - toPaise(item.discountAmount)
  return tx.studentFeeItem.update({
    where: { id: feeItemId },
    data: {
      originalAmount: toRupees(newOriginalPaise),
      netAmount: toRupees(netPaise),
      dueAmount: toRupees(netPaise - toPaise(item.paidAmount)),
    },
    include: { installments: { orderBy: { sequence: 'asc' } } },
  })
}

/** Remove a fee item. Refused once any payment has been allocated to it. */
export async function deleteFeeItem(tx: Prisma.TransactionClient, feeItemId: number) {
  const item = await tx.studentFeeItem.findUnique({ where: { id: feeItemId } })
  if (!item) throw new FeeItemError('fee item not found', 404)
  if (toPaise(item.paidAmount) > 0) {
    throw new FeeItemError(
      'cannot remove a fee that has payments against it; cancel its transactions first',
      409
    )
  }
  // paidAmount = 0 means any allocation rows left on these installments belong
  // to CANCELLED transactions; drop them so the installments can be removed.
  await tx.transactionAllocation.deleteMany({
    where: { installment: { feeItemId } },
  })
  await tx.studentFeeItem.delete({ where: { id: feeItemId } })
}

/**
 * Turn a fee-structure item's due-date schedule into an explicit installment
 * plan, so a new enrollment's installments arrive already dated.
 *
 * Returns null when the item carries no schedule; the caller then falls back
 * to an undated even split, exactly as before. An undated installment cannot
 * be judged on time or late, so the recovery module's timing analysis falls
 * back to session-relative timing for those items rather than guessing.
 */
export function planFromSchedule(
  amount: number,
  schedule: { sequence: number; label: string; dueDate: Date }[]
): InstallmentPlanInput[] | null {
  if (schedule.length === 0) return null
  const ordered = [...schedule].sort((a, b) => a.sequence - b.sequence)
  const amounts = splitAmount(amount, ordered.length)
  return ordered.map((row, i) => ({
    amount: amounts[i],
    label: row.label,
    dueDate: row.dueDate,
  }))
}

/**
 * Copy the class-wise fee structure (for the enrollment's session + class)
 * onto an enrollment. Items whose name is already assigned are skipped, so
 * the call is idempotent and manual additions survive.
 *
 * Where a structure item defines a due-date schedule, the created
 * installments pick those dates up automatically.
 */
export async function applyStructureToEnrollment(
  tx: Prisma.TransactionClient,
  enrollmentId: number
) {
  const enrollment = await tx.studentEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { classroom: true, feeItems: { select: { name: true } } },
  })
  if (!enrollment) throw new FeeItemError('enrollment not found', 404)

  const structure = await tx.feeStructure.findUnique({
    where: {
      sessionId_classId: {
        sessionId: enrollment.sessionId,
        classId: enrollment.classroom.classId,
      },
    },
    include: { items: { include: { schedule: { orderBy: { sequence: 'asc' } } } } },
  })
  if (!structure) {
    throw new FeeItemError('no fee structure defined for this class and session', 404)
  }

  const existingNames = new Set(enrollment.feeItems.map((f) => f.name))
  const created = []
  for (const item of structure.items) {
    if (existingNames.has(item.name)) continue
    const amount = Number(item.amount)
    created.push(
      await createFeeItem(tx, {
        enrollmentId,
        category: item.category,
        name: item.name,
        amount,
        installments: planFromSchedule(amount, item.schedule) ?? item.installmentCount,
        structureItemId: item.id,
      })
    )
  }
  return created
}
