import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'
import { recalculatePacingForSession } from '@/lib/teaching/pacing'

/** Update an event. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const existing = await prisma.calendarEvent.findUnique({ where: { id } })
  if (!existing) return err('event not found', 404)

  const body = await readJson<{
    title?: string
    type?: string
    startDate?: string
    endDate?: string
    description?: string | null
  }>(request)
  if (!body) return err('invalid JSON body')

  const data: Prisma.CalendarEventUpdateInput = {}
  if (body.title !== undefined) {
    const title = body.title.trim()
    if (!title) return err('title cannot be empty')
    data.title = title
  }
  if (body.type !== undefined) {
    if (!['HOLIDAY', 'EXAM', 'EVENT'].includes(body.type)) return err('type must be HOLIDAY, EXAM or EVENT')
    data.type = body.type as Prisma.CalendarEventUpdateInput['type']
  }
  if (body.startDate !== undefined) {
    if (isNaN(Date.parse(body.startDate))) return err('invalid startDate')
    data.startDate = new Date(body.startDate)
  }
  if (body.endDate !== undefined) {
    if (isNaN(Date.parse(body.endDate))) return err('invalid endDate')
    data.endDate = new Date(body.endDate)
  }
  if (body.description !== undefined) data.description = body.description?.trim() || null
  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const event = await prisma.$transaction(async (tx) => {
      const updated = await tx.calendarEvent.update({ where: { id }, data })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'CALENDAR_EVENT_UPDATED',
        entityType: 'CalendarEvent',
        entityId: id,
        oldValue: existing,
        newValue: updated,
      })
      return updated
    })
    await recalculatePacingForSession(event.sessionId)
    return ok(event)
  } catch (e) {
    return handleError(e)
  }
}

/** Delete an event and recalculate pacing. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const existing = await prisma.calendarEvent.findUnique({ where: { id } })
  if (!existing) return err('event not found', 404)

  try {
    await prisma.$transaction(async (tx) => {
      await tx.calendarEvent.delete({ where: { id } })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'CALENDAR_EVENT_DELETED',
        entityType: 'CalendarEvent',
        entityId: id,
        oldValue: existing,
      })
    })
    await recalculatePacingForSession(existing.sessionId)
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
