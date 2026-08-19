import { NextRequest } from 'next/server'
import { err, handleError, ok, readJson } from '@/lib/fees/api'
import { getCurrentUser } from '@/lib/auth/session'
import { loadTuning, saveTuning, TUNING_LIMITS } from '@/lib/recovery/config'
import type { RecoveryTuning } from '@/lib/recovery/types'

export async function GET() {
  const tuning = await loadTuning()
  return ok({ tuning, limits: TUNING_LIMITS })
}

/**
 * Update the targeting rules. Every numeric field is clamped to
 * TUNING_LIMITS so a typo cannot empty the call list or flood it — see
 * src/lib/recovery/config.ts for why these bounds exist.
 */
export async function PATCH(request: NextRequest) {
  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const patch: Partial<RecoveryTuning> = {}
  for (const key of Object.keys(TUNING_LIMITS) as (keyof typeof TUNING_LIMITS)[]) {
    const raw = (body as Record<string, unknown>)[key]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return err(`${key} must be a number`)
    const { min, max } = TUNING_LIMITS[key]
    if (raw < min || raw > max) return err(`${key} must be between ${min} and ${max}`)
    patch[key] = raw
  }
  if ('scoreWeights' in (body as object)) {
    const w = (body as { scoreWeights?: unknown }).scoreWeights
    if (w !== null && typeof w !== 'object') return err('scoreWeights must be an object or null')
    patch.scoreWeights = w as Record<string, number> | null
  }

  try {
    const user = await getCurrentUser()
    const tuning = await saveTuning(patch, user?.id)
    return ok({ tuning, limits: TUNING_LIMITS })
  } catch (e) {
    return handleError(e)
  }
}
