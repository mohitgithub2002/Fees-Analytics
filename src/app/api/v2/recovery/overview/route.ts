import { prisma } from '@/lib/prisma'
import { err, ok } from '@/lib/fees/api'
import { cached, TAGS } from '@/lib/cache'
import { timingProvenance } from '@/lib/recovery/cohorts'

/**
 * Command-centre KPIs: the numbers the owner should see first thing in the
 * morning. Everything here reads the already-computed GuardianProfile /
 * RecoveryCase tables — recompute the module (POST /profiles/recalculate)
 * separately, this endpoint just reports what it last found.
 */
export async function GET() {
  const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (!session) return err('no current session set', 400)

  const payload = await cached(
    `recovery:overview:${session.id}`,
    { tags: [TAGS.recovery], ttlMs: 30_000 },
    () => computeOverview(session.id)
  )
  return ok(payload)
}

async function computeOverview(sessionId: number) {
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const todayEnd = new Date(todayStart.getTime() + 86_400_000)

  const [
    outstanding,
    recoverable,
    queuedToday,
    promisesDueToday,
    promisesBroken,
    recoveredThisMonth,
    provenance,
  ] = await Promise.all([
    prisma.guardianProfile.aggregate({ _sum: { totalOutstanding: true } }),

    prisma.recoveryCase.aggregate({
      where: { sessionId, suppressionReason: null },
      _sum: { expectedRecoveryValue: true },
      _count: true,
    }),

    prisma.recoveryCase.count({ where: { sessionId, suppressionReason: null } }),

    prisma.promiseToPay.aggregate({
      where: { sessionId, status: 'OPEN', promisedFor: { gte: todayStart, lt: todayEnd } },
      _sum: { amount: true },
      _count: true,
    }),

    prisma.promiseToPay.aggregate({
      where: { sessionId, status: 'BROKEN' },
      _sum: { amount: true },
      _count: true,
    }),

    prisma.feeTransaction.aggregate({
      where: {
        status: 'COMPLETED',
        paidAt: { gte: new Date(today.getFullYear(), today.getMonth(), 1) },
      },
      _sum: { amount: true },
    }),

    timingProvenance(),
  ])

  return {
    sessionId,
    generatedAt: today.toISOString(),
    money: {
      totalOutstanding: Number(outstanding._sum.totalOutstanding ?? 0),
      recoverableNow: Number(recoverable._sum.expectedRecoveryValue ?? 0),
      recoveredThisMonth: Number(recoveredThisMonth._sum.amount ?? 0),
    },
    actions: {
      queuedToday,
      promisesDueToday: {
        count: promisesDueToday._count,
        amount: Number(promisesDueToday._sum.amount ?? 0),
      },
      promisesBroken: {
        count: promisesBroken._count,
        amount: Number(promisesBroken._sum.amount ?? 0),
      },
    },
    dataQuality: provenance,
  }
}
