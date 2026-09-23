/**
 * The recovery engine's domain types.
 *
 * This file is deliberately Prisma-free. Client components import the labels,
 * and the fixture harness (scripts/recovery-verify.ts) drives the scoring
 * functions directly with plain objects — neither should have to pull in the
 * generated client. The enum unions below mirror prisma/schema.prisma exactly;
 * a mismatch is caught at the boundary in features.ts, which is where Prisma
 * rows are turned into these shapes.
 */

export type PaymentArchetype =
  | 'CHRONIC_DEFAULTER'
  | 'NEXT_YEAR_PAYER'
  | 'HEAVY_ROLLOVER'
  | 'YEAR_END_PARTIAL'
  | 'YEAR_END_FULL'
  | 'INSTALLMENT_REGULAR'
  | 'EARLY_FULL'
  | 'UNKNOWN'

export type EconomicTier =
  | 'AFFLUENT'
  | 'COMFORTABLE'
  | 'STRAINED'
  | 'POOR'
  | 'SEVERE'
  | 'UNKNOWN'

export type TimingProvenance = 'REAL' | 'PARTIAL' | 'NONE'

export type ContactChannel = 'CALL' | 'SMS' | 'WHATSAPP' | 'VISIT' | 'IN_PERSON' | 'OTHER'

export type ContactOutcome =
  | 'PROMISED'
  | 'PAID_ALREADY'
  | 'NEEDS_TIME'
  | 'REFUSED'
  | 'DISPUTED'
  | 'CALL_BACK_LATER'
  | 'NO_ANSWER'
  | 'SWITCHED_OFF'
  | 'WRONG_NUMBER'

export type PromiseStatus = 'OPEN' | 'KEPT' | 'PARTIAL' | 'BROKEN' | 'CANCELLED'

export type RecoveryStage =
  | 'NEW'
  | 'CONTACTED'
  | 'PROMISED'
  | 'PARTIAL'
  | 'RECOVERED'
  | 'SNOOZED'
  | 'PARKED'
  | 'ESCALATED'

// ---------------------------------------------------------------------------
// Labels
//
// Everything a school owner reads is in plain language, not enum-speak. These
// are the single source of those words — screens never hand-roll their own, so
// the same behaviour is never called two different things in two places.
// ---------------------------------------------------------------------------

export const ARCHETYPE_LABEL: Record<PaymentArchetype, string> = {
  CHRONIC_DEFAULTER: 'Owes for more than one year',
  NEXT_YEAR_PAYER: 'Always a year behind',
  HEAVY_ROLLOVER: 'Leaves most of it unpaid',
  YEAR_END_PARTIAL: 'Pays late, leaves a balance',
  YEAR_END_FULL: 'Pays in full, but only at year end',
  INSTALLMENT_REGULAR: 'Pays each installment on time',
  EARLY_FULL: 'Pays everything up front',
  UNKNOWN: 'Not enough history yet',
}

export const ARCHETYPE_HINT: Record<PaymentArchetype, string> = {
  CHRONIC_DEFAULTER: 'Dues open in two or more years at the same time.',
  NEXT_YEAR_PAYER: "Pays last year's fees while this year goes uncollected.",
  HEAVY_ROLLOVER: 'Half or less gets paid; the rest carries into next year.',
  YEAR_END_PARTIAL: 'Pays late and still leaves something behind.',
  YEAR_END_FULL: 'Clears the whole amount, but most of it lands in the last quarter.',
  INSTALLMENT_REGULAR: 'Pays each installment close to its due date and clears within the year.',
  EARLY_FULL: 'Clears almost everything in the first installment window.',
  UNKNOWN: 'Not enough payment history to tell yet.',
}

export const TIER_LABEL: Record<EconomicTier, string> = {
  AFFLUENT: 'Can pay easily',
  COMFORTABLE: 'Can pay comfortably',
  STRAINED: 'Can pay, but it is a stretch',
  POOR: 'Struggles to pay',
  SEVERE: 'Cannot pay right now',
  UNKNOWN: 'Not assessed yet',
}

export const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  PROMISED: 'Promised to pay',
  PAID_ALREADY: 'Says already paid',
  NEEDS_TIME: 'Needs more time',
  REFUSED: 'Refused to pay',
  DISPUTED: 'Disputes the amount',
  CALL_BACK_LATER: 'Asked to call back',
  NO_ANSWER: 'Did not pick up',
  SWITCHED_OFF: 'Phone switched off',
  WRONG_NUMBER: 'Wrong number',
}

