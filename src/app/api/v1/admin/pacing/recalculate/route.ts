import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, parseId } from '@/lib/teaching/http'
import {
  recalculatePacingAll,
  recalculatePacingForAssignment,
  recalculatePacingForSession,
} from '@/lib/teaching/pacing'

/**
 * Force a full pacing recomputation immediately. Optionally scoped to one
 * assignment or one academic session via query params; otherwise recomputes
 * every active assignment (stands in for the doc's "nightly cron" — there is
 * no background job runner in this app, so a real nightly run needs an
 * external scheduler hitting this endpoint).
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const assignmentId = parseId(sp.get('assignmentId'))
  const sessionId = parseId(sp.get('sessionId'))

  if (assignmentId) {
    await recalculatePacingForAssignment(assignmentId)
    return ok({ recalculated: 1, scope: 'assignment' })
  }
  if (sessionId) {
    await recalculatePacingForSession(sessionId)
    return ok({ scope: 'session' })
  }

  const count = await recalculatePacingAll()
  return ok({ recalculated: count, scope: 'all' })
}
