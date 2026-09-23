import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { recomputeRecovery } from '@/lib/recovery/recompute'
import type { PromiseStatus } from '@/lib/recovery/types'

const CLOSEABLE = new Set<PromiseStatus>(['KEPT', 'PARTIAL', 'BROKEN', 'CANCELLED'])

interface Body {
  status?: PromiseStatus
  settledAmount?: number
  promisedFor?: string
  amount?: number
  closeReason?: string
}

/**
 * Adjust or close a promise by hand.
 *
 * Promises normally settle themselves from recorded payments — see
 * promises.ts — and that is the path that should be used, because a
 * kept/broken record which depends on someone remembering to tick a box decays
 * into flattery and then feeds the propensity score.
 *
 * This exists for the cases automatic settlement cannot see: money taken in
 * cash and not yet recorded, a family that renegotiated, a promise logged
 * against the wrong household.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<Body>(request)
  if (!body) return err('invalid JSON body')

  const data: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!CLOSEABLE.has(body.status)) {
      return err(`status must be one of: ${[...CLOSEABLE].join(', ')}`)
    }
    data.status = body.status
    data.settledAt = new Date()
    data.settledAmount = body.settledAmount ?? (body.status === 'BROKEN' ? 0 : undefined)
    data.closeReason = body.closeReason?.trim() || `Closed by ${gate.user.name}.`
  }

  if (body.amount !== undefined) {
    if (!(typeof body.amount === 'number' && body.amount > 0)) {
      return err('amount must be positive')
    }
    data.amount = body.amount
  }

  if (body.promisedFor !== undefined) {
    const promisedFor = new Date(body.promisedFor)
    if (Number.isNaN(promisedFor.getTime())) return err('promisedFor is not a valid date')
    data.promisedFor = promisedFor
  }

  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const existing = await prisma.promiseToPay.findUnique({
      where: { id },
      select: { id: true, householdId: true },
    })
    if (!existing) return err('promise not found', 404)

    const promise = await prisma.promiseToPay.update({ where: { id }, data })

    // Closing a promise lifts its suppression; moving its date extends it.
    await recomputeRecovery({ householdIds: [existing.householdId] }).catch(() => {})
    invalidateTags(TAGS.recovery)

    return ok({ data: promise })
  } catch (e) {
    return handleError(e)
  }
}
