import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { recomputeRecovery } from '@/lib/recovery/recompute'

const MS_PER_DAY = 86_400_000

/**
 * Workflow transitions on one recovery case.
 *
 * All five live on one endpoint because they are the same kind of act: a
 * person overriding what the system worked out. They write only the
 * human-owned columns — stage, snooze, park, pin — which a recompute reads and
 * never touches.
 *
 *   pin     force onto today's list, overriding every suppression rule
 *   unpin   take that override back
 *   snooze  not now, ask again on this date
 *   park    confirmed hardship — stop chasing until somebody reopens it
 *   reopen  undo a park
 */
type Action = 'pin' | 'unpin' | 'snooze' | 'park' | 'reopen'

const ACTIONS = new Set<Action>(['pin', 'unpin', 'snooze', 'park', 'reopen'])

interface Body {
  action?: Action
  /** snooze: either an explicit date or a number of days. */
  until?: string
  days?: number
  /** park: required — a park with no stated reason is unreviewable later. */
  reason?: string
  /** pin: defaults to today. */
  date?: string
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<Body>(request)
  if (!body) return err('invalid JSON body')
  if (!body.action || !ACTIONS.has(body.action)) {
    return err(`action must be one of: ${[...ACTIONS].join(', ')}`)
  }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const data: Record<string, unknown> = {}

  switch (body.action) {
    case 'pin': {
      let date = today
      if (body.date) {
        const parsed = new Date(body.date)
        if (Number.isNaN(parsed.getTime())) return err('date is not a valid date')
        date = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
      }
      data.pinnedForDate = date
      break
    }

    case 'unpin':
      data.pinnedForDate = null
      break

    case 'snooze': {
      let until: Date
      if (body.until) {
        until = new Date(body.until)
        if (Number.isNaN(until.getTime())) return err('until is not a valid date')
      } else if (Number.isInteger(body.days) && body.days! > 0) {
        until = new Date(today.getTime() + body.days! * MS_PER_DAY)
      } else {
        return err('snooze needs either an until date or a positive days count')
      }
      if (until <= now) return err('snooze until must be in the future')
      data.snoozedUntil = until
      data.stage = 'SNOOZED'
      break
    }

    case 'park': {
      // A park stops all chasing indefinitely, so it has to carry a reason
      // somebody can review later — otherwise the list quietly shrinks and
      // nobody can say why.
      const reason = body.reason?.trim()
      if (!reason) return err('park needs a reason')
      data.parkedReason = reason
      data.stage = 'PARKED'
      data.snoozedUntil = null
      break
    }

    case 'reopen':
      data.parkedReason = null
      data.snoozedUntil = null
      data.stage = 'CONTACTED'
      break
  }

  try {
    const existing = await prisma.recoveryCase.findUnique({
      where: { id },
      select: { id: true, householdId: true },
    })
    if (!existing) return err('case not found', 404)

    const updated = await prisma.recoveryCase.update({ where: { id }, data })

    // Re-evaluate suppression immediately so the change shows on the next load
    // rather than at the next full recompute.
    await recomputeRecovery({ householdIds: [existing.householdId] }).catch(() => {})
    invalidateTags(TAGS.recovery)

    return ok({ data: updated })
  } catch (e) {
    return handleError(e)
  }
}
