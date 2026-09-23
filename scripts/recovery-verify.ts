/**
 * Fixture checks for the recovery engine.
 *
 *   npm run recovery:verify
 *
 * The repo has no test runner, and this is not the place to introduce one for
 * a single module — but the scoring engine decides who gets phoned, so the
 * behaviours that matter are pinned here rather than left to be noticed in
 * production. Everything under test is pure, which is the point of keeping
 * archetype/tier/propensity/suppression free of Prisma: the fixtures below are
 * plain objects, and the checks run in milliseconds with no database.
 *
 * Exits non-zero on the first failure so it can gate a build.
 */
import { classifyArchetype, historyCap } from '../src/lib/recovery/archetype'
import { clampTuning, DEFAULT_TUNING } from '../src/lib/recovery/config'
import {
  expectedCollectable,
  expectedRecoveryValue,
  scorePropensity,
} from '../src/lib/recovery/propensity'
import { evaluateSuppression } from '../src/lib/recovery/suppression'
import { suggestTier, tierFactor } from '../src/lib/recovery/tier'
import type {
  CaseState,
  HouseholdFeatures,
  PaymentArchetype,
} from '../src/lib/recovery/types'

// --- Tiny harness -----------------------------------------------------

let passed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function checkEqual<T>(name: string, actual: T, expected: T) {
  check(name, actual === expected, `expected ${String(expected)}, got ${String(actual)}`)
}

// --- Fixtures ----------------------------------------------------------

const NOW = new Date('2026-01-15T00:00:00Z')

/** A blank household: owes nothing, no history, nothing known. */
function makeFeatures(overrides: Partial<HouseholdFeatures> = {}): HouseholdFeatures {
  return {
    householdId: 1,
    displayName: 'Test Household',
    economicTier: 'UNKNOWN',
    childrenCount: 1,

    totalOutstanding: 0,
    currentSessionDue: 0,
    currentSessionBilled: 30000,
    pastSessionsDue: 0,
    overdueAmount: 0,
    overdueInstallments: 0,
    lifetimeBilled: 30000,
    lifetimePaid: 0,
    avgTicket: 0,
    discountShare: 0,
    hasBusFee: false,

    sessionsTracked: 1,
    sessionsWithOpenDues: 0,
    currentPaidRatio: 0,
    // No finished year by default, so the fixtures below exercise the
    // in-progress path unless they say otherwise.
    completedSessions: 0,
    avgEndPaidRatio: null,
    avgClearanceProgress: null,
    rolloverStreak: 0,
    pastDuePaymentShare: 0,

    timingProvenance: 'REAL',
    datedPaymentCount: 3,
    totalPaymentCount: 3,
    lastPaymentAt: null,
    lastPaymentAmount: 0,
    daysSinceLastPayment: null,
    daysToFirstPayment: null,
    onTimeInstallmentRate: null,
    avgDaysLate: null,
    clearanceDay: null,
    monthHistogram: {},
    sessionProgress: 0.8,

    reachableContacts: 1,
    contactAttempts: 0,
    contactsAnswered: 0,
    contactPickRate: 0,
    promisesMade: 0,
    promisesKept: 0,
    promisesBroken: 0,
    lastContactAt: null,
    daysSinceLastContact: null,
    consecutiveNoAnswer: 0,
    openPromise: null,
    ...overrides,
  }
}

const CLEAN_STATE: CaseState = {
  stage: 'NEW',
  snoozedUntil: null,
  parkedReason: null,
  pinnedForDate: null,
}

// ======================================================================
// 1. One case per archetype
// ======================================================================

