/**
 * How likely is a call to this household to actually produce money, and how
 * much? Pure and Prisma-free.
 *
 * The score is a product of bounded factors:
 *
 *   p = base(archetype) x tier x recency x promises x contact x season x askSize
 *
 * Multiplicative rather than additive so that one damning signal can drag the
 * whole score down — a family that never answers and broke its last two
 * promises should not be rescued into the call list by a large balance.
 *
 * Every factor is bounded, every factor emits one plain-English line, and
 * every factor can be muted from /recovery/settings without anyone editing
 * this formula (see applyWeight). The evidence is what the UI shows; the
 * number is only how the list gets sorted.
 */
import { isWorthChasing } from './archetype'
import { tierFactor } from './tier'
import type {
  HouseholdFeatures,
  PaymentArchetype,
  PropensityFactor,
  PropensityResult,
  RecoveryTuning,
} from './types'

/**
 * Probability that a call lands a payment within 30 days, before any other
 * signal is considered.
 *
 * Reliable payers score HIGH here, which reads oddly until you remember what
 * the list is for: they are suppressed whenever nothing is overdue, so the
 * only way one reaches the worklist at all is that something has slipped —
 * and a family that always pays on time, with something overdue, has usually
 * just forgotten. That is the easiest money on the list.
 */
const ARCHETYPE_BASE: Record<PaymentArchetype, number> = {
  CHRONIC_DEFAULTER: 0.12,
  NEXT_YEAR_PAYER: 0.3,
  HEAVY_ROLLOVER: 0.25,
  YEAR_END_PARTIAL: 0.4,
  YEAR_END_FULL: 0.45,
  INSTALLMENT_REGULAR: 0.55,
  EARLY_FULL: 0.6,
  UNKNOWN: 0.3,
}

const MIN_SCORE = 0.02
const MAX_SCORE = 0.95

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Damp a factor toward neutral by its configured weight.
 * weight 1 = full strength, weight 0 = the factor is switched off.
 */
function applyWeight(factor: number, weight: number): number {
  return 1 + (factor - 1) * clamp(weight, 0, 1)
}

