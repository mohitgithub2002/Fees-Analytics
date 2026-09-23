import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId } from '@/lib/fees/api'
import { cached, TAGS } from '@/lib/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { loadTuning } from '@/lib/recovery/config'
import { buildForecast } from '@/lib/recovery/forecast'
import { ARCHETYPE_LABEL, TIER_LABEL, type PaymentArchetype } from '@/lib/recovery/types'

/**
 * The command centre: money, the day's work, and what is blocking it.
 *
 * Deliberately leads with what can be ACTED on rather than with a wall of
 * totals. A dashboard that opens on "₹1.3 crore outstanding" tells the owner
 * something they already know and nothing they can do today.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const raw = request.nextUrl.searchParams.get('sessionId')
  const sessionId = raw ? parseId(raw) : null
  if (raw && !sessionId) return err('invalid sessionId')

  try {
    const session = sessionId
      ? await prisma.academicSession.findUnique({ where: { id: sessionId } })
      : await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!session) return err('no current academic session', 404)

    const data = await cached(
      `recovery:overview:${session.id}`,
      { tags: [TAGS.recovery, TAGS.fees], ttlMs: 60_000 },
      async () => {
        const tuning = await loadTuning()
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const tomorrow = new Date(today.getTime() + 86_400_000)
        const weekAhead = new Date(today.getTime() + 7 * 86_400_000)

        const [
          money,
          callable,
          suppressed,
          pinned,
          noContact,
          promisesDue,
          overduePromises,
          byArchetype,
          untagged,
          topCases,
          needsReview,
          lastComputed,
          recentContacts,
        ] = await Promise.all([
          prisma.recoveryCase.aggregate({
            where: { sessionId: session.id },
            _sum: { outstanding: true, expectedRecoveryValue: true, recoveredAmount: true },
            _count: { _all: true },
          }),
          prisma.recoveryCase.count({
            where: { sessionId: session.id, suppressionRule: null },
          }),
          prisma.recoveryCase.count({
            where: { sessionId: session.id, suppressionRule: { not: null } },
          }),
          prisma.recoveryCase.count({
            where: { sessionId: session.id, pinnedForDate: { gte: today, lt: tomorrow } },
          }),
          prisma.recoveryCase.count({
            where: { sessionId: session.id, suppressionRule: 'NO_CONTACT' },
          }),
          prisma.promiseToPay.aggregate({
            where: { status: 'OPEN', promisedFor: { gte: today, lt: weekAhead } },
            _sum: { amount: true },
            _count: { _all: true },
          }),
          prisma.promiseToPay.count({
            where: { status: 'OPEN', promisedFor: { lt: today } },
          }),
          prisma.householdProfile.groupBy({
            by: ['archetype'],
            _count: { _all: true },
            _sum: { totalOutstanding: true },
          }),
          prisma.household.aggregate({
            where: { isActive: true, economicTier: 'UNKNOWN' },
            _count: { _all: true },
          }),
          prisma.recoveryCase.findMany({
            where: { sessionId: session.id, suppressionRule: null },
            orderBy: { priorityScore: 'desc' },
            take: 10,
            select: {
              id: true,
              outstanding: true,
              expectedRecoveryValue: true,
              household: {
                select: {
                  id: true,
                  displayName: true,
                  economicTier: true,
                  profile: { select: { archetype: true, childrenCount: true } },
                },
              },
            },
          }),
          prisma.household.count({ where: { isActive: true, needsReview: true } }),
          prisma.householdProfile.aggregate({ _max: { computedAt: true } }),
          prisma.contactAttempt.count({
            where: { contactedAt: { gte: new Date(today.getTime() - 7 * 86_400_000) } },
          }),
        ])

        // One month ahead is what the question "where does next month's money
        // come from" actually asks; the full horizon lives on /recovery/forecast.
        const forecast = await buildForecast({ sessionId: session.id, months: 1, now })
        const nextMonth = forecast.months[0] ?? null

        return {
          session: { id: session.id, name: session.name },
          lastComputedAt: lastComputed._max.computedAt,

          money: {
            outstanding: Number(money._sum.outstanding ?? 0),
            expectedRecovery: Number(money._sum.expectedRecoveryValue ?? 0),
            recovered: Number(money._sum.recoveredAmount ?? 0),
            households: money._count._all,
          },

          today: {
            callable,
            suppressed,
            pinned,
            dailyCallTarget: tuning.dailyCallTarget,
            callsLastSevenDays: recentContacts,
          },

          promises: {
            dueThisWeek: promisesDue._count._all,
            dueThisWeekAmount: Number(promisesDue._sum.amount ?? 0),
            overdue: overduePromises,
          },

          nextMonth: nextMonth
            ? {
                month: nextMonth.month,
                committed: nextMonth.committed,
                likely: nextMonth.likely,
                stretch: nextMonth.stretch,
                sources: nextMonth.sources,
              }
            : null,

          blockers: {
            // Ordered by how much they cost: a household nobody can phone is
            // unreachable however good the ranking is.
            noContactDetails: noContact,
            untaggedAbility: untagged._count._all,
            householdsNeedingReview: needsReview,
            forecastCoverage: forecast.coverage.message,
          },

          mix: byArchetype
            .map((row) => ({
              archetype: row.archetype as PaymentArchetype,
              label: ARCHETYPE_LABEL[row.archetype as PaymentArchetype] ?? row.archetype,
              households: row._count._all,
              outstanding: Number(row._sum.totalOutstanding ?? 0),
            }))
            .sort((a, b) => b.outstanding - a.outstanding),

          topHouseholds: topCases.map((c) => ({
            caseId: c.id,
            householdId: c.household.id,
            displayName: c.household.displayName,
            archetype: c.household.profile?.archetype ?? 'UNKNOWN',
            archetypeLabel:
              ARCHETYPE_LABEL[(c.household.profile?.archetype ?? 'UNKNOWN') as PaymentArchetype],
            tier: c.household.economicTier,
            tierLabel: TIER_LABEL[c.household.economicTier],
            children: c.household.profile?.childrenCount ?? 0,
            outstanding: Number(c.outstanding),
            expectedRecoveryValue: Number(c.expectedRecoveryValue),
          })),
        }
      }
    )

    return ok({ data })
  } catch (e) {
    return handleError(e)
  }
}
