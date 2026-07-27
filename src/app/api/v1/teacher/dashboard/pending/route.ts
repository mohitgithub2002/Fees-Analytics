import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok } from '@/lib/teaching/http'

/** Subtopics still unmarked across own assignments. */
export async function GET() {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const assignments = await prisma.teacherAssignment.findMany({
    where: { teacherId: gate.teacher.id, isActive: true },
    select: {
      id: true,
      subjectId: true,
      classroom: { select: { classId: true } },
      subject: { select: { id: true, name: true } },
    },
  })

  const results = []
  for (const a of assignments) {
    const subtopics = await prisma.subtopic.findMany({
      where: {
        isActive: true,
        topic: {
          isActive: true,
          chapter: { isActive: true, subjectId: a.subjectId, classId: a.classroom.classId },
        },
        topicDetails: { none: { status: 'COMPLETE', sessionLog: { assignmentId: a.id, type: 'TEACHING' } } },
      },
      select: {
        id: true,
        name: true,
        displayOrder: true,
        topic: { select: { id: true, name: true, chapter: { select: { id: true, name: true } } } },
      },
      orderBy: [
        { topic: { chapter: { displayOrder: 'asc' } } },
        { topic: { displayOrder: 'asc' } },
        { displayOrder: 'asc' },
      ],
    })
    if (subtopics.length) {
      results.push({ assignmentId: a.id, subject: a.subject, pending: subtopics })
    }
  }

  return ok(results)
}
