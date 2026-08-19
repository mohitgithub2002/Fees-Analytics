import { tierFactor } from './tier'
import type {
  EconomicTier,
  GuardianFeatures,
  PaymentArchetype,
  PropensityFactor,
  PropensityVerdict,
  RecoveryTuning,
} from './types'

/**
 * How likely is this household to pay something in the next 30 days, and how
 * much would that be?
 *
 * The ranking has to be *arguable*. A single opaque score tells a caller
 * nothing, so the probability is built as a product of bounded factors, each
 * emitting one line of plain English. What ends up on screen next to a name is
 * not "score 68" but "cleared last year in full · picked up both recent calls ·
 * pays every January" — which is also what makes the call itself go better.
 *
 * The output is deliberately an *expected amount*, not the full outstanding.
 * Ranking a chronic defaulter's ₹40,000 above a year-end payer's ₹12,000 is
 * how a call list ends up sorted by how badly a family is doing rather than by
 * what the day will actually collect.
 */

/** Odds of collecting from a household of this type, before anything else. */
const ARCHETYPE_BASE: Record<PaymentArchetype, number> = {
  EARLY_FULL: 0.7, // owing anything is out of character — usually an oversight
  INSTALLMENT_REGULAR: 0.6,
  YEAR_END_FULL: 0.35, // they will pay, but on their own calendar
  YEAR_END_PARTIAL: 0.25,
  HEAVY_ROLLOVER: 0.15,
  NEXT_YEAR_PAYER: 0.12,
  CHRONIC_DEFAULTER: 0.08,
  UNKNOWN: 0.3,
}

