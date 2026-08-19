/**
 * Fixture check for the archetype classifier and propensity scorer.
 *
 * The classifier decides who gets phoned, so its rules need to be pinned down
 * by examples rather than trusted by inspection. These are pure functions over
 * a plain feature vector — no database, no Prisma — so this runs standalone:
 *
 *   npm run recovery:verify
 *
 * Exits non-zero on the first failing expectation, so it can gate a deploy.
 */
import { classifyArchetype } from '../src/lib/recovery/archetype'
import { scorePropensity, reliabilityScore } from '../src/lib/recovery/propensity'
import { suggestTier } from '../src/lib/recovery/tier'
import { evaluateSuppression } from '../src/lib/recovery/suppression'
import { DEFAULT_TUNING } from '../src/lib/recovery/types'
import type { GuardianFeatures, PaymentArchetype, SessionBehaviour } from '../src/lib/recovery/types'

const NOW = new Date('2026-08-19T00:00:00Z')
const L = 364 // session length in days

function session(overrides: Partial<SessionBehaviour> = {}): SessionBehaviour {
  const billed = overrides.billedPaise ?? 1_000_000 // ₹10,000
  const paid = overrides.paidPaise ?? billed
  return {
    sessionId: 1,
    sessionName: '2024-25',
    startDate: new Date('2024-04-01'),
    endDate: new Date('2025-03-31'),
    isCurrent: false,
    lengthDays: L,
    billedPaise: billed,
    paidPaise: paid,
    duePaise: billed - paid,
    paidRatio: billed > 0 ? paid / billed : 1,
    firstPaymentDay: 20,
    clearanceDay: 60,
    lastQuarterShare: 0,
    paymentCount: 3,
    paidTowardsPastPaise: 0,
    paidAfterSessionEndPaise: 0,
    installmentsDue: 3,
    installmentsPaidOnTime: 3,
    avgDaysLate: null,
    ...overrides,
  }
}

/** Build a feature vector, deriving the rollups the classifier reads. */
function features(
  sessions: SessionBehaviour[],
  overrides: Partial<GuardianFeatures> = {}
): GuardianFeatures {
  const closed = sessions.filter((s) => !s.isCurrent)
  const current = sessions.find((s) => s.isCurrent) ?? null
  const clearanceDays = closed.map((s) => s.clearanceDay).filter((d): d is number => d !== null)

  return {
    guardianId: 1,
    childrenCount: 1,
    sessions,
    closedSessions: closed,
    current,
    lifetimeBilledPaise: sessions.reduce((s, x) => s + x.billedPaise, 0),
    lifetimePaidPaise: sessions.reduce((s, x) => s + x.paidPaise, 0),
    totalOutstandingPaise: sessions.reduce((s, x) => s + x.duePaise, 0),
    currentSessionDuePaise: current?.duePaise ?? 0,
    pastSessionsDuePaise: closed.reduce((s, x) => s + x.duePaise, 0),
    sessionsTracked: sessions.length,
    sessionsWithDues: sessions.filter((s) => s.duePaise > 0).length,
    rolloverStreak: 0,
    openDueSessions: sessions.filter((s) => s.duePaise > 0).length,
    lastPaymentAt: new Date('2026-06-01'),
    lastPaymentPaise: 200_000,
    daysSinceLastPayment: 79,
    avgTicketPaise: 200_000,
    avgTicketShare: 0.2,
    avgDaysToFirstPayment: 20,
    avgClearanceDay: clearanceDays.length
      ? Math.round(clearanceDays.reduce((a, b) => a + b, 0) / clearanceDays.length)
      : null,
    onTimeInstallmentRate: null,
    avgDaysLate: null,
    monthHistogram: {},
    hasBusFee: false,
    discountShare: 0,
    contactAttempts: 0,
    contactsReached: 0,
    consecutiveNoAnswer: 0,
    lastContactAt: null,
    promisesMade: 0,
    promisesKept: 0,
    promisesBroken: 0,
    hasOpenPromise: false,
    openPromiseDate: null,
    openPromisePaise: 0,
    ...overrides,
  }
}

/* ── Fixtures: one per archetype, each the minimal case that triggers it ── */

