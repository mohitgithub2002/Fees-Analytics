import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'
import { recalculatePacingForSession } from '@/lib/teaching/pacing'

/** List calendar events for a session, filterable by type and date range. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const sessionId = parseId(sp.get('sessionId'))
  if (!sessionId) return err('sessionId is required', 400)

  const type = sp.get('type')
  const from = sp.get('from')
  const to = sp.get('to')

  const where: Prisma.CalendarEventWhereInput = { sessionId }
  if (type) where.type = type as Prisma.CalendarEventWhereInput['type']
  // An event overlaps [from, to] when it ends on/after `from` and starts on/before `to`.
  if (from && !isNaN(Date.parse(from))) where.endDate = { gte: new Date(from) }
  if (to && !isNaN(Date.parse(to))) where.startDate = { lte: new Date(to) }

  const events = await prisma.calendarEvent.findMany({ where, orderBy: { startDate: 'asc' } })
  return ok(events)
}

/** Add a holiday, exam block or event. Triggers a pacing recalculation for the session. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const body = await readJson<{
    sessionId?: number
    title?: string
    type?: string
    startDate?: string
    endDate?: string
    description?: string
  }>(request)
  if (!body) return err('invalid JSON body')

  const { sessionId, title, type, startDate, endDate } = body
  if (!sessionId) return err('sessionId is required')
  if (!title?.trim()) return err('title is required')
  if (!type || !['HOLIDAY', 'EXAM', 'EVENT'].includes(type)) return err('type must be HOLIDAY, EXAM or EVENT')
  if (!startDate || isNaN(Date.parse(startDate))) return err('a valid startDate is required')
  if (!endDate || isNaN(Date.parse(endDate))) return err('a valid endDate is required')

  try {
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.calendarEvent.create({
        data: {
          sessionId,
          title: title.trim(),
          type: type as Prisma.CalendarEventCreateInput['type'],
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          description: body.description?.trim() || null,
        },
      })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'CALENDAR_EVENT_CREATED',
        entityType: 'CalendarEvent',
        entityId: created.id,
        newValue: created,
      })
      return created
    })
    await recalculatePacingForSession(sessionId)
    return ok(event, 201)
  } catch (e) {
    return handleError(e)
  }
}
