import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { recomputeRecovery } from '@/lib/recovery/recompute'
import {
  ANSWERED_OUTCOMES,
  OUTCOME_LABEL,
  type ContactChannel,
  type ContactOutcome,
  type EconomicTier,
} from '@/lib/recovery/types'

const CHANNELS = new Set<ContactChannel>(['CALL', 'SMS', 'WHATSAPP', 'VISIT', 'IN_PERSON', 'OTHER'])
const OUTCOMES = new Set<ContactOutcome>(Object.keys(OUTCOME_LABEL) as ContactOutcome[])
const TIERS = new Set<EconomicTier>([
  'AFFLUENT',
  'COMFORTABLE',
  'STRAINED',
  'POOR',
  'SEVERE',
  'UNKNOWN',
])

/** The call log for one household, newest first. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    const calls = await prisma.contactAttempt.findMany({
      where: { householdId: id },
      orderBy: { contactedAt: 'desc' },
      include: { promises: { select: { id: true, amount: true, promisedFor: true, status: true } } },
    })
    return ok({
      data: calls.map((c) => ({
        ...c,
        outcomeLabel: OUTCOME_LABEL[c.outcome as ContactOutcome] ?? c.outcome,
      })),
    })
  } catch (e) {
    return handleError(e)
  }
}

interface LogCallBody {
  channel?: ContactChannel
  outcome?: ContactOutcome
  talkedTo?: string
  notes?: string
  contactId?: number
  nextFollowUpAt?: string
  /** Set when the outcome is PROMISED. */
  promiseAmount?: number
  promisedFor?: string
  /** Tag ability to pay in the same write — this is how tiers get collected. */
  economicTier?: EconomicTier
  tierNote?: string
}

/**
 * Log one conversation.
 *
 * Everything that comes out of a single call is written in ONE request: the
 * outcome, what was said, the promise if they made one, and what the caller
 * learned about what this family can afford. Splitting those across three
 * round trips is how call logging quietly stops happening — and a call log
 * that is only sometimes filled in is worse than none, because the propensity
 * score starts treating "nobody wrote it down" as "nobody called".
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<LogCallBody>(request)
  if (!body) return err('invalid JSON body')

  const channel = body.channel ?? 'CALL'
  if (!CHANNELS.has(channel)) return err(`channel must be one of: ${[...CHANNELS].join(', ')}`)
  if (!body.outcome || !OUTCOMES.has(body.outcome)) {
    return err(`outcome must be one of: ${[...OUTCOMES].join(', ')}`)
  }

  let promisedFor: Date | null = null
  if (body.outcome === 'PROMISED') {
    if (typeof body.promiseAmount !== 'number' || !(body.promiseAmount > 0)) {
      return err('a promise needs a positive promiseAmount')
    }
    if (!body.promisedFor) return err('a promise needs a promisedFor date')
    promisedFor = new Date(body.promisedFor)
    if (Number.isNaN(promisedFor.getTime())) return err('promisedFor is not a valid date')
  }

  let nextFollowUpAt: Date | null = null
  if (body.nextFollowUpAt) {
    nextFollowUpAt = new Date(body.nextFollowUpAt)
    if (Number.isNaN(nextFollowUpAt.getTime())) return err('nextFollowUpAt is not a valid date')
  }

  if (body.economicTier !== undefined && !TIERS.has(body.economicTier)) {
    return err(`economicTier must be one of: ${[...TIERS].join(', ')}`)
  }

  try {
    const household = await prisma.household.findUnique({ where: { id }, select: { id: true } })
    if (!household) return err('household not found', 404)

    const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!session) return err('no current academic session', 404)

    const now = new Date()
    const answered = ANSWERED_OUTCOMES.has(body.outcome)

    const result = await prisma.$transaction(async (tx) => {
      const attempt = await tx.contactAttempt.create({
        data: {
          householdId: id,
          sessionId: session.id,
          contactId: body.contactId ?? null,
          channel,
          outcome: body.outcome!,
          talkedTo: body.talkedTo?.trim() || null,
          notes: body.notes?.trim() || null,
          nextFollowUpAt,
          contactedAt: now,
          loggedById: gate.user.id,
          loggedByName: gate.user.name,
        },
      })

      // The promise is created in the same write as the call that produced it,
      // and carries a link back to it, so "who said they would pay" is always
      // traceable to a conversation.
      const promise = promisedFor
        ? await tx.promiseToPay.create({
            data: {
              householdId: id,
              sourceContactId: attempt.id,
              amount: body.promiseAmount!,
              promisedFor,
            },
          })
        : null

      // Reaching somebody proves the number works — worth recording, because
      // reachability is what decides whether this family can be chased at all.
      if (body.contactId && answered) {
        await tx.householdContact.updateMany({
          where: { id: body.contactId, householdId: id },
          data: { verification: 'VERIFIED', lastReachedAt: now },
        })
      }
      if (body.contactId && body.outcome === 'WRONG_NUMBER') {
        await tx.householdContact.updateMany({
          where: { id: body.contactId, householdId: id },
          data: { verification: 'WRONG_NUMBER' },
        })
      }

      if (body.economicTier !== undefined || body.tierNote !== undefined) {
        await tx.household.update({
          where: { id },
          data: {
            ...(body.economicTier !== undefined
              ? {
                  economicTier: body.economicTier,
                  tierSetById: gate.user.id,
                  tierSetByName: gate.user.name,
                  tierSetAt: now,
                }
              : {}),
            ...(body.tierNote !== undefined ? { tierNote: body.tierNote } : {}),
          },
        })
      }

      // Stage and contact counters are human-owned columns, so they are
      // advanced here rather than by a recompute.
      await tx.recoveryCase.upsert({
        where: { householdId_sessionId: { householdId: id, sessionId: session.id } },
        create: {
          householdId: id,
          sessionId: session.id,
          stage: promise ? 'PROMISED' : 'CONTACTED',
          contactCount: 1,
          lastContactAt: now,
          nextActionAt: nextFollowUpAt,
        },
        update: {
          stage: promise ? 'PROMISED' : 'CONTACTED',
          contactCount: { increment: 1 },
          lastContactAt: now,
          nextActionAt: nextFollowUpAt,
        },
      })

      return { attempt, promise }
    })

    // Refresh this household so the cooling-off rule takes effect immediately
    // and they drop off today's queue. Non-fatal: a stale queue row is a much
    // smaller problem than losing the logged call.
    await recomputeRecovery({ householdIds: [id] }).catch(() => {})
    invalidateTags(TAGS.recovery)

    return ok(
      {
        data: {
          ...result.attempt,
          outcomeLabel: OUTCOME_LABEL[result.attempt.outcome as ContactOutcome],
          promise: result.promise,
        },
      },
      201
    )
  } catch (e) {
    return handleError(e)
  }
}
