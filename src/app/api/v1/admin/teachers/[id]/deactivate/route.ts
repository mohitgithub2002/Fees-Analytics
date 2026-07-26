import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, parseId, handleError } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'

/** Block login. Existing teacher sessions stop resolving on the next request (isActive is checked per-request). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const existing = await prisma.teacher.findUnique({ where: { id }, select: { id: true, isActive: true } })
  if (!existing) return err('teacher not found', 404)

  try {
    const teacher = await prisma.$transaction(async (tx) => {
      const updated = await tx.teacher.update({
        where: { id },
        data: { isActive: false },
        select: { id: true, employeeId: true, name: true, isActive: true },
      })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'TEACHER_DEACTIVATED',
        entityType: 'Teacher',
        entityId: id,
        oldValue: existing,
        newValue: { isActive: false },
      })
      return updated
    })
    return ok(teacher)
  } catch (e) {
    return handleError(e)
  }
}