/** Outcomes where somebody actually spoke to the family. */
export const ANSWERED_OUTCOMES: ReadonlySet<ContactOutcome> = new Set<ContactOutcome>([
  'PROMISED',
  'PAID_ALREADY',
  'NEEDS_TIME',
  'REFUSED',
  'DISPUTED',
  'CALL_BACK_LATER',
])

export const STAGE_LABEL: Record<RecoveryStage, string> = {
  NEW: 'Not contacted yet',
  CONTACTED: 'Contacted',
  PROMISED: 'Promised to pay',
  PARTIAL: 'Paid part of it',
  RECOVERED: 'Cleared',
  SNOOZED: 'Snoozed',
  PARKED: 'Parked — cannot pay',
  ESCALATED: 'Escalated',
}

export const PROVENANCE_LABEL: Record<TimingProvenance, string> = {
  REAL: 'Based on recorded payment dates',
  PARTIAL: 'Some payment dates are missing — timing is partly estimated',
  NONE: 'No payment dates recorded — timing cannot be judged',
}

// ---------------------------------------------------------------------------
// The feature vector
// ---------------------------------------------------------------------------

/** An open promise a family made about a specific amount and date. */
export interface OpenPromise {
  id: number
  amount: number
  promisedFor: Date
}

/**
 * Everything the scoring functions know about one household, built by
 * features.ts from bulk ledger queries. All money is in rupees.
 *
 * The fields are grouped by which axis they feed, because the two axes become
 * available at different times — see PaymentArchetype in the schema.
 */
export interface HouseholdFeatures {
  householdId: number
  displayName: string
  /** The HUMAN-set tier from Household. Never the suggestion. */
  economicTier: EconomicTier
  childrenCount: number

  // --- Money ---------------------------------------------------------
  totalOutstanding: number
  currentSessionDue: number
  currentSessionBilled: number
  pastSessionsDue: number
  /**
   * Unpaid amount on installments whose due date has already passed.
   *
   * Distinct from currentSessionDue: a family with three future installments
   * owes money but is not late. Chasing them is how a call list loses its
   * credibility with the people who most need to trust it.
   */
  overdueAmount: number
  overdueInstallments: number
  lifetimeBilled: number
  lifetimePaid: number
  /** Average size of a single payment. Used to judge whether an ask is realistic. */
  avgTicket: number

  // --- School-side ability signals -----------------------------------
  // Not behaviour — facts the school already recorded about this family.
  // A concession the school itself granted is the closest thing the ledger
  // holds to an assessment of what they can afford.
  /** Discount granted / (billed + discount), 0..1. */
  discountShare: number
  /** Pays for school transport — a small, optional, recurring extra. */
  hasBusFee: boolean

  // --- Carry axis (available today; needs no payment dates) ----------
  sessionsTracked: number
  sessionsWithOpenDues: number
  /** currentSessionPaid / currentSessionNet, 0..1. */
  currentPaidRatio: number

  // --- Completed sessions --------------------------------------------
  // An archetype describes a SETTLED pattern, and a finished year is the only
  // place one can be read. Judging a family on the year they are halfway
  // through means nobody can be called a year-end payer until March, however
  // many Marches they have already done it in.
  /** Sessions that have ended, so their outcome is final. */
  completedSessions: number
  /** Average share of the year's fees paid by the time it ended, 0..1. */
  avgEndPaidRatio: number | null
  /**
   * Average point in the year at which they finished paying, 0..1.
   * Null when no completed session was ever substantially cleared.
   */
  avgClearanceProgress: number | null
  /** Consecutive sessions that ended with an unpaid balance. */
  rolloverStreak: number
  /** Share of this session's payments that went to settling PAST-session dues, 0..1. */
  pastDuePaymentShare: number

  // --- Timing axis (dark until dated payments + due dates exist) -----
  timingProvenance: TimingProvenance
  datedPaymentCount: number
  totalPaymentCount: number
  lastPaymentAt: Date | null
  lastPaymentAmount: number
  daysSinceLastPayment: number | null
  /** Days from session start to the first payment of the session. */
  daysToFirstPayment: number | null
  /** Share of dated installments paid on or before their due date, 0..1. */
  onTimeInstallmentRate: number | null
  avgDaysLate: number | null
  /** Day-of-session on which cumulative payment crossed 90% of what was billed. */
  clearanceDay: number | null
  /** { "1": 0.05, ... } share of lifetime collection by calendar month. */
  monthHistogram: Record<string, number>

