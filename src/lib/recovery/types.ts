/**
 * Hand-rolled, Prisma-free enum types — deliberately not imported from
 * @/generated/prisma/client (mirrors src/lib/v2/types.ts). This file is
 * imported from client components for the shared chip/label metadata below,
 * and the generated Prisma client pulls in Node-only runtime deps (pg, the
 * query engine) that must never reach a browser bundle. Structurally these
 * are identical to the generated enum types, so values from Prisma queries
 * assign here without friction.
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

export type EconomicTier = 'AFFLUENT' | 'COMFORTABLE' | 'STRAINED' | 'POOR' | 'SEVERE' | 'UNKNOWN'

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

/* ── Session-level view of one household's behaviour ────────────────────── */

export interface SessionBehaviour {
  sessionId: number
  sessionName: string
  startDate: Date
  endDate: Date
  isCurrent: boolean
  /** Session length in days, used to express timings as a fraction of the year. */
  lengthDays: number

  billedPaise: number
  paidPaise: number
  duePaise: number
  /** paidPaise / billedPaise, 0–1. Zero-billed sessions report 1 (nothing owed). */
  paidRatio: number

  /** Day-of-session (0-based) of the first rupee received; null if nothing paid. */
  firstPaymentDay: number | null
  /** Day-of-session by which ≥95% of the billed amount had arrived; null if never. */
  clearanceDay: number | null
  /** Share of this session's collection that arrived in its last quarter, 0–1. */
  lastQuarterShare: number
  paymentCount: number

  /** Money received during this session that settled an EARLIER session's dues. */
  paidTowardsPastPaise: number
  /** Money received AFTER this session ended that settled this session's dues. */
  paidAfterSessionEndPaise: number

  installmentsDue: number
  installmentsPaidOnTime: number
  /** Average days past due date across installments that were paid late. */
  avgDaysLate: number | null
}

/* ── The full feature vector the classifier and scorer read ─────────────── */

export interface GuardianFeatures {
  guardianId: number
  childrenCount: number
  /** Oldest session first. Only sessions where the household was billed. */
  sessions: SessionBehaviour[]
  /** Sessions with history complete enough to classify on (i.e. not the current one). */
  closedSessions: SessionBehaviour[]
  current: SessionBehaviour | null

  lifetimeBilledPaise: number
  lifetimePaidPaise: number
  totalOutstandingPaise: number
  currentSessionDuePaise: number
  pastSessionsDuePaise: number

  sessionsTracked: number
  sessionsWithDues: number
  /** Consecutive most-recent closed sessions that ended with money still owed. */
  rolloverStreak: number
  /** Distinct sessions carrying dues right now — 2+ means multi-year debt. */
  openDueSessions: number

  lastPaymentAt: Date | null
  lastPaymentPaise: number | null
  daysSinceLastPayment: number | null
  avgTicketPaise: number | null
  /** Typical payment as a share of one session's billing — spots fragment-payers. */
  avgTicketShare: number | null

  avgDaysToFirstPayment: number | null
  avgClearanceDay: number | null
  onTimeInstallmentRate: number | null
  avgDaysLate: number | null

  /** Share of lifetime collection by calendar month, keyed "1".."12", sums to 1. */
  monthHistogram: Record<string, number>

  hasBusFee: boolean
  discountShare: number

  contactAttempts: number
  contactsReached: number
  consecutiveNoAnswer: number
  lastContactAt: Date | null
  promisesMade: number
  promisesKept: number
  promisesBroken: number
  hasOpenPromise: boolean
  openPromiseDate: Date | null
  openPromisePaise: number
}

/* ── Classifier / scorer outputs ────────────────────────────────────────── */

export interface ArchetypeVerdict {
  archetype: PaymentArchetype
  /** 0–100. Low means "the rules matched, but on thin history". */
  confidence: number
  evidence: string[]
}

export interface TierSuggestion {
  tier: EconomicTier
  confidence: number
  evidence: string[]
}

export interface PropensityFactor {
  key: string
  /** Multiplier applied to the base probability. */
  weight: number
  /** One line, written for the person about to make the call. */
  reason: string
}

export interface PropensityVerdict {
  /** Probability of receiving a payment within 30 days, 0–1. */
  probability: number
  score: number
  factors: PropensityFactor[]
  expectedRecoveryPaise: number
}

export interface SuppressionVerdict {
  suppressed: boolean
  /** Shown to the user — suppressed households are listed, never hidden. */
  reason: string | null
  until: Date | null
}

