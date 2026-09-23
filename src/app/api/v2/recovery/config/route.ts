import { NextRequest } from 'next/server'
import { err, handleError, ok, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { requireAdmin } from '@/lib/teaching/guards'
import { DEFAULT_TUNING, loadTuning, saveTuning, TUNING_LIMITS } from '@/lib/recovery/config'
import type { RecoveryTuning } from '@/lib/recovery/types'

/**
 * The tunable targeting rules.
 *
 * Limits and defaults are returned alongside the current values so the
 * settings screen can render real bounds instead of hard-coding its own copy
 * and drifting from what the server actually enforces.
 */
export async function GET() {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  try {
    const tuning = await loadTuning()
    return ok({ data: { tuning, limits: TUNING_LIMITS, defaults: DEFAULT_TUNING } })
  } catch (e) {
    return handleError(e)
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const body = await readJson<Partial<RecoveryTuning>>(request)
  if (!body) return err('invalid JSON body')

  try {
    // Every value is clamped server-side — a bad edit should make the call
    // list worse, not nonsensical.
    const tuning = await saveTuning(body, { id: gate.user.id, name: gate.user.name })
    invalidateTags(TAGS.recovery)
    return ok({ data: { tuning, limits: TUNING_LIMITS, defaults: DEFAULT_TUNING } })
  } catch (e) {
    return handleError(e)
  }
}
