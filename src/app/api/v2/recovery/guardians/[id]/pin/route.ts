import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'

/**
 * Pin a household onto today's call list, overriding the ranking — the
 * segmentation browser's bulk "add to today's list" action. Recompute
 * evaluates pinnedForDate before any suppression rule (see
 * src/lib/recovery/recompute.ts), so a pinned household shows up today even
 * if it would otherwise be cooling off or snoozed.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guardianId = parseId((await params).id)
  if (!guardianId) return err('invalid id', 400)

  try {
    const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!session) return err('no current session set', 400)

    const guardian = await prisma.guardian.findUnique({ where: { id: guardianId } })
    if (!guardian) return err('guardian not found', 404)

    const today = new Date()
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())

    const recCase = await prisma.recoveryCase.upsert({
      where: { guardianId_sessionId: { guardianId, sessionId: session.id } },
      create: { guardianId, sessionId: session.id, pinnedForDate: todayDate },
      update: { pinnedForDate: todayDate, suppressedUntil: null, suppressionReason: null },
    })

    invalidateTags(TAGS.recovery)
    return ok(recCase)
  } catch (e) {
    return handleError(e)
  }
}
