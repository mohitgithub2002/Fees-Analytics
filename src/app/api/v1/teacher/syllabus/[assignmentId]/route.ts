import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok, err, parseId } from '@/lib/teaching/http'
import { getSubtopicCompletionMap } from '@/lib/teaching/progress'

/** Nested chapter → topic → subtopic tree for one own assignment, annotated with current completion status. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ assignmentId: string }> }) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const assignmentId = parseId((await params).assignmentId)
  if (!assignmentId) return err('invalid assignmentId', 400)

  // Ownership check and fetch collapsed into one query: if the assignment
  // isn't this teacher's, this simply returns nothing.
  const assignment = await prisma.teacherAssignment.findFirst({
    where: { id: assignmentId, teacherId: gate.teacher.id, isActive: true },
    include: { classroom: { include: { class: true } }, subject: true },
  })
  if (!assignment) return err('assignment not found', 404)

  const chapters = await prisma.chapter.findMany({
    where: { subjectId: assignment.subjectId, classId: assignment.classroom.classId, isActive: true },
    orderBy: { displayOrder: 'asc' },
    include: {
      topics: {
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' },
        include: { subtopics: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } } },
      },
    },
  })

  const allSubtopicIds = chapters.flatMap((c) => c.topics.flatMap((t) => t.subtopics.map((s) => s.id)))
  const statusMap = await getSubtopicCompletionMap(assignmentId, allSubtopicIds)

  const tree = chapters.map((c) => ({
    id: c.id,
    name: c.name,
    displayOrder: c.displayOrder,
    periodsRequired: c.periodsRequired,
    topics: c.topics.map((t) => ({
      id: t.id,
      name: t.name,
      displayOrder: t.displayOrder,
      subtopics: t.subtopics.map((s) => ({
        id: s.id,
        name: s.name,
        displayOrder: s.displayOrder,
        status: statusMap.get(s.id) ?? null,
      })),
    })),
  }))

  return ok({
    assignment: {
      id: assignment.id,
      subject: { id: assignment.subject.id, name: assignment.subject.name },
      class: { id: assignment.classroom.class.id, name: assignment.classroom.class.name },
    },
    chapters: tree,
  })
}
