import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId } from '@/lib/fees/api'
import { recomputeRecovery } from '@/lib/recovery/recompute'

/** Clear a snooze or park decision and let the case re-enter normal ranking. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    const recCase = await prisma.recoveryCase.findUnique({ where: { id } })
    if (!recCase) return err('case not found', 404)

    const updated = await prisma.recoveryCase.update({
      where: { id },
      data: { stage: 'CONTACTED', snoozedUntil: null, parkedReason: null },
    })
    await recomputeRecovery([recCase.guardianId])
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}