const ARCHETYPE_CASES: { name: PaymentArchetype; features: Partial<HouseholdFeatures> }[] = [
  {
    name: 'CHRONIC_DEFAULTER',
    features: {
      sessionsWithOpenDues: 3,
      sessionsTracked: 3,
      pastSessionsDue: 45000,
      totalOutstanding: 70000,
      currentSessionDue: 25000,
    },
  },
  {
    name: 'NEXT_YEAR_PAYER',
    features: {
      sessionsWithOpenDues: 1,
      pastSessionsDue: 20000,
      pastDuePaymentShare: 0.85,
      currentPaidRatio: 0.15,
      totalOutstanding: 45000,
      currentSessionDue: 25000,
    },
  },
  {
    name: 'HEAVY_ROLLOVER',
    features: { currentPaidRatio: 0.35, sessionProgress: 0.85, currentSessionDue: 19500 },
  },
  {
    name: 'YEAR_END_PARTIAL',
    features: { currentPaidRatio: 0.72, sessionProgress: 0.85, currentSessionDue: 8400 },
  },
  {
    name: 'YEAR_END_FULL',
    features: {
      currentPaidRatio: 1,
      clearanceDay: 300,
      onTimeInstallmentRate: 0.2,
      avgDaysLate: 62,
    },
  },
  {
    name: 'INSTALLMENT_REGULAR',
    features: { currentPaidRatio: 0.95, onTimeInstallmentRate: 0.9, clearanceDay: 200 },
  },
  {
    name: 'EARLY_FULL',
    features: { currentPaidRatio: 1, clearanceDay: 40, onTimeInstallmentRate: null },
  },
]

for (const testCase of ARCHETYPE_CASES) {
  const verdict = classifyArchetype(makeFeatures(testCase.features))
  checkEqual(`classifies ${testCase.name}`, verdict.archetype, testCase.name)
  check(
    `${testCase.name} carries evidence`,
    verdict.evidence.length > 0,
    'no evidence lines produced'
  )
}

// A household with nothing billed must not be given a personality. Zero paid
// out of zero billed is a ratio of zero, which reads as "leaves most of it
// unpaid" unless something guards against it.
checkEqual(
  'nothing billed classifies as UNKNOWN',
  classifyArchetype(
    makeFeatures({
      currentSessionBilled: 0,
      lifetimeBilled: 0,
      totalPaymentCount: 0,
      datedPaymentCount: 0,
      timingProvenance: 'NONE',
    })
  ).archetype,
  'UNKNOWN'
)

// But a family that WAS billed and has paid nothing, late in the year, is
// genuinely rolling the whole thing over — that is not an unknown.
checkEqual(
  'billed but nothing paid, late in the year, is a rollover',
  classifyArchetype(
    makeFeatures({
      currentSessionBilled: 30000,
      currentSessionDue: 30000,
      totalOutstanding: 30000,
      currentPaidRatio: 0,
      sessionProgress: 0.85,
      totalPaymentCount: 0,
      datedPaymentCount: 0,
      timingProvenance: 'NONE',
    })
  ).archetype,
  'HEAVY_ROLLOVER'
)

// A family whose remaining installments simply are not due yet is behind the
// calendar, not behind the plan — the distinction that keeps reliable payers
// off the call list.
checkEqual(
  'paying to schedule is not "leaves a balance"',
  classifyArchetype(
    makeFeatures({
      currentPaidRatio: 0.66,
      sessionProgress: 0.8,
      onTimeInstallmentRate: 1,
      overdueInstallments: 0,
      clearanceDay: null,
    })
  ).archetype,
  'INSTALLMENT_REGULAR'
)

// ...but a perfect on-time record over settled installments must not excuse an
// installment that is sitting overdue right now.
check(
  'a perfect on-time record does not excuse an overdue installment',
  classifyArchetype(
    makeFeatures({
      currentPaidRatio: 0.4,
      sessionProgress: 0.85,
      onTimeInstallmentRate: 1,
      overdueInstallments: 2,
      overdueAmount: 18000,
    })
  ).archetype === 'HEAVY_ROLLOVER'
)

// ======================================================================
// 2. Confidence rises with history, and one year is capped
// ======================================================================

check('history cap rises with sessions', historyCap(1) < historyCap(2) && historyCap(2) < historyCap(3))
checkEqual('one session is capped at 0.6', historyCap(1), 0.6)

