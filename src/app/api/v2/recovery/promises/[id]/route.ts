import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { toPaise, toRupees } from '@/lib/fees/money'
import { recomputeRecovery } from '@/lib/recovery/recompute'

/**
 * Manual promise resolution. Normally promises settle themselves — see
 * src/lib/recovery/promises.ts, which checks incoming payments against the
 * promised date on every recompute. This route exists for the exceptions: a
 * parent explicitly cancels, or a staff member needs to correct one by hand.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { status, settledAmount, notes } = body as {
    status?: string
    settledAmount?: number
    notes?: string
  }
  const ALLOWED = new Set(['KEPT', 'PARTIAL', 'BROKEN', 'CANCELLED'])
  if (!status || !ALLOWED.has(status)) return err(`status must be one of ${[...ALLOWED].join(', ')}`)

  try {
    const promise = await prisma.promiseToPay.findUnique({ where: { id } })
    if (!promise) return err('promise not found', 404)
    if (promise.status !== 'OPEN') return err('promise is already resolved', 409)

    if (settledAmount !== undefined && toPaise(settledAmount) > toPaise(promise.amount)) {
      return err('settledAmount cannot exceed the promised amount')
    }

    const updated = await prisma.promiseToPay.update({
      where: { id },
      data: {
        status: status as never,
        settledAmount:
          settledAmount !== undefined ? toRupees(toPaise(settledAmount)) : promise.settledAmount,
        settledAt: status === 'BROKEN' ? null : new Date(),
        notes: notes !== undefined ? notes.trim() || null : promise.notes,
      },
    })

    await recomputeRecovery([promise.guardianId])
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}
