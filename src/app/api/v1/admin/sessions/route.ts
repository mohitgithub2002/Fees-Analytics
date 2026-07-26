import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, parseId, parsePagination, paginationMeta } from '@/lib/teaching/http'

/** Every session across all teachers, filterable by date, type, teacher and classroom. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const teacherId = parseId(sp.get('teacherId'))
  const classroomId = parseId(sp.get('classroomId'))
  const type = sp.get('type')
  const from = sp.get('from')
  const to = sp.get('to')
  const { page, pageSize, skip, take } = parsePagination(sp)

  const where: Prisma.SessionLogWhereInput = {}
  if (teacherId || classroomId) {
    where.assignment = {
      ...(teacherId ? { teacherId } : {}),
      ...(classroomId ? { classroomId } : {}),
    }
  }
  if (type) where.type = type as Prisma.SessionLogWhereInput['type']
  if (from || to) {
    where.sessionDate = {
      ...(from && !isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}),
      ...(to && !isNaN(Date.parse(to)) ? { lte: new Date(to) } : {}),
    }
  }

  const [sessions, total] = await Promise.all([
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
        _count: { select: { topics: true } },
      },
    }),
    prisma.sessionLog.count({ where }),
  ])

  return ok({ sessions, pagination: paginationMeta(page, pageSize, total) })
}
