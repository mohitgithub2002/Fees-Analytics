import { prisma } from '@/lib/prisma'
import { toRupees } from '@/lib/fees/money'
import { invalidateTags, TAGS } from '@/lib/cache'
import { classifyArchetype } from './archetype'
import { loadTuning } from './config'
import { buildFeatures } from './features'
import { reliabilityScore, scorePropensity } from './propensity'
import { resolvePromises } from './promises'
import { suggestTier } from './tier'
import { evaluateSuppression } from './suppression'
import type { GuardianFeatures, RecoveryStage } from './types'

/**
 * Refresh the derived layer: GuardianProfile (what we believe about a
 * household) and RecoveryCase (what should happen about it).
 *
 * Same contract as SyllabusPacing — never written by a human, always
 * recomputable, and **idempotent**: identical ledger state must always yield
 * identical rows. That is what lets this run after every payment without
 * anyone having to think about ordering.
 *
 * The split between the two tables matters: profiles are rebuilt wholesale
 * each time, while cases carry decisions a person made (snoozed, parked,
 * pinned, stage) that a recompute must never trample.
 */

export interface RecomputeResult {
  guardians: number
  cases: number
  promises: { kept: number; partial: number; broken: number; stillOpen: number }
  durationMs: number
}

export async function recomputeRecovery(
  guardianIds?: number[],
  now: Date = new Date()
): Promise<RecomputeResult> {
  const started = Date.now()

  // Promises first: a promise that just came due changes both the propensity
  // score and whether the household is suppressed today.
  const promises = await resolvePromises(now)

  const [tuning, features, currentSession] = await Promise.all([
    loadTuning(),
    buildFeatures(guardianIds, now),
    prisma.academicSession.findFirst({ where: { isCurrent: true } }),
  ])

  if (features.size === 0) {
    return { guardians: 0, cases: 0, promises, durationMs: Date.now() - started }
  }

  const ids = [...features.keys()]
  const [guardians, existingCases] = await Promise.all([
    prisma.guardian.findMany({
      where: { id: { in: ids } },
      select: { id: true, economicTier: true },
    }),
    currentSession
      ? prisma.recoveryCase.findMany({
          where: { guardianId: { in: ids }, sessionId: currentSession.id },
        })
      : Promise.resolve([]),
  ])

  const tierByGuardian = new Map(guardians.map((g) => [g.id, g.economicTier]))
  const caseByGuardian = new Map(existingCases.map((c) => [c.guardianId, c]))

  let caseCount = 0

  for (const [guardianId, f] of features) {
    const archetype = classifyArchetype(f)
    const suggested = suggestTier(f)
    const confirmedTier = tierByGuardian.get(guardianId) ?? 'UNKNOWN'
    // The human tag wins; the suggestion only fills the gap while untagged.
    const effectiveTier = confirmedTier !== 'UNKNOWN' ? confirmedTier : suggested.tier

    const propensity = scorePropensity(f, archetype.archetype, effectiveTier, tuning, now)
    const reliability = reliabilityScore(f)

    const evidence = [
      ...archetype.evidence,
      ...propensity.factors.map((x) => x.reason),
      ...(confirmedTier === 'UNKNOWN' ? suggested.evidence.slice(0, 1) : []),
    ]

    const profileData = {
      archetype: archetype.archetype,
      archetypeConfidence: archetype.confidence,
      suggestedTier: suggested.tier,

      reliabilityScore: reliability,
      propensityScore: propensity.score,
      expectedRecovery30d: toRupees(propensity.expectedRecoveryPaise),

      totalOutstanding: toRupees(f.totalOutstandingPaise),
      currentSessionDue: toRupees(f.currentSessionDuePaise),
      pastSessionsDue: toRupees(f.pastSessionsDuePaise),
      lifetimeBilled: toRupees(f.lifetimeBilledPaise),
      lifetimePaid: toRupees(f.lifetimePaidPaise),

      sessionsTracked: f.sessionsTracked,
      sessionsWithDues: f.sessionsWithDues,
      rolloverStreak: f.rolloverStreak,
      childrenCount: f.childrenCount,

      lastPaymentAt: f.lastPaymentAt,
      lastPaymentAmount: f.lastPaymentPaise !== null ? toRupees(f.lastPaymentPaise) : null,
      avgDaysToFirstPayment: f.avgDaysToFirstPayment,
      avgClearanceDay: f.avgClearanceDay,
      onTimeInstallmentRate: f.onTimeInstallmentRate,
      avgDaysLate: f.avgDaysLate,
      avgTicket: f.avgTicketPaise !== null ? toRupees(f.avgTicketPaise) : null,

      monthHistogram: f.monthHistogram,
      evidence,

      contactAttempts: f.contactAttempts,
      contactPickRate:
        f.contactAttempts > 0 ? Math.round((f.contactsReached / f.contactAttempts) * 100) : null,
      promisesMade: f.promisesMade,
      promisesKept: f.promisesKept,

      calculatedAt: now,
    }

    await prisma.guardianProfile.upsert({
      where: { guardianId },
      create: { guardianId, ...profileData },
      update: profileData,
    })

    if (!currentSession) continue

    /* ── The case: derived numbers refreshed, human decisions preserved ── */

    const existing = caseByGuardian.get(guardianId)
    const suppression = evaluateSuppression(
      {
        features: f,
        archetype: archetype.archetype,
        snoozedUntil: existing?.snoozedUntil,
        parkedReason: existing?.parkedReason,
        pinnedForDate: existing?.pinnedForDate,
        lastContactAt: existing?.lastContactAt ?? f.lastContactAt,
      },
      tuning,
      now
    )

    const caseData = {
      priorityScore: propensity.score,
      outstanding: toRupees(f.totalOutstandingPaise),
      expectedRecoveryValue: toRupees(propensity.expectedRecoveryPaise),
      suppressedUntil: suppression.until,
      suppressionReason: suppression.suppressed ? suppression.reason : null,
      stage: nextStage(existing?.stage, f, suppression.suppressed),
    }

    await prisma.recoveryCase.upsert({
      where: { guardianId_sessionId: { guardianId, sessionId: currentSession.id } },
      create: { guardianId, sessionId: currentSession.id, ...caseData },
      update: caseData,
    })
    caseCount++
  }

  invalidateTags(TAGS.recovery)

  return {
    guardians: features.size,
    cases: caseCount,
    promises: {
      kept: promises.kept,
      partial: promises.partial,
      broken: promises.broken,
      stillOpen: promises.stillOpen,
    },
    durationMs: Date.now() - started,
  }
}

