import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { recomputeRecovery } from '@/lib/recovery/recompute'

/**
 * Park a household from the Parent 360 quick actions — confirmed hardship,
 * stop chasing by phone. Mirrors POST /cases/:id/park but addressed by
 * guardian rather than case id, since the profile screen only ever knows the
 * guardian; the current-session case is found (or created) here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guardianId = parseId((await params).id)
  if (!guardianId) return err('invalid id', 400)

  const body = await readJson(request)
  const { reason } = (body ?? {}) as { reason?: string }
  if (!reason?.trim()) return err('reason is required')

  try {
    const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!session) return err('no current session set', 400)

    const guardian = await prisma.guardian.findUnique({ where: { id: guardianId } })
    if (!guardian) return err('guardian not found', 404)

    await prisma.recoveryCase.upsert({
      where: { guardianId_sessionId: { guardianId, sessionId: session.id } },
      create: { guardianId, sessionId: session.id, stage: 'PARKED', parkedReason: reason.trim() },
      update: { stage: 'PARKED', parkedReason: reason.trim() },
    })

    await recomputeRecovery([guardianId])
    return ok({ parked: true })
  } catch (e) {
    return handleError(e)
  }
}
