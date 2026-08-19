import { NextRequest } from 'next/server'
import { $Enums } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { err, ok } from '@/lib/fees/api'
import { loadTuning } from '@/lib/recovery/config'

/**
 * Today's call list. This is the daily driver — optimised to answer "who do I
 * call, in what order, and why" in one request.
 *
 * Households are pre-ranked by RecoveryCase.expectedRecoveryValue at recompute
 * time (see src/lib/recovery/recompute.ts), so ranking here is a plain SQL
 * ORDER BY rather than in-memory scoring. Suppressed households are never
 * dropped silently — they come back in `skipped`, each with the reason a
 * human can override.
 */

const STAGE_FILTERS: Record<string, object> = {
  all: {},
  promises: { guardian: { promises: { some: { status: 'OPEN' } } } },
  broken: { guardian: { promises: { some: { status: 'BROKEN' } } } },
  new: { stage: 'NEW' },
  'no-answer': { stage: 'CONTACTED' },
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const filter = sp.get('filter') ?? 'all'
  const includePinnedOnly = sp.get('pinned') === 'true'

  const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (!session) return err('no current session set', 400)

  const tuning = await loadTuning()
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || '') || tuning.dailyCallTarget))

  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  const baseWhere = {
    sessionId: session.id,
    ...(STAGE_FILTERS[filter] ?? {}),
    ...(includePinnedOnly ? { pinnedForDate: { gte: todayStart } } : {}),
  }

  const include = {
    guardian: {
      select: {
        id: true,
        name: true,
        phone: true,
        altPhone: true,
        economicTier: true,
        profile: true,
        students: {
          where: { isPayer: true },
          select: {
            student: {
              select: {
                id: true,
                name: true,
                enrollments: {
                  where: { sessionId: session.id },
                  select: { classroom: { select: { class: { select: { name: true } } } } },
                  take: 1,
                },
              },
            },
          },
        },
        promises: {
          where: { status: { in: [$Enums.PromiseStatus.OPEN, $Enums.PromiseStatus.BROKEN] } },
          orderBy: { promisedFor: 'asc' as const },
          take: 1,
        },
      },
    },
  }

  const [queue, skipped] = await Promise.all([
    prisma.recoveryCase.findMany({
      where: { ...baseWhere, suppressionReason: null },
      orderBy: [{ pinnedForDate: 'desc' }, { expectedRecoveryValue: 'desc' }],
      take: limit,
      include,
    }),
    prisma.recoveryCase.findMany({
      where: { ...baseWhere, suppressionReason: { not: null } },
      orderBy: { expectedRecoveryValue: 'desc' },
      select: {
        id: true,
        outstanding: true,
        suppressionReason: true,
        guardian: { select: { id: true, name: true } },
      },
    }),
  ])

  return ok({
    date: todayStart.toISOString().slice(0, 10),
    sessionId: session.id,
    dailyCallTarget: tuning.dailyCallTarget,
    queue: queue.map(shapeCase),
    skipped: skipped.map((c) => ({
      caseId: c.id,
      guardianId: c.guardian.id,
      name: c.guardian.name,
      outstanding: Number(c.outstanding),
      reason: c.suppressionReason,
    })),
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeCase(c: any) {
  const children = c.guardian.students.map((gs: { student: {
    id: number; name: string; enrollments: { classroom: { class: { name: string } } }[]
  } }) => ({
    id: gs.student.id,
    name: gs.student.name,
    class: gs.student.enrollments[0]?.classroom.class.name ?? null,
  }))
  const nextPromise = c.guardian.promises[0] ?? null

  return {
    caseId: c.id,
    stage: c.stage,
    outstanding: Number(c.outstanding),
    expectedRecoveryValue: Number(c.expectedRecoveryValue),
    priorityScore: c.priorityScore,
    pinned: !!c.pinnedForDate,
    lastContactAt: c.lastContactAt,
    contactCount: c.contactCount,
    guardian: {
      id: c.guardian.id,
      name: c.guardian.name,
      phone: c.guardian.phone,
      altPhone: c.guardian.altPhone,
      economicTier: c.guardian.economicTier,
      archetype: c.guardian.profile?.archetype ?? 'UNKNOWN',
      archetypeConfidence: c.guardian.profile?.archetypeConfidence ?? 0,
      evidence: (c.guardian.profile?.evidence as string[] | null) ?? [],
      children,
    },
    promise: nextPromise
      ? {
          id: nextPromise.id,
          amount: Number(nextPromise.amount),
          promisedFor: nextPromise.promisedFor,
          status: nextPromise.status,
        }
      : null,
  }
}