const oneYear = classifyArchetype(
  makeFeatures({ currentPaidRatio: 0.35, sessionProgress: 0.85, sessionsTracked: 1 })
)
const fourYears = classifyArchetype(
  makeFeatures({ currentPaidRatio: 0.35, sessionProgress: 0.85, sessionsTracked: 4 })
)
check(
  'confidence rises with more history',
  fourYears.carryConfidence > oneYear.carryConfidence,
  `1yr=${oneYear.carryConfidence} 4yr=${fourYears.carryConfidence}`
)
check(
  'a single year never claims more than the cap',
  oneYear.carryConfidence <= 0.6,
  `got ${oneYear.carryConfidence}`
)
check(
  'a single year says so in its evidence',
  oneYear.evidence.some((line) => line.includes('single year'))
)

// ======================================================================
// 3. The timing axis stays dark without payment dates
// ======================================================================

const undated = classifyArchetype(
  makeFeatures({
    timingProvenance: 'NONE',
    datedPaymentCount: 0,
    totalPaymentCount: 4,
    currentPaidRatio: 0.35,
    sessionProgress: 0.85,
  })
)
checkEqual('no dates means zero timing confidence', undated.timingConfidence, 0)
check(
  'carry axis still works without dates',
  undated.archetype === 'HEAVY_ROLLOVER',
  `got ${undated.archetype}`
)
check(
  'undated verdicts say they rest on balances alone',
  undated.evidence.some((line) => line.includes('No payment dates'))
)

const partial = classifyArchetype(
  makeFeatures({ timingProvenance: 'PARTIAL', datedPaymentCount: 2, totalPaymentCount: 8 })
)
const full = classifyArchetype(makeFeatures({ timingProvenance: 'REAL' }))
check(
  'partial dating is less confident than full',
  partial.timingConfidence < full.timingConfidence,
  `partial=${partial.timingConfidence} full=${full.timingConfidence}`
)

// ======================================================================
// 4. An archetype describes a completed pattern
// ======================================================================

const earlyInYear = classifyArchetype(
  makeFeatures({ currentPaidRatio: 0.1, sessionProgress: 0.15, currentSessionDue: 27000 })
)
check(
  'does not accuse a family of rolling over in the first weeks',
  earlyInYear.archetype !== 'HEAVY_ROLLOVER' && earlyInYear.archetype !== 'YEAR_END_PARTIAL',
  `got ${earlyInYear.archetype}`
)
checkEqual('too early to call reads as UNKNOWN', earlyInYear.archetype, 'UNKNOWN')

// ======================================================================
// 4b. A settled pattern is read off finished years
//
// The whole point: a family that clears every March is a year-end payer in
// September too. Judging only the year in progress would leave the entire
// school reading as "too early to say" for nine months of every year.
// ======================================================================

/** Mid-year — the in-progress session is only 40% elapsed. */
const MID_YEAR = { sessionProgress: 0.4 }

checkEqual(
  'a year-end payer is recognised mid-way through the next year',
  classifyArchetype(
    makeFeatures({
      ...MID_YEAR,
      completedSessions: 3,
      avgEndPaidRatio: 1,
      avgClearanceProgress: 0.88,
      onTimeInstallmentRate: 0.1,
      currentPaidRatio: 0.1,
      sessionsTracked: 4,
    })
  ).archetype,
  'YEAR_END_FULL'
)

checkEqual(
  'a chronic part-payer is recognised mid-year',
  classifyArchetype(
    makeFeatures({
      ...MID_YEAR,
      completedSessions: 2,
      avgEndPaidRatio: 0.72,
      currentPaidRatio: 0.2,
      sessionsTracked: 3,
    })
  ).archetype,
  'YEAR_END_PARTIAL'
)

checkEqual(
  'a heavy roller-over is recognised mid-year',
  classifyArchetype(
    makeFeatures({
      ...MID_YEAR,
      completedSessions: 2,
      avgEndPaidRatio: 0.3,
      currentPaidRatio: 0.05,
      sessionsTracked: 3,
    })
  ).archetype,
  'HEAVY_ROLLOVER'
)

checkEqual(
  'an up-front payer is recognised from finished years',
  classifyArchetype(
    makeFeatures({
      ...MID_YEAR,
      completedSessions: 2,
      avgEndPaidRatio: 1,
      avgClearanceProgress: 0.08,
      sessionsTracked: 3,
    })
  ).archetype,
  'EARLY_FULL'
)

