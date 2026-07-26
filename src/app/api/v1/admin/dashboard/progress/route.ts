import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, parseId } from '@/lib/teaching/http'

/** Completion percentage by classroom and subject, scoped to one academic session. */
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

  const pacing = await prisma.syllabusPacing.findMany({
    where: { assignment: { isActive: true, classroom: { sessionId } } },
    select: {
      status: true,
      completionPercent: true,
      assignment: {
        select: {
          classroomId: true,
          subjectId: true,
          teacher: { select: { id: true, name: true } },
          subject: { select: { id: true, name: true } },
          classroom: {
            select: { id: true, section: true, class: { select: { id: true, name: true } } },
          },
        },
      },
    },
  })

  interface Group {
    classroomId: number
    className: string
    section: string
    subjectId: number
    subjectName: string
    teacherName: string
    totalChapters: number
    completedChapters: number
    behindChapters: number
    sumPercent: number
  }
  const groups = new Map<string, Group>()

  for (const row of pacing) {
    const a = row.assignment
    const key = `${a.classroomId}:${a.subjectId}`
    let g = groups.get(key)
    if (!g) {
      g = {
        classroomId: a.classroomId,
        className: a.classroom.class.name,
        section: a.classroom.section,
        subjectId: a.subjectId,
        subjectName: a.subject.name,
        teacherName: a.teacher.name,
        totalChapters: 0,
        completedChapters: 0,
        behindChapters: 0,
        sumPercent: 0,
      }
      groups.set(key, g)
    }
    g.totalChapters++
    g.sumPercent += row.completionPercent
    if (row.status === 'COMPLETED') g.completedChapters++
    if (row.status === 'BEHIND') g.behindChapters++
  }

  const progress = Array.from(groups.values())
    .map((g) => ({
      classroomId: g.classroomId,
      className: g.className,
      section: g.section,
      subjectId: g.subjectId,
      subjectName: g.subjectName,
      teacherName: g.teacherName,
      totalChapters: g.totalChapters,
      completedChapters: g.completedChapters,
      behindChapters: g.behindChapters,
      completionPercent: g.totalChapters ? Math.round(g.sumPercent / g.totalChapters) : 0,
    }))
    .sort((a, b) => a.className.localeCompare(b.className) || a.section.localeCompare(b.section))

  return ok(progress)
}
