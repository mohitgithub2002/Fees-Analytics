import { NextRequest } from 'next/server'
import { $Enums } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { getCurrentUser } from '@/lib/auth/session'
import { OUTCOME_META } from '@/lib/recovery/types'

/**
 * Parent 360: everything a caller needs on one screen — dues across every
 * child, the behavioural profile and why it says what it says, the payment
 * timeline, and contact/promise history. Assembled from the ledger plus the
 * derived recovery tables; nothing here is computed live beyond simple sums.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const guardian = await prisma.guardian.findUnique({
    where: { id },
    include: {
      profile: true,
      students: {
        where: { isPayer: true },
        include: {
          student: {
            include: {
              enrollments: {
                orderBy: { session: { startDate: 'desc' } },
                include: {
                  session: { select: { id: true, name: true, isCurrent: true } },
                  classroom: { include: { class: { select: { name: true } } } },
                  feeItems: {
                    include: { installments: { orderBy: { sequence: 'asc' } } },
                  },
                },
              },
            },
          },
        },
      },
      contacts: { orderBy: { contactedAt: 'desc' }, take: 20 },
      promises: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })
  if (!guardian) return err('guardian not found', 404)

  const studentIds = guardian.students.map((gs) => gs.studentId)
  const transactions = studentIds.length
    ? await prisma.feeTransaction.findMany({
        where: { studentId: { in: studentIds }, status: 'COMPLETED' },
        orderBy: { paidAt: 'asc' },
        select: {
          id: true, receiptNo: true, studentId: true, category: true, amount: true,
          mode: true, paidAt: true, remarks: true,
        },
      })
    : []

  const children = guardian.students.map((gs) => {
    const totalDue = gs.student.enrollments.reduce(
      (sum, e) => sum + e.feeItems.reduce((s, f) => s + Number(f.dueAmount), 0),
      0
    )
    return {
      id: gs.student.id,
      name: gs.student.name,
      relation: gs.relation,
      enrollments: gs.student.enrollments.map((e) => ({
        id: e.id,
        session: e.session,
        class: e.classroom.class.name,
        section: e.classroom.section,
        feeItems: e.feeItems.map((f) => ({
          id: f.id,
          category: f.category,
          name: f.name,
          netAmount: Number(f.netAmount),
          paidAmount: Number(f.paidAmount),
          dueAmount: Number(f.dueAmount),
          installments: f.installments.map((i) => ({
            id: i.id,
            sequence: i.sequence,
            label: i.label,
            dueDate: i.dueDate,
            netAmount: Number(i.netAmount),
            paidAmount: Number(i.paidAmount),
            status: i.status,
          })),
        })),
      })),
      totalDue,
    }
  })

  const isDemoTiming = (receiptNo: string) =>
    receiptNo.startsWith('DEMO-') || receiptNo.startsWith('LEGACY-')

  return ok({
    id: guardian.id,
    name: guardian.name,
    phone: guardian.phone,
    altPhone: guardian.altPhone,
    relation: guardian.relation,
    occupation: guardian.occupation,
    address: guardian.address,
    notes: guardian.notes,
    economicTier: guardian.economicTier,
    tierSetAt: guardian.tierSetAt,
    tierNote: guardian.tierNote,
    profile: guardian.profile
      ? {
          ...guardian.profile,
          totalOutstanding: Number(guardian.profile.totalOutstanding),
          currentSessionDue: Number(guardian.profile.currentSessionDue),
          pastSessionsDue: Number(guardian.profile.pastSessionsDue),
          lifetimeBilled: Number(guardian.profile.lifetimeBilled),
          lifetimePaid: Number(guardian.profile.lifetimePaid),
          expectedRecovery30d: Number(guardian.profile.expectedRecovery30d),
          lastPaymentAmount:
            guardian.profile.lastPaymentAmount !== null
              ? Number(guardian.profile.lastPaymentAmount)
              : null,
          avgTicket: guardian.profile.avgTicket !== null ? Number(guardian.profile.avgTicket) : null,
        }
      : null,
    children,
    timeline: transactions.map((t) => ({
      id: t.id,
      receiptNo: t.receiptNo,
      studentId: t.studentId,
      category: t.category,
      amount: Number(t.amount),
      mode: t.mode,
      paidAt: t.paidAt,
      isEstimatedTiming: isDemoTiming(t.receiptNo),
    })),
    contacts: guardian.contacts.map((c) => ({
      id: c.id,
      channel: c.channel,
      outcome: c.outcome,
      outcomeLabel: OUTCOME_META[c.outcome]?.label ?? c.outcome,
      talkedTo: c.talkedTo,
      notes: c.notes,
      contactedAt: c.contactedAt,
      loggedByName: c.loggedByName,
    })),
    promises: guardian.promises.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      promisedFor: p.promisedFor,
      status: p.status,
      settledAmount: Number(p.settledAmount),
      notes: p.notes,
      createdAt: p.createdAt,
    })),
  })
}

const TIERS = new Set(Object.values($Enums.EconomicTier))

/** Confirm/override the economic tier, or edit contact details. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { economicTier, tierNote, phone, altPhone, occupation, address, notes } = body as {
    economicTier?: string
    tierNote?: string
    phone?: string
    altPhone?: string
    occupation?: string
    address?: string
    notes?: string
  }

  if (economicTier !== undefined && !TIERS.has(economicTier as never)) {
    return err(`economicTier must be one of ${[...TIERS].join(', ')}`)
  }

  try {
    const user = await getCurrentUser()
    const data: Record<string, unknown> = {}
    if (economicTier !== undefined) {
      data.economicTier = economicTier
      data.tierSetById = user?.id ?? null
      data.tierSetAt = new Date()
      if (tierNote !== undefined) data.tierNote = tierNote.trim() || null
    }
    if (phone !== undefined) data.phone = phone.trim() || null
    if (altPhone !== undefined) data.altPhone = altPhone.trim() || null
    if (occupation !== undefined) data.occupation = occupation.trim() || null
    if (address !== undefined) data.address = address.trim() || null
    if (notes !== undefined) data.notes = notes.trim() || null

    const guardian = await prisma.guardian.update({ where: { id }, data })
    invalidateTags(TAGS.recovery)
    return ok(guardian)
  } catch (e) {
    return handleError(e)
  }
}
