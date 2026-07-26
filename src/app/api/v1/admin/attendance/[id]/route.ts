import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'
import { recalculatePacingForTeacher } from '@/lib/teaching/pacing'

/** Correct an attendance entry. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const existing = await prisma.teacherAttendance.findUnique({ where: { id } })
  if (!existing) return err('attendance record not found', 404)

  const body = await readJson<{ status?: string; remarks?: string | null }>(request)
  if (!body) return err('invalid JSON body')

  const data: Prisma.TeacherAttendanceUpdateInput = { markedById: user.id }
  if (body.status !== undefined) {
    if (!['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE'].includes(body.status)) {
      return err('status must be PRESENT, ABSENT, HALF_DAY or ON_LEAVE')
    }
    data.status = body.status as Prisma.TeacherAttendanceUpdateInput['status']
  }
  if (body.remarks !== undefined) data.remarks = body.remarks?.trim() || null

  try {
    const record = await prisma.$transaction(async (tx) => {
      const updated = await tx.teacherAttendance.update({
        where: { id },
        data,
        include: { teacher: { select: { id: true, name: true, employeeId: true } } },
      })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'ATTENDANCE_CORRECTED',
        entityType: 'TeacherAttendance',
        entityId: id,
        oldValue: existing,
        newValue: updated,
      })
      return updated
    })
    await recalculatePacingForTeacher(existing.teacherId)
    return ok(record)
  } catch (e) {
    return handleError(e)
  }
}
