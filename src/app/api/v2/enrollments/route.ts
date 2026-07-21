import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { applyStructureToEnrollment, FeeItemError } from '@/lib/fees/fee-items'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const sessionId = sp.get('sessionId') ? parseId(sp.get('sessionId')!) : null
  const classroomId = sp.get('classroomId') ? parseId(sp.get('classroomId')!) : null
  const studentId = sp.get('studentId') ? parseId(sp.get('studentId')!) : null
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const limit = Math.min(100, Math.max(5, parseInt(sp.get('limit') || '50')))

  const where = {
    ...(sessionId ? { sessionId } : {}),
    ...(classroomId ? { classroomId } : {}),
    ...(studentId ? { studentId } : {}),
  }

  const [total, enrollments] = await Promise.all([
    prisma.studentEnrollment.count({ where }),
    prisma.studentEnrollment.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ classroomId: 'asc' }, { rollNo: 'asc' }, { id: 'asc' }],
      include: {
        student: { select: { id: true, name: true, fatherName: true, admissionNo: true } },
        session: { select: { id: true, name: true, isCurrent: true } },
        classroom: { include: { class: { select: { id: true, name: true } } } },
        feeItems: {
          select: { category: true, netAmount: true, paidAmount: true, dueAmount: true },
        },
      },
    }),
  ])

  return ok({
    data: enrollments,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  })
}

/**
 * Enroll a student into a classroom (session is derived from the classroom).
 * Pass applyFeeStructure: true to also copy the class-wise fee structure
 * onto the new enrollment in the same transaction.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { studentId, classroomId, rollNo, notes, applyFeeStructure } = body as {
    studentId?: number
    classroomId?: number
    rollNo?: number
    notes?: string
    applyFeeStructure?: boolean
  }
  if (!Number.isInteger(studentId)) return err('studentId is required')
  if (!Number.isInteger(classroomId)) return err('classroomId is required')

  try {
    const enrollment = await prisma.$transaction(async (tx) => {
      const classroom = await tx.classroom.findUnique({ where: { id: classroomId! } })
      if (!classroom) throw new FeeItemError('classroom not found', 404)

      const created = await tx.studentEnrollment.create({
        data: {
          studentId: studentId!,
          classroomId: classroomId!,
          sessionId: classroom.sessionId,
          rollNo: Number.isInteger(rollNo) ? rollNo : null,
          notes: notes?.trim() || null,
        },
      })
      if (applyFeeStructure) {
        await applyStructureToEnrollment(tx, created.id)
      }
      return tx.studentEnrollment.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          student: { select: { id: true, name: true } },
          session: { select: { id: true, name: true } },
          classroom: { include: { class: { select: { id: true, name: true } } } },
          feeItems: { include: { installments: { orderBy: { sequence: 'asc' } } } },
        },
      })
    })
    // New enrollment adds a student to a session + creates dues, and bumps
    // classroom/session enrollment counts.
    invalidateTags(TAGS.fees, TAGS.classrooms, TAGS.sessions)
    return ok(enrollment, 201)
  } catch (e) {
    return handleError(e)
  }
}
