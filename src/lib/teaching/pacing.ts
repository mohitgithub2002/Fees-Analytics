import { prisma } from '@/lib/prisma'
import type { PacingStatus } from '@/generated/prisma/enums'
import { countWorkingDays, addWorkingDays, type DateRange } from './working-days'
import { getSubtopicCompletionMap, chapterCompletionPercent } from './progress'

/**
 * The pacing engine. Answers one question per chapter: given the working
 * days actually available in the academic session, should this chapter have
 * been finished by now?
 *
 * There is no background job runner in this app, so the doc's "nightly cron"
 * is realized as an on-demand recompute: POST /api/v1/admin/pacing/recalculate
 * (all assignments), plus targeted recomputes from the calendar and
 * attendance admin routes, since both change the available working days and
 * therefore every downstream expected date. Wire an external scheduler (e.g.
 * a platform cron hitting the recalculate endpoint) for a true nightly run.
 */
export async function recalculatePacingForAssignment(assignmentId: number): Promise<void> {
  const assignment = await prisma.teacherAssignment.findUnique({
    where: { id: assignmentId },
    include: { classroom: { include: { session: true, class: true } } },
  })
  if (!assignment || !assignment.isActive) return

  const { session, class: schoolClass } = assignment.classroom

  const chapters = await prisma.chapter.findMany({
    where: { subjectId: assignment.subjectId, classId: schoolClass.id, isActive: true },
    orderBy: { displayOrder: 'asc' },
    include: { subtopics: { where: { isActive: true }, select: { id: true } } },
  })
  if (chapters.length === 0) return

  const events = await prisma.calendarEvent.findMany({
    where: { sessionId: session.id },
    select: { startDate: true, endDate: true },
  })
  const excludeEvents: DateRange[] = events.map((e) => ({ startDate: e.startDate, endDate: e.endDate }))

  const absences = await prisma.teacherAttendance.findMany({
    where: {
      teacherId: assignment.teacherId,
      status: 'ABSENT',
      date: { gte: session.startDate, lte: session.endDate },
    },
    select: { date: true },
  })
  const excludeDates = absences.map((a) => a.date)
  const dayOpts = { excludeSundays: true, excludeEvents, excludeDates }

  const totalWorkingDays = countWorkingDays({ from: session.startDate, to: session.endDate, ...dayOpts })

  const allSubtopicIds = chapters.flatMap((c) => c.subtopics.map((s) => s.id))
  const completionMap = await getSubtopicCompletionMap(assignmentId, allSubtopicIds)

  const totalWeight = chapters.reduce((sum, c) => sum + (c.periodsRequired ?? 1), 0) || chapters.length
  const today = new Date(new Date().toISOString().slice(0, 10)) // UTC-midnight "today", for date-only comparisons

  let cursor = new Date(session.startDate)
  for (const chapter of chapters) {
    const weight = chapter.periodsRequired ?? 1
    const span = Math.max(1, Math.round((weight / totalWeight) * totalWorkingDays))

    const expectedStartDate = new Date(cursor)
    const expectedEndDate = addWorkingDays(cursor, span, dayOpts)

    const subtopicIds = chapter.subtopics.map((s) => s.id)
    const percent = chapterCompletionPercent(subtopicIds, completionMap)

    let status: PacingStatus
    let daysBehind = 0
    if (percent === 100) {
      status = 'COMPLETED'
      if (today < expectedEndDate) {
        daysBehind = -countWorkingDays({ from: today, to: expectedEndDate, ...dayOpts })
      }
    } else if (today > expectedEndDate) {
      status = 'BEHIND'
      daysBehind = countWorkingDays({ from: expectedEndDate, to: today, ...dayOpts })
    } else {
      const windowDays = Math.max(1, countWorkingDays({ from: expectedStartDate, to: expectedEndDate, ...dayOpts }))
      const elapsedDays = countWorkingDays({ from: expectedStartDate, to: today, ...dayOpts })
      const expectedPercentByNow = Math.min(100, Math.round((elapsedDays / windowDays) * 100))
      status = percent >= expectedPercentByNow ? 'AHEAD' : 'ON_TRACK'
    }

    await prisma.syllabusPacing.upsert({
      where: { assignmentId_chapterId: { assignmentId, chapterId: chapter.id } },
      create: { assignmentId, chapterId: chapter.id, expectedStartDate, expectedEndDate, status, daysBehind, completionPercent: percent },
      update: { expectedStartDate, expectedEndDate, status, daysBehind, completionPercent: percent, calculatedAt: new Date() },
    })

    const dayAfterEnd = new Date(expectedEndDate)
    dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1)
    cursor = addWorkingDays(dayAfterEnd, 1, dayOpts)
  }
}

export async function recalculatePacingForAssignments(assignmentIds: number[]): Promise<void> {
  for (const id of assignmentIds) {
    await recalculatePacingForAssignment(id)
  }
}

export async function recalculatePacingForTeacher(teacherId: number): Promise<void> {
  const assignments = await prisma.teacherAssignment.findMany({
    where: { isActive: true, teacherId },
    select: { id: true },
  })
  await recalculatePacingForAssignments(assignments.map((a) => a.id))
}

export async function recalculatePacingForSession(sessionId: number): Promise<void> {
  const assignments = await prisma.teacherAssignment.findMany({
    where: { isActive: true, classroom: { sessionId } },
    select: { id: true },
  })
  await recalculatePacingForAssignments(assignments.map((a) => a.id))
}

/** Recompute every active assignment. Returns the number recomputed. */
export async function recalculatePacingAll(): Promise<number> {
  const assignments = await prisma.teacherAssignment.findMany({ where: { isActive: true }, select: { id: true } })
  await recalculatePacingForAssignments(assignments.map((a) => a.id))
  return assignments.length
}
