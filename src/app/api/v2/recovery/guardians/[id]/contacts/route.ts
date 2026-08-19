import { NextRequest } from 'next/server'
import { $Enums } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { getCurrentUser } from '@/lib/auth/session'
import { recomputeRecovery } from '@/lib/recovery/recompute'

const CHANNELS = new Set(Object.values($Enums.ContactChannel))
const OUTCOMES = new Set(Object.values($Enums.ContactOutcome))

/**
 * Log a call outcome, in the single round trip the worklist's "Log & next"
 * button makes. A PROMISED outcome can carry a promise amount/date to create
 * the PromiseToPay row in the same request — logging a promise and dialling
 * the next household should not be two separate steps under time pressure.
 *
 * Triggers a recompute for this household so the worklist and profile reflect
 * the call immediately, without a background job the owner has to wait on.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guardianId = parseId((await params).id)
  if (!guardianId) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const {
    channel = 'CALL',
    outcome,
    talkedTo,
    notes,
    nextFollowUpAt,
    promiseAmount,
    promiseDate,
  } = body as {
    channel?: string
    outcome?: string
    talkedTo?: string
    notes?: string
    nextFollowUpAt?: string
    promiseAmount?: number
    promiseDate?: string
  }

  if (!CHANNELS.has(channel as never)) return err(`channel must be one of ${[...CHANNELS].join(', ')}`)
  if (!outcome || !OUTCOMES.has(outcome as never)) {
    return err(`outcome must be one of ${[...OUTCOMES].join(', ')}`)
  }
  if (outcome === 'PROMISED') {
    if (!(typeof promiseAmount === 'number' && promiseAmount > 0)) {
      return err('promiseAmount is required and must be positive when outcome is PROMISED')
    }
    if (!promiseDate || isNaN(Date.parse(promiseDate))) {
      return err('promiseDate is required when outcome is PROMISED')
    }
  }
  if (nextFollowUpAt && isNaN(Date.parse(nextFollowUpAt))) return err('invalid nextFollowUpAt')

  try {
    const guardian = await prisma.guardian.findUnique({ where: { id: guardianId } })
    if (!guardian) return err('guardian not found', 404)

    const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    const user = await getCurrentUser()
    const caseRow = session
      ? await prisma.recoveryCase.findUnique({
          where: { guardianId_sessionId: { guardianId, sessionId: session.id } },
        })
      : null

    const result = await prisma.$transaction(async (tx) => {
      const contact = await tx.contactAttempt.create({
        data: {
          guardianId,
          sessionId: session?.id ?? null,
          caseId: caseRow?.id ?? null,
          channel: channel as never,
          outcome: outcome as never,
          talkedTo: talkedTo?.trim() || null,
          notes: notes?.trim() || null,
          nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null,
          loggedById: user?.id ?? null,
          loggedByName: user?.name ?? null,
        },
      })

      let promise = null
      if (outcome === 'PROMISED' && session) {
        promise = await tx.promiseToPay.create({
          data: {
            guardianId,
            sessionId: session.id,
            amount: promiseAmount!,
            promisedFor: new Date(promiseDate!),
            sourceContactId: contact.id,
          },
        })
      }

      if (caseRow) {
        await tx.recoveryCase.update({
          where: { id: caseRow.id },
          data: { lastContactAt: contact.contactedAt, contactCount: { increment: 1 } },
        })
      }

      return { contact, promise }
    })

    // Recompute immediately so the worklist reflects this call without a
    // separate step — the cooldown/promise suppression should apply now.
    // (recomputeRecovery invalidates the recovery cache tag itself.)
    await recomputeRecovery([guardianId])

    return ok(result, 201)
  } catch (e) {
    return handleError(e)
  }
}
