import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { recomputeRecovery } from '@/lib/recovery/recompute'

/**
 * "Not now" — hold a household off the worklist until a chosen date without
 * touching its behavioural profile. Distinct from the automatic suppression
 * rules (just paid, cooldown, open promise): this is a human's own judgement
 * call, e.g. "the family said their factory reopens after Diwali."
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')
  const { until } = body as { until?: string }
  if (!until || isNaN(Date.parse(until))) return err('until is required (ISO date)')

  try {
    const recCase = await prisma.recoveryCase.findUnique({ where: { id } })
    if (!recCase) return err('case not found', 404)

    const updated = await prisma.recoveryCase.update({
      where: { id },
      data: { stage: 'SNOOZED', snoozedUntil: new Date(until) },
    })
    await recomputeRecovery([recCase.guardianId])
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}
