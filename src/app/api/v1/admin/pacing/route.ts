import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, parseId } from '@/lib/teaching/http'

const PACING_INCLUDE = {
  chapter: { select: { id: true, name: true, displayOrder: true } },
  assignment: {
    include: {
      teacher: { select: { id: true, name: true, employeeId: true } },
      subject: { select: { id: true, name: true } },
      classroom: { include: { class: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.SyllabusPacingInclude

/** Pacing status across all assignments, filterable by classroom, teacher or subject. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const classroomId = parseId(sp.get('classroomId'))
  const teacherId = parseId(sp.get('teacherId'))
  const subjectId = parseId(sp.get('subjectId'))
  const status = sp.get('status')

  const where: Prisma.SyllabusPacingWhereInput = {}
  if (classroomId || teacherId || subjectId) {
    where.assignment = {
      ...(classroomId ? { classroomId } : {}),
      ...(teacherId ? { teacherId } : {}),
      ...(subjectId ? { subjectId } : {}),
    }
  }
  if (status) where.status = status as Prisma.SyllabusPacingWhereInput['status']

  const pacing = await prisma.syllabusPacing.findMany({
    where,
    include: PACING_INCLUDE,
    orderBy: [{ status: 'asc' }, { chapter: { displayOrder: 'asc' } }],
  })
  return ok(pacing)
}
