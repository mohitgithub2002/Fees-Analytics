import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, ok, parseId } from '@/lib/fees/api'
import { cached, TAGS } from '@/lib/cache'
import { installmentBehaviour } from '@/lib/recovery/cohorts'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  let sessionId = sp.get('sessionId') ? parseId(sp.get('sessionId')!) : null
  if (!sessionId) {
    const current = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!current) return err('no current session set; pass ?sessionId=', 400)
    sessionId = current.id
  }

  const data = await cached(
    `recovery:installments:${sessionId}`,
    { tags: [TAGS.recovery], ttlMs: 60_000 },
    () => installmentBehaviour(sessionId!)
  )
  return ok({ sessionId, data })
}
