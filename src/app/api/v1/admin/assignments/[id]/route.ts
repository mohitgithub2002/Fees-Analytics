import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, parseId, handleError } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'

/** Deactivate an assignment. Historical session logs are preserved. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const existing = await prisma.teacherAssignment.findUnique({ where: { id }, select: { id: true, isActive: true } })
  if (!existing) return err('assignment not found', 404)

  try {
    const assignment = await prisma.$transaction(async (tx) => {
      const updated = await tx.teacherAssignment.update({ where: { id }, data: { isActive: false } })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'ASSIGNMENT_DEACTIVATED',
        entityType: 'TeacherAssignment',
        entityId: id,
        oldValue: existing,
        newValue: { isActive: false },
      })
      return updated
    })
    return ok(assignment)
  } catch (e) {
    return handleError(e)
  }
}