  /**
   * How far through the current session we are, 0..1.
   *
   * This gates every "by year end" rule. An archetype describes a COMPLETED
   * pattern: in April nobody has yet failed to pay by year end, so classifying
   * a family as "leaves most of it unpaid" two weeks into the session would be
   * an accusation, not an observation.
   */
  sessionProgress: number

  // --- Contact history -----------------------------------------------
  reachableContacts: number
  contactAttempts: number
  contactsAnswered: number
  /** contactsAnswered / contactAttempts, 0..1. */
  contactPickRate: number
  promisesMade: number
  promisesKept: number
  promisesBroken: number
  lastContactAt: Date | null
  daysSinceLastContact: number | null
  /** Unanswered attempts since the last time somebody picked up. */
  consecutiveNoAnswer: number
  openPromise: OpenPromise | null
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export interface ArchetypeVerdict {
  archetype: PaymentArchetype
  /** Confidence in the carry (rollover) reading, 0..1. */
  carryConfidence: number
  /** Confidence in the timing reading, 0..1. Zero without dated payments. */
  timingConfidence: number
  /** Plain-English lines, rendered verbatim by the UI. */
  evidence: string[]
}

export interface TierSuggestion {
  tier: EconomicTier
  confidence: number
  evidence: string[]
}

/** One bounded multiplier in the propensity product, with its reason. */
export interface PropensityFactor {
  name: string
  multiplier: number
  reason: string
}

export interface PropensityResult {
  /** Probability that reaching out produces a payment in the next 30 days, 0..1. */
  score: number
  factors: PropensityFactor[]
  /** What we expect to actually collect — never more than the balance. */
  expectedRecovery: number
  evidence: string[]
}

export type SuppressionRule =
  | 'PAID_IN_FULL'
  | 'BELOW_MINIMUM'
  | 'JUST_PAID'
  | 'OPEN_PROMISE'
  | 'COOLING_OFF'
  | 'NO_ANSWER_BACKOFF'
  | 'PARKED'
  | 'SNOOZED'
  | 'RELIABLE_PAYER'
  | 'NO_CONTACT'

/**
 * One short label per rule, for summarising a skipped list.
 *
 * Individual reasons carry the specifics — "Promised ₹9,127 by 23/9/2026" —
 * which is exactly what a caller needs on one household and exactly what makes
 * them useless for grouping: every family gets its own row and "40 skipped
 * today" becomes forty lines of one. The count belongs to the rule; the detail
 * belongs to the household.
 */
export const SUPPRESSION_LABEL: Record<SuppressionRule, string> = {
  PAID_IN_FULL: 'Nothing outstanding — fully paid',
  BELOW_MINIMUM: 'Too little owed to be worth a call',
  JUST_PAID: 'Paid recently',
  OPEN_PROMISE: 'Already promised to pay',
  COOLING_OFF: 'Spoken to recently',
  NO_ANSWER_BACKOFF: 'Not answering — trying less often',
  PARKED: 'Parked — confirmed hardship',
  SNOOZED: 'Snoozed',
  RELIABLE_PAYER: 'Pays reliably, nothing overdue',
  NO_CONTACT: 'No phone number on record',
}

export interface SuppressionVerdict {
  suppressed: boolean
  rule: SuppressionRule | null
  /** Always set when suppressed — a skipped household is never unexplained. */
  reason: string | null
  until: Date | null
}

/**
 * The tunable targeting rules, loaded from RecoveryConfig.
 * Defaults and clamps live in config.ts.
 */
export interface RecoveryTuning {
  minOutstanding: number
  justPaidSuppressDays: number
  cooldownDays: number
  promiseGraceDays: number
  noAnswerBackoffThreshold: number
  noAnswerBackoffDays: number
  dailyCallTarget: number
  scoreWeights: Record<string, number>
}

/** Mutable, human-owned case state that suppression has to respect. */
export interface CaseState {
  stage: RecoveryStage
  snoozedUntil: Date | null
  parkedReason: string | null
  pinnedForDate: Date | null
}
