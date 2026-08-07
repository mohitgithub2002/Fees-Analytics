import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok, parseId, parsePagination, paginationMeta, todayDateOnly, daysBetween } from '@/lib/teaching/http'

/**
 * The teacher's own homework diary. Homework itself is created through the
 * normal write path (`POST /teacher/sessions` with `type: "HOMEWORK"`) so
 * there is only ever one way a SessionLog comes into existence; this route is
 * the read side, plus the `checked` filter that drives the "what still has to
 * be checked" queue.
 */

const HOMEWORK_INCLUDE = {
  assignment: {
    include: {
      subject: { select: { id: true, name: true } },
      classroom: { include: { class: { select: { id: true, name: true } } } },
    },
  },
  topics: {
    include: {
      subtopic: {
        select: {
          id: true,
          name: true,
          topic: { select: { id: true, name: true, chapter: { select: { id: true, name: true } } } },
        },
      },
      chapter: { select: { id: true, name: true } },
    },
  },
  homeworkCheck: true,
} as const

/** Own homework, newest first. `?checked=false` is the pending-to-check queue. */
export async function GET(request: NextRequest) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const assignmentId = parseId(sp.get('assignmentId'))
  const checked = sp.get('checked')
  const from = sp.get('from')
  const to = sp.get('to')
  const { page, pageSize, skip, take } = parsePagination(sp)

  const where: Prisma.SessionLogWhereInput = {
    type: 'HOMEWORK',
    assignment: { teacherId: gate.teacher.id, ...(assignmentId ? { id: assignmentId } : {}) },
  }
  if (checked === 'true') where.homeworkCheck = { isNot: null }
  if (checked === 'false') where.homeworkCheck = { is: null }
  if (from || to) {
    where.sessionDate = {
      ...(from && !isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}),
      ...(to && !isNaN(Date.parse(to)) ? { lte: new Date(to) } : {}),
    }
  }

  const [rows, total, uncheckedCount] = await Promise.all([
    prisma.sessionLog.findMany({
      where,
      skip,
      take,
      // Oldest-pending-first when listing the check queue, newest-first otherwise:
      // an unchecked pile is worked through from the top, history is read from the bottom.
      orderBy: { sessionDate: checked === 'false' ? 'asc' : 'desc' },
      include: HOMEWORK_INCLUDE,
    }),
    prisma.sessionLog.count({ where }),
    prisma.sessionLog.count({
      where: {
        type: 'HOMEWORK',
        assignment: { teacherId: gate.teacher.id, ...(assignmentId ? { id: assignmentId } : {}) },
        homeworkCheck: { is: null },
      },
    }),
  ])

  const today = todayDateOnly()
  const homework = rows.map((row) => ({
    ...row,
    isChecked: row.homeworkCheck !== null,
    // How long the homework has been sitting unchecked, or how long the
    // teacher took to get to it — the number an admin actually asks about.
    daysPending: row.homeworkCheck
      ? daysBetween(row.sessionDate, row.homeworkCheck.checkedOn)
      : daysBetween(row.sessionDate, today),
  }))

  return ok({ homework, uncheckedCount, pagination: paginationMeta(page, pageSize, total) })
}
