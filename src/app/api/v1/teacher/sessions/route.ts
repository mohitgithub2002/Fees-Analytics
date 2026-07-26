import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok, err, readJson, handleError, parseId, parsePagination, paginationMeta } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'
import { recalculatePacingForAssignment } from '@/lib/teaching/pacing'

const SESSION_TYPES = ['TEACHING', 'REVISION', 'QA', 'TEST'] as const
type SessionTypeInput = (typeof SESSION_TYPES)[number]

interface TopicInput {
  subtopicId?: number
  chapterId?: number
  status?: string
  notes?: string
}

/** Own session history, filterable by date range, type and assignment. */
export async function GET(request: NextRequest) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const assignmentId = parseId(sp.get('assignmentId'))
  const type = sp.get('type')
  const from = sp.get('from')
  const to = sp.get('to')
  const { page, pageSize, skip, take } = parsePagination(sp)

  const where: Prisma.SessionLogWhereInput = {
    assignment: { teacherId: gate.teacher.id, ...(assignmentId ? { id: assignmentId } : {}) },
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

/** Log a session. Accepts the header and its topic rows in a single transactional request. */
export async function POST(request: NextRequest) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error
  const { teacher } = gate

  const body = await readJson<{
    assignmentId?: number
    sessionDate?: string
    type?: string
    notes?: string
    topics?: TopicInput[]
  }>(request)
  if (!body) return err('invalid JSON body')

  const { assignmentId, sessionDate, notes, type } = body
  if (!assignmentId) return err('assignmentId is required')
  if (!sessionDate || isNaN(Date.parse(sessionDate))) return err('a valid sessionDate is required')
  if (!type || !SESSION_TYPES.includes(type as SessionTypeInput)) {
    return err('type must be one of TEACHING, REVISION, QA, TEST')
  }
  if (!Array.isArray(body.topics) || body.topics.length === 0) return err('at least one topic is required')

  // Ownership — the assignment must belong to THIS teacher. Filtering by
  // teacherId in the same query that fetches the assignment collapses the
  // check and the fetch into one unbypassable statement.
  const assignment = await prisma.teacherAssignment.findFirst({
    where: { id: assignmentId, teacherId: teacher.id, isActive: true },
    select: { id: true, subjectId: true, classroom: { select: { classId: true } } },
  })
  if (!assignment) return err('assignment not found', 404)

  const usesSubtopic = type === 'TEACHING' || type === 'REVISION'
  const chapters = await prisma.chapter.findMany({
    where: { subjectId: assignment.subjectId, classId: assignment.classroom.classId },
    select: { id: true, subtopics: { select: { id: true } } },
  })
  const validChapterIds = new Set(chapters.map((c) => c.id))
  const validSubtopicIds = new Set(chapters.flatMap((c) => c.subtopics.map((s) => s.id)))

  const topicsData: {
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
      topicsData.push({ subtopicId: t.subtopicId, chapterId: null, status: rowStatus, notes: t.notes?.trim() || null })
    } else {
      if (!t.chapterId || !validChapterIds.has(t.chapterId)) {
        return err("every topic row needs a chapterId that belongs to this assignment's syllabus")
      }
      topicsData.push({ subtopicId: null, chapterId: t.chapterId, status: rowStatus, notes: t.notes?.trim() || null })
    }
  }

  try {
    const log = await prisma.$transaction(async (tx) => {
      const created = await tx.sessionLog.create({
        data: {
          assignmentId,
          sessionDate: new Date(sessionDate),
          type: type as Prisma.SessionLogCreateInput['type'],
          notes: notes?.trim() || null,
          topics: { create: topicsData },
        },
        include: { topics: true },
      })
      await writeAudit(tx, {
        actorType: 'TEACHER',
        actorId: teacher.id,
        actorName: teacher.name,
        action: 'SESSION_LOGGED',
        entityType: 'SessionLog',
        entityId: created.id,
        newValue: created,
      })
      return created
    })
    if (usesSubtopic) await recalculatePacingForAssignment(assignmentId)
    return ok(log, 201)
  } catch (e) {
    return handleError(e)
  }
}
