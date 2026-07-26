import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'
import { normalizePhone } from '@/lib/auth/phone'
import { writeAudit } from '@/lib/teaching/audit'

const TEACHER_SELECT = {
  id: true,
  employeeId: true,
  name: true,
  phone: true,
  email: true,
  qualification: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TeacherSelect

/** Full teacher profile including current assignments. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const teacher = await prisma.teacher.findUnique({
    where: { id },
    select: {
      ...TEACHER_SELECT,
      assignments: {
        where: { isActive: true },
        include: {
          subject: { select: { id: true, name: true } },
          classroom: {
            include: {
              class: { select: { id: true, name: true } },
              session: { select: { id: true, name: true, isCurrent: true } },
            },
          },
        },
      },
    },
  })
  if (!teacher) return err('teacher not found', 404)
  return ok(teacher)
}

/** Update name, phone, email or qualification. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<{
    name?: string
    phone?: string
    email?: string | null
    qualification?: string | null
  }>(request)
  if (!body) return err('invalid JSON body')

  const existing = await prisma.teacher.findUnique({ where: { id }, select: TEACHER_SELECT })
  if (!existing) return err('teacher not found', 404)

  const data: Prisma.TeacherUpdateInput = {}
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return err('name cannot be empty')
    data.name = name
  }
  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone)
    if (!phone) return err('a valid phone number is required')
    data.phone = phone
  }
  if (body.email !== undefined) data.email = body.email?.trim() || null
  if (body.qualification !== undefined) data.qualification = body.qualification?.trim() || null
  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const teacher = await prisma.$transaction(async (tx) => {
      const updated = await tx.teacher.update({ where: { id }, data, select: TEACHER_SELECT })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'TEACHER_UPDATED',
        entityType: 'Teacher',
        entityId: id,
        oldValue: existing,
        newValue: updated,
      })
      return updated
    })
    return ok(teacher)
  } catch (e) {
    return handleError(e)
  }
}
