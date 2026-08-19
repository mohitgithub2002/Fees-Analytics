// Client-safe response shapes for /api/v2/recovery/*. Hand-written rather than
// inferred, matching src/lib/v2/types.ts — keeps the client bundle free of the
// server-only recovery lib (which touches Prisma internals for its own types).

import type { EconomicTier, PaymentArchetype, RecoveryStage } from './types'

export interface ChildSummary {
  id: number
  name: string
  class: string | null
}

export interface GuardianCore {
  id: number
  name: string
  phone: string | null
  altPhone?: string | null
  economicTier: EconomicTier
  archetype: PaymentArchetype
  archetypeConfidence?: number
  evidence?: string[]
  children: ChildSummary[]
}

export interface WorklistCase {
  caseId: number
  stage: RecoveryStage
  outstanding: number
  expectedRecoveryValue: number
  priorityScore: number
  pinned: boolean
  lastContactAt: string | null
  contactCount: number
  guardian: GuardianCore
  promise: { id: number; amount: number; promisedFor: string; status: string } | null
}

export interface SkippedCase {
  caseId: number
  guardianId: number
  name: string
  outstanding: number
  reason: string
}

export interface WorklistResponse {
  date: string
  sessionId: number
  dailyCallTarget: number
  queue: WorklistCase[]
  skipped: SkippedCase[]
}

export interface OverviewResponse {
  sessionId: number
  generatedAt: string
  money: { totalOutstanding: number; recoverableNow: number; recoveredThisMonth: number }
  actions: {
    queuedToday: number
    promisesDueToday: { count: number; amount: number }
    promisesBroken: { count: number; amount: number }
  }
  dataQuality: { total: number; estimated: number; percentEstimated: number }
}

export interface SegmentCellDTO {
  archetype: PaymentArchetype
  tier: EconomicTier
  households: number
  outstanding: number
  expectedRecovery: number
}

export interface SegmentMatrixResponse {
  cells: SegmentCellDTO[]
  totals: { households: number; outstanding: number; expectedRecovery: number }
}

export interface GuardianListRow {
  id: number
  name: string
  phone: string | null
  economicTier: EconomicTier
  archetype: PaymentArchetype
  suggestedTier: EconomicTier
  totalOutstanding: number
  expectedRecovery30d: number
  childrenCount: number
  lastContactAt: string | null
}

export interface InstallmentPlanFee {
  id: number
  sequence: number
  label: string
  dueDate: string | null
  netAmount: number
  paidAmount: number
  status: string
}

export interface FeeItemDetail {
  id: number
  category: string
  name: string
  netAmount: number
  paidAmount: number
  dueAmount: number
  installments: InstallmentPlanFee[]
}

export interface EnrollmentDetail {
  id: number
  session: { id: number; name: string; isCurrent: boolean }
  class: string
  section: string
  feeItems: FeeItemDetail[]
}

export interface ChildDetail {
  id: number
  name: string
  relation: string
  enrollments: EnrollmentDetail[]
  totalDue: number
}

export interface TimelineEntry {
  id: number
  receiptNo: string
  studentId: number
  category: string | null
  amount: number
  mode: string
  paidAt: string
  isEstimatedTiming: boolean
}

export interface ContactEntry {
  id: number
  channel: string
  outcome: string
  outcomeLabel: string
  talkedTo: string | null
  notes: string | null
  contactedAt: string
  loggedByName: string | null
}

export interface PromiseEntry {
  id: number
  amount: number
  promisedFor: string
  status: string
  settledAmount: number
  notes: string | null
  createdAt: string
}

export interface GuardianProfileDTO {
  archetype: PaymentArchetype
  archetypeConfidence: number
  suggestedTier: EconomicTier
  reliabilityScore: number
  propensityScore: number
  expectedRecovery30d: number
  totalOutstanding: number
  currentSessionDue: number
  pastSessionsDue: number
  lifetimeBilled: number
  lifetimePaid: number
  sessionsTracked: number
  sessionsWithDues: number
  rolloverStreak: number
  childrenCount: number
  lastPaymentAt: string | null
  lastPaymentAmount: number | null
  avgDaysToFirstPayment: number | null
  avgClearanceDay: number | null
  onTimeInstallmentRate: number | null
  avgDaysLate: number | null
  avgTicket: number | null
  monthHistogram: Record<string, number> | null
  evidence: string[] | null
  contactAttempts: number
  contactPickRate: number | null
  promisesMade: number
  promisesKept: number
  calculatedAt: string
}

export interface GuardianDetailResponse {
  id: number
  name: string
  phone: string | null
  altPhone: string | null
  relation: string
  occupation: string | null
  address: string | null
  notes: string | null
  economicTier: EconomicTier
  tierSetAt: string | null
  tierNote: string | null
  profile: GuardianProfileDTO | null
  children: ChildDetail[]
  timeline: TimelineEntry[]
  contacts: ContactEntry[]
  promises: PromiseEntry[]
}

export interface InstallmentBehaviourDTO {
  sequence: number
  label: string
  dueDate: string | null
  /** False when no due date is set — the on-time/late split is then unknown. */
  hasDueDate: boolean
  expected: number
  collectedOnTime: number
  collectedLate: number
  collected: number
  outstanding: number
  onTimePercent: number | null
  avgDaysLate: number | null
  studentsDue: number
  studentsCleared: number
}

export interface MonthlyCollectionDTO {
  month: number
  label: string
  bySession: Record<string, number>
  total: number
}

export interface ClassCohortDTO {
  classId: number
  className: string
  students: number
  billed: number
  collected: number
  outstanding: number
  recoveryPercent: number
  bands: {
    above: { students: number; outstanding: number }
    at: { students: number; outstanding: number }
    below: { students: number; outstanding: number }
  }
}

export interface ForecastMonthDTO {
  month: string
  label: string
  isPast: boolean
  isCurrent: boolean
  committed: number
  likely: number
  stretch: number
  actual: number | null
  drivers: { promises: number; dueInstallments: number }
}

export interface ForecastResponse {
  sessionId: number
  sessionName: string
  generatedAt: string
  calibrationFactor: number
  months: ForecastMonthDTO[]
  accuracy: { month: string; label: string; predicted: number; actual: number; errorPercent: number }[]
  topContributors: {
    guardianId: number
    name: string
    phone: string | null
    outstanding: number
    expectedRecovery: number
    archetype: string
    childrenCount: number
  }[]
  totals: { outstanding: number; expectedNext30d: number; sessionGap: number }
}

export interface RecoveryTuningDTO {
  cooldownDays: number
  justPaidSuppressDays: number
  promiseGraceDays: number
  noAnswerBackoffThreshold: number
  noAnswerBackoffDays: number
  minOutstandingPaise: number
  dailyCallTarget: number
  scoreWeights: Record<string, number> | null
}

export interface TuningLimit {
  min: number
  max: number
  label: string
  help: string
}

export interface HouseholdRow {
  id: number
  name: string
  phone: string | null
  needsReview: boolean
  notes: string | null
  students: { id: number; name: string; phone: string | null; class: string | null; linkSource: string | null }[]
}
