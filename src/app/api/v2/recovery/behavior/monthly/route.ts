import { NextRequest } from 'next/server'
import { ok } from '@/lib/fees/api'
import { cached, TAGS } from '@/lib/cache'
import { monthlyCollection } from '@/lib/recovery/cohorts'
import { timingProvenance } from '@/lib/recovery/cohorts'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const limitSessions = Math.min(5, Math.max(1, parseInt(sp.get('sessions') || '3')))

  const [data, provenance] = await Promise.all([
    cached(`recovery:monthly:${limitSessions}`, { tags: [TAGS.recovery], ttlMs: 60_000 }, () =>
      monthlyCollection(limitSessions)
    ),
    timingProvenance(),
  ])
  return ok({ ...data, dataQuality: provenance })
}
