import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, parseId, parsePagination, paginationMeta, todayDateOnly, daysBetween } from '@/lib/teaching/http'

/** Homework across all teachers, with whether — and how late — it was checked. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const teacherId = parseId(sp.get('teacherId'))
  const classroomId = parseId(sp.get('classroomId'))
  const subjectId = parseId(sp.get('subjectId'))
  const checked = sp.get('checked')
  const from = sp.get('from')
  const to = sp.get('to')
  const { page, pageSize, skip, take } = parsePagination(sp)

  const where: Prisma.SessionLogWhereInput = { type: 'HOMEWORK' }
  if (teacherId || classroomId || subjectId) {
    where.assignment = {
      ...(teacherId ? { teacherId } : {}),
      ...(classroomId ? { classroomId } : {}),
      ...(subjectId ? { subjectId } : {}),
    }
  }
  if (checked === 'true') where.homeworkCheck = { isNot: null }
  if (checked === 'false') where.homeworkCheck = { is: null }
  if (from || to) {
    where.sessionDate = {
      ...(from && !isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}),
      ...(to && !isNaN(Date.parse(to)) ? { lte: new Date(to) } : {}),
    }
  }

  const [rows, total] = await Promise.all([
    prisma.sessionLog.findMany({
      where,
      skip,
      take,
      orderBy: { sessionDate: 'desc' },
      include: {
        assignment: {
          include: {
            teacher: { select: { id: true, name: true, employeeId: true } },
            subject: { select: { id: true, name: true } },
            classroom: { include: { class: { select: { id: true, name: true } } } },
          },
        },
        homeworkCheck: true,
        _count: { select: { topics: true } },
      },
    }),
    prisma.sessionLog.count({ where }),
  ])

  const today = todayDateOnly()
  const homework = rows.map((row) => ({
    ...row,
    isChecked: row.homeworkCheck !== null,
    daysPending: row.homeworkCheck
      ? daysBetween(row.sessionDate, row.homeworkCheck.checkedOn)
      : daysBetween(row.sessionDate, today),
  }))

  return ok({ homework, pagination: paginationMeta(page, pageSize, total) })
}