// …but with NO finished year, the same mid-year position stays undecided.
checkEqual(
  'with no finished year, mid-year stays undecided',
  classifyArchetype(makeFeatures({ ...MID_YEAR, currentPaidRatio: 0.3 })).archetype,
  'UNKNOWN'
)

check(
  'a settled verdict says which years it is based on',
  classifyArchetype(
    makeFeatures({
      ...MID_YEAR,
      completedSessions: 3,
      avgEndPaidRatio: 0.35,
      sessionsTracked: 4,
    })
  ).evidence.some((line) => line.includes('the last 3 years'))
)

// ======================================================================
// 4c. "Owes for years" needs magnitude, not just persistence
//
// A family that pays 85% and leaves a small residue has open dues in every
// session too. Branding them the same as a family paying 5% puts them at the
// top of a call list they do not belong on.
// ======================================================================

checkEqual(
  'a small residue every year is not a chronic defaulter',
  classifyArchetype(
    makeFeatures({
      sessionsWithOpenDues: 3,
      sessionsTracked: 3,
      completedSessions: 2,
      avgEndPaidRatio: 0.85,
      currentPaidRatio: 0.6,
      pastSessionsDue: 4000,
      totalOutstanding: 9000,
      sessionProgress: 0.4,
    })
  ).archetype,
  'YEAR_END_PARTIAL'
)

checkEqual(
  'paying a fraction year after year IS a chronic defaulter',
  classifyArchetype(
    makeFeatures({
      sessionsWithOpenDues: 3,
      sessionsTracked: 3,
      completedSessions: 2,
      avgEndPaidRatio: 0.06,
      currentPaidRatio: 0.02,
      pastSessionsDue: 60000,
      totalOutstanding: 90000,
      sessionProgress: 0.4,
    })
  ).archetype,
  'CHRONIC_DEFAULTER'
)

check(
  'a chronic verdict states the share actually paid',
  classifyArchetype(
    makeFeatures({
      sessionsWithOpenDues: 2,
      completedSessions: 2,
      avgEndPaidRatio: 0.1,
      pastSessionsDue: 40000,
    })
  ).evidence.some((line) => line.includes('year after year'))
)

// ======================================================================
// 4d. The specific rule wins over the general one
//
// A family that clears the whole year in April has also, trivially, paid
// every installment on or before its due date. If the broad on-time rule is
// checked first it swallows the specific one and nobody is ever recognised as
// an up-front payer.
// ======================================================================

checkEqual(
  'paying everything up front is not merely "on time"',
  classifyArchetype(
    makeFeatures({
      completedSessions: 2,
      avgEndPaidRatio: 1,
      avgClearanceProgress: 0.05,
      currentPaidRatio: 1,
      onTimeInstallmentRate: 1,
      overdueInstallments: 0,
      sessionsTracked: 3,
      sessionProgress: 0.4,
    })
  ).archetype,
  'EARLY_FULL'
)

checkEqual(
  'spreading payments across the due dates is still "on time"',
  classifyArchetype(
    makeFeatures({
      completedSessions: 2,
      avgEndPaidRatio: 1,
      avgClearanceProgress: 0.7,
      currentPaidRatio: 0.67,
      onTimeInstallmentRate: 0.95,
      overdueInstallments: 0,
      sessionsTracked: 3,
      sessionProgress: 0.45,
    })
  ).archetype,
  'INSTALLMENT_REGULAR'
)

// ======================================================================
// 5. Ability moves the score in the right direction
// ======================================================================

check('affluent lifts the score', tierFactor('AFFLUENT') > 1)
check('severe cuts the score', tierFactor('SEVERE') < 1)
checkEqual('unknown ability is exactly neutral', tierFactor('UNKNOWN'), 1)

const base = makeFeatures({ totalOutstanding: 20000, avgTicket: 6000, currentPaidRatio: 0.4 })
const affluentScore = scorePropensity(
  { ...base, economicTier: 'AFFLUENT' },
  'YEAR_END_PARTIAL',
  DEFAULT_TUNING,
  { now: NOW }
).score
const severeScore = scorePropensity(
  { ...base, economicTier: 'SEVERE' },
  'YEAR_END_PARTIAL',
  DEFAULT_TUNING,
  { now: NOW }
).score
const unknownScore = scorePropensity(base, 'YEAR_END_PARTIAL', DEFAULT_TUNING, { now: NOW }).score

