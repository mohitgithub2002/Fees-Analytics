import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, ok, parseId } from '@/lib/fees/api'
import { cached, TAGS } from '@/lib/cache'
import { buildForecast } from '@/lib/recovery/forecast'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const months = Math.min(12, Math.max(1, parseInt(sp.get('months') || '6')))
  let sessionId = sp.get('sessionId') ? parseId(sp.get('sessionId')!) : null

  if (!sessionId) {
    const current = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!current) return err('no current session set; pass ?sessionId=', 400)
    sessionId = current.id
  }

  const payload = await cached(
    `recovery:forecast:${sessionId}:${months}`,
    { tags: [TAGS.recovery], ttlMs: 60_000 },
    () => buildForecast(sessionId!, months)
  )
  return ok(payload)
}
