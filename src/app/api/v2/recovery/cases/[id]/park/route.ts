import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { recomputeRecovery } from '@/lib/recovery/recompute'

/**
 * Park a household: confirmed hardship, stop chasing by phone. Parked cases
 * leave the daily worklist entirely and surface in a separate "needs a
 * decision" bucket for a discount, payment plan, or write-off review — the
 * opposite of a snooze, which just defers the same call to a later date.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')
  const { reason } = body as { reason?: string }
  if (!reason?.trim()) return err('reason is required')

  try {
    const recCase = await prisma.recoveryCase.findUnique({ where: { id } })
    if (!recCase) return err('case not found', 404)

    const updated = await prisma.recoveryCase.update({
      where: { id },
      data: { stage: 'PARKED', parkedReason: reason.trim() },
    })
    await recomputeRecovery([recCase.guardianId])
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}
