import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError, isSameCalendarDay } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'
import { recalculatePacingForAssignment } from '@/lib/teaching/pacing'

/** Update a topic's status, typically PARTIAL to COMPLETE. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error
  const { teacher } = gate

  const { id: idRaw, tid: tidRaw } = await params
  const id = parseId(idRaw)
  const tid = parseId(tidRaw)
  if (!id || !tid) return err('invalid id', 400)

  const topic = await prisma.sessionTopicDetail.findFirst({
    where: { id: tid, sessionLogId: id, sessionLog: { assignment: { teacherId: teacher.id } } },
    include: { sessionLog: { select: { type: true, assignmentId: true } } },
  })
  if (!topic) return err('topic not found', 404)

  const body = await readJson<{ status?: string; notes?: string | null }>(request)
  if (!body) return err('invalid JSON body')

  const data: Prisma.SessionTopicDetailUpdateInput = {}
  if (body.status !== undefined) {
    if (!['PARTIAL', 'COMPLETE'].includes(body.status)) return err('status must be PARTIAL or COMPLETE')
    data.status = body.status as Prisma.SessionTopicDetailUpdateInput['status']
  }
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null
  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.sessionTopicDetail.update({ where: { id: tid }, data })
      await writeAudit(tx, {
        actorType: 'TEACHER',
        actorId: teacher.id,
        actorName: teacher.name,
        action: 'SESSION_TOPIC_UPDATED',
        entityType: 'SessionTopicDetail',
        entityId: tid,
        oldValue: topic,
        newValue: result,
      })
      return result
    })
    if (topic.sessionLog.type === 'TEACHING') await recalculatePacingForAssignment(topic.sessionLog.assignmentId)
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}

/** Remove a mistakenly added topic row. Same-day only. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error
  const { teacher } = gate

  const { id: idRaw, tid: tidRaw } = await params
  const id = parseId(idRaw)
  const tid = parseId(tidRaw)
  if (!id || !tid) return err('invalid id', 400)

  const topic = await prisma.sessionTopicDetail.findFirst({
    where: { id: tid, sessionLogId: id, sessionLog: { assignment: { teacherId: teacher.id } } },
    include: { sessionLog: { select: { type: true, assignmentId: true } } },
  })
  if (!topic) return err('topic not found', 404)
  if (!isSameCalendarDay(topic.createdAt, new Date())) {
    return err('topic rows can only be removed on the day they were added', 403)
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sessionTopicDetail.delete({ where: { id: tid } })
      await writeAudit(tx, {
        actorType: 'TEACHER',
        actorId: teacher.id,
        actorName: teacher.name,
        action: 'SESSION_TOPIC_REMOVED',
        entityType: 'SessionTopicDetail',
        entityId: tid,
        oldValue: topic,
      })
    })
    if (topic.sessionLog.type === 'TEACHING') await recalculatePacingForAssignment(topic.sessionLog.assignmentId)
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
