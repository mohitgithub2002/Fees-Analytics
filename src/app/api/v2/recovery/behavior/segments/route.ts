import { ok } from '@/lib/fees/api'
import { cached, TAGS } from '@/lib/cache'
import { segmentMatrix } from '@/lib/recovery/cohorts'

/** The archetype × tier matrix — where the outstanding money is stuck. */
export async function GET() {
  const data = await cached('recovery:segments', { tags: [TAGS.recovery], ttlMs: 60_000 }, () =>
    segmentMatrix()
  )
  return ok(data)
}
