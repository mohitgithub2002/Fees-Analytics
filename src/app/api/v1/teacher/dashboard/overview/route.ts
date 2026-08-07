import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok } from '@/lib/teaching/http'

/** Summary of assignments, today's periods, overall progress and homework still to check. */
export async function GET() {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const dayOfWeek = new Date().getDay()

  const [assignmentCount, todaySlots, pacingRows, homeworkToCheck] = await Promise.all([
    prisma.teacherAssignment.count({ where: { teacherId: gate.teacher.id, isActive: true } }),
    dayOfWeek === 0
      ? Promise.resolve([])
      : prisma.timetableSlot.findMany({
          where: { dayOfWeek, assignment: { teacherId: gate.teacher.id, isActive: true } },
          include: {
            assignment: {
              include: { subject: { select: { id: true, name: true } }, classroom: { include: { class: { select: { id: true, name: true } } } } },
            },
          },
          orderBy: { periodNumber: 'asc' },
        }),
    prisma.syllabusPacing.findMany({
      where: { assignment: { teacherId: gate.teacher.id, isActive: true } },
      select: { status: true, completionPercent: true },
    }),
    prisma.sessionLog.count({
      where: {
        type: 'HOMEWORK',
        homeworkCheck: { is: null },
        assignment: { teacherId: gate.teacher.id, isActive: true },
      },
    }),
  ])

  const overallCompletionPercent = pacingRows.length
    ? Math.round(pacingRows.reduce((sum, r) => sum + r.completionPercent, 0) / pacingRows.length)
    : 0
  const pacingBreakdown = { ON_TRACK: 0, BEHIND: 0, AHEAD: 0, COMPLETED: 0 }
  for (const row of pacingRows) pacingBreakdown[row.status]++

  return ok({ assignmentCount, todaySlots, overallCompletionPercent, pacingBreakdown, homeworkToCheck })
}