check(
  'able-to-pay outranks cannot-pay',
  affluentScore > severeScore,
  `affluent=${affluentScore.toFixed(3)} severe=${severeScore.toFixed(3)}`
)
check(
  'untagged sits between the two',
  unknownScore > severeScore && unknownScore < affluentScore,
  `unknown=${unknownScore.toFixed(3)}`
)

// ======================================================================
// 6. Promises
// ======================================================================

const withPromise = makeFeatures({
  totalOutstanding: 20000,
  avgTicket: 3000,
  openPromise: { id: 1, amount: 8000, promisedFor: new Date('2026-02-01T00:00:00Z') },
})
const withoutPromise = makeFeatures({ totalOutstanding: 20000, avgTicket: 3000 })

checkEqual(
  "a family's own figure is believed over the model",
  expectedCollectable(withPromise),
  8000
)
checkEqual('without a promise, expect a typical payment', expectedCollectable(withoutPromise), 3000)

const keptPromises = scorePropensity(
  makeFeatures({ totalOutstanding: 20000, avgTicket: 5000, promisesMade: 4, promisesKept: 4 }),
  'YEAR_END_PARTIAL',
  DEFAULT_TUNING,
  { now: NOW }
).score
const brokenPromises = scorePropensity(
  makeFeatures({
    totalOutstanding: 20000,
    avgTicket: 5000,
    promisesMade: 4,
    promisesKept: 0,
    promisesBroken: 4,
  }),
  'YEAR_END_PARTIAL',
  DEFAULT_TUNING,
  { now: NOW }
).score
check(
  'keeping promises raises the score',
  keptPromises > brokenPromises,
  `kept=${keptPromises.toFixed(3)} broken=${brokenPromises.toFixed(3)}`
)

// ======================================================================
// 6b. The evidence must not contradict itself
//
// A family with undated payment history is not a family that has never paid.
// Saying "no payment has ever been recorded" next to "their usual payment is
// ₹27,000" makes the whole panel look careless, and the panel is the only
// reason anyone trusts the call order.
// ======================================================================

const undatedHistory = scorePropensity(
  makeFeatures({
    totalOutstanding: 25000,
    avgTicket: 27250,
    totalPaymentCount: 4,
    datedPaymentCount: 0,
    timingProvenance: 'NONE',
    daysSinceLastPayment: null,
    lastPaymentAt: null,
    monthHistogram: {},
  }),
  'UNKNOWN',
  DEFAULT_TUNING,
  { now: NOW }
)

check(
  'undated history is not described as never having paid',
  !undatedHistory.evidence.some((line) => line.includes('No payment has ever been recorded')),
  undatedHistory.evidence.join(' | ')
)
check(
  'undated history says the dates are what is missing',
  undatedHistory.evidence.some((line) => line.includes('none of those payments carry a date'))
)
check(
  'no seasonal claim is made without dated payments',
  !undatedHistory.evidence.some((line) => line.includes('quiet month')),
  undatedHistory.evidence.join(' | ')
)

// A genuinely new family still reads as never having paid.
check(
  'a family with no payments at all still reads that way',
  scorePropensity(
    makeFeatures({ totalOutstanding: 25000, totalPaymentCount: 0, datedPaymentCount: 0 }),
    'UNKNOWN',
    DEFAULT_TUNING,
    { now: NOW }
  ).evidence.some((line) => line.includes('No payment has ever been recorded'))
)

// ======================================================================
// 7. Expected recovery never exceeds the balance
// ======================================================================

for (const outstanding of [0, 500, 5000, 90000]) {
  for (const ticket of [0, 800, 50000]) {
    const f = makeFeatures({ totalOutstanding: outstanding, avgTicket: ticket })
    const collectable = expectedCollectable(f)
    const erv = expectedRecoveryValue(0.95, collectable, outstanding)
    check(
      `expected recovery stays within the balance (${outstanding}/${ticket})`,
      erv <= outstanding + 0.001,
      `erv=${erv} outstanding=${outstanding}`
    )
    check(
      `expected collectable stays within the balance (${outstanding}/${ticket})`,
      collectable <= outstanding + 0.001
    )
  }
}