const CASES: { name: string; features: GuardianFeatures; expect: PaymentArchetype }[] = [
  {
    name: 'no completed session → UNKNOWN',
    features: features([session({ isCurrent: true, paidPaise: 300_000 })]),
    expect: 'UNKNOWN',
  },
  {
    name: 'dues open in two sessions at once → CHRONIC_DEFAULTER',
    features: features([
      session({ sessionId: 1, sessionName: '2023-24', paidPaise: 200_000 }),
      session({ sessionId: 2, sessionName: '2024-25', paidPaise: 100_000 }),
    ]),
    expect: 'CHRONIC_DEFAULTER',
  },
  {
    name: "current year untouched while last year's dues are being paid → NEXT_YEAR_PAYER",
    features: features(
      [
        session({ sessionId: 1, paidPaise: 1_000_000 }),
        session({
          sessionId: 2, isCurrent: true, billedPaise: 1_000_000, paidPaise: 50_000,
          paidTowardsPastPaise: 400_000,
        }),
      ],
      // Only the current session is in arrears, so the chronic rule must not fire.
      { openDueSessions: 1 }
    ),
    expect: 'NEXT_YEAR_PAYER',
  },
  {
    name: 'most money lands after the session ends → NEXT_YEAR_PAYER',
    features: features([
      session({ paidPaise: 1_000_000, paidAfterSessionEndPaise: 800_000 }),
    ]),
    expect: 'NEXT_YEAR_PAYER',
  },
  {
    name: 'clears in full inside the first third → EARLY_FULL',
    features: features([session({ clearanceDay: 40 })]),
    expect: 'EARLY_FULL',
  },
  {
    name: 'clears in full, meets due dates → INSTALLMENT_REGULAR',
    features: features([session({ clearanceDay: 300 })], { onTimeInstallmentRate: 85 }),
    expect: 'INSTALLMENT_REGULAR',
  },
  {
    name: 'clears in full but most of it in the last quarter → YEAR_END_FULL',
    features: features([session({ clearanceDay: 320, lastQuarterShare: 0.8 })], {
      onTimeInstallmentRate: 20,
    }),
    expect: 'YEAR_END_FULL',
  },
  {
    name: 'pays ~70% and leaves a tail → YEAR_END_PARTIAL',
    features: features([session({ paidPaise: 700_000 })], { openDueSessions: 1 }),
    expect: 'YEAR_END_PARTIAL',
  },
  {
    name: 'pays under half by year end → HEAVY_ROLLOVER',
    features: features([session({ paidPaise: 300_000 })], { openDueSessions: 1 }),
    expect: 'HEAVY_ROLLOVER',
  },
  {
    name: 'never paid anything → HEAVY_ROLLOVER',
    features: features([session({ paidPaise: 0 })], { openDueSessions: 1 }),
    expect: 'HEAVY_ROLLOVER',
  },
]

/* ── Runner ──────────────────────────────────────────────────────────── */

let failures = 0

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failures++
  }
}

console.log('\nArchetype classification')
for (const c of CASES) {
  const verdict = classifyArchetype(c.features)
  check(c.name, verdict.archetype === c.expect, `got ${verdict.archetype}`)
  if (verdict.evidence.length === 0) {
    check(`${c.name} — carries evidence`, false, 'no evidence lines emitted')
  }
}

console.log('\nConfidence')
{
  const oneSession = classifyArchetype(features([session({ clearanceDay: 40 })]))
  const threeSessions = classifyArchetype(
    features([
      session({ sessionId: 1, clearanceDay: 40 }),
      session({ sessionId: 2, clearanceDay: 45 }),
      session({ sessionId: 3, clearanceDay: 38 }),
    ])
  )
  check(
    'more history yields higher confidence',
    threeSessions.confidence > oneSession.confidence,
    `${threeSessions.confidence} vs ${oneSession.confidence}`
  )
  const unknown = classifyArchetype(features([session({ isCurrent: true })]))
  check('UNKNOWN is low-confidence', unknown.confidence <= 30, `got ${unknown.confidence}`)
}

