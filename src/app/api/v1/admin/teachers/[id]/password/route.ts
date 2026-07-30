import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, parseId, handleError } from '@/lib/teaching/http'
import { hashPassword, generateTempPassword } from '@/lib/auth/password'
import { writeAudit } from '@/lib/teaching/audit'

/** Force-reset the password and return the new temporary credential. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const existing = await prisma.teacher.findUnique({ where: { id }, select: { id: true, employeeId: true, name: true } })
  if (!existing) return err('teacher not found', 404)

  const temporaryPassword = generateTempPassword()

  try {
    await prisma.$transaction(async (tx) => {
      await tx.teacher.update({ where: { id }, data: { passwordHash: hashPassword(temporaryPassword) } })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'TEACHER_PASSWORD_RESET',
        entityType: 'Teacher',
        entityId: id,
      })
    })
    return ok({ teacherId: id, employeeId: existing.employeeId, temporaryPassword })
  } catch (e) {
    return handleError(e)
  }
}