function money(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

export interface ScoreOptions {
  /** Injected so the fixture harness can pin "today". */
  now?: Date
}

export function scorePropensity(
  f: HouseholdFeatures,
  archetype: PaymentArchetype,
  tuning: RecoveryTuning,
  opts: ScoreOptions = {}
): PropensityResult {
  const now = opts.now ?? new Date()
  const w = tuning.scoreWeights
  const factors: PropensityFactor[] = []

  const base = ARCHETYPE_BASE[archetype] ?? ARCHETYPE_BASE.UNKNOWN

  // --- Ability to pay -------------------------------------------------
  const rawTier = tierFactor(f.economicTier)
  const tierF = applyWeight(rawTier, w.tier ?? 1)
  factors.push({
    name: 'tier',
    multiplier: tierF,
    reason:
      f.economicTier === 'UNKNOWN'
        ? 'Ability to pay has not been assessed, so it neither helps nor hurts the score.'
        : rawTier >= 1.2
          ? 'Tagged as able to pay — this is a timing problem, not a money problem.'
          : rawTier < 1
            ? 'Tagged as struggling to pay — calling harder will not create money.'
            : 'Tagged as able to pay, but it is a stretch.',
  })

  // --- How recently money last moved ---------------------------------
  let rawRecency: number
  let recencyReason: string
  if (f.daysSinceLastPayment === null) {
    rawRecency = 0.8
    // These two cases look identical in the data and mean opposite things, so
    // they must not share a sentence. A family that has paid plenty — just
    // without recorded dates — is not a family that has never paid, and saying
    // so next to "their usual payment is ₹27,000" makes the whole panel look
    // careless.
    recencyReason =
      f.totalPaymentCount > 0
        ? 'They have paid before, but none of those payments carry a date, so how recently is unknown.'
        : 'No payment has ever been recorded from this family.'
  } else if (f.daysSinceLastPayment <= 30) {
    rawRecency = 1.15
    recencyReason = `Paid ${f.daysSinceLastPayment} days ago — they are in a paying phase.`
  } else if (f.daysSinceLastPayment <= 90) {
    rawRecency = 1.0
    recencyReason = `Last paid ${f.daysSinceLastPayment} days ago.`
  } else if (f.daysSinceLastPayment <= 180) {
    rawRecency = 0.85
    recencyReason = `Nothing has come in for ${f.daysSinceLastPayment} days.`
  } else {
    rawRecency = 0.7
    recencyReason = `Nothing has come in for over ${Math.floor(f.daysSinceLastPayment / 30)} months.`
  }
  const recencyF = applyWeight(rawRecency, w.recency ?? 1)
  factors.push({ name: 'recency', multiplier: recencyF, reason: recencyReason })

  // --- Do they keep their word? ---------------------------------------
  let rawPromises = 1
  let promiseReason = 'No promises made yet, so there is nothing to go on.'
  if (f.promisesMade > 0) {
    const keptRate = f.promisesKept / f.promisesMade
    rawPromises = 0.6 + 0.6 * keptRate
    promiseReason = `Kept ${f.promisesKept} of ${f.promisesMade} promises to pay.`
    if (f.promisesBroken > 0 && keptRate < 0.5) {
      promiseReason += ' Most commitments have not been honoured.'
    }
  }
  const promiseF = applyWeight(rawPromises, w.promises ?? 1)
  factors.push({ name: 'promises', multiplier: promiseF, reason: promiseReason })

  // --- Can we even get through? ---------------------------------------
  let rawContact = 1
  let contactReason = 'Not contacted yet.'
  if (f.reachableContacts === 0) {
    rawContact = 0.5
    contactReason = 'No usable phone number on record — somebody has to find one first.'
  } else if (f.contactAttempts > 0) {
    rawContact = 0.7 + 0.5 * f.contactPickRate
    contactReason = `Answers ${pct(f.contactPickRate)} of calls (${f.contactsAnswered} of ${f.contactAttempts}).`
    if (f.consecutiveNoAnswer > 0) {
      contactReason += ` ${f.consecutiveNoAnswer} unanswered since anyone last got through.`
    }
  }
  const contactF = applyWeight(rawContact, w.contact ?? 1)
  factors.push({ name: 'contact', multiplier: contactF, reason: contactReason })

  // --- Is this a month they normally pay in? --------------------------
  // Damped hard by default: with one year of history the histogram is a single
  // sample, and a coincidence dressed up as a habit would mis-rank the list.
  const month = String(now.getMonth() + 1)
  const share = Number(f.monthHistogram?.[month] ?? 0)
  const uniform = 1 / 12
  // Gated on DATED payments, not all of them: the histogram is built only from
  // payments that carry a date, so an undated history would otherwise read as
  // "a quiet month (0% of their payments)" — a confident-sounding claim drawn
  // from nothing.
  const hasSeasonality = f.datedPaymentCount > 0
  const rawSeason = hasSeasonality ? clamp(1 + (share - uniform) * 4, 0.75, 1.3) : 1
  const seasonF = applyWeight(rawSeason, w.season ?? 0.5)
  factors.push({
    name: 'season',
    multiplier: seasonF,
    reason: !hasSeasonality
      ? 'No dated payments, so there is no seasonal pattern to read.'
      : share > uniform
        ? `${pct(share)} of what they have ever paid came in this month of the year.`
        : `Historically a quiet month for this family (${pct(share)} of their payments).`,
  })

  // --- Is the ask realistic? ------------------------------------------
  let rawAsk = 1
  let askReason = 'No payment history to judge the size of the ask against.'
  if (f.avgTicket > 0 && f.totalOutstanding > 0) {
    const ratio = f.totalOutstanding / f.avgTicket
    if (ratio <= 1) {
      rawAsk = 1.2
      askReason = `The whole balance is about one of their usual payments (${money(f.avgTicket)}).`
    } else if (ratio <= 3) {
      rawAsk = 1.0
      askReason = `The balance is about ${Math.round(ratio)} of their usual payments.`
    } else {
      rawAsk = 0.75
      askReason = `The balance is ${Math.round(ratio)}x what they usually pay at once — expect a part payment, not the full amount.`
    }
  }
  const askF = applyWeight(rawAsk, w.askSize ?? 1)
  factors.push({ name: 'askSize', multiplier: askF, reason: askReason })

  // --- Combine ---------------------------------------------------------
  const archetypeBase = applyWeight(base / ARCHETYPE_BASE.UNKNOWN, w.archetype ?? 1) * ARCHETYPE_BASE.UNKNOWN
  const score = clamp(
    archetypeBase * tierF * recencyF * promiseF * contactF * seasonF * askF,
    MIN_SCORE,
    MAX_SCORE
  )

  // --- What would actually arrive --------------------------------------
  const expectedRecovery = expectedCollectable(f)

  const evidence = factors.map((x) => x.reason)
  if (f.openPromise) {
    evidence.unshift(
      `Promised ${money(f.openPromise.amount)} by ${f.openPromise.promisedFor.toLocaleDateString('en-IN')} — their own figure, believed over the model.`
    )
  }
  if (!isWorthChasing(archetype) && f.totalOutstanding > 0) {
    evidence.push('Normally pays without chasing, so something has slipped — usually an easy call.')
  }

  return { score, factors, expectedRecovery, evidence }
}

/**
 * What this household would plausibly hand over in one go.
 *
 * Where a family has named a figure themselves, that figure is believed over
 * anything the model would infer — they know their own circumstances, and a
 * forecast built on their words is one they can be held to.
 *
 * Otherwise the best evidence of how much they pay at a time is how much they
 * have paid at a time. Never more than what is actually owed.
 */
export function expectedCollectable(f: HouseholdFeatures): number {
  if (f.totalOutstanding <= 0) return 0

  if (f.openPromise) {
    return Math.min(f.openPromise.amount, f.totalOutstanding)
  }
  if (f.avgTicket > 0) {
    return Math.min(f.avgTicket, f.totalOutstanding)
  }
  // Never paid anything: one installment's worth of this year's bill is the
  // most defensible guess available.
  const oneInstallment = f.currentSessionBilled > 0 ? f.currentSessionBilled / 3 : f.totalOutstanding
  return Math.min(oneInstallment, f.totalOutstanding)
}

/**
 * Expected recovery value — what the worklist actually ranks on.
 *
 * Never the raw balance: sorting by outstanding ranks families by how badly
 * they are doing rather than by what the day will collect, which is how a call
 * list ends up spending its best hours on the people least able to pay.
 */
export function expectedRecoveryValue(score: number, collectable: number, outstanding: number): number {
  return Math.min(score * collectable, outstanding)
}

/**
 * How dependable this household is, independent of what they currently owe.
 * Shown on the parent page; also used to decide who belongs in the committed
 * forecast band.
 */
export function reliabilityScore(f: HouseholdFeatures, archetype: PaymentArchetype): number {
  let score = 0.5

  if (archetype === 'INSTALLMENT_REGULAR' || archetype === 'EARLY_FULL') score += 0.3
  else if (archetype === 'YEAR_END_FULL') score += 0.1
  else if (archetype === 'CHRONIC_DEFAULTER') score -= 0.3
  else if (archetype === 'HEAVY_ROLLOVER' || archetype === 'NEXT_YEAR_PAYER') score -= 0.2

  if (f.onTimeInstallmentRate !== null) score += (f.onTimeInstallmentRate - 0.5) * 0.3
  if (f.promisesMade > 0) score += (f.promisesKept / f.promisesMade - 0.5) * 0.2
  if (f.rolloverStreak > 0) score -= Math.min(0.2, f.rolloverStreak * 0.07)

  return clamp(score, 0, 1)
}
