import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, parseId } from '@/lib/teaching/http'

/** Headline counts and overall syllabus completion, scoped to one academic session. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  let sessionId = parseId(sp.get('sessionId'))
  const session = sessionId
    ? await prisma.academicSession.findUnique({ where: { id: sessionId } })
    : await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (!session) return err('no academic session found', 404)
  sessionId = session.id

  const startOfToday = new Date(new Date().toISOString().slice(0, 10))
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 7)

  const [
    totalTeachers,
    totalAssignments,
    totalSubjects,
    totalChapters,
    sessionsToday,
    sessionsThisWeek,
    pacingRows,
  ] = await Promise.all([
    prisma.teacher.count({ where: { isActive: true } }),
    prisma.teacherAssignment.count({ where: { isActive: true, classroom: { sessionId } } }),
    prisma.subject.count({ where: { isActive: true } }),
    prisma.chapter.count({ where: { isActive: true } }),
    prisma.sessionLog.count({
      where: { sessionDate: { gte: startOfToday }, assignment: { classroom: { sessionId } } },
    }),
    prisma.sessionLog.count({
      where: { sessionDate: { gte: startOfWeek }, assignment: { classroom: { sessionId } } },
    }),
    prisma.syllabusPacing.findMany({
      where: { assignment: { classroom: { sessionId } } },
      select: { status: true, completionPercent: true },
    }),
  ])

  const overallCompletionPercent = pacingRows.length
    ? Math.round(pacingRows.reduce((sum, r) => sum + r.completionPercent, 0) / pacingRows.length)
    : 0

  const pacingBreakdown = { ON_TRACK: 0, BEHIND: 0, AHEAD: 0, COMPLETED: 0 }
  for (const row of pacingRows) pacingBreakdown[row.status]++

  return ok({
    session: { id: session.id, name: session.name },
    totalTeachers,
    totalAssignments,
    totalSubjects,
    totalChapters,
    sessionsLoggedToday: sessionsToday,
    sessionsLoggedThisWeek: sessionsThisWeek,
    overallCompletionPercent,
    pacingBreakdown,
  })
}
