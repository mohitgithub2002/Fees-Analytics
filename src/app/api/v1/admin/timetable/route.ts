import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'

const SLOT_INCLUDE = {
  assignment: {
    include: {
      teacher: { select: { id: true, name: true, employeeId: true } },
      subject: { select: { id: true, name: true } },
      classroom: { include: { class: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.TimetableSlotInclude

/** Full timetable grid, filterable by day, classroom or teacher. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const dayOfWeek = parseId(sp.get('dayOfWeek'))
  const classroomId = parseId(sp.get('classroomId'))
  const teacherId = parseId(sp.get('teacherId'))

  const where: Prisma.TimetableSlotWhereInput = {}
  if (dayOfWeek) where.dayOfWeek = dayOfWeek
  if (classroomId || teacherId) {
    where.assignment = {
      ...(classroomId ? { classroomId } : {}),
      ...(teacherId ? { teacherId } : {}),
    }
  }

  const slots = await prisma.timetableSlot.findMany({
    where,
    include: SLOT_INCLUDE,
    orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
  })
  return ok(slots)
}

/** Add a period slot. Rejects clashes for the same teacher or classroom. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const body = await readJson<{
    assignmentId?: number
    dayOfWeek?: number
    periodNumber?: number
    startTime?: string
    endTime?: string
    roomLabel?: string
  }>(request)
  if (!body) return err('invalid JSON body')

  const { assignmentId, dayOfWeek, periodNumber, startTime, endTime } = body
  if (!assignmentId) return err('assignmentId is required')
  if (dayOfWeek == null || dayOfWeek < 1 || dayOfWeek > 6) return err('dayOfWeek must be between 1 (Mon) and 6 (Sat)')
  if (!periodNumber || periodNumber < 1) return err('periodNumber is required')
  if (!startTime) return err('startTime is required')
  if (!endTime) return err('endTime is required')

  const assignment = await prisma.teacherAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, teacherId: true, classroomId: true, isActive: true },
  })
  if (!assignment || !assignment.isActive) return err('assignment not found', 404)

  const clash = await prisma.timetableSlot.findFirst({
    where: {
      dayOfWeek,
      periodNumber,
      assignment: { OR: [{ teacherId: assignment.teacherId }, { classroomId: assignment.classroomId }] },
    },
    include: { assignment: { select: { teacherId: true, classroomId: true } } },
  })
  if (clash) {
    const reason = clash.assignment.teacherId === assignment.teacherId ? 'teacher' : 'classroom'
    return err(`this period clashes with an existing slot for the same ${reason}`, 409)
  }

  try {
    const slot = await prisma.timetableSlot.create({
      data: { assignmentId, dayOfWeek, periodNumber, startTime, endTime, roomLabel: body.roomLabel?.trim() || null },
      include: SLOT_INCLUDE,
    })
    return ok(slot, 201)
  } catch (e) {
    return handleError(e)
  }
}
