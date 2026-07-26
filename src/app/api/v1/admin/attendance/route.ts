import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'
import { recalculatePacingForTeacher } from '@/lib/teaching/pacing'

/** Attendance records, filterable by date range and teacher. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const teacherId = parseId(sp.get('teacherId'))
  const from = sp.get('from')
  const to = sp.get('to')

  const where: Prisma.TeacherAttendanceWhereInput = {}
  if (teacherId) where.teacherId = teacherId
  if (from || to) {
    where.date = {
      ...(from && !isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}),
      ...(to && !isNaN(Date.parse(to)) ? { lte: new Date(to) } : {}),
    }
  }

  const attendance = await prisma.teacherAttendance.findMany({
    where,
    include: { teacher: { select: { id: true, name: true, employeeId: true } } },
    orderBy: { date: 'desc' },
  })
  return ok(attendance)
}

/** Record attendance. Upserts on the (teacher, date) unique key. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const body = await readJson<{ teacherId?: number; date?: string; status?: string; remarks?: string }>(request)
  if (!body) return err('invalid JSON body')

  const { teacherId, date, status } = body
  if (!teacherId) return err('teacherId is required')
  if (!date || isNaN(Date.parse(date))) return err('a valid date is required')
  if (!status || !['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE'].includes(status)) {
    return err('status must be PRESENT, ABSENT, HALF_DAY or ON_LEAVE')
  }

  try {
    const record = await prisma.$transaction(async (tx) => {
      const upserted = await tx.teacherAttendance.upsert({
        where: { teacherId_date: { teacherId, date: new Date(date) } },
        create: {
          teacherId,
          date: new Date(date),
          status: status as Prisma.TeacherAttendanceCreateInput['status'],
          remarks: body.remarks?.trim() || null,
          markedById: user.id,
        },
        update: {
          status: status as Prisma.TeacherAttendanceUpdateInput['status'],
          remarks: body.remarks?.trim() || null,
          markedById: user.id,
        },
        include: { teacher: { select: { id: true, name: true, employeeId: true } } },
      })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'ATTENDANCE_RECORDED',
        entityType: 'TeacherAttendance',
        entityId: upserted.id,
        newValue: upserted,
      })
      return upserted
    })
    await recalculatePacingForTeacher(teacherId)
    return ok(record, 201)
  } catch (e) {
    return handleError(e)
  }
}