/** The share of an outstanding balance this type of household clears at once. */
const EXPECTED_SHARE: Record<PaymentArchetype, number> = {
  EARLY_FULL: 1,
  INSTALLMENT_REGULAR: 1,
  YEAR_END_FULL: 0.9,
  YEAR_END_PARTIAL: 0.6,
  HEAVY_ROLLOVER: 0.35,
  NEXT_YEAR_PAYER: 0.3,
  CHRONIC_DEFAULTER: 0.25,
  UNKNOWN: 0.5,
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function scorePropensity(
  f: GuardianFeatures,
  archetype: PaymentArchetype,
  tier: EconomicTier,
  tuning: RecoveryTuning,
  now: Date = new Date()
): PropensityVerdict {
  const factors: PropensityFactor[] = []
  const weights = tuning.scoreWeights ?? {}
  const applyOverride = (key: string, value: number) =>
    typeof weights[key] === 'number' ? weights[key] : value

  let probability = applyOverride(`base.${archetype}`, ARCHETYPE_BASE[archetype])

  const push = (key: string, weight: number, reason: string) => {
    const w = applyOverride(key, weight)
    factors.push({ key, weight: w, reason })
    probability *= w
  }

  /* ── Ability to pay ─────────────────────────────────────────────────── */

  if (tier !== 'UNKNOWN') {
    const w = tierFactor(tier)
    const reason =
      w >= 1.1
        ? 'Tagged as able to pay — money is not the obstacle.'
        : w <= 0.6
          ? 'Tagged as struggling — a call is unlikely to produce payment on its own.'
          : 'Can pay in full, but it takes them effort.'
    push(`tier.${tier}`, w, reason)
  }

  /* ── Recency: has money moved lately? ───────────────────────────────── */

  const days = f.daysSinceLastPayment
  if (days === null) {
    push('recency.never', 0.4, 'Has never paid anything — no evidence money will start now.')
  } else if (days < tuning.justPaidSuppressDays) {
    push(
      'recency.justPaid',
      0.35,
      `Paid ${rupees(f.lastPaymentPaise ?? 0)} ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`} — give them room before asking again.`
    )
  } else if (days <= 30) {
    push('recency.recent', 0.9, `Last paid ${days} days ago — actively settling.`)
  } else if (days <= 90) {
    push('recency.warm', 1.05, `Last payment ${days} days ago — due for the next one.`)
  } else if (days <= 180) {
    push('recency.cooling', 0.85, `Nothing received for ${Math.round(days / 30)} months.`)
  } else if (days <= 365) {
    push('recency.cold', 0.6, `Nothing received for ${Math.round(days / 30)} months.`)
  } else {
    push('recency.dormant', 0.4, `No payment in over a year (${Math.round(days / 365)}+ years).`)
  }

  /* ── Do they keep their word? The strongest single signal there is ──── */

  if (f.hasOpenPromise && f.openPromiseDate) {
    const dueIn = Math.ceil((f.openPromiseDate.getTime() - now.getTime()) / 86_400_000)
    if (dueIn >= 0) {
      push(
        'promise.open',
        1.6,
        `Promised ${rupees(f.openPromisePaise)} by ${formatDate(f.openPromiseDate)}${dueIn === 0 ? ' — today' : ` (${dueIn} days)`}.`
      )
    } else {
      push(
        'promise.overdue',
        1.2,
        `Promised ${rupees(f.openPromisePaise)} by ${formatDate(f.openPromiseDate)} — ${Math.abs(dueIn)} days overdue. Worth pressing.`
      )
    }
  }

  if (f.promisesMade > 0) {
    const keptRate = f.promisesKept / f.promisesMade
    const w = 0.6 + 0.8 * keptRate
    push(
      'promise.history',
      w,
      keptRate >= 0.7
        ? `Kept ${f.promisesKept} of ${f.promisesMade} promises — their word is good.`
        : keptRate <= 0.3
          ? `Broke ${f.promisesBroken} of ${f.promisesMade} promises — treat commitments cautiously.`
          : `Kept ${f.promisesKept} of ${f.promisesMade} promises.`
    )
  }

  /* ── Can we even reach them? ────────────────────────────────────────── */

  if (f.contactAttempts > 0) {
    const pickRate = f.contactsReached / f.contactAttempts
    push(
      'contact.reach',
      0.7 + 0.6 * pickRate,
      pickRate >= 0.6
        ? `Answers the phone (${f.contactsReached} of ${f.contactAttempts} attempts).`
        : `Hard to reach — answered ${f.contactsReached} of ${f.contactAttempts} attempts.`
    )
  }

  if (f.consecutiveNoAnswer >= tuning.noAnswerBackoffThreshold) {
    push(
      'contact.unreachable',
      0.55,
      `${f.consecutiveNoAnswer} calls in a row went unanswered — try the alternate number or a home visit.`
    )
  }

  /* ── Their own calendar ─────────────────────────────────────────────── */

  const season = seasonFactor(f, now)
  if (season) push('season', season.weight, season.reason)

  /* ── Size of the ask ────────────────────────────────────────────────── */

  // A balance many times larger than anything they have ever paid at once is
  // not going to arrive because of one phone call.
  if (f.avgTicketPaise && f.totalOutstandingPaise > f.avgTicketPaise * 4) {
    push(
      'ask.oversized',
      0.8,
      `Outstanding is ${Math.round(f.totalOutstandingPaise / f.avgTicketPaise)}× their typical payment of ${rupees(f.avgTicketPaise)} — expect part payment, and ask for a plan.`
    )
  }

  probability = clamp(probability, 0.02, 0.95)

  /* ── Expected amount, not the full balance ──────────────────────────── */

  const share = EXPECTED_SHARE[archetype]
  let expectedAmount = Math.round(f.totalOutstandingPaise * share)

  // If they have named a figure themselves, believe that over the model.
  if (f.hasOpenPromise && f.openPromisePaise > 0) {
    expectedAmount = Math.min(f.totalOutstandingPaise, f.openPromisePaise)
  }
  // Never expect more in one go than they have ever managed, unless they
  // reliably clear the whole year.
  if (f.avgTicketPaise && share < 0.9) {
    expectedAmount = Math.max(
      Math.min(expectedAmount, Math.round(f.avgTicketPaise * 1.5)),
      Math.min(f.totalOutstandingPaise, Math.round(f.avgTicketPaise))
    )
  }

  return {
    probability,
    score: Math.round(probability * 100),
    factors,
    expectedRecoveryPaise: Math.round(probability * expectedAmount),
  }
}

/**
 * Households pay on their own annual rhythm — harvest, bonus season, a
 * particular month every year. Calling someone in the month they always pay is
 * a different conversation from calling them in the month they never do.
 */
function seasonFactor(
  f: GuardianFeatures,
  now: Date
): { weight: number; reason: string } | null {
  const histogram = f.monthHistogram
  if (!histogram || Object.keys(histogram).length === 0) return null

  const thisMonth = now.getMonth() + 1
  const nextMonth = (thisMonth % 12) + 1
  const share = (histogram[String(thisMonth)] ?? 0) + (histogram[String(nextMonth)] ?? 0)

  const baseline = 2 / 12 // two months' worth of an even spread
  if (share >= baseline * 2) {
    return {
      weight: 1.35,
      reason: `${MONTHS[thisMonth - 1]}–${MONTHS[nextMonth - 1]} is when they historically pay (${Math.round(share * 100)}% of everything they have ever paid).`,
    }
  }
  if (share <= baseline * 0.3) {
    return {
      weight: 0.8,
      reason: `They have almost never paid in ${MONTHS[thisMonth - 1]} — expect to have to wait.`,
    }
  }
  return null
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/**
 * Reliability is a backward-looking character reference, separate from the
 * forward-looking propensity: "do they settle what they owe, over the years?"
 * A family can score low here and high on propensity (a chronic defaulter with
 * a fresh promise), and that combination is exactly the call worth making.
 */
export function reliabilityScore(f: GuardianFeatures): number {
  const closed = f.closedSessions.filter((s) => s.billedPaise > 0)
  if (closed.length === 0) return 50

  const ratio = closed.reduce((s, x) => s + x.paidRatio, 0) / closed.length
  let score = ratio * 70

  if (f.onTimeInstallmentRate !== null) score += (f.onTimeInstallmentRate / 100) * 20
  else score += 10 // no due dates recorded — don't punish for missing data

  if (f.promisesMade > 0) score += (f.promisesKept / f.promisesMade) * 10
  else score += 5

  score -= Math.min(15, f.rolloverStreak * 5)

  return Math.round(clamp(score, 0, 100))
}
