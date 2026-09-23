/**
 * Classify how a household pays.
 *
 * Pure and Prisma-free: the fixture harness drives this directly.
 *
 * Two things make this harder than a single sort on "amount outstanding", and
 * both are deliberate:
 *
 * 1. THE TWO AXES BECOME AVAILABLE AT DIFFERENT TIMES. Whether money rolls
 *    forward into the next year is a present fact in the ledger and can be read
 *    today. WHEN in the year money arrives needs dated payments and installment
 *    due dates, neither of which exists until the import has run. So confidence
 *    is reported per axis rather than as one number, and a verdict that rests
 *    on timing says so.
 *
 * 2. AN ARCHETYPE DESCRIBES A COMPLETED PATTERN. In April nobody has yet
 *    failed to pay by year end. Calling a family "leaves most of it unpaid"
 *    two weeks into the session would be an accusation, not an observation, so
 *    every year-end rule is gated on sessionProgress.
 *
 * Rules are checked worst-behaviour-first, and the first match wins. Every
 * verdict carries the evidence that produced it, rendered verbatim by the UI,
 * because the owner has to be able to disagree with it out loud.
 */
import type { ArchetypeVerdict, HouseholdFeatures, PaymentArchetype } from './types'

/** How far into the session a "by year end" judgment becomes meaningful. */
const YEAR_END_PROGRESS = 0.75
/** Clearance past this point in the session counts as "at year end". */
const LAST_QUARTER = 0.75
/** Clearance before this point counts as "up front". */
const FIRST_WINDOW = 0.3
/** At or above this share of the year's fees, treat the year as cleared. */
const CLEARED_RATIO = 0.98
/** Below this share by year end, the bulk is rolling forward. */
const HEAVY_ROLLOVER_RATIO = 0.5
/**
 * Below this share, year after year, a family is not merely slow.
 *
 * Open dues in two sessions at once is not enough on its own to call somebody
 * a chronic defaulter: a family that pays 85% and leaves a small residue does
 * that too, every single year, and branding them the same as a family paying
 * 5% puts them at the top of a call list they do not belong on. Persistence
 * has to be paired with magnitude.
 */
