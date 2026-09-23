import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId } from '@/lib/fees/api'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { CASE_INCLUDE, shapeCase } from '@/lib/recovery/case-view'
import { loadTuning } from '@/lib/recovery/config'
import { SUPPRESSION_LABEL, type SuppressionRule } from '@/lib/recovery/types'

const MS_PER_DAY = 86_400_000

/**
 * Today's call list.
 *
 * Ranked on priorityScore — expected recovery, nudged by how overdue a family
 * is — and never on the raw balance. Sorting by outstanding ranks families by
 * how badly they are doing rather than by what the day will actually collect,
 * which is how a call list ends up spending its best hour on the people least
 * able to pay.
 *
 * The response has three parts, and the last two matter as much as the first:
 *
 *   queue    who to call, best first
 *   skipped  who was left out and WHY, grouped by reason. Shown in a collapsed
 *            row rather than silently dropped, so the owner can overrule the
 *            system instead of wondering what it did with everyone.
 *   toFix    households suppressed for something a person can act on — no
 *            usable phone number. That is work, not a skip, and it becomes
 *            invisible if it is mixed in with "wait five days".
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const rawSession = sp.get('sessionId')
  const sessionId = rawSession ? parseId(rawSession) : null
  if (rawSession && !sessionId) return err('invalid sessionId')

  const rawLimit = sp.get('limit')
  const limitOverride = rawLimit ? parseInt(rawLimit, 10) : null
  if (rawLimit && (!Number.isInteger(limitOverride) || limitOverride! < 1)) {
    return err('limit must be a positive integer')
  }

  try {
    const session = sessionId
      ? await prisma.academicSession.findUnique({ where: { id: sessionId } })
      : await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!session) return err('no current academic session', 404)

    const tuning = await loadTuning()
    const limit = Math.min(200, limitOverride ?? tuning.dailyCallTarget)

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today.getTime() + MS_PER_DAY)
    const pinnedToday = { gte: today, lt: tomorrow }

    // "Not pinned for today" has to be spelled out rather than written as
    // NOT(pinnedForDate BETWEEN ...). In SQL, NOT(NULL >= x) is NULL rather
    // than TRUE, so a plain negation silently drops every household that has
    // never been pinned — which is nearly all of them, and leaves the call
    // list empty.
    const notPinnedToday = {
      OR: [
        { pinnedForDate: null },
        { pinnedForDate: { lt: today } },
        { pinnedForDate: { gte: tomorrow } },
      ],
    }

    const [pinned, callable, skippedGroups, toFix, skippedCount, totalCallable] =
      await Promise.all([
        // A pin is the owner overruling the system for today, so these are
        // fetched separately and always lead the queue whatever they score.
        prisma.recoveryCase.findMany({
          where: { sessionId: session.id, pinnedForDate: pinnedToday },
          include: CASE_INCLUDE,
          orderBy: { priorityScore: 'desc' },
        }),
        prisma.recoveryCase.findMany({
          where: { sessionId: session.id, suppressionRule: null, ...notPinnedToday },
          include: CASE_INCLUDE,
          orderBy: { priorityScore: 'desc' },
          take: limit,
        }),
        // Grouped by RULE, not by reason. Reasons embed the specifics a caller
        // needs on one household ("Promised ₹9,127 by the 23rd"), which makes
        // every family its own group and turns "184 skipped today" into 45
        // rows of one.
        prisma.recoveryCase.groupBy({
          by: ['suppressionRule'],
          where: { sessionId: session.id, suppressionRule: { not: null } },
          _count: { _all: true },
          _sum: { outstanding: true },
          orderBy: { _count: { suppressionRule: 'desc' } },
        }),
        prisma.recoveryCase.findMany({
          where: { sessionId: session.id, suppressionRule: 'NO_CONTACT' },
          include: CASE_INCLUDE,
          orderBy: { outstanding: 'desc' },
          take: 50,
        }),
        prisma.recoveryCase.count({
          where: { sessionId: session.id, suppressionRule: { not: null } },
        }),
        prisma.recoveryCase.count({
          where: { sessionId: session.id, suppressionRule: null },
        }),
      ])

    const pinnedIds = new Set(pinned.map((c) => c.id))
    const queue = [...pinned, ...callable.filter((c) => !pinnedIds.has(c.id))]

    const noContactTotal = await prisma.recoveryCase.count({
      where: { sessionId: session.id, suppressionRule: 'NO_CONTACT' },
    })

    return ok({
      data: {
        session: { id: session.id, name: session.name },
        generatedAt: now.toISOString(),
        dailyCallTarget: tuning.dailyCallTarget,
        totals: {
          callable: totalCallable,
          shown: queue.length,
          pinned: pinned.length,
          skipped: skippedCount,
          needsContactDetails: noContactTotal,
        },
        queue: queue.map((c) => shapeCase(c, today)),
        skipped: skippedGroups.map((g) => ({
          rule: g.suppressionRule,
          reason:
            SUPPRESSION_LABEL[g.suppressionRule as SuppressionRule] ?? g.suppressionRule,
          households: g._count._all,
          outstanding: Number(g._sum.outstanding ?? 0),
        })),
        toFix: toFix.map((c) => shapeCase(c, today)),
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
