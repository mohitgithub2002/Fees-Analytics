/**
 * Rebuild the derived half of the module: household profiles and the score
 * columns on their recovery cases.
 *
 * Idempotent by construction. Running it twice in a row produces the same
 * rows, so it is safe from a button, a script or a cron hook, and safe to run
 * again when a run is interrupted.
 *
 * The rule that matters most here is what it does NOT write. A RecoveryCase
 * carries two kinds of column side by side: numbers this file owns, and
 * decisions a person made — stage, snooze, park, pin, assignment. A recompute
 * that reset a parked hardship case every night would quietly undo the owner's
 * judgement, and they would stop trusting the list. So the human columns are
 * read (suppression has to respect them) and never written, with one factual
 * exception noted below.
 */
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { classifyArchetype } from './archetype'
import { loadTuning } from './config'
import { buildFeatures } from './features'
import { snapshotForecast } from './forecast'
import { resolvePromises } from './promises'
import {
  expectedCollectable,
  expectedRecoveryValue,
  reliabilityScore,
  scorePropensity,
} from './propensity'
import { suggestTier } from './tier'
import { evaluateSuppression } from './suppression'
import type { CaseState, HouseholdFeatures, RecoveryStage } from './types'

/** Written in batches so ~530 households is a handful of round trips. */
const WRITE_CHUNK = 50

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface RecomputeResult {
  sessionId: number
  sessionName: string
  households: number
  suppressed: number
  callable: number
  promises: { kept: number; partial: number; broken: number; stillOpen: number }
  totalOutstanding: number
  totalExpectedRecovery: number
  durationMs: number
}

/**
 * Urgency nudge applied on top of expected recovery.
 *
 * Two families with the same expected recovery are not equally urgent: the one
 * with three installments already past their due date should be called first.
 * Capped at +50% so urgency can break a tie without overturning the ranking —
 * being very late is not the same as being likely to pay.
 */
function urgencyMultiplier(f: HouseholdFeatures): number {
  return 1 + Math.min(0.5, f.overdueInstallments * 0.1)
}

/**
 * @param householdIds narrows the run to a few families. The totals in the
 * result are then those families' totals, not the school's.
 */
