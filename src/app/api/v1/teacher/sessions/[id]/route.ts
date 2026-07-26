import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError, isSameCalendarDay } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'

const SESSION_INCLUDE = {
  assignment: {
    include: {
      subject: { select: { id: true, name: true } },
      classroom: { include: { class: { select: { id: true, name: true } } } },
    },
  },
  topics: {
    include: {
      subtopic: { select: { id: true, name: true } },
      chapter: { select: { id: true, name: true } },
    },
  },
} as const

/** One own session with its topic detail rows. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const session = await prisma.sessionLog.findFirst({
    where: { id, assignment: { teacherId: gate.teacher.id } },
    include: SESSION_INCLUDE,
  })
  if (!session) return err('session not found', 404)
  return ok(session)
}

/** Edit notes or date. Permitted only on the day the session was created. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error
  const { teacher } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const existing = await prisma.sessionLog.findFirst({ where: { id, assignment: { teacherId: teacher.id } } })
  if (!existing) return err('session not found', 404)
  if (!isSameCalendarDay(existing.createdAt, new Date())) {
    return err('sessions can only be edited on the day they were created', 403)
  }

  const body = await readJson<{ notes?: string | null; sessionDate?: string }>(request)
  if (!body) return err('invalid JSON body')

  const data: Prisma.SessionLogUpdateInput = {}
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null
  if (body.sessionDate !== undefined) {
    if (isNaN(Date.parse(body.sessionDate))) return err('invalid sessionDate')
    data.sessionDate = new Date(body.sessionDate)
  }
  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const session = await prisma.$transaction(async (tx) => {
      const updated = await tx.sessionLog.update({ where: { id }, data, include: SESSION_INCLUDE })
      await writeAudit(tx, {
        actorType: 'TEACHER',
        actorId: teacher.id,
        actorName: teacher.name,
        action: 'SESSION_UPDATED',
        entityType: 'SessionLog',
        entityId: id,
        oldValue: existing,
        newValue: updated,
      })
      return updated
    })
    return ok(session)
  } catch (e) {
    return handleError(e)
  }
}