/**
 * Advance the workflow stage from what the ledger now shows, without undoing a
 * decision someone made. PARKED and SNOOZED are human states and are left
 * alone; everything else follows the money.
 */
function nextStage(
  current: RecoveryStage | undefined,
  f: GuardianFeatures,
  suppressed: boolean
): RecoveryStage {
  if (current === 'PARKED' || current === 'SNOOZED') return current

  if (f.totalOutstandingPaise <= 0) return 'RECOVERED'
  if (f.hasOpenPromise) return 'PROMISED'

  // Money has moved since the last contact, but a balance remains.
  if (
    current &&
    current !== 'NEW' &&
    f.lastPaymentAt &&
    f.lastContactAt &&
    f.lastPaymentAt > f.lastContactAt
  ) {
    return 'PARTIAL'
  }

  if (f.contactAttempts > 0) return 'CONTACTED'
  return suppressed ? (current ?? 'NEW') : 'NEW'
}

/**
 * Refresh just the households affected by one student's payment. Called from
 * the transaction endpoints so the call list reflects a payment the moment it
 * is recorded — the user's requirement that a family who pays disappears from
 * the list without anyone maintaining it.
 */
export async function recomputeForStudent(studentId: number, now: Date = new Date()) {
  const links = await prisma.guardianStudent.findMany({
    where: { studentId },
    select: { guardianId: true },
  })
  if (links.length === 0) return null
  return recomputeRecovery(
    links.map((l) => l.guardianId),
    now
  )
}
