import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { requireAdmin } from '@/lib/teaching/guards'
import { recomputeRecovery } from '@/lib/recovery/recompute'

/**
 * Rebuild every household profile and recovery case, then snapshot the
 * forecast.
 *
 * This app has no background job runner (see docs/TEACHER_SYLLABUS.md), so
 * recompute is on demand: this endpoint, the Recalculate button on the command
 * centre, and `npm run recovery:recalculate` for unattended runs. This is also
 * the hook point for a real scheduler.
 *
 * Idempotent, and never touches the decisions a person made — stage, snooze,
 * park, pin.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const raw = request.nextUrl.searchParams.get('sessionId')
  const sessionId = raw ? parseId(raw) : null
  if (raw && !sessionId) return err('invalid sessionId')

  try {
    const result = await recomputeRecovery({ sessionId: sessionId ?? undefined })
    invalidateTags(TAGS.recovery, TAGS.fees)
    return ok({ data: result })
  } catch (e) {
    return handleError(e)
  }
}
