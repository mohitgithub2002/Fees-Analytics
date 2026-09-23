/**
 * Ability to pay — the second axis.
 *
 * Pure and Prisma-free.
 *
 * This axis exists because behaviour and ability look identical in a balance
 * column. A wealthy family that pays everything in March and a family that
 * genuinely cannot pay both show a large outstanding amount all year. Ranking
 * on the balance alone cannot tell them apart, so a day of calls gets spent on
 * families who have nothing to give while the ones who are merely slow go
 * unchased.
 *
 * Nothing here decides anything on its own. suggestTier() only proposes;
 * Household.economicTier — set by a person who has actually spoken to the
 * family — is what scoring uses. A wrong guess sends a struggling family to
 * the call list and lets a wealthy late payer off, so the human tag always
 * wins, and the suggestion is deliberately quiet about how sure it is.
 */
import type { EconomicTier, HouseholdFeatures, TierSuggestion } from './types'

/**
 * How much ability moves the propensity score.
 *
 * UNKNOWN is exactly neutral, and that matters: tiers are collected one
 * conversation at a time, so most households start untagged. The system has to
 * rank sensibly on behaviour alone and simply sharpen as tags accumulate —
 * never treat "not asked yet" as "cannot pay".
 */
const TIER_FACTOR: Record<EconomicTier, number> = {
  AFFLUENT: 1.35,
  COMFORTABLE: 1.2,
  STRAINED: 1.0,
  POOR: 0.6,
  SEVERE: 0.3,
  UNKNOWN: 1.0,
}

export function tierFactor(tier: EconomicTier): number {
  return TIER_FACTOR[tier] ?? 1
}

/** A concession this large is effectively the school's own hardship finding. */
const HEAVY_CONCESSION = 0.3
const SOME_CONCESSION = 0.12

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * Propose an economic tier from school-side facts.
 *
 * Deliberately NOT built on payment behaviour: that is the other axis, and
 * folding it in here would collapse the two into one and defeat the point.
 * What it does use is what the school already recorded — the concessions it
 * granted, whether the family pays for optional transport, and the size of the
 * bill they took on.
 *
 * Confidence stays low by design. This is a starting point for a conversation,
 * not a finding.
 */
export function suggestTier(f: HouseholdFeatures): TierSuggestion {
  const evidence: string[] = []

  // A concession the school granted is the strongest signal available, because
  // somebody already looked at this family and decided they could not pay full
  // fees.
  if (f.discountShare >= HEAVY_CONCESSION) {
    evidence.push(
      `The school has already written off ${pct(f.discountShare)} of this family's fees.`
    )
    evidence.push('A concession that size usually means hardship was recognised at admission.')
    return { tier: 'POOR', confidence: 0.45, evidence }
  }

  if (f.discountShare >= SOME_CONCESSION) {
    evidence.push(`Carries a ${pct(f.discountShare)} fee concession.`)
    return { tier: 'STRAINED', confidence: 0.35, evidence }
  }

  // Optional paid transport for several children is a small, recurring,
  // entirely avoidable cost. Families under real pressure drop it first.
  if (f.hasBusFee && f.childrenCount >= 2) {
    evidence.push(
      `Pays for school transport for a family of ${f.childrenCount} children, with no fee concession.`
    )
    return { tier: 'COMFORTABLE', confidence: 0.3, evidence }
  }

  if (f.hasBusFee) {
    evidence.push('Pays for optional school transport and takes no fee concession.')
    return { tier: 'COMFORTABLE', confidence: 0.22, evidence }
  }

  if (f.childrenCount >= 3) {
    evidence.push(
      `Carries fees for ${f.childrenCount} children — a large recurring commitment.`
    )
    return { tier: 'STRAINED', confidence: 0.2, evidence }
  }

  evidence.push('Nothing in the school records indicates what this family can afford.')
  evidence.push('Tag them on the next call — it is the fastest way to sharpen their priority.')
  return { tier: 'UNKNOWN', confidence: 0, evidence }
}

/**
 * Whether a tier says calling is the wrong tool.
 *
 * Families who genuinely cannot pay need a payment plan or a concession
 * conversation, not repeated calls — calling harder does not create money.
 * This never hides them; it routes them, and suppression always explains
 * itself and stays reversible.
 */
export function cannotPay(tier: EconomicTier): boolean {
  return tier === 'SEVERE'
}
