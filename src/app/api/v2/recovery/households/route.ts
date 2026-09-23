import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { err, handleError, ok, parseId } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { normalizePhone } from '@/lib/auth/phone'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { parsePagination, paginationMeta } from '@/lib/teaching/http'
import { recomputeRecovery } from '@/lib/recovery/recompute'
import { ARCHETYPE_LABEL, TIER_LABEL, type PaymentArchetype, type EconomicTier } from '@/lib/recovery/types'

/**
 * The segmentation browser: every household, filtered by how they pay, whether
 * they can, which class their children are in, and how much they owe.
 *
 * Sorting and pagination happen in SQL against RecoveryCase, which is exactly
 * why the case table carries the derived score columns — filtering ~400
 * households in memory would work today and stop working the year the school
 * grows.
 */
const SORTABLE = {
  priority: 'priorityScore',
  outstanding: 'outstanding',
  expected: 'expectedRecoveryValue',
  lastContact: 'lastContactAt',
} as const

export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const { page, pageSize, skip, take } = parsePagination(sp)

  const rawSession = sp.get('sessionId')
  const sessionId = rawSession ? parseId(rawSession) : null
  if (rawSession && !sessionId) return err('invalid sessionId')

  const sortKey = (sp.get('sortKey') ?? 'priority') as keyof typeof SORTABLE
  if (!(sortKey in SORTABLE)) {
    return err(`sortKey must be one of: ${Object.keys(SORTABLE).join(', ')}`)
  }
  const sortDir = sp.get('sortDir') === 'asc' ? 'asc' : 'desc'

  try {
    const session = sessionId
      ? await prisma.academicSession.findUnique({ where: { id: sessionId } })
      : await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!session) return err('no current academic session', 404)

    const where: Prisma.RecoveryCaseWhereInput = { sessionId: session.id }
    const householdWhere: Prisma.HouseholdWhereInput = { isActive: true }

    const archetype = sp.get('archetype')
    if (archetype) householdWhere.profile = { archetype: archetype as PaymentArchetype }

    const tier = sp.get('tier')
    if (tier) householdWhere.economicTier = tier as EconomicTier

    if (sp.get('needsReview') === 'true') householdWhere.needsReview = true

    const search = sp.get('search')?.trim()
    if (search) {
      householdWhere.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { members: { some: { student: { name: { contains: search, mode: 'insensitive' } } } } },
      ]
    }

    const className = sp.get('class')
    if (className) {
      householdWhere.members = {
        some: {
          student: {
            enrollments: {
              some: {
                sessionId: session.id,
                classroom: { class: { name: className } },
              },
            },
          },
        },
      }
    }

    where.household = householdWhere

    const stage = sp.get('stage')
    if (stage) where.stage = stage as Prisma.EnumRecoveryStageFilter['equals']

    // Callable / skipped is the distinction the worklist is built on, so the
    // browser can filter by it too.
    const status = sp.get('status')
    if (status === 'callable') where.suppressionRule = null
    else if (status === 'skipped') where.suppressionRule = { not: null }

    const minDue = sp.get('minDue')
    const maxDue = sp.get('maxDue')
    if (minDue || maxDue) {
      where.outstanding = {
        ...(minDue ? { gte: Number(minDue) } : {}),
        ...(maxDue ? { lte: Number(maxDue) } : {}),
      }
    }

    const [rows, total] = await Promise.all([
      prisma.recoveryCase.findMany({
        where,
        skip,
        take,
        orderBy: { [SORTABLE[sortKey]]: sortDir },
        select: {
          id: true,
          stage: true,
          outstanding: true,
          expectedRecoveryValue: true,
          priorityScore: true,
          suppressionRule: true,
          suppressionReason: true,
          lastContactAt: true,
          contactCount: true,
          pinnedForDate: true,
          household: {
            select: {
              id: true,
              displayName: true,
              economicTier: true,
              needsReview: true,
              linkSource: true,
              _count: { select: { members: true, contacts: true } },
              profile: {
                select: {
                  archetype: true,
                  carryConfidence: true,
                  pastSessionsDue: true,
                  currentSessionDue: true,
                  reachableContacts: true,
                },
              },
              members: {
                take: 4,
                select: {
                  student: {
                    select: {
                      id: true,
                      name: true,
                      enrollments: {
                        where: { sessionId: session.id },
                        take: 1,
                        select: { classroom: { select: { class: { select: { name: true } } } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.recoveryCase.count({ where }),
    ])

    return ok({
      data: rows.map((c) => {
        const archetypeValue = (c.household.profile?.archetype ?? 'UNKNOWN') as PaymentArchetype
        const tierValue = c.household.economicTier as EconomicTier
        return {
          caseId: c.id,
          householdId: c.household.id,
          displayName: c.household.displayName,
          archetype: archetypeValue,
          archetypeLabel: ARCHETYPE_LABEL[archetypeValue] ?? archetypeValue,
          confidence: c.household.profile?.carryConfidence ?? 0,
          tier: tierValue,
          tierLabel: TIER_LABEL[tierValue] ?? tierValue,
          stage: c.stage,
          outstanding: Number(c.outstanding),
          currentSessionDue: Number(c.household.profile?.currentSessionDue ?? 0),
          pastSessionsDue: Number(c.household.profile?.pastSessionsDue ?? 0),
          expectedRecoveryValue: Number(c.expectedRecoveryValue),
          priorityScore: c.priorityScore,
          suppressionRule: c.suppressionRule,
          suppressionReason: c.suppressionReason,
          lastContactAt: c.lastContactAt,
          contactCount: c.contactCount,
          isPinned: Boolean(c.pinnedForDate),
          childrenCount: c.household._count.members,
          reachableContacts: c.household.profile?.reachableContacts ?? 0,
          needsReview: c.household.needsReview,
          linkSource: c.household.linkSource,
          children: c.household.members.map((m) => ({
            id: m.student.id,
            name: m.student.name,
            className: m.student.enrollments[0]?.classroom.class.name ?? null,
          })),
        }
      }),
      pagination: paginationMeta(page, pageSize, total),
    })
  } catch (e) {
    return handleError(e)
  }
}

interface MergeBody {
  action?: 'merge' | 'split' | 'confirm' | 'create' | 'assign'
  householdId?: number
  intoHouseholdId?: number
  studentIds?: number[]
  displayName?: string
  phone?: string
}

const ACTIONS = ['merge', 'split', 'confirm', 'create', 'assign'] as const

/**
 * Manage who pays for whom.
 *
 *   create   start a new family (a parent), optionally with children and a phone
 *   assign   move children into an existing family
 *   split    pull children out into a family of their own
 *   merge    fold one family into another
 *   confirm  mark an automatic grouping as checked
 *
 * Merging is the dangerous direction — a wrong merge invents a family owing
 * several households' fees and floats it to the top of the call list — so it
 * is only ever driven by an explicit request naming both sides, never inferred.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const body = (await request.json().catch(() => null)) as MergeBody | null
  if (!body) return err('invalid JSON body')
  if (!body.action || !ACTIONS.includes(body.action)) {
    return err(`action must be one of: ${ACTIONS.join(', ')}`)
  }

  try {
    // --- Start a new family ------------------------------------------
    if (body.action === 'create') {
      const name = body.displayName?.trim()
      if (!name) return err('displayName is required — name the parent or the family')

      const phone = body.phone?.trim() ? normalizePhone(body.phone) : null
      if (body.phone?.trim() && !phone) {
        return err('that does not look like a valid phone number (10–15 digits)')
      }

      const created = await prisma.$transaction(async (tx) => {
        const household = await tx.household.create({
          data: {
            displayName: name,
            normalizedName: name.toLowerCase(),
            linkSource: 'manual',
            confirmedAt: new Date(),
            confirmedById: gate.user.id,
            ...(phone
              ? {
                  contacts: {
                    create: { phone, rawPhone: body.phone!.trim(), name, isPrimary: true },
                  },
                }
              : {}),
          },
        })
        if (body.studentIds?.length) {
          // upsert, not create: a child already in another family is MOVED
          // here rather than ending up in two places at once.
          for (const studentId of body.studentIds) {
            await tx.householdMember.upsert({
              where: { studentId },
              create: { studentId, householdId: household.id, linkSource: 'manual' },
              update: { householdId: household.id, linkSource: 'manual' },
            })
          }
        }
        return household
      })

      if (body.studentIds?.length) {
        await recomputeRecovery({ householdIds: [created.id] }).catch(() => {})
      }
      invalidateTags(TAGS.recovery)
      return ok({ data: created }, 201)
    }

    // --- Move children into an existing family -------------------------
    if (body.action === 'assign') {
      if (!Number.isInteger(body.householdId)) return err('householdId is required')
      if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) {
        return err('studentIds is required')
      }

      const household = await prisma.household.findUnique({
        where: { id: body.householdId! },
        select: { id: true },
      })
      if (!household) return err('family not found', 404)

      // Whichever families these children are leaving also need rescoring —
      // their outstanding total and child count have just changed.
      const previous = await prisma.householdMember.findMany({
        where: { studentId: { in: body.studentIds } },
        select: { householdId: true },
      })

      await prisma.$transaction(async (tx) => {
        for (const studentId of body.studentIds!) {
          await tx.householdMember.upsert({
            where: { studentId },
            create: { studentId, householdId: household.id, linkSource: 'manual' },
            update: { householdId: household.id, linkSource: 'manual' },
          })
        }
        await tx.household.update({
          where: { id: household.id },
          data: { linkSource: 'manual', needsReview: false, confirmedById: gate.user.id, confirmedAt: new Date() },
        })
      })

      const affected = [...new Set([household.id, ...previous.map((p) => p.householdId)])]
      await recomputeRecovery({ householdIds: affected }).catch(() => {})
      invalidateTags(TAGS.recovery)

      return ok({ data: { householdId: household.id, moved: body.studentIds.length } })
    }

    if (body.action === 'confirm') {
      if (!Number.isInteger(body.householdId)) return err('householdId is required')
      const household = await prisma.household.update({
        where: { id: body.householdId! },
        data: {
          needsReview: false,
          reviewNote: null,
          confirmedAt: new Date(),
          confirmedById: gate.user.id,
        },
      })
      return ok({ data: household })
    }

    if (body.action === 'merge') {
      if (!Number.isInteger(body.householdId) || !Number.isInteger(body.intoHouseholdId)) {
        return err('householdId and intoHouseholdId are required')
      }
      if (body.householdId === body.intoHouseholdId) {
        return err('cannot merge a household into itself')
      }

      const [source, target] = await Promise.all([
        prisma.household.findUnique({
          where: { id: body.householdId! },
          include: { members: true },
        }),
        prisma.household.findUnique({ where: { id: body.intoHouseholdId! } }),
      ])
      if (!source) return err('household not found', 404)
      if (!target) return err('target household not found', 404)

      await prisma.$transaction(async (tx) => {
        // Move the children, then the record of human contact. Profiles and
        // cases are derived, so they are simply dropped and rebuilt by the
        // next recompute rather than being merged arithmetically.
        await tx.householdMember.updateMany({
          where: { householdId: source.id },
          data: { householdId: target.id, linkSource: 'manual' },
        })
        await tx.contactAttempt.updateMany({
          where: { householdId: source.id },
          data: { householdId: target.id },
        })
        await tx.promiseToPay.updateMany({
          where: { householdId: source.id },
          data: { householdId: target.id },
        })
        await tx.householdContact.updateMany({
          where: { householdId: source.id },
          data: { householdId: target.id },
        })
        await tx.householdProfile.deleteMany({ where: { householdId: source.id } })
        await tx.recoveryCase.deleteMany({ where: { householdId: source.id } })
        await tx.household.delete({ where: { id: source.id } })
        await tx.household.update({
          where: { id: target.id },
          data: {
            linkSource: 'manual',
            needsReview: false,
            confirmedAt: new Date(),
            confirmedById: gate.user.id,
          },
        })
      })

      return ok({
        data: { merged: source.id, into: target.id, movedChildren: source.members.length },
        note: 'Run a recalculate to rebuild the merged household\'s profile.',
      })
    }

    // split
    if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) {
      return err('studentIds is required')
    }
    const members = await prisma.householdMember.findMany({
      where: { studentId: { in: body.studentIds } },
      include: { student: { select: { id: true, name: true, fatherName: true } } },
    })
    if (members.length === 0) return err('none of those students are in a household', 404)

    const first = members[0].student
    const created = await prisma.$transaction(async (tx) => {
      const household = await tx.household.create({
        data: {
          displayName: first.fatherName || first.name,
          normalizedName: (first.fatherName || first.name).toLowerCase().trim(),
          linkSource: 'manual',
          needsReview: false,
          confirmedAt: new Date(),
          confirmedById: gate.user.id,
        },
      })
      await tx.householdMember.updateMany({
        where: { studentId: { in: body.studentIds! } },
        data: { householdId: household.id, linkSource: 'manual' },
      })
      return household
    })

    return ok({
      data: created,
      note: 'Run a recalculate to build the new household\'s profile.',
    })
  } catch (e) {
    return handleError(e)
  }
}
