import { isWorthChasing } from './archetype'
import type {
  GuardianFeatures,
  PaymentArchetype,
  RecoveryTuning,
  SuppressionVerdict,
} from './types'

/**
 * Who should NOT be called today.
 *
 * This is the half of the system that saves effort rather than finding money,
 * and it is the half that decides whether the call list gets trusted. A list
 * that keeps offering up families who paid last week, or who already promised
 * a date, or who reliably pay on their own, is a list the owner stops opening
 * after a fortnight.
 *
 * Two rules the whole design rests on:
 *   1. Suppression is always *explained and reversible*. Skipped households are
 *      listed with their reason, never silently dropped — the owner overrules
 *      the system, not the other way round.
 *   2. Every threshold lives in RecoveryConfig, because the person who knows
 *      whether five days is too soon to call again is the person running the
 *      school, not this file.
 */

const DAY_MS = 86_400_000
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS)
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`
const formatDate = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

export interface SuppressionInput {
  features: GuardianFeatures
  archetype: PaymentArchetype
  /** Workflow state a human set, which outranks every derived rule below. */
  snoozedUntil?: Date | null
  parkedReason?: string | null
  pinnedForDate?: Date | null
  lastContactAt?: Date | null
}

const none: SuppressionVerdict = { suppressed: false, reason: null, until: null }

export function evaluateSuppression(
  input: SuppressionInput,
  tuning: RecoveryTuning,
  now: Date = new Date()
): SuppressionVerdict {
  const f = input.features

  /* ── A human explicitly asked for this household today ──────────────── */

  if (input.pinnedForDate && sameDay(input.pinnedForDate, now)) return none

  /* ── Nothing to collect ─────────────────────────────────────────────── */

  if (f.totalOutstandingPaise <= 0) {
    return {
      suppressed: true,
      reason: 'Fully paid — nothing outstanding.',
      until: null,
    }
  }

  if (f.totalOutstandingPaise < tuning.minOutstandingPaise) {
    return {
      suppressed: true,
      reason: `Only ${rupees(f.totalOutstandingPaise)} outstanding — below the ${rupees(
        tuning.minOutstandingPaise
      )} threshold worth a call.`,
      until: null,
    }
  }

  /* ── Human decisions ────────────────────────────────────────────────── */

  if (input.parkedReason) {
    return {
      suppressed: true,
      reason: `Parked: ${input.parkedReason}`,
      until: null,
    }
  }

  if (input.snoozedUntil && input.snoozedUntil > now) {
    return {
      suppressed: true,
      reason: `Snoozed until ${formatDate(input.snoozedUntil)}.`,
      until: input.snoozedUntil,
    }
  }

  /* ── They just paid ─────────────────────────────────────────────────── */

  if (
    f.daysSinceLastPayment !== null &&
    f.daysSinceLastPayment < tuning.justPaidSuppressDays &&
    f.lastPaymentAt
  ) {
    const until = addDays(f.lastPaymentAt, tuning.justPaidSuppressDays)
    return {
      suppressed: true,
      reason: `Just paid ${rupees(f.lastPaymentPaise ?? 0)} on ${formatDate(f.lastPaymentAt)}.`,
      until,
    }
  }

  /* ── They already told us a date ────────────────────────────────────── */

  if (f.hasOpenPromise && f.openPromiseDate) {
    const deadline = addDays(f.openPromiseDate, tuning.promiseGraceDays)
    if (deadline > now) {
      return {
        suppressed: true,
        reason: `Promised ${rupees(f.openPromisePaise)} by ${formatDate(f.openPromiseDate)} — wait for the date.`,
        until: deadline,
      }
    }
    // Past the grace period the promise is broken, and that is a reason TO
    // call, not to hold off — fall through.
  }

  /* ── We just spoke to them ──────────────────────────────────────────── */

  if (input.lastContactAt) {
    const until = addDays(input.lastContactAt, tuning.cooldownDays)
    if (until > now) {
      return {
        suppressed: true,
        reason: `Contacted on ${formatDate(input.lastContactAt)} — cooling off for ${tuning.cooldownDays} days.`,
        until,
      }
    }
  }

  /* ── The phone is not being answered ────────────────────────────────── */

  if (f.consecutiveNoAnswer >= tuning.noAnswerBackoffThreshold && input.lastContactAt) {
    const until = addDays(input.lastContactAt, tuning.noAnswerBackoffDays)
    if (until > now) {
      return {
        suppressed: true,
        reason: `${f.consecutiveNoAnswer} unanswered calls — backing off until ${formatDate(until)}. Try the alternate number or a home visit.`,
        until,
      }
    }
  }

  /* ── They pay reliably on their own ─────────────────────────────────── */

  // Only holds while nothing is actually overdue: a regular payer with a
  // genuinely missed due date is worth one call, because for them it is
  // usually an oversight rather than a shortage.
  if (!isWorthChasing(input.archetype) && !hasOverdueInstallment(f, now)) {
    return {
      suppressed: true,
      reason: 'Pays reliably on schedule — nothing is overdue yet.',
      until: null,
    }
  }

  return none
}

/**
 * Is any installment past its due date and still unsettled? Derived from the
 * per-session counts rather than a fresh query: an installment counted as due
 * but not met on time is exactly one that has slipped.
 */
function hasOverdueInstallment(f: GuardianFeatures, now: Date): boolean {
  const current = f.current
  if (current) {
    if (current.installmentsDue > current.installmentsPaidOnTime && current.duePaise > 0) {
      return true
    }
    // No due dates recorded at all: fall back to "the session is more than
    // half over and money is still owed".
    if (current.installmentsDue === 0 && current.duePaise > 0) {
      const elapsed = (now.getTime() - current.startDate.getTime()) / DAY_MS
      return elapsed > current.lengthDays / 2
    }
  }
  return f.pastSessionsDuePaise > 0
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