console.log('\nPropensity')
{
  const base = features([session({ paidPaise: 300_000 })], { openDueSessions: 1 })

  const withPromise = scorePropensity(
    { ...base, hasOpenPromise: true, openPromiseDate: new Date('2026-08-25'), openPromisePaise: 500_000 },
    'HEAVY_ROLLOVER', 'STRAINED', DEFAULT_TUNING, NOW
  )
  const withoutPromise = scorePropensity(base, 'HEAVY_ROLLOVER', 'STRAINED', DEFAULT_TUNING, NOW)
  check(
    'an open promise raises propensity',
    withPromise.probability > withoutPromise.probability,
    `${withPromise.probability.toFixed(3)} vs ${withoutPromise.probability.toFixed(3)}`
  )

  const justPaid = scorePropensity(
    { ...base, daysSinceLastPayment: 1 },
    'HEAVY_ROLLOVER', 'STRAINED', DEFAULT_TUNING, NOW
  )
  check(
    'a household that just paid ranks lower',
    justPaid.probability < withoutPromise.probability,
    `${justPaid.probability.toFixed(3)} vs ${withoutPromise.probability.toFixed(3)}`
  )

  const severe = scorePropensity(base, 'HEAVY_ROLLOVER', 'SEVERE', DEFAULT_TUNING, NOW)
  const affluent = scorePropensity(base, 'HEAVY_ROLLOVER', 'AFFLUENT', DEFAULT_TUNING, NOW)
  check(
    'ability to pay moves the score the right way',
    affluent.probability > severe.probability,
    `affluent ${affluent.probability.toFixed(3)} vs severe ${severe.probability.toFixed(3)}`
  )

  check('probability stays within bounds', [withPromise, withoutPromise, justPaid, severe, affluent].every(
    (v) => v.probability >= 0.02 && v.probability <= 0.95
  ))

  check(
    'expected recovery never exceeds the balance',
    [withoutPromise, severe, affluent].every((v) => v.expectedRecoveryPaise <= base.totalOutstandingPaise)
  )

  check('every factor carries a reason', withPromise.factors.every((f) => f.reason.length > 0))
}

console.log('\nReliability')
{
  const good = reliabilityScore(features([session({ paidPaise: 1_000_000 })], { onTimeInstallmentRate: 95 }))
  const bad = reliabilityScore(features([session({ paidPaise: 100_000 })], { onTimeInstallmentRate: 5, rolloverStreak: 3 }))
  check('a reliable payer outscores a defaulter', good > bad, `${good} vs ${bad}`)
  check('score stays 0–100', good <= 100 && bad >= 0)
}

console.log('\nTier suggestion')
{
  check(
    'no history yields UNKNOWN',
    suggestTier(features([session({ isCurrent: true })])).tier === 'UNKNOWN'
  )
  check(
    'always pays in full → able to pay',
    ['COMFORTABLE', 'AFFLUENT'].includes(suggestTier(features([session({ paidPaise: 1_000_000 })])).tier)
  )
  check(
    'a suggestion is never stated with high confidence',
    suggestTier(features([session({ paidPaise: 1_000_000 })])).confidence <= 65
  )
}

console.log('\nSuppression')
{
  const base = features([session({ paidPaise: 300_000 })], { openDueSessions: 1 })

  check(
    'nothing outstanding → suppressed',
    evaluateSuppression(
      { features: features([session({ paidPaise: 1_000_000 })]), archetype: 'YEAR_END_FULL' },
      DEFAULT_TUNING, NOW
    ).suppressed
  )

  check(
    'just paid → suppressed',
    evaluateSuppression(
      { features: { ...base, daysSinceLastPayment: 2, lastPaymentAt: new Date('2026-08-17') }, archetype: 'HEAVY_ROLLOVER' },
      DEFAULT_TUNING, NOW
    ).suppressed
  )

  check(
    'open promise with a future date → suppressed',
    evaluateSuppression(
      {
        features: { ...base, hasOpenPromise: true, openPromiseDate: new Date('2026-08-30'), openPromisePaise: 500_000 },
        archetype: 'HEAVY_ROLLOVER',
      },
      DEFAULT_TUNING, NOW
    ).suppressed
  )

  const broken = evaluateSuppression(
    {
      features: { ...base, hasOpenPromise: true, openPromiseDate: new Date('2026-08-01'), openPromisePaise: 500_000 },
      archetype: 'HEAVY_ROLLOVER',
    },
    DEFAULT_TUNING, NOW
  )
  check('a promise past its grace period stops suppressing', !broken.suppressed)

  const pinned = evaluateSuppression(
    {
      features: { ...base, daysSinceLastPayment: 1, lastPaymentAt: NOW },
      archetype: 'HEAVY_ROLLOVER',
      pinnedForDate: NOW,
    },
    DEFAULT_TUNING, NOW
  )
  check('an explicit pin overrides every rule', !pinned.suppressed)

  const suppressed = evaluateSuppression(
    { features: { ...base, daysSinceLastPayment: 2, lastPaymentAt: new Date('2026-08-17') }, archetype: 'HEAVY_ROLLOVER' },
    DEFAULT_TUNING, NOW
  )
  check('suppression always states a reason', !!suppressed.reason)
}

console.log('')
if (failures > 0) {
  console.error(`${failures} check(s) failed.\n`)
  process.exit(1)
}
console.log('All checks passed.\n')
