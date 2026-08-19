import { prisma } from '@/lib/prisma'
import { toPaise, toRupees } from '@/lib/fees/money'
import { loadTuning } from './config'

/**
 * Promise resolution — the one place the CRM and the ledger meet.
 *
 * "I'll pay ₹5,000 by the 12th" is only worth recording if the system later
 * checks whether it happened, without anybody having to tick a box. A promise
 * is settled by money actually arriving from that household between the
 * promise being made and its date (plus a grace period); nothing else counts.
 *
 * This is what makes the kept/broken ratio trustworthy, and that ratio is the
 * strongest predictor the propensity model has.
 */

const DAY_MS = 86_400_000

export interface PromiseResolution {
  checked: number
  kept: number
  partial: number
  broken: number
  stillOpen: number
}

/**
 * Settle every OPEN promise whose date (plus grace) has passed, and record
 * partial progress on those still running.
 *
 * Idempotent: re-running only ever moves promises forward from OPEN, so it is
 * safe to call on every recompute and after every payment.
 */
export async function resolvePromises(now: Date = new Date()): Promise<PromiseResolution> {
  const tuning = await loadTuning()

  const open = await prisma.promiseToPay.findMany({
    where: { status: 'OPEN' },
    include: {
      guardian: { select: { students: { where: { isPayer: true }, select: { studentId: true } } } },
    },
  })

  const result: PromiseResolution = {
    checked: open.length,
    kept: 0,
    partial: 0,
    broken: 0,
    stillOpen: 0,
  }
  if (open.length === 0) return result

  for (const promise of open) {
    const studentIds = promise.guardian.students.map((s) => s.studentId)
    const deadline = new Date(promise.promisedFor.getTime() + tuning.promiseGraceDays * DAY_MS)

    // Money from this household, received after the promise was made. Capped
    // at the deadline so a payment three months later cannot retroactively
    // turn a broken promise into a kept one.
    const paid =
      studentIds.length > 0
        ? await prisma.feeTransaction.aggregate({
            where: {
              studentId: { in: studentIds },
              status: 'COMPLETED',
              paidAt: { gte: promise.createdAt, lte: deadline },
            },
            _sum: { amount: true },
          })
        : { _sum: { amount: null } }

    const settledPaise = toPaise(paid._sum.amount ?? 0)
    const promisedPaise = toPaise(promise.amount)
    const expired = now > deadline

    let status: 'OPEN' | 'KEPT' | 'PARTIAL' | 'BROKEN' = 'OPEN'
    if (settledPaise >= promisedPaise && promisedPaise > 0) status = 'KEPT'
    else if (expired && settledPaise > 0) status = 'PARTIAL'
    else if (expired) status = 'BROKEN'

    if (status === 'OPEN') {
      result.stillOpen++
      // Keep partial progress visible while the promise is still running.
      if (settledPaise !== toPaise(promise.settledAmount)) {
        await prisma.promiseToPay.update({
          where: { id: promise.id },
          data: { settledAmount: toRupees(settledPaise) },
        })
      }
      continue
    }

    await prisma.promiseToPay.update({
      where: { id: promise.id },
      data: {
        status,
        settledAmount: toRupees(settledPaise),
        settledAt: status === 'BROKEN' ? null : now,
      },
    })

    if (status === 'KEPT') result.kept++
    else if (status === 'PARTIAL') result.partial++
    else result.broken++
  }

  return result
}