const CHRONIC_PAID_RATIO = 0.28
/** On-time rate at or above this counts as paying to the schedule. */
const ON_TIME_GOOD = 0.7
/** A household paying this share of the year is meaningfully engaged. */
const ENGAGED_RATIO = 0.6
/** Share of this year's payments going to old dues that says "a year behind". */
const BEHIND_SHARE = 0.6

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function money(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

/**
 * The most any verdict can claim, given how many sessions of history exist.
 *
 * One year is a sample of one. It can show what happened; it cannot show a
 * habit, and the system should not talk as though it can.
 */
export function historyCap(sessionsTracked: number): number {
  if (sessionsTracked >= 4) return 0.95
  if (sessionsTracked >= 3) return 0.9
  if (sessionsTracked >= 2) return 0.75
  return 0.6
}

/** Confidence in the timing reading, given how much of it is real. */
function timingConfidenceFor(f: HouseholdFeatures): number {
  if (f.timingProvenance === 'NONE' || f.totalPaymentCount === 0) return 0
  const cap = historyCap(f.sessionsTracked)
  if (f.timingProvenance === 'REAL') return cap
  // PARTIAL: scale by how much of the history is actually dated, and never let
  // a half-dated history speak as loudly as a complete one.
  const dated = f.datedPaymentCount / f.totalPaymentCount
  return Math.min(cap * 0.75, cap * dated)
}

/**
 * Is this household actually keeping to the payment schedule?
 *
 * Both halves are needed. The on-time rate alone is not enough, because it is
 * measured over installments that were SETTLED: a family that paid installments
 * 1 and 2 on time and then simply stopped scores a perfect 100%, and would look
 * like a model payer forever while their balance sat there. Requiring that
 * nothing is currently overdue is what closes that hole.
 */
function isOnSchedule(f: HouseholdFeatures): boolean {
  return (
    f.onTimeInstallmentRate !== null &&
    f.onTimeInstallmentRate >= ON_TIME_GOOD &&
    f.overdueInstallments === 0
  )
}

/** Where in the session the household finished paying, 0..1, or null. */
function clearanceProgress(f: HouseholdFeatures): number | null {
  if (f.clearanceDay === null) return null
  // clearanceDay is already expressed as a day-of-session; 365 is the divisor
  // rather than the exact session length because a session that runs a few
  // days over should not flip a verdict.
  return Math.min(1, Math.max(0, f.clearanceDay / 365))
}

export function classifyArchetype(f: HouseholdFeatures): ArchetypeVerdict {
  const evidence: string[] = []
  const carryCap = historyCap(f.sessionsTracked)
  const timingConfidence = timingConfidenceFor(f)
  const onSchedule = isOnSchedule(f)

  // Read the pattern off years that have FINISHED wherever there are any.
  // Judging a family only on the year they are halfway through means nobody
  // can be recognised as a year-end payer until March, however many Marches
  // they have already done it in — and for nine months of every year the whole
  // school reads as "too early to say".
  const settled = f.completedSessions > 0
  const paidRatio = settled ? (f.avgEndPaidRatio ?? 0) : f.currentPaidRatio
  const clearance = settled ? f.avgClearanceProgress : clearanceProgress(f)
  // A finished year can be judged on its outcome; an unfinished one only once
  // enough of it has elapsed to be fair.
  const canJudgeYearEnd = settled || f.sessionProgress >= YEAR_END_PROGRESS
  const period = settled
    ? f.completedSessions === 1
      ? 'last year'
      : `the last ${f.completedSessions} years`
    : 'this year'

  const verdict = (
    archetype: PaymentArchetype,
    carryConfidence: number
  ): ArchetypeVerdict => {
    if (f.sessionsTracked <= 1 && archetype !== 'UNKNOWN') {
      evidence.push(
        'Based on a single year of history — treat this as a first read, not a settled pattern.'
      )
    }
    if (f.timingProvenance === 'NONE' && archetype !== 'UNKNOWN') {
      evidence.push('No payment dates are recorded, so this rests on balances alone.')
    }
    return {
      archetype,
      carryConfidence: Math.min(carryCap, carryConfidence),
      timingConfidence,
      evidence,
    }
  }

  // --- 0. Is there anything to classify at all? ----------------------
  // A household with no fees on record cannot be rolling anything over.
  // Without this guard every newly enrolled family reads as "leaves most of it
  // unpaid" from the moment the year is three quarters gone, purely because
  // zero paid out of zero billed is a ratio of zero.
  if (f.currentSessionBilled <= 0 && f.pastSessionsDue <= 0 && f.lifetimeBilled <= 0) {
    evidence.push('No fees have been assigned to this family yet.')
    return {
      archetype: 'UNKNOWN',
      carryConfidence: 0,
      timingConfidence: 0,
      evidence,
    }
  }

  // --- 1. Owes for more than one year --------------------------------
  // Open dues in two or more sessions at once — a present fact in the ledger,
  // needing no payment dates — AND consistently paying only a fraction of what
  // is billed. Both halves are required; see CHRONIC_PAID_RATIO.
  const everydayRatio = f.avgEndPaidRatio ?? f.currentPaidRatio
  if (f.sessionsWithOpenDues >= 2 && everydayRatio < CHRONIC_PAID_RATIO) {
    evidence.push(
      `Has unpaid fees in ${f.sessionsWithOpenDues} different years at the same time.`
    )
    evidence.push(`Pays only ${pct(everydayRatio)} of what is billed, year after year.`)
    if (f.pastSessionsDue > 0) {
      evidence.push(`${money(f.pastSessionsDue)} of that is from earlier years.`)
    }
    // Close to certain — arithmetic on open balances, not an inference about
    // behaviour.
    return verdict('CHRONIC_DEFAULTER', 0.95)
  }

  // --- 2. Always a year behind ---------------------------------------
  // They are paying — the money is just going to last year's bill while this
  // year's accrues behind it.
  if (
    f.pastSessionsDue > 0 &&
    f.pastDuePaymentShare >= BEHIND_SHARE &&
    f.currentPaidRatio < HEAVY_ROLLOVER_RATIO
  ) {
    evidence.push(
      `${pct(f.pastDuePaymentShare)} of what they have paid this year went to clearing earlier years' dues.`
    )
    evidence.push(
      `Meanwhile only ${pct(f.currentPaidRatio)} of this year's fees are paid.`
    )
    return verdict('NEXT_YEAR_PAYER', 0.8)
  }

  // --- 3. Leaves most of it unpaid -----------------------------------
  // Gated on not being on schedule: a family whose remaining installments are
  // not due yet is behind the calendar, not behind the plan.
  if (canJudgeYearEnd && paidRatio <= HEAVY_ROLLOVER_RATIO && !onSchedule) {
    evidence.push(
      settled
        ? `Paid only ${pct(paidRatio)} of what was billed across ${period}.`
        : `Only ${pct(paidRatio)} of this year's fees are paid, and the year is ${pct(f.sessionProgress)} over.`
    )
    evidence.push(`${money(f.currentSessionDue)} is on course to carry into next year.`)
    return verdict('HEAVY_ROLLOVER', 0.8)
  }

  // --- 4. Pays late, leaves a balance --------------------------------
  if (
    canJudgeYearEnd &&
    paidRatio > HEAVY_ROLLOVER_RATIO &&
    paidRatio < CLEARED_RATIO &&
    !onSchedule
  ) {
    evidence.push(
      settled
        ? `Pays most of it — ${pct(paidRatio)} across ${period} — but never quite clears.`
        : `${pct(paidRatio)} of this year is paid with the year ${pct(f.sessionProgress)} over — most of it, but not all.`
    )
    evidence.push(`${money(f.currentSessionDue)} would carry forward if nothing changes.`)
    return verdict('YEAR_END_PARTIAL', 0.75)
  }

  // --- 5. Pays in full, but only at year end -------------------------
  // Distinguished from a regular payer by the schedule, not the calendar:
  // clearing installment 3 on its January due date is paying on time, not late.
  if (
    canJudgeYearEnd &&
    paidRatio >= CLEARED_RATIO &&
    !onSchedule &&
    clearance !== null &&
    clearance >= LAST_QUARTER
  ) {
    evidence.push(
      `Clears the full amount, but not until ${pct(clearance)} of the way through ${settled ? 'the year' : 'it'}.`
    )
    if (f.avgDaysLate !== null && f.avgDaysLate > 0) {
      evidence.push(`Installments are paid ${Math.round(f.avgDaysLate)} days late on average.`)
    }
    return verdict('YEAR_END_FULL', 0.7)
  }

  // --- 6. Pays everything up front -----------------------------------
  // Checked BEFORE the on-time rule, which is the broader of the two: a family
  // that clears the whole year in April has also, trivially, paid every
  // installment on or before its due date, so the general rule would swallow
  // the specific one and nobody would ever be recognised as an up-front payer.
  if (paidRatio >= CLEARED_RATIO && clearance !== null && clearance <= FIRST_WINDOW) {
    evidence.push(`Clears almost the whole year within the first ${pct(clearance)} of it.`)
    return verdict('EARLY_FULL', 0.8)
  }

  // --- 7. Pays each installment on time ------------------------------
  if (onSchedule && f.currentPaidRatio >= ENGAGED_RATIO) {
    evidence.push(
      `Pays on or before the due date ${pct(f.onTimeInstallmentRate!)} of the time.`
    )
    evidence.push(`${pct(f.currentPaidRatio)} of this year is already paid.`)
    return verdict('INSTALLMENT_REGULAR', 0.75)
  }

  // --- Not enough to say ---------------------------------------------
  // Said plainly, with what is missing, so the gap is actionable rather than
  // mysterious.
  if (f.currentPaidRatio >= CLEARED_RATIO) {
    evidence.push("This year's fees are fully paid.")
    if (clearance === null) {
      evidence.push(
        'Without payment dates we cannot tell whether they paid up front or at the last minute.'
      )
    }
  } else if (f.sessionProgress < YEAR_END_PROGRESS) {
    evidence.push(
      `${pct(f.currentPaidRatio)} of this year is paid and the year is only ${pct(f.sessionProgress)} over — too early to call the pattern.`
    )
  } else if (f.totalPaymentCount === 0) {
    evidence.push('No payments have ever been recorded for this family.')
  } else {
    evidence.push('Payment history does not match any clear pattern yet.')
  }
  return verdict('UNKNOWN', Math.min(0.3, carryCap))
}

/**
 * Whether chasing this archetype is usually worth a call at all.
 *
 * Used only as an input to scoring, never as a reason to hide a household: the
 * owner decides who is worth calling, and a pin overrides everything.
 */
export function isWorthChasing(archetype: PaymentArchetype): boolean {
  return archetype !== 'EARLY_FULL' && archetype !== 'INSTALLMENT_REGULAR'
}
