/**
 * The tunable targeting rules.
 *
 * These are settings, not constants: the person who knows whether five days is
 * too soon to call a family again is the one running the school. Everything
 * here is editable at /recovery/settings.
 *
 * Every value is clamped on the way in. A bad edit should make the call list
 * worse, not nonsensical — a cooldown of 3,000 days or a negative minimum
 * would empty the worklist silently, and the owner would have no way to tell
 * the difference between "nobody to call" and "the settings are broken".
 */
import { prisma } from '@/lib/prisma'
import type { RecoveryTuning } from './types'

/**
 * Per-factor influence on the propensity score, 0..1.
 *
 * A weight damps its factor toward neutral: 1 is full strength, 0 switches the
 * factor off entirely (see applyWeight in propensity.ts). This lets the owner
 * mute a signal they do not trust without anyone editing the formula.
 *
 * `season` starts at half strength on purpose. With one session of payment
 * history the month histogram is a single sample, not a habit, so letting it
 * swing the score at full strength would dress up a coincidence as a pattern.
 * Raise it once a second year of history has accumulated.
 */
export const DEFAULT_SCORE_WEIGHTS: Record<string, number> = {
  archetype: 1,
  tier: 1,
  recency: 1,
  promises: 1,
  contact: 1,
  season: 0.5,
  askSize: 1,
}

export const DEFAULT_TUNING: RecoveryTuning = {
  minOutstanding: 500,
  justPaidSuppressDays: 7,
  cooldownDays: 5,
  promiseGraceDays: 3,
  noAnswerBackoffThreshold: 3,
  noAnswerBackoffDays: 7,
  dailyCallTarget: 30,
  scoreWeights: DEFAULT_SCORE_WEIGHTS,
}

/** Inclusive [min, max] for every numeric setting. */
export const TUNING_LIMITS: Record<
  Exclude<keyof RecoveryTuning, 'scoreWeights'>,
  [number, number]
> = {
  minOutstanding: [0, 100_000],
  justPaidSuppressDays: [0, 90],
  cooldownDays: [0, 90],
  promiseGraceDays: [0, 30],
  noAnswerBackoffThreshold: [1, 20],
  noAnswerBackoffDays: [0, 90],
  dailyCallTarget: [1, 500],
}

function clampNumber(value: unknown, [min, max]: [number, number], fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Pure — the fixture harness drives this directly. */
export function clampTuning(input: Partial<RecoveryTuning>): RecoveryTuning {
  const out = { ...DEFAULT_TUNING, scoreWeights: { ...DEFAULT_SCORE_WEIGHTS } }

  for (const key of Object.keys(TUNING_LIMITS) as (keyof typeof TUNING_LIMITS)[]) {
    if (input[key] === undefined) continue
    out[key] = clampNumber(input[key], TUNING_LIMITS[key], DEFAULT_TUNING[key])
  }
  // Day counts are whole days; a 2.5-day cooldown would be a confusing thing
  // to show back to someone.
  out.justPaidSuppressDays = Math.round(out.justPaidSuppressDays)
  out.cooldownDays = Math.round(out.cooldownDays)
  out.promiseGraceDays = Math.round(out.promiseGraceDays)
  out.noAnswerBackoffThreshold = Math.round(out.noAnswerBackoffThreshold)
  out.noAnswerBackoffDays = Math.round(out.noAnswerBackoffDays)
  out.dailyCallTarget = Math.round(out.dailyCallTarget)

  if (input.scoreWeights && typeof input.scoreWeights === 'object') {
    for (const key of Object.keys(DEFAULT_SCORE_WEIGHTS)) {
      const raw = (input.scoreWeights as Record<string, unknown>)[key]
      if (raw === undefined) continue
      out.scoreWeights[key] = clampNumber(raw, [0, 1], DEFAULT_SCORE_WEIGHTS[key])
    }
  }
  return out
}

/**
 * Load the single config row, creating it with defaults on first use.
 * Never throws on a malformed stored value — clampTuning falls back.
 */
export async function loadTuning(): Promise<RecoveryTuning> {
  const row = await prisma.recoveryConfig.upsert({
    where: { id: 1 },
    create: { id: 1, scoreWeights: DEFAULT_SCORE_WEIGHTS },
    update: {},
  })
  return clampTuning({
    minOutstanding: Number(row.minOutstanding),
    justPaidSuppressDays: row.justPaidSuppressDays,
    cooldownDays: row.cooldownDays,
    promiseGraceDays: row.promiseGraceDays,
    noAnswerBackoffThreshold: row.noAnswerBackoffThreshold,
    noAnswerBackoffDays: row.noAnswerBackoffDays,
    dailyCallTarget: row.dailyCallTarget,
    scoreWeights: (row.scoreWeights ?? {}) as Record<string, number>,
  })
}

export async function saveTuning(
  input: Partial<RecoveryTuning>,
  actor?: { id?: number | null; name?: string | null }
): Promise<RecoveryTuning> {
  const current = await loadTuning()
  const next = clampTuning({ ...current, ...input })

  await prisma.recoveryConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      minOutstanding: next.minOutstanding,
      justPaidSuppressDays: next.justPaidSuppressDays,
      cooldownDays: next.cooldownDays,
      promiseGraceDays: next.promiseGraceDays,
      noAnswerBackoffThreshold: next.noAnswerBackoffThreshold,
      noAnswerBackoffDays: next.noAnswerBackoffDays,
      dailyCallTarget: next.dailyCallTarget,
      scoreWeights: next.scoreWeights,
      updatedById: actor?.id ?? null,
      updatedByName: actor?.name ?? null,
    },
    update: {
      minOutstanding: next.minOutstanding,
      justPaidSuppressDays: next.justPaidSuppressDays,
      cooldownDays: next.cooldownDays,
      promiseGraceDays: next.promiseGraceDays,
      noAnswerBackoffThreshold: next.noAnswerBackoffThreshold,
      noAnswerBackoffDays: next.noAnswerBackoffDays,
      dailyCallTarget: next.dailyCallTarget,
      scoreWeights: next.scoreWeights,
      updatedById: actor?.id ?? null,
      updatedByName: actor?.name ?? null,
    },
  })
  return next
}
