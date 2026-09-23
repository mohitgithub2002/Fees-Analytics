/**
 * The shape a recovery case takes on screen.
 *
 * Shared by the worklist and the parent page so a household never reads
 * differently depending on which screen you reached it from — same labels,
 * same evidence, same numbers.
 *
 * The include below is exported as a const so Prisma can infer the row type
 * from it (`CaseWithHousehold`), rather than every caller re-describing the
 * same nested selection and drifting from it.
 */
import { Prisma } from '@/generated/prisma/client'
import {
  ARCHETYPE_LABEL,
  STAGE_LABEL,
  TIER_LABEL,
  type EconomicTier,
  type PaymentArchetype,
  type RecoveryStage,
} from './types'

const MS_PER_DAY = 86_400_000

export const CASE_INCLUDE = {
  household: {
    select: {
      id: true,
      displayName: true,
      economicTier: true,
      tierNote: true,
      needsReview: true,
      reviewNote: true,
      linkSource: true,
      profile: {
        select: {
          archetype: true,
          carryConfidence: true,
          timingConfidence: true,
          suggestedTier: true,
          evidence: true,
          totalOutstanding: true,
          currentSessionDue: true,
          pastSessionsDue: true,
          lifetimeBilled: true,
          lifetimePaid: true,
          avgTicket: true,
          sessionsTracked: true,
          sessionsWithOpenDues: true,
          currentPaidRatio: true,
          timingProvenance: true,
          lastPaymentAt: true,
          lastPaymentAmount: true,
          onTimeInstallmentRate: true,
          avgDaysLate: true,
          monthHistogram: true,
          reliabilityScore: true,
          propensityScore: true,
          contactPickRate: true,
          promisesMade: true,
          promisesKept: true,
          childrenCount: true,
          reachableContacts: true,
        },
      },
      contacts: {
        orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          phone: true,
          rawPhone: true,
          relation: true,
          isPrimary: true,
          verification: true,
          lastReachedAt: true,
        },
      },
      promises: {
        where: { status: 'OPEN' },
        orderBy: { promisedFor: 'asc' },
        select: { id: true, amount: true, promisedFor: true },
      },
      members: {
        select: {
          student: {
            select: {
              id: true,
              name: true,
              enrollments: {
                orderBy: { session: { startDate: 'desc' } },
                take: 1,
                select: {
                  classroom: { select: { section: true, class: { select: { name: true } } } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.RecoveryCaseInclude

export type CaseWithHousehold = Prisma.RecoveryCaseGetPayload<{
  include: typeof CASE_INCLUDE
}>

function isToday(date: Date | null, today: Date): boolean {
  if (!date) return false
  return date >= today && date.getTime() < today.getTime() + MS_PER_DAY
}

/** Flatten a case into what a call card needs, with labels already resolved. */
export function shapeCase(c: CaseWithHousehold, today: Date) {
  const profile = c.household.profile
  const archetype = (profile?.archetype ?? 'UNKNOWN') as PaymentArchetype
  const tier = c.household.economicTier as EconomicTier
  const stage = c.stage as RecoveryStage
  const promise = c.household.promises[0]

  return {
    caseId: c.id,
    householdId: c.household.id,
    displayName: c.household.displayName,

    archetype,
    archetypeLabel: ARCHETYPE_LABEL[archetype] ?? archetype,
    carryConfidence: profile?.carryConfidence ?? 0,
    timingConfidence: profile?.timingConfidence ?? 0,
    timingProvenance: profile?.timingProvenance ?? 'NONE',

    tier,
    tierLabel: TIER_LABEL[tier] ?? tier,
    suggestedTier: profile?.suggestedTier ?? 'UNKNOWN',
    tierNote: c.household.tierNote,

    stage,
    stageLabel: STAGE_LABEL[stage] ?? stage,

    outstanding: Number(c.outstanding),
    currentSessionDue: Number(profile?.currentSessionDue ?? 0),
    pastSessionsDue: Number(profile?.pastSessionsDue ?? 0),
    expectedRecoveryValue: Number(c.expectedRecoveryValue),
    priorityScore: c.priorityScore,
    avgTicket: Number(profile?.avgTicket ?? 0),
    lastPaymentAt: profile?.lastPaymentAt ?? null,
    lastPaymentAmount: Number(profile?.lastPaymentAmount ?? 0),

    // Rendered verbatim by the UI: the owner has to be able to disagree with a
    // verdict out loud and see which rule produced it.
    evidence: Array.isArray(profile?.evidence) ? (profile.evidence as string[]) : [],

    suppressionRule: c.suppressionRule,
    suppressionReason: c.suppressionReason,
    suppressedUntil: c.suppressedUntil,
    snoozedUntil: c.snoozedUntil,
    parkedReason: c.parkedReason,
    isPinnedToday: isToday(c.pinnedForDate, today),

    lastContactAt: c.lastContactAt,
    contactCount: c.contactCount,
    contactPickRate: profile?.contactPickRate ?? 0,
    promisesMade: profile?.promisesMade ?? 0,
    promisesKept: profile?.promisesKept ?? 0,
    reliabilityScore: profile?.reliabilityScore ?? 0,

    openPromise: promise
      ? { id: promise.id, amount: Number(promise.amount), promisedFor: promise.promisedFor }
      : null,

    contacts: c.household.contacts,
    reachableContacts: profile?.reachableContacts ?? 0,
    needsReview: c.household.needsReview,
    reviewNote: c.household.reviewNote,
    children: c.household.members.map((m) => ({
      id: m.student.id,
      name: m.student.name,
      className: m.student.enrollments[0]?.classroom.class.name ?? null,
      section: m.student.enrollments[0]?.classroom.section ?? null,
    })),
  }
}

export type ShapedCase = ReturnType<typeof shapeCase>
