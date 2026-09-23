import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { CASE_INCLUDE, shapeCase } from '@/lib/recovery/case-view'
import { recomputeRecovery } from '@/lib/recovery/recompute'
import {
  ARCHETYPE_HINT,
  OUTCOME_LABEL,
  PROVENANCE_LABEL,
  TIER_LABEL,
  type ContactOutcome,
  type EconomicTier,
  type PaymentArchetype,
  type TimingProvenance,
} from '@/lib/recovery/types'

const TIERS = new Set<EconomicTier>([
  'AFFLUENT',
  'COMFORTABLE',
  'STRAINED',
  'POOR',
  'SEVERE',
  'UNKNOWN',
])

/**
 * Parent 360 — everything needed to have one useful conversation.
 *
 * The point of this payload is that the person making the call should not have
 * to look anything else up: who the children are, what each of them owes, what
 * this family has actually done about it before, what was said on the last
 * call, and what the system thinks — with its reasoning shown rather than a
 * bare score.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!session) return err('no current academic session', 404)

    const household = await prisma.household.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        economicTier: true,
        tierNote: true,
        tierSetByName: true,
        tierSetAt: true,
        linkSource: true,
        needsReview: true,
        reviewNote: true,
        profile: true,
        members: {
          select: {
            linkSource: true,
            student: {
              select: {
                id: true,
                name: true,
                fatherName: true,
                motherName: true,
                phone: true,
                admissionNo: true,
                enrollments: {
                  orderBy: { session: { startDate: 'desc' } },
                  select: {
                    id: true,
                    session: { select: { id: true, name: true, isCurrent: true } },
                    classroom: {
                      select: { section: true, class: { select: { name: true } } },
                    },
                    feeItems: {
                      select: {
                        id: true,
                        category: true,
                        name: true,
                        netAmount: true,
                        paidAmount: true,
                        dueAmount: true,
                        installments: {
                          orderBy: { sequence: 'asc' },
                          select: {
                            id: true,
                            sequence: true,
                            label: true,
                            dueDate: true,
                            netAmount: true,
                            paidAmount: true,
                            status: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    if (!household) return err('household not found', 404)

    const studentIds = household.members.map((m) => m.student.id)

    const [recoveryCase, contacts, promises, payments] = await Promise.all([
      prisma.recoveryCase.findUnique({
        where: { householdId_sessionId: { householdId: id, sessionId: session.id } },
        include: CASE_INCLUDE,
      }),
      prisma.contactAttempt.findMany({
        where: { householdId: id },
        orderBy: { contactedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          channel: true,
          outcome: true,
          talkedTo: true,
          notes: true,
          nextFollowUpAt: true,
          contactedAt: true,
          loggedByName: true,
        },
      }),
      prisma.promiseToPay.findMany({
        where: { householdId: id },
        orderBy: { promisedFor: 'desc' },
        select: {
          id: true,
          amount: true,
          promisedFor: true,
          status: true,
          settledAmount: true,
          settledAt: true,
          closeReason: true,
          createdAt: true,
        },
      }),
      prisma.feeTransaction.findMany({
        where: { studentId: { in: studentIds }, status: 'COMPLETED' },
        orderBy: { paidAt: 'desc' },
        take: 100,
        select: {
          id: true,
          receiptNo: true,
          amount: true,
          mode: true,
          paidAt: true,
          category: true,
          student: { select: { id: true, name: true } },
        },
      }),
    ])

    const today = new Date(new Date().setHours(0, 0, 0, 0))
    const provenance = (household.profile?.timingProvenance ?? 'NONE') as TimingProvenance
    const archetype = (household.profile?.archetype ?? 'UNKNOWN') as PaymentArchetype

    return ok({
      data: {
        session: { id: session.id, name: session.name },
        household: {
          id: household.id,
          displayName: household.displayName,
          linkSource: household.linkSource,
          needsReview: household.needsReview,
          reviewNote: household.reviewNote,
          tier: household.economicTier,
          tierLabel: TIER_LABEL[household.economicTier as EconomicTier],
          tierNote: household.tierNote,
          tierSetByName: household.tierSetByName,
          tierSetAt: household.tierSetAt,
        },

        // The same shape the worklist card uses, so a household reads
        // identically wherever you reach it from.
        case: recoveryCase ? shapeCase(recoveryCase, today) : null,

        profile: household.profile
          ? {
              ...household.profile,
              archetypeHint: ARCHETYPE_HINT[archetype],
              timingProvenanceLabel: PROVENANCE_LABEL[provenance],
              // Said plainly rather than left for the reader to infer from a
              // confidence number they have no scale for.
              historyCaveat:
                (household.profile.sessionsTracked ?? 0) <= 1
                  ? 'Based on a single year of history — a first read, not a settled pattern.'
                  : null,
            }
          : null,

        children: household.members.map((m) => ({
          id: m.student.id,
          name: m.student.name,
          fatherName: m.student.fatherName,
          motherName: m.student.motherName,
          phone: m.student.phone,
          admissionNo: m.student.admissionNo,
          linkSource: m.linkSource,
          enrollments: m.student.enrollments.map((e) => ({
            id: e.id,
            session: e.session,
            className: e.classroom.class.name,
            section: e.classroom.section,
            billed: e.feeItems.reduce((n, f) => n + Number(f.netAmount), 0),
            paid: e.feeItems.reduce((n, f) => n + Number(f.paidAmount), 0),
            due: e.feeItems.reduce((n, f) => n + Number(f.dueAmount), 0),
            feeItems: e.feeItems,
          })),
        })),

        contacts: contacts.map((c) => ({
          ...c,
          outcomeLabel: OUTCOME_LABEL[c.outcome as ContactOutcome] ?? c.outcome,
        })),
        promises,
        payments,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}

interface PatchBody {
  economicTier?: EconomicTier
  tierNote?: string | null
  displayName?: string
}

/**
 * Set what this family can afford, or correct their name.
 *
 * The tier is the half of the targeting matrix the ledger cannot supply, and
 * it is collected one conversation at a time — so this is deliberately a
 * one-field write the call card can fire without leaving the queue.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<PatchBody>(request)
  if (!body) return err('invalid JSON body')

  const data: Record<string, unknown> = {}

  if (body.economicTier !== undefined) {
    if (!TIERS.has(body.economicTier)) {
      return err(`economicTier must be one of: ${[...TIERS].join(', ')}`)
    }
    data.economicTier = body.economicTier
    // Who said so and when — a tier that nobody can trace is a tier nobody
    // will trust enough to overrule.
    data.tierSetById = gate.user.id
    data.tierSetByName = gate.user.name
    data.tierSetAt = new Date()
  }
  if (body.tierNote !== undefined) data.tierNote = body.tierNote
  if (body.displayName !== undefined) {
    const name = body.displayName.trim()
    if (!name) return err('displayName cannot be empty')
    data.displayName = name
    data.normalizedName = name.toLowerCase()
  }

  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const household = await prisma.household.update({ where: { id }, data })

    // The tier feeds straight into scoring, so the ranking should reflect the
    // new tag immediately rather than at the next full recompute.
    if (body.economicTier !== undefined) {
      await recomputeRecovery({ householdIds: [id] }).catch(() => {})
    }
    invalidateTags(TAGS.recovery)

    return ok({ data: household })
  } catch (e) {
    return handleError(e)
  }
}