// An over-promise cannot inflate the forecast beyond what is owed.
checkEqual(
  'a promise larger than the balance is capped at the balance',
  expectedCollectable(
    makeFeatures({
      totalOutstanding: 5000,
      openPromise: { id: 1, amount: 99999, promisedFor: NOW },
    })
  ),
  5000
)

// ======================================================================
// 8. Suppression
// ======================================================================

const SUPPRESSION_CASES: {
  name: string
  features: Partial<HouseholdFeatures>
  state?: Partial<CaseState>
  rule: string
}[] = [
  { name: 'fully paid', features: { totalOutstanding: 0 }, rule: 'PAID_IN_FULL' },
  { name: 'trivial balance', features: { totalOutstanding: 120 }, rule: 'BELOW_MINIMUM' },
  {
    name: 'parked hardship',
    features: { totalOutstanding: 20000 },
    state: { parkedReason: 'Father lost his job' },
    rule: 'PARKED',
  },
  {
    name: 'snoozed',
    features: { totalOutstanding: 20000 },
    state: { snoozedUntil: new Date('2026-03-01T00:00:00Z') },
    rule: 'SNOOZED',
  },
  {
    name: 'open promise',
    features: {
      totalOutstanding: 20000,
      openPromise: { id: 1, amount: 5000, promisedFor: new Date('2026-02-01T00:00:00Z') },
    },
    rule: 'OPEN_PROMISE',
  },
  {
    name: 'just paid',
    features: {
      totalOutstanding: 20000,
      daysSinceLastPayment: 2,
      lastPaymentAt: new Date('2026-01-13T00:00:00Z'),
      lastPaymentAmount: 5000,
    },
    rule: 'JUST_PAID',
  },
  {
    name: 'nobody picking up',
    features: {
      totalOutstanding: 20000,
      consecutiveNoAnswer: 4,
      daysSinceLastContact: 1,
      lastContactAt: new Date('2026-01-14T00:00:00Z'),
    },
    rule: 'NO_ANSWER_BACKOFF',
  },
  {
    name: 'spoken to yesterday',
    features: {
      totalOutstanding: 20000,
      daysSinceLastContact: 1,
      lastContactAt: new Date('2026-01-14T00:00:00Z'),
    },
    rule: 'COOLING_OFF',
  },
  {
    name: 'no phone number',
    features: { totalOutstanding: 20000, reachableContacts: 0 },
    rule: 'NO_CONTACT',
  },
]

for (const testCase of SUPPRESSION_CASES) {
  const verdict = evaluateSuppression(
    makeFeatures(testCase.features),
    'YEAR_END_PARTIAL',
    { ...CLEAN_STATE, ...testCase.state },
    DEFAULT_TUNING,
    { now: NOW }
  )
  check(`suppresses: ${testCase.name}`, verdict.suppressed, 'was not suppressed')
  checkEqual(`suppression rule for ${testCase.name}`, verdict.rule, testCase.rule as never)
  check(
    `${testCase.name} explains itself`,
    Boolean(verdict.reason && verdict.reason.length > 0),
    'no reason given'
  )
}

// A reliable payer with nothing overdue is left alone; the same family with
// something overdue is not.
checkEqual(
  'reliable payer with nothing overdue is left alone',
  evaluateSuppression(
    makeFeatures({ totalOutstanding: 20000, overdueAmount: 0 }),
    'INSTALLMENT_REGULAR',
    CLEAN_STATE,
    DEFAULT_TUNING,
    { now: NOW }
  ).rule,
  'RELIABLE_PAYER'
)
check(
  'reliable payer WITH something overdue is called',
  !evaluateSuppression(
    makeFeatures({ totalOutstanding: 20000, overdueAmount: 9000, overdueInstallments: 1 }),
    'INSTALLMENT_REGULAR',
    CLEAN_STATE,
    DEFAULT_TUNING,
    { now: NOW }
  ).suppressed
)

