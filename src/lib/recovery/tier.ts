import type { EconomicTier, GuardianFeatures, TierSuggestion } from './types'

/**
 * Economic tier: whether a household CAN pay.
 *
 * The ledger records what was paid, never why it wasn't — so this file only
 * ever produces a *suggestion*, and says so. A family that pays nothing might
 * be destitute or simply unwilling, and the two need opposite treatment: one
 * needs a concession, the other needs a firmer call. Nothing in the payment
 * record separates them. Only a person who has spoken to the family can, which
 * is why `Guardian.economicTier` (human-set) always overrides this, and why
 * every suggestion carries a low ceiling on confidence.
 *
 * The useful signals are about *shape* rather than amount:
 * - Pays in full eventually, however late → the money exists.
 * - Pays in many small fragments → assembling the fee is a struggle.
 * - Already carries a large discount → the school has assessed hardship before.
 */

const FRAGMENT_SHARE = 0.15 // a payment worth <15% of a year's fees is a fragment
const HIGH_DISCOUNT = 0.2 // a fifth of the bill already waived

const pct = (v: number) => `${Math.round(v * 100)}%`
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0

const CAVEAT = 'Suggested from payment behaviour only — confirm with the family before acting on it.'

export function suggestTier(f: GuardianFeatures): TierSuggestion {
  const closed = f.closedSessions.filter((s) => s.billedPaise > 0)

  if (closed.length === 0) {
    return {
      tier: 'UNKNOWN',
      confidence: 0,
      evidence: ['No completed session on record — nothing to infer ability from yet.'],
    }
  }

  const avgRatio = mean(closed.map((s) => s.paidRatio))
  const fragments =
    f.avgTicketShare !== null && f.avgTicketShare < FRAGMENT_SHARE && f.sessions.some((s) => s.paymentCount >= 4)
  const heavyDiscount = f.discountShare >= HIGH_DISCOUNT

  const suggest = (tier: EconomicTier, confidence: number, lines: string[]): TierSuggestion => ({
    tier,
    confidence: Math.min(confidence, closed.length >= 2 ? 65 : 45),
    evidence: [...lines, CAVEAT],
  })

  /* The school has already granted a substantial concession — that is a prior
     human assessment of hardship, and it outranks anything inferred here. */
  if (heavyDiscount && avgRatio < 0.95) {
    return suggest('POOR', 55, [
      `${pct(f.discountShare)} of this family's fees have already been waived as discount.`,
      'Someone has previously judged them unable to pay the full amount.',
    ])
  }

  /* Pays everything, eventually — the money is there. */
  if (avgRatio >= 0.95) {
    const clearsEarly =
      f.avgClearanceDay !== null && f.avgClearanceDay <= closed[closed.length - 1].lengthDays * 0.33

    if (clearsEarly && f.hasBusFee) {
      return suggest('AFFLUENT', 60, [
        'Clears the full year early, and pays for optional transport on top.',
        'No sign of any difficulty finding the money.',
      ])
    }
    return suggest('COMFORTABLE', 60, [
      `Settles ${pct(avgRatio)} of the billed amount across ${closed.length} completed session${closed.length > 1 ? 's' : ''}.`,
      f.avgClearanceDay !== null
        ? 'It arrives late sometimes, but it always arrives in full.'
        : 'The full amount is always eventually paid.',
    ])
  }

  /* Pays most of it. Effort, not inability. */
  if (avgRatio >= 0.7) {
    return suggest('STRAINED', 55, [
      `Pays ${pct(avgRatio)} of what is billed — most of it, but never quite all.`,
      fragments
        ? 'Arrives in small instalments, which usually means the money is assembled with effort.'
        : 'The shortfall is consistent rather than occasional.',
    ])
  }

  /* Between a third and two thirds. The fragment pattern is the tell. */
  if (avgRatio >= 0.3) {
    if (fragments) {
      return suggest('POOR', 50, [
        `Pays ${pct(avgRatio)} of the fee, in small amounts averaging ${
          f.avgTicketPaise ? `₹${Math.round(f.avgTicketPaise / 100).toLocaleString('en-IN')}` : 'a fraction of the bill'
        }.`,
        'Paying in fragments this small is a sign of genuine cash-flow difficulty.',
      ])
    }
    return suggest('STRAINED', 40, [
      `Pays ${pct(avgRatio)} of the billed amount and stops.`,
      'Could be difficulty or could be choice — the payment record cannot tell them apart.',
    ])
  }

  /* Almost nothing. This is where the data is at its least trustworthy. */
  if (f.lifetimePaidPaise > 0) {
    return suggest('POOR', 40, [
      `Only ${pct(avgRatio)} of the billed amount has ever been paid.`,
      'Something is being paid, so contact is worth keeping open.',
    ])
  }

  return suggest('SEVERE', 30, [
    `Nothing has ever been recorded against ${closed.length} completed session${closed.length > 1 ? 's' : ''}.`,
    'This is equally consistent with severe hardship and with simple refusal — a call is the only way to tell.',
  ])
}

/**
 * How much a tier changes the odds of collecting in the near term.
 *
 * Deliberately asymmetric: being affluent barely helps (a wealthy family that
 * has ignored three reminders will ignore a fourth), while being genuinely
 * unable to pay collapses them. The point is not to chase the rich harder — it
 * is to stop spending the day calling people who have nothing to give.
 */
export function tierFactor(tier: EconomicTier): number {
  switch (tier) {
    case 'AFFLUENT':
      return 1.25
    case 'COMFORTABLE':
      return 1.15
    case 'STRAINED':
      return 0.95
    case 'POOR':
      return 0.55
    case 'SEVERE':
      return 0.2
    default:
      return 1
  }
}
