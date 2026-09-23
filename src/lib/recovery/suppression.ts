/**
 * Who should NOT be called today, and why. Pure and Prisma-free.
 *
 * This is the half of the system that saves effort rather than finding it. A
 * ranked list of everyone who owes money is easy; the expensive mistakes are
 * calling a family three days after they paid, calling again before the date
 * they already promised, and calling the same unanswered number every morning
 * for a week. Each of those costs a call and a little of the owner's
 * credibility.
 *
 * Two rules the whole design rests on:
 *
 * 1. SUPPRESSION IS ALWAYS EXPLAINED AND REVERSIBLE. Every verdict carries a
 *    reason, and skipped households are shown in the worklist's collapsed
 *    "N skipped today" row rather than silently dropped. The owner overrules
 *    the system, not the other way round — which is why a pin is checked
 *    before anything else here.
 *
 * 2. THE THRESHOLDS ARE SETTINGS, NOT CONSTANTS. Every number below comes from
 *    RecoveryConfig. The person who knows whether five days is too soon to
 *    call a family again is the one running the school.
 */
import type {
  CaseState,
  HouseholdFeatures,
  PaymentArchetype,
  RecoveryTuning,
  SuppressionVerdict,
} from './types'

function money(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date)
  out.setDate(out.getDate() + days)
  return out
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

const NOT_SUPPRESSED: SuppressionVerdict = {
  suppressed: false,
  rule: null,
  reason: null,
  until: null,
}

export interface SuppressionOptions {
  /** Injected so the fixture harness can pin "today". */
  now?: Date
}

export function evaluateSuppression(
  f: HouseholdFeatures,
  archetype: PaymentArchetype,
  state: CaseState,
  tuning: RecoveryTuning,
  opts: SuppressionOptions = {}
): SuppressionVerdict {
  const now = opts.now ?? new Date()

  // --- The owner's override comes first -------------------------------
  // Checked before every other rule, because the owner knows things the ledger
  // does not: a conversation at the school gate, a parent's job coming back.
  if (state.pinnedForDate && isSameDay(state.pinnedForDate, now)) {
    return NOT_SUPPRESSED
  }

  // --- Nothing to collect ---------------------------------------------
  if (f.totalOutstanding <= 0) {
    return {
      suppressed: true,
      rule: 'PAID_IN_FULL',
      reason: 'Nothing outstanding — fully paid.',
      until: null,
    }
  }

  if (f.totalOutstanding < tuning.minOutstanding) {
    return {
      suppressed: true,
      rule: 'BELOW_MINIMUM',
      reason: `Only ${money(f.totalOutstanding)} outstanding — below the ${money(tuning.minOutstanding)} worth calling about.`,
      until: null,
    }
  }

  // --- Decisions a person already made --------------------------------
  if (state.parkedReason) {
    return {
      suppressed: true,
      rule: 'PARKED',
      reason: `Parked: ${state.parkedReason}. Reopen the case to put them back on the list.`,
      until: null,
    }
  }

  if (state.snoozedUntil && state.snoozedUntil > now) {
    return {
      suppressed: true,
      rule: 'SNOOZED',
      reason: `Snoozed until ${state.snoozedUntil.toLocaleDateString('en-IN')}.`,
      until: state.snoozedUntil,
    }
  }

  // --- They already told us when ---------------------------------------
  // Calling before the date a family named themselves is the fastest way to
  // teach them that what they say does not matter.
  if (f.openPromise) {
    const deadline = addDays(f.openPromise.promisedFor, tuning.promiseGraceDays)
    if (deadline > now) {
      return {
        suppressed: true,
        rule: 'OPEN_PROMISE',
        reason: `Promised ${money(f.openPromise.amount)} by ${f.openPromise.promisedFor.toLocaleDateString('en-IN')} — give them until then.`,
        until: deadline,
      }
    }
  }

  // --- Money just moved -------------------------------------------------
  if (
    f.daysSinceLastPayment !== null &&
    f.daysSinceLastPayment < tuning.justPaidSuppressDays &&
    f.lastPaymentAt
  ) {
    const until = addDays(f.lastPaymentAt, tuning.justPaidSuppressDays)
    return {
      suppressed: true,
      rule: 'JUST_PAID',
      reason: `Paid ${money(f.lastPaymentAmount)} ${f.daysSinceLastPayment} day(s) ago.`,
      until,
    }
  }

  // --- Nobody is picking up ---------------------------------------------
  // Slow the cadence rather than stopping: a number that rings out today may
  // be answered next week, but trying every morning wastes the calls and
  // annoys whoever eventually answers.
  if (
    f.consecutiveNoAnswer >= tuning.noAnswerBackoffThreshold &&
    f.lastContactAt &&
    f.daysSinceLastContact !== null &&
    f.daysSinceLastContact < tuning.noAnswerBackoffDays
  ) {
    return {
      suppressed: true,
      rule: 'NO_ANSWER_BACKOFF',
      reason: `${f.consecutiveNoAnswer} calls in a row unanswered — trying again in ${tuning.noAnswerBackoffDays - f.daysSinceLastContact} day(s).`,
      until: addDays(f.lastContactAt, tuning.noAnswerBackoffDays),
    }
  }

  if (
    f.lastContactAt &&
    f.daysSinceLastContact !== null &&
    f.daysSinceLastContact < tuning.cooldownDays
  ) {
    return {
      suppressed: true,
      rule: 'COOLING_OFF',
      reason: `Spoken to ${f.daysSinceLastContact} day(s) ago — cooling off for ${tuning.cooldownDays}.`,
      until: addDays(f.lastContactAt, tuning.cooldownDays),
    }
  }

  // --- There is no number to call ---------------------------------------
  // Not a quiet drop: this routes the household to the contact-repair queue,
  // because "we cannot reach them" is a fixable problem and an invisible one
  // stays broken forever. Most migrated families start here.
  if (f.reachableContacts === 0) {
    return {
      suppressed: true,
      rule: 'NO_CONTACT',
      reason: 'No usable phone number on record — add one before this family can be chased.',
      until: null,
    }
  }

  // --- They pay anyway ---------------------------------------------------
  // Note this tests OVERDUE, not outstanding. A reliable family with three
  // installments still ahead of them owes money but is not late, and chasing
  // them for it is how a call list loses the trust of the people who most
  // reliably answer it.
  if (
    (archetype === 'INSTALLMENT_REGULAR' || archetype === 'EARLY_FULL') &&
    f.overdueAmount <= 0
  ) {
    return {
      suppressed: true,
      rule: 'RELIABLE_PAYER',
      reason: 'Pays reliably and nothing is overdue yet.',
      until: null,
    }
  }

  return NOT_SUPPRESSED
}

/**
 * Suppression rules that mean "fix something", not "wait".
 * The worklist groups these separately so they surface as work rather than
 * disappearing into the skipped row.
 */
export const ACTIONABLE_RULES: ReadonlySet<string> = new Set(['NO_CONTACT'])