// A household with real work to do is not suppressed at all.
check(
  'a genuinely callable household is not suppressed',
  !evaluateSuppression(
    makeFeatures({ totalOutstanding: 20000, overdueAmount: 20000, overdueInstallments: 2 }),
    'YEAR_END_PARTIAL',
    CLEAN_STATE,
    DEFAULT_TUNING,
    { now: NOW }
  ).suppressed
)

// ======================================================================
// 9. A pin overrides every suppression rule
// ======================================================================

for (const testCase of SUPPRESSION_CASES) {
  const verdict = evaluateSuppression(
    makeFeatures(testCase.features),
    'YEAR_END_PARTIAL',
    { ...CLEAN_STATE, ...testCase.state, pinnedForDate: NOW },
    DEFAULT_TUNING,
    { now: NOW }
  )
  check(`a pin overrides ${testCase.rule}`, !verdict.suppressed, 'pin did not override')
}

// A pin for a different day does not leak into today.
check(
  'a pin for another day does not apply today',
  evaluateSuppression(
    makeFeatures({ totalOutstanding: 0 }),
    'YEAR_END_PARTIAL',
    { ...CLEAN_STATE, pinnedForDate: new Date('2026-01-20T00:00:00Z') },
    DEFAULT_TUNING,
    { now: NOW }
  ).suppressed
)

// ======================================================================
// 10. Settings are clamped
// ======================================================================

const wild = clampTuning({
  cooldownDays: -50,
  minOutstanding: 9_999_999,
  noAnswerBackoffThreshold: 0,
  dailyCallTarget: 100000,
  scoreWeights: { tier: 12, season: -3 },
})
check('negative cooldown is clamped up', wild.cooldownDays >= 0)
check('absurd minimum is clamped down', wild.minOutstanding <= 100_000)
check('backoff threshold stays at least 1', wild.noAnswerBackoffThreshold >= 1)
check('call target stays sane', wild.dailyCallTarget <= 500)
check('weights stay within 0..1', wild.scoreWeights.tier <= 1 && wild.scoreWeights.season >= 0)

// Muting a factor makes it stop mattering.
const mutedTier = clampTuning({ scoreWeights: { tier: 0 } })
const affluentMuted = scorePropensity(
  { ...base, economicTier: 'AFFLUENT' },
  'YEAR_END_PARTIAL',
  mutedTier,
  { now: NOW }
).score
const severeMuted = scorePropensity(
  { ...base, economicTier: 'SEVERE' },
  'YEAR_END_PARTIAL',
  mutedTier,
  { now: NOW }
).score
check(
  'muting the ability factor removes its influence',
  Math.abs(affluentMuted - severeMuted) < 1e-9,
  `${affluentMuted} vs ${severeMuted}`
)

// ======================================================================
// 11. Tier suggestions stay suggestions
// ======================================================================

const concession = suggestTier(makeFeatures({ discountShare: 0.45 }))
checkEqual('a heavy concession suggests hardship', concession.tier, 'POOR')
check('a tier suggestion is never fully confident', concession.confidence < 1)
check('a tier suggestion explains itself', concession.evidence.length > 0)

checkEqual(
  'nothing known means no suggestion',
  suggestTier(makeFeatures()).tier,
  'UNKNOWN'
)
checkEqual('an empty suggestion claims no confidence', suggestTier(makeFeatures()).confidence, 0)

// ======================================================================
// 12. Every factor states a reason
// ======================================================================

const scored = scorePropensity(
  makeFeatures({ totalOutstanding: 20000, avgTicket: 5000 }),
  'YEAR_END_PARTIAL',
  DEFAULT_TUNING,
  { now: NOW }
)
check('every scoring factor carries a reason', scored.factors.every((f) => f.reason.length > 0))
check('every factor is bounded', scored.factors.every((f) => f.multiplier > 0 && f.multiplier < 3))
check('the score is a probability', scored.score > 0 && scored.score <= 1)

// ======================================================================

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} check(s) failed:\n`)
  for (const failure of failures) console.error(`   · ${failure}`)
  console.error(`\n${passed} passed, ${failures.length} failed.`)
  process.exit(1)
}

console.log(`✅ All ${passed} recovery engine checks passed.`)
