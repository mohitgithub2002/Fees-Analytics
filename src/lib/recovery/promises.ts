/**
 * Settle promises from real payments.
 *
 * Nobody ticks a box. A promise is kept or broken according to whether money
 * actually arrived, because a kept/broken record that depends on someone
 * remembering to update it is worse than no record at all — it decays into
 * flattery, and then it feeds the propensity score.
 *
 * A promise is judged over the window from when it was made to its due date
 * plus the configured grace period. Any completed payment by that household
 * inside the window counts towards it: the family said "₹5,000 by the 12th",
 * and ₹5,000 arriving by the 12th is the promise kept, whichever child's
 * account it was posted against.
 */
import { prisma } from '@/lib/prisma'
import { loadTuning } from './config'

const MS_PER_DAY = 86_400_000

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

export interface ResolveResult {
  kept: number
  partial: number
  broken: number
  stillOpen: number
}

/**
 * Resolve every open promise whose outcome is now decidable.
 *
 * Promises settle EARLY when the full amount has already arrived — a family
 * that pays the next morning should get the credit immediately, not wait out
 * the grace period before the system admits they were good for it.
 */
export async function resolvePromises(opts: { now?: Date } = {}): Promise<ResolveResult> {
  const now = opts.now ?? new Date()
  const tuning = await loadTuning()

  const open = await prisma.promiseToPay.findMany({
    where: { status: 'OPEN' },
    select: {
      id: true,
      householdId: true,
      amount: true,
      promisedFor: true,
      createdAt: true,
    },
  })
  if (open.length === 0) return { kept: 0, partial: 0, broken: 0, stillOpen: 0 }

  // One bulk read covering every household with an open promise, from the
  // earliest promise onwards — rather than a query per promise.
  const earliest = open.reduce(
    (min, p) => (p.createdAt < min ? p.createdAt : min),
    open[0].createdAt
  )
  const householdIds = [...new Set(open.map((p) => p.householdId))]

  const payments = await prisma.$queryRaw<
    { householdId: number; paidAt: Date; amount: unknown }[]
  >`
    SELECT m."householdId" AS "householdId",
           t."paidAt"      AS "paidAt",
           t."amount"      AS "amount"
    FROM "HouseholdMember" m
    JOIN "FeeTransaction" t ON t."studentId" = m."studentId"
    WHERE t."status" = 'COMPLETED'
      AND t."paidAt" >= ${earliest}
      AND m."householdId" = ANY(${householdIds}::int[])
  `

  const byHousehold = new Map<number, { paidAt: Date; amount: number }[]>()
  for (const row of payments) {
    const entry = { paidAt: row.paidAt, amount: Number(row.amount) || 0 }
    const list = byHousehold.get(row.householdId)
    if (list) list.push(entry)
    else byHousehold.set(row.householdId, [entry])
  }

  const result: ResolveResult = { kept: 0, partial: 0, broken: 0, stillOpen: 0 }
  const updates: { id: number; status: 'KEPT' | 'PARTIAL' | 'BROKEN'; settled: number }[] = []

  for (const promise of open) {
    const deadline = addDays(promise.promisedFor, tuning.promiseGraceDays)
    const window = byHousehold.get(promise.householdId) ?? []
    const paid = window
      .filter((p) => p.paidAt >= promise.createdAt && p.paidAt <= deadline)
      .reduce((sum, p) => sum + p.amount, 0)

    const promised = Number(promise.amount) || 0

    if (paid >= promised && promised > 0) {
      updates.push({ id: promise.id, status: 'KEPT', settled: paid })
      result.kept++
      continue
    }

    // Not yet due — leave it open and let it keep suppressing the household.
    if (deadline > now) {
      result.stillOpen++
      continue
    }

    if (paid > 0) {
      updates.push({ id: promise.id, status: 'PARTIAL', settled: paid })
      result.partial++
    } else {
      updates.push({ id: promise.id, status: 'BROKEN', settled: 0 })
      result.broken++
    }
  }

  for (const update of updates) {
    await prisma.promiseToPay.update({
      where: { id: update.id },
      data: {
        status: update.status,
        settledAmount: update.settled,
        settledAt: now,
        closeReason: 'Settled automatically from recorded payments.',
      },
    })
  }

  return result
}
