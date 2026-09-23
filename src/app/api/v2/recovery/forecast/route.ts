import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId } from '@/lib/fees/api'
import { cached, TAGS } from '@/lib/cache'
import { requireAdmin } from '@/lib/teaching/guards'
import { buildForecast } from '@/lib/recovery/forecast'

/**
 * Where next month's money comes from.
 *
 * Read-only: it builds the forecast without snapshotting it. Snapshots are
 * taken on a full recompute, because a snapshot is a dated prediction the
 * system will later be graded against — and letting every page view write one
 * would fill the accuracy history with same-day "predictions" and flatter the
 * calibration into uselessness.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams

  const rawSession = sp.get('sessionId')
  const sessionId = rawSession ? parseId(rawSession) : null
  if (rawSession && !sessionId) return err('invalid sessionId')

  const rawMonths = sp.get('months')
  const months = rawMonths ? parseInt(rawMonths, 10) : 3
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    return err('months must be between 1 and 12')
  }

  try {
    const data = await cached(
      `recovery:forecast:${sessionId ?? 'current'}:${months}`,
      { tags: [TAGS.recovery, TAGS.fees], ttlMs: 120_000 },
      () => buildForecast({ sessionId: sessionId ?? undefined, months })
    )
    return ok({ data })
  } catch (e) {
    return handleError(e)
  }
}
