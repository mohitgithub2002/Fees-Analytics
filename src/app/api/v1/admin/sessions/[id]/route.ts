import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, parseId, handleError } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'
import { recalculatePacingForAssignment } from '@/lib/teaching/pacing'

const SESSION_INCLUDE = {
  assignment: {
    include: {
      teacher: { select: { id: true, name: true, employeeId: true } },
      subject: { select: { id: true, name: true } },
      classroom: { include: { class: { select: { id: true, name: true } } } },
    },
  },
  topics: {
    include: {
      subtopic: { select: { id: true, name: true } },
      chapter: { select: { id: true, name: true } },
    },
  },
  homeworkCheck: true, // null on every type but HOMEWORK, and on unchecked homework
} as const

/** Full detail of one session including all covered topics. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const session = await prisma.sessionLog.findUnique({ where: { id }, include: SESSION_INCLUDE })
  if (!session) return err('session not found', 404)
  return ok(session)
}

/** Delete an erroneous session. The deletion itself is written to the audit log. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const existing = await prisma.sessionLog.findUnique({ where: { id }, include: SESSION_INCLUDE })
  if (!existing) return err('session not found', 404)

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sessionLog.delete({ where: { id } })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'SESSION_DELETED',
        entityType: 'SessionLog',
        entityId: id,
        oldValue: existing,
      })
    })
    await recalculatePacingForAssignment(existing.assignmentId)
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