export async function recomputeRecovery(
  opts: { sessionId?: number; now?: Date; householdIds?: number[] } = {}
): Promise<RecomputeResult> {
  const started = Date.now()
  const now = opts.now ?? new Date()

  // Settle promises FIRST so the feature vectors see current promise state —
  // otherwise a promise kept yesterday would still suppress its household.
  const promises = await resolvePromises({ now })

  const { features, session } = await buildFeatures({
    sessionId: opts.sessionId,
    now,
    householdIds: opts.householdIds,
  })
  const tuning = await loadTuning()

  const existingCases = await prisma.recoveryCase.findMany({
    where: {
      sessionId: session.id,
      ...(opts.householdIds ? { householdId: { in: opts.householdIds } } : {}),
    },
    select: {
      id: true,
      householdId: true,
      stage: true,
      snoozedUntil: true,
      parkedReason: true,
      pinnedForDate: true,
      contactCount: true,
    },
  })
  const caseByHousehold = new Map(existingCases.map((c) => [c.householdId, c]))

  let suppressedCount = 0
  let totalOutstanding = 0
  let totalExpectedRecovery = 0

  const profilePayloads: { householdId: number; data: Record<string, unknown> }[] = []
  const casePayloads: { householdId: number; data: Record<string, unknown> }[] = []

  for (const f of features.values()) {
    const verdict = classifyArchetype(f)
    const tierHint = suggestTier(f)
    const propensity = scorePropensity(f, verdict.archetype, tuning, { now })
    const collectable = expectedCollectable(f)
    const erv = expectedRecoveryValue(propensity.score, collectable, f.totalOutstanding)
    const reliability = reliabilityScore(f, verdict.archetype)

    const existing = caseByHousehold.get(f.householdId)
    // pinnedForDate is deliberately NOT passed here. A pin is an override for
    // one day, applied when the worklist is read (it fetches pinned cases
    // separately). Letting it clear the stored suppression would leave the
    // household looking callable tomorrow, after the pin has expired, until
    // the next recompute happened to run — so what gets stored is the real
    // reason, independent of any pin.
    const state: CaseState = {
      stage: (existing?.stage ?? 'NEW') as RecoveryStage,
      snoozedUntil: existing?.snoozedUntil ?? null,
      parkedReason: existing?.parkedReason ?? null,
      pinnedForDate: null,
    }

    const suppression = evaluateSuppression(f, verdict.archetype, state, tuning, { now })
    if (suppression.suppressed) suppressedCount++

    totalOutstanding += f.totalOutstanding
    if (!suppression.suppressed) totalExpectedRecovery += erv

    // The evidence the UI renders verbatim: why this archetype, then why this
    // score. Tier evidence only when the system actually has something to say.
    const evidence = [
      ...verdict.evidence,
      ...propensity.evidence,
      ...(tierHint.confidence > 0 ? tierHint.evidence : []),
    ]

    profilePayloads.push({
      householdId: f.householdId,
      data: {
        archetype: verdict.archetype,
        carryConfidence: verdict.carryConfidence,
        timingConfidence: verdict.timingConfidence,
        suggestedTier: tierHint.tier,
        evidence,

        totalOutstanding: f.totalOutstanding,
        currentSessionDue: f.currentSessionDue,
        pastSessionsDue: f.pastSessionsDue,
        lifetimeBilled: f.lifetimeBilled,
        lifetimePaid: f.lifetimePaid,
        avgTicket: f.avgTicket,

        sessionsTracked: f.sessionsTracked,
        sessionsWithOpenDues: f.sessionsWithOpenDues,
        currentPaidRatio: f.currentPaidRatio,
        rolloverStreak: f.rolloverStreak,
        childrenCount: f.childrenCount,

        timingProvenance: f.timingProvenance,
        lastPaymentAt: f.lastPaymentAt,
        lastPaymentAmount: f.lastPaymentAmount,
        daysToFirstPayment: f.daysToFirstPayment,
        onTimeInstallmentRate: f.onTimeInstallmentRate,
        avgDaysLate: f.avgDaysLate,
        clearanceDay: f.clearanceDay,
        monthHistogram: f.monthHistogram,

        reliabilityScore: reliability,
        propensityScore: propensity.score,
        expectedRecovery30d: erv,

        reachableContacts: f.reachableContacts,
        contactAttempts: f.contactAttempts,
        contactPickRate: f.contactPickRate,
        promisesMade: f.promisesMade,
        promisesKept: f.promisesKept,

        computedAt: now,
      },
    })

    casePayloads.push({
      householdId: f.householdId,
      data: {
        outstanding: f.totalOutstanding,
        expectedRecoveryValue: erv,
        priorityScore: erv * urgencyMultiplier(f),
        suppressedUntil: suppression.until,
        suppressionReason: suppression.reason,
        suppressionRule: suppression.rule,
        lastContactAt: f.lastContactAt,
        // The one factual stage transition this file owns — see below.
        ...factualStage(existing?.stage as RecoveryStage | undefined, f, existing?.contactCount ?? 0),
      },
    })
  }

  // --- Write the derived half ------------------------------------------
  //
  // Set-based on purpose. An earlier version ran chunks of 50 upserts inside
  // transactions: against a remote pooler each statement costs a round trip,
  // so a chunk took longer than the 5s transaction timeout, and running the
  // chunks concurrently instead just exhausted the connection pool. Neither
  // failure is about this school's size — 400 households is nothing — they
  // are about doing per-row work over a network.
  //
  // Profiles are rebuilt wholesale by contract, so they are simply replaced.
  // No transaction is needed: the whole recompute is idempotent, so a run
  // interrupted halfway is fixed by running it again.
  const scopedHouseholds = opts.householdIds
  await prisma.householdProfile.deleteMany({
    where: scopedHouseholds ? { householdId: { in: scopedHouseholds } } : {},
  })
  for (const group of chunk(profilePayloads, WRITE_CHUNK)) {
    await prisma.householdProfile.createMany({
      data: group.map((p) => ({ householdId: p.householdId, ...p.data })) as never,
    })
  }

  // Cases cannot be replaced — they carry the human columns. One INSERT ...
  // ON CONFLICT per chunk updates only the four derived columns and leaves
  // stage, snooze, park, pin and assignment untouched.
  for (const group of chunk(casePayloads, WRITE_CHUNK)) {
    const values = group.map((c) => {
      const d = c.data as {
        outstanding: number
        expectedRecoveryValue: number
        priorityScore: number
        suppressedUntil: Date | null
        suppressionReason: string | null
        suppressionRule: string | null
        lastContactAt: Date | null
      }
      return Prisma.sql`(${c.householdId}, ${session.id}, ${d.outstanding}, ${d.expectedRecoveryValue},
        ${d.priorityScore}, ${d.suppressedUntil}, ${d.suppressionReason}, ${d.suppressionRule},
        ${d.lastContactAt}, NOW(), NOW())`
    })

    await prisma.$executeRaw`
      INSERT INTO "RecoveryCase" (
        "householdId", "sessionId", "outstanding", "expectedRecoveryValue",
        "priorityScore", "suppressedUntil", "suppressionReason", "suppressionRule",
        "lastContactAt", "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("householdId", "sessionId") DO UPDATE SET
        "outstanding"           = EXCLUDED."outstanding",
        "expectedRecoveryValue" = EXCLUDED."expectedRecoveryValue",
        "priorityScore"         = EXCLUDED."priorityScore",
        "suppressedUntil"       = EXCLUDED."suppressedUntil",
        "suppressionReason"     = EXCLUDED."suppressionReason",
        "suppressionRule"       = EXCLUDED."suppressionRule",
        "lastContactAt"         = EXCLUDED."lastContactAt",
        "updatedAt"             = NOW()
    `
  }

  // The one factual stage transition this file owns, expressed as two
  // set-based updates rather than a per-row decision. PARKED is never
  // overwritten: parking is a deliberate statement about a family's
  // circumstances, and clearing one bill does not retract it.
  const stageScope = scopedHouseholds ? { householdId: { in: scopedHouseholds } } : {}
  await prisma.recoveryCase.updateMany({
    where: {
      ...stageScope,
      sessionId: session.id,
      outstanding: { lte: 0 },
      stage: { notIn: ['PARKED', 'RECOVERED'] },
    },
    data: { stage: 'RECOVERED' },
  })
  await prisma.recoveryCase.updateMany({
    where: {
      ...stageScope,
      sessionId: session.id,
      outstanding: { gt: 0 },
      stage: 'RECOVERED',
    },
    data: { stage: 'CONTACTED' },
  })

  // Snapshot the forecast so it can be graded against reality later — but only
  // on a school-wide run. A scoped run sees a handful of households, and
  // storing that as the month's prediction would quietly poison the accuracy
  // history that the calibration factor is built from.
  if (!opts.householdIds) {
    await snapshotForecast({ sessionId: session.id, now })
  }

  return {
    sessionId: session.id,
    sessionName: session.name,
    households: features.size,
    suppressed: suppressedCount,
    callable: features.size - suppressedCount,
    promises,
    totalOutstanding,
    totalExpectedRecovery,
    durationMs: Date.now() - started,
  }
}