/** Tunable targeting rules; mirrors the RecoveryConfig row. */
export interface RecoveryTuning {
  cooldownDays: number
  justPaidSuppressDays: number
  promiseGraceDays: number
  noAnswerBackoffThreshold: number
  noAnswerBackoffDays: number
  minOutstandingPaise: number
  dailyCallTarget: number
  scoreWeights: Record<string, number> | null
}

export const DEFAULT_TUNING: RecoveryTuning = {
  cooldownDays: 5,
  justPaidSuppressDays: 7,
  promiseGraceDays: 3,
  noAnswerBackoffThreshold: 3,
  noAnswerBackoffDays: 7,
  minOutstandingPaise: 50_000, // ₹500
  dailyCallTarget: 30,
  scoreWeights: null,
}

/* ── Display metadata, shared by every screen that renders a chip ───────── */

export const ARCHETYPE_META: Record<
  PaymentArchetype,
  { label: string; short: string; description: string; tone: 'critical' | 'warning' | 'neutral' | 'good' }
> = {
  CHRONIC_DEFAULTER: {
    label: 'Chronic Defaulter',
    short: 'Chronic',
    description: 'Owes across two or more sessions at once.',
    tone: 'critical',
  },
  NEXT_YEAR_PAYER: {
    label: 'Next-Year Payer',
    short: 'Next-year',
    description: "Pays last year's fees during this one; the current year goes uncollected.",
    tone: 'critical',
  },
  HEAVY_ROLLOVER: {
    label: 'Heavy Rollover',
    short: 'Rollover',
    description: 'Pays half or less by year end; the rest rolls forward.',
    tone: 'critical',
  },
  YEAR_END_PARTIAL: {
    label: 'Year-End Partial',
    short: 'Part-payer',
    description: 'Pays late and leaves a residue that carries into the next session.',
    tone: 'warning',
  },
  YEAR_END_FULL: {
    label: 'Year-End Payer',
    short: 'Year-end',
    description: 'Clears the full amount, but most of it arrives in the last quarter.',
    tone: 'warning',
  },
  INSTALLMENT_REGULAR: {
    label: 'Installment Regular',
    short: 'Regular',
    description: 'Pays each installment close to its due date and clears within the year.',
    tone: 'good',
  },
  EARLY_FULL: {
    label: 'Early Full Payer',
    short: 'Early',
    description: 'Clears almost everything in the first installment window.',
    tone: 'good',
  },
  UNKNOWN: {
    label: 'Not Enough History',
    short: 'Unknown',
    description: 'Too little payment history to classify yet.',
    tone: 'neutral',
  },
}

export const TIER_META: Record<
  EconomicTier,
  { label: string; short: string; description: string; rank: number }
> = {
  AFFLUENT: {
    label: 'Affluent',
    short: 'Affluent',
    description: 'No difficulty paying; delays are about attention, not money.',
    rank: 1,
  },
  COMFORTABLE: {
    label: 'Comfortable',
    short: 'Comfortable',
    description: 'Can pay the full fee without real strain.',
    rank: 2,
  },
  STRAINED: {
    label: 'Strained',
    short: 'Strained',
    description: 'Can pay in full, but it takes effort and timing.',
    rank: 3,
  },
  POOR: {
    label: 'Poor',
    short: 'Poor',
    description: 'Genuinely struggles; needs a plan more than a reminder.',
    rank: 4,
  },
  SEVERE: {
    label: 'Severe Hardship',
    short: 'Severe',
    description: 'Paying is very difficult; consider concession or write-off.',
    rank: 5,
  },
  UNKNOWN: {
    label: 'Untagged',
    short: 'Untagged',
    description: 'No one has assessed this family yet.',
    rank: 6,
  },
}

export const OUTCOME_META: Record<
  ContactOutcome,
  { label: string; reached: boolean; tone: 'good' | 'warning' | 'critical' | 'neutral' }
> = {
  PROMISED: { label: 'Promised to pay', reached: true, tone: 'good' },
  PAID_ALREADY: { label: 'Says already paid', reached: true, tone: 'neutral' },
  NEEDS_TIME: { label: 'Needs more time', reached: true, tone: 'warning' },
  REFUSED: { label: 'Refused', reached: true, tone: 'critical' },
  DISPUTED: { label: 'Disputes the amount', reached: true, tone: 'critical' },
  CALL_BACK_LATER: { label: 'Call back later', reached: true, tone: 'neutral' },
  NO_ANSWER: { label: 'No answer', reached: false, tone: 'neutral' },
  SWITCHED_OFF: { label: 'Switched off', reached: false, tone: 'neutral' },
  WRONG_NUMBER: { label: 'Wrong number', reached: false, tone: 'critical' },
}
