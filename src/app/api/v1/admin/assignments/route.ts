import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'
import { recalculatePacingForAssignment } from '@/lib/teaching/pacing'

const ASSIGNMENT_INCLUDE = {
  teacher: { select: { id: true, name: true, employeeId: true } },
  subject: { select: { id: true, name: true } },
  classroom: {
    include: {
      class: { select: { id: true, name: true } },
      session: { select: { id: true, name: true, isCurrent: true } },
    },
  },
} satisfies Prisma.TeacherAssignmentInclude

/** List assignments, filterable by classroom, teacher or academic session. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const classroomId = parseId(sp.get('classroomId'))
  const teacherId = parseId(sp.get('teacherId'))
  const sessionId = parseId(sp.get('sessionId'))
  const activeParam = sp.get('active')

  const where: Prisma.TeacherAssignmentWhereInput = {}
  if (classroomId) where.classroomId = classroomId
  if (teacherId) where.teacherId = teacherId
  if (sessionId) where.classroom = { sessionId }
  if (activeParam === 'false') where.isActive = false
  else if (activeParam !== 'all') where.isActive = true

  const assignments = await prisma.teacherAssignment.findMany({
    where,
    include: ASSIGNMENT_INCLUDE,
    orderBy: { id: 'desc' },
  })
  return ok(assignments)
}

/** Assign a teacher to a classroom and subject. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const body = await readJson<{ teacherId?: number; classroomId?: number; subjectId?: number }>(request)
  if (!body) return err('invalid JSON body')

  const { teacherId, classroomId, subjectId } = body
  if (!teacherId) return err('teacherId is required')
  if (!classroomId) return err('classroomId is required')
  if (!subjectId) return err('subjectId is required')

  try {
    const assignment = await prisma.$transaction(async (tx) => {
      const created = await tx.teacherAssignment.create({
        data: { teacherId, classroomId, subjectId, assignedById: user.id },
        include: ASSIGNMENT_INCLUDE,
      })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'ASSIGNMENT_CREATED',
        entityType: 'TeacherAssignment',
        entityId: created.id,
        newValue: created,
      })
      return created
    })
    await recalculatePacingForAssignment(assignment.id)
    return ok(assignment, 201)
  } catch (e) {
    return handleError(e)
  }
}