/**
 * The only stage change a recompute is allowed to make.
 *
 * "Cleared" is a fact about the balance, not a judgement, so the system keeps
 * it in sync in both directions: a household that pays off is marked RECOVERED
 * without anyone having to remember, and one whose balance reopens (a new
 * session's fees, a cancelled payment) comes back onto the list instead of
 * sitting in RECOVERED forever.
 *
 * PARKED is never overwritten. Parking is a deliberate statement about a
 * family's circumstances, and paying one bill does not retract it — only a
 * person reopening the case should.
 */
function factualStage(
  current: RecoveryStage | undefined,
  f: HouseholdFeatures,
  contactCount: number
): { stage?: RecoveryStage } {
  if (current === 'PARKED') return {}

  if (f.totalOutstanding <= 0) {
    return current === 'RECOVERED' ? {} : { stage: 'RECOVERED' }
  }
  if (current === 'RECOVERED') {
    return { stage: contactCount > 0 ? 'CONTACTED' : 'NEW' }
  }
  return {}
}

/**
 * Refresh one student's household after money moves.
 *
 * Called from the transaction endpoints so a family that pays mid-session
 * disappears from the worklist on the next load rather than on the next full
 * recompute — which is what makes "if he already paid the fees in between,
 * remove them from the list" true without anyone maintaining it.
 *
 * Scoped to the one household on purpose: a full school recompute here would
 * make the cashier wait seconds to record a payment. It must also never make a
 * payment fail, so callers treat an error from here as non-fatal — a stale
 * worklist row is a much smaller problem than a rejected payment.
 */
export async function recomputeForStudent(studentId: number): Promise<void> {
  const member = await prisma.householdMember.findUnique({
    where: { studentId },
    select: { householdId: true },
  })
  // A student not yet grouped into a household has nothing to refresh —
  // link-households.ts will pick them up.
  if (!member) return

  await recomputeRecovery({ householdIds: [member.householdId] })
}
