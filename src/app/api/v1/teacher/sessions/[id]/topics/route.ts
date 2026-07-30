import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'
import { recalculatePacingForAssignment } from '@/lib/teaching/pacing'

interface TopicInput {
  subtopicId?: number
  chapterId?: number
  status?: string
  notes?: string
}

/** Append topic rows to an existing own session. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error
  const { teacher } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const session = await prisma.sessionLog.findFirst({
    where: { id, assignment: { teacherId: teacher.id } },
    include: { assignment: { select: { subjectId: true, classroom: { select: { classId: true } } } } },
  })
  if (!session) return err('session not found', 404)

  const body = await readJson<{ topics?: TopicInput[] }>(request)
  if (!body || !Array.isArray(body.topics) || body.topics.length === 0) return err('at least one topic is required')

  const usesSubtopic = session.type === 'TEACHING' || session.type === 'REVISION'
  const chapters = await prisma.chapter.findMany({
    where: { subjectId: session.assignment.subjectId, classId: session.assignment.classroom.classId },
    select: { id: true, topics: { select: { subtopics: { select: { id: true } } } } },
  })
  const validChapterIds = new Set(chapters.map((c) => c.id))
  const validSubtopicIds = new Set(
    chapters.flatMap((c) => c.topics.flatMap((t) => t.subtopics.map((s) => s.id))),
  )

  const topicsData: {
    sessionLogId: number
    subtopicId: number | null
    chapterId: number | null
    status: 'PARTIAL' | 'COMPLETE'
    notes: string | null
  }[] = []
  for (const t of body.topics) {
    const rowStatus = t.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE'
    if (usesSubtopic) {
      if (!t.subtopicId || !validSubtopicIds.has(t.subtopicId)) {
        return err("every topic row needs a subtopicId that belongs to this assignment's syllabus")
      }
      topicsData.push({ sessionLogId: id, subtopicId: t.subtopicId, chapterId: null, status: rowStatus, notes: t.notes?.trim() || null })
    } else {
      if (!t.chapterId || !validChapterIds.has(t.chapterId)) {
        return err("every topic row needs a chapterId that belongs to this assignment's syllabus")
      }
      topicsData.push({ sessionLogId: id, subtopicId: null, chapterId: t.chapterId, status: rowStatus, notes: t.notes?.trim() || null })
    }
  }

  try {
    const topics = await prisma.$transaction(async (tx) => {
      await tx.sessionTopicDetail.createMany({ data: topicsData })
      const rows = await tx.sessionTopicDetail.findMany({ where: { sessionLogId: id }, orderBy: { id: 'asc' } })
      await writeAudit(tx, {
        actorType: 'TEACHER',
        actorId: teacher.id,
        actorName: teacher.name,
        action: 'SESSION_TOPICS_ADDED',
        entityType: 'SessionLog',
        entityId: id,
        newValue: { added: topicsData.length },
      })
      return rows
    })
    if (usesSubtopic) await recalculatePacingForAssignment(session.assignmentId)
    return ok(topics, 201)
  } catch (e) {
    return handleError(e)
  }
}
