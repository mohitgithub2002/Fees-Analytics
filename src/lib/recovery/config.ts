import { prisma } from '@/lib/prisma'
import { toPaise, toRupees } from '@/lib/fees/money'
import { DEFAULT_TUNING, type RecoveryTuning } from './types'

/**
 * The single row of tunable targeting rules, loaded as a plain object.
 *
 * Kept as data rather than constants because these numbers encode local
 * judgement, not arithmetic: whether five days is too soon to call again
 * depends on the school, the town, and how the families take it.
 */

const CONFIG_ID = 1

export async function loadTuning(): Promise<RecoveryTuning> {
  const row = await prisma.recoveryConfig.findUnique({ where: { id: CONFIG_ID } })
  if (!row) return DEFAULT_TUNING

  return {
    cooldownDays: row.cooldownDays,
    justPaidSuppressDays: row.justPaidSuppressDays,
    promiseGraceDays: row.promiseGraceDays,
    noAnswerBackoffThreshold: row.noAnswerBackoffThreshold,
    noAnswerBackoffDays: row.noAnswerBackoffDays,
    minOutstandingPaise: toPaise(row.minOutstanding),
    dailyCallTarget: row.dailyCallTarget,
    scoreWeights: (row.scoreWeights as Record<string, number> | null) ?? null,
  }
}

/** Create-or-update the single config row and return the tuning it now holds. */
export async function saveTuning(
  patch: Partial<RecoveryTuning>,
  updatedById?: number | null
): Promise<RecoveryTuning> {
  const current = await loadTuning()
  const next = { ...current, ...patch }

  const data = {
    cooldownDays: next.cooldownDays,
    justPaidSuppressDays: next.justPaidSuppressDays,
    promiseGraceDays: next.promiseGraceDays,
    noAnswerBackoffThreshold: next.noAnswerBackoffThreshold,
    noAnswerBackoffDays: next.noAnswerBackoffDays,
    minOutstanding: toRupees(next.minOutstandingPaise),
    dailyCallTarget: next.dailyCallTarget,
    scoreWeights: next.scoreWeights ?? undefined,
    updatedById: updatedById ?? null,
  }

  await prisma.recoveryConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, ...data },
    update: data,
  })
  return next
}

/** Field-by-field bounds, so a typo in the settings screen cannot empty the call list. */
export const TUNING_LIMITS: Record<
  keyof Omit<RecoveryTuning, 'scoreWeights'>,
  { min: number; max: number; label: string; help: string }
> = {
  cooldownDays: {
    min: 0,
    max: 60,
    label: 'Cooling-off period',
    help: 'Days to leave a household alone after any contact, unless they break a promise.',
  },
  justPaidSuppressDays: {
    min: 0,
    max: 90,
    label: 'After a payment',
    help: 'Days to keep a household off the list once money has come in.',
  },
  promiseGraceDays: {
    min: 0,
    max: 30,
    label: 'Promise grace period',
    help: 'Days past a promised date before it counts as broken and re-enters the list.',
  },
  noAnswerBackoffThreshold: {
    min: 1,
    max: 10,
    label: 'Unanswered calls before backing off',
    help: 'Consecutive no-answers that switch a household to a slower cadence.',
  },
  noAnswerBackoffDays: {
    min: 1,
    max: 90,
    label: 'Back-off length',
    help: 'How long to wait before trying an unreachable household again.',
  },
  minOutstandingPaise: {
    min: 0,
    max: 10_000_00,
    label: 'Minimum balance worth calling',
    help: 'Households owing less than this never reach the call list.',
  },
  dailyCallTarget: {
    min: 5,
    max: 200,
    label: 'Calls per day',
    help: 'How many households the daily list should hold.',
  },
}
