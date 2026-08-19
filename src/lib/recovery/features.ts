import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { toPaise } from '@/lib/fees/money'
import type { GuardianFeatures, SessionBehaviour } from './types'

/**
 * Feature extraction: the ledger, re-read as behaviour.
 *
 * Everything downstream — archetype, tier suggestion, propensity, forecast —
 * consumes `GuardianFeatures` and nothing else. Keeping the SQL in one place
 * means the rest of the module is pure functions that can be reasoned about
 * (and tested) without a database.
 *
 * The unit is the household, not the student: a father with three children is
 * one payer making one decision, and splitting him into three profiles would
 * both triple the call list and misread his behaviour.
 */

const DAY_MS = 86_400_000

const dayDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY_MS)

interface SessionRow {
  id: number
  name: string
  startDate: Date
  endDate: Date
  isCurrent: boolean
}

interface BillingRow {
  studentId: number
  sessionId: number
  billed: unknown
  paid: unknown
  due: unknown
  discount: unknown
  hasBus: boolean
}

interface AllocationRow {
  studentId: number
  paidAt: Date
  amount: unknown
  installmentId: number
  targetSessionId: number
}

interface InstallmentRow {
  studentId: number
  sessionId: number
  installmentId: number
  dueDate: Date | null
  netAmount: unknown
}

/**
 * Build the feature vector for every guardian (or a subset).
 *
 * Deliberately bulk: five queries for the whole school rather than five per
 * household. At a few hundred families the assembled maps fit comfortably in
 * memory, and a per-guardian version would turn a recompute into thousands of
 * round trips.
 */
export async function buildFeatures(
  guardianIds?: number[],
  now: Date = new Date()
): Promise<Map<number, GuardianFeatures>> {
  const guardianFilter = guardianIds?.length ? { guardianId: { in: guardianIds } } : {}

  const links = await prisma.guardianStudent.findMany({
    where: { ...guardianFilter, isPayer: true },
    select: { guardianId: true, studentId: true },
  })
  if (links.length === 0) return new Map()

  const studentIds = [...new Set(links.map((l) => l.studentId))]
  const studentsByGuardian = new Map<number, number[]>()
  for (const link of links) {
    const list = studentsByGuardian.get(link.guardianId) ?? []
    list.push(link.studentId)
    studentsByGuardian.set(link.guardianId, list)
  }

  const [sessions, billing, allocations, installments, contacts, promises] = await Promise.all([
    prisma.academicSession.findMany({
      orderBy: { startDate: 'asc' },
      select: { id: true, name: true, startDate: true, endDate: true, isCurrent: true },
    }),

    // Billed / paid / due per (student, session), summed across every fee item.
    prisma.$queryRaw<BillingRow[]>(Prisma.sql`
      SELECT e."studentId", e."sessionId",
             COALESCE(SUM(f."netAmount"), 0)      AS billed,
             COALESCE(SUM(f."paidAmount"), 0)     AS paid,
             COALESCE(SUM(f."dueAmount"), 0)      AS due,
             COALESCE(SUM(f."discountAmount"), 0) AS discount,
             COALESCE(BOOL_OR(f.category = 'BUS'), false) AS "hasBus"
      FROM "StudentEnrollment" e
      LEFT JOIN "StudentFeeItem" f ON f."enrollmentId" = e.id
      WHERE e."studentId" = ANY(${studentIds})
      GROUP BY e."studentId", e."sessionId"
    `),

    // Every rupee, with the day it arrived and the session it settled. The gap
    // between those two is what separates a late payer from a rollover.
    prisma.$queryRaw<AllocationRow[]>(Prisma.sql`
      SELECT t."studentId", t."paidAt", a.amount, a."installmentId",
             e."sessionId" AS "targetSessionId"
      FROM "TransactionAllocation" a
      JOIN "FeeTransaction"    t  ON t.id  = a."transactionId"
      JOIN "FeeInstallment"    i  ON i.id  = a."installmentId"
      JOIN "StudentFeeItem"    fi ON fi.id = i."feeItemId"
      JOIN "StudentEnrollment" e  ON e.id  = fi."enrollmentId"
      WHERE t."studentId" = ANY(${studentIds})
        AND t.status = 'COMPLETED'
      ORDER BY t."paidAt" ASC
    `),

    // The installment universe, including ones never paid — an installment that
    // was never touched is the most important kind of "not on time".
    prisma.$queryRaw<InstallmentRow[]>(Prisma.sql`
      SELECT e."studentId", e."sessionId", i.id AS "installmentId",
             i."dueDate", i."netAmount"
      FROM "FeeInstallment"    i
      JOIN "StudentFeeItem"    fi ON fi.id = i."feeItemId"
      JOIN "StudentEnrollment" e  ON e.id  = fi."enrollmentId"
      WHERE e."studentId" = ANY(${studentIds})
    `),

    prisma.contactAttempt.findMany({
      where: guardianIds?.length ? { guardianId: { in: guardianIds } } : {},
      select: { guardianId: true, outcome: true, contactedAt: true },
      orderBy: { contactedAt: 'desc' },
    }),

    prisma.promiseToPay.findMany({
      where: guardianIds?.length ? { guardianId: { in: guardianIds } } : {},
      select: {
        guardianId: true,
        status: true,
        amount: true,
        promisedFor: true,
        settledAmount: true,
      },
    }),
  ])

  const sessionById = new Map(sessions.map((s) => [s.id, s as SessionRow]))

  /* ── Index the bulk rows by student ─────────────────────────────────── */

  const billingByStudent = new Map<number, BillingRow[]>()
  for (const row of billing) {
    const list = billingByStudent.get(row.studentId) ?? []
    list.push(row)
    billingByStudent.set(row.studentId, list)
  }

  const allocByStudent = new Map<number, AllocationRow[]>()
  for (const row of allocations) {
    const list = allocByStudent.get(row.studentId) ?? []
    list.push(row)
    allocByStudent.set(row.studentId, list)
  }

  const instByStudent = new Map<number, InstallmentRow[]>()
  for (const row of installments) {
    const list = instByStudent.get(row.studentId) ?? []
    list.push(row)
    instByStudent.set(row.studentId, list)
  }

  // When each installment became fully settled, from its allocation history.
  const settledAt = settlementDates(allocations, installments)

  const contactsByGuardian = new Map<number, typeof contacts>()
  for (const row of contacts) {
    const list = contactsByGuardian.get(row.guardianId) ?? []
    list.push(row)
    contactsByGuardian.set(row.guardianId, list)
  }

  const promisesByGuardian = new Map<number, typeof promises>()
  for (const row of promises) {
    const list = promisesByGuardian.get(row.guardianId) ?? []
    list.push(row)
    promisesByGuardian.set(row.guardianId, list)
  }

  /* ── Assemble one feature vector per household ──────────────────────── */

  const out = new Map<number, GuardianFeatures>()
  for (const [guardianId, children] of studentsByGuardian) {
    out.set(
      guardianId,
      assembleGuardian({
        guardianId,
        children,
        sessionById,
        billingByStudent,
        allocByStudent,
        instByStudent,
        settledAt,
        contacts: contactsByGuardian.get(guardianId) ?? [],
        promises: promisesByGuardian.get(guardianId) ?? [],
        now,
      })
    )
  }
  return out
}

/**
 * The date each installment was fully covered. Allocations arrive oldest-first,
 * so the settling date is the paidAt of the allocation that pushes the running
 * total to the installment's net amount. Partially-paid installments never
 * settle and are treated as unpaid — half an installment is not "on time".
 */
function settlementDates(
  allocations: AllocationRow[],
  installments: InstallmentRow[]
): Map<number, Date> {
  const netByInstallment = new Map<number, number>()
  for (const inst of installments) {
    netByInstallment.set(inst.installmentId, toPaise(inst.netAmount as number))
  }

  const running = new Map<number, number>()
  const settled = new Map<number, Date>()
  for (const alloc of allocations) {
    const net = netByInstallment.get(alloc.installmentId)
    if (net === undefined || settled.has(alloc.installmentId)) continue
    const total = (running.get(alloc.installmentId) ?? 0) + toPaise(alloc.amount as number)
    running.set(alloc.installmentId, total)
    if (total >= net && net > 0) settled.set(alloc.installmentId, alloc.paidAt)
  }
  return settled
}

interface AssembleInput {
  guardianId: number
  children: number[]
  sessionById: Map<number, SessionRow>
  billingByStudent: Map<number, BillingRow[]>
  allocByStudent: Map<number, AllocationRow[]>
  instByStudent: Map<number, InstallmentRow[]>
  settledAt: Map<number, Date>
  contacts: { outcome: string; contactedAt: Date }[]
  promises: { status: string; amount: unknown; promisedFor: Date; settledAmount: unknown }[]
  now: Date
}

function assembleGuardian(input: AssembleInput): GuardianFeatures {
  const { guardianId, children, sessionById, settledAt, now } = input

  /* ── Per-session aggregation across all the household's children ────── */

  const perSession = new Map<
    number,
    { billed: number; paid: number; due: number; discount: number; hasBus: boolean }
  >()
  for (const studentId of children) {
    for (const row of input.billingByStudent.get(studentId) ?? []) {
      const agg = perSession.get(row.sessionId) ?? {
        billed: 0,
        paid: 0,
        due: 0,
        discount: 0,
        hasBus: false,
      }
      agg.billed += toPaise(row.billed as number)
      agg.paid += toPaise(row.paid as number)
      agg.due += toPaise(row.due as number)
      agg.discount += toPaise(row.discount as number)
      agg.hasBus = agg.hasBus || row.hasBus
      perSession.set(row.sessionId, agg)
    }
  }

  const allocs = children.flatMap((id) => input.allocByStudent.get(id) ?? [])
  allocs.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())

  const insts = children.flatMap((id) => input.instByStudent.get(id) ?? [])

  const sessionsBehaviour: SessionBehaviour[] = []
  for (const [sessionId, agg] of perSession) {
    const session = sessionById.get(sessionId)
    if (!session || agg.billed <= 0) continue

    const start = session.startDate
    const end = session.endDate
    const lengthDays = Math.max(1, dayDiff(end, start))
    const lastQuarterStart = new Date(end.getTime() - (lengthDays / 4) * DAY_MS)

    const targeting = allocs.filter((a) => a.targetSessionId === sessionId)
    const paidInSession = targeting.reduce((sum, a) => sum + toPaise(a.amount as number), 0)

    let firstPaymentDay: number | null = null
    let lastQuarterPaise = 0
    let afterEndPaise = 0
    let cumulative = 0
    let clearanceDay: number | null = null
    const clearanceTarget = agg.billed * 0.95

    for (const alloc of targeting) {
      const paise = toPaise(alloc.amount as number)
      if (firstPaymentDay === null) firstPaymentDay = dayDiff(alloc.paidAt, start)
      if (alloc.paidAt > end) afterEndPaise += paise
      else if (alloc.paidAt >= lastQuarterStart) lastQuarterPaise += paise
      cumulative += paise
      if (clearanceDay === null && cumulative >= clearanceTarget) {
        clearanceDay = dayDiff(alloc.paidAt, start)
      }
    }

    // Money this household paid DURING this session that settled an older
    // session's dues — the signature of the parent who is always a year behind.
    const paidTowardsPast = allocs
      .filter((a) => {
        if (a.paidAt < start || a.paidAt > end) return false
        const target = sessionById.get(a.targetSessionId)
        return !!target && target.startDate < start
      })
      .reduce((sum, a) => sum + toPaise(a.amount as number), 0)

    /* Installment punctuality, counting only installments already owed. */
    const sessionInsts = insts.filter((i) => i.sessionId === sessionId && i.dueDate)
    let due = 0
    let onTime = 0
    const lateDays: number[] = []
    for (const inst of sessionInsts) {
      const dueDate = inst.dueDate!
      if (dueDate > now) continue // not owed yet — neither on time nor late
      due++
      const settled = settledAt.get(inst.installmentId)
      if (settled && settled <= dueDate) onTime++
      else if (settled) lateDays.push(dayDiff(settled, dueDate))
    }

    sessionsBehaviour.push({
      sessionId,
      sessionName: session.name,
      startDate: start,
      endDate: end,
      isCurrent: session.isCurrent,
      lengthDays,
      billedPaise: agg.billed,
      paidPaise: agg.paid,
      duePaise: agg.due,
      paidRatio: agg.billed > 0 ? agg.paid / agg.billed : 1,
      firstPaymentDay,
      clearanceDay,
      lastQuarterShare: paidInSession > 0 ? lastQuarterPaise / paidInSession : 0,
      paymentCount: targeting.length,
      paidTowardsPastPaise: paidTowardsPast,
      paidAfterSessionEndPaise: afterEndPaise,
      installmentsDue: due,
      installmentsPaidOnTime: onTime,
      avgDaysLate: lateDays.length
        ? Math.round(lateDays.reduce((a, b) => a + b, 0) / lateDays.length)
        : null,
    })
  }

  sessionsBehaviour.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
  const current = sessionsBehaviour.find((s) => s.isCurrent) ?? null
  const closed = sessionsBehaviour.filter((s) => !s.isCurrent)

  /* ── Lifetime rollups ───────────────────────────────────────────────── */

  const lifetimeBilled = sessionsBehaviour.reduce((s, x) => s + x.billedPaise, 0)
  const lifetimePaid = sessionsBehaviour.reduce((s, x) => s + x.paidPaise, 0)
  const totalOutstanding = sessionsBehaviour.reduce((s, x) => s + x.duePaise, 0)
  const pastDue = closed.reduce((s, x) => s + x.duePaise, 0)
  const openDueSessions = sessionsBehaviour.filter((s) => s.duePaise > 0).length

  // Consecutive closed sessions, newest backwards, that ended still owing.
  let rolloverStreak = 0
  for (let i = closed.length - 1; i >= 0; i--) {
    if (closed[i].duePaise > 0) rolloverStreak++
    else break
  }

  /* ── Payment cadence and seasonality ────────────────────────────────── */

  // Allocations share a transaction, so collapse to distinct payment events
  // before measuring ticket size — otherwise a payment split across four
  // installments reads as four small payments.
  const byMoment = new Map<number, number>()
  for (const alloc of allocs) {
    const key = alloc.paidAt.getTime()
    byMoment.set(key, (byMoment.get(key) ?? 0) + toPaise(alloc.amount as number))
  }
  const payments = [...byMoment.entries()]
    .map(([time, paise]) => ({ at: new Date(time), paise }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())

  const lastPayment = payments.length ? payments[payments.length - 1] : null
  const avgTicket = payments.length
    ? Math.round(payments.reduce((s, p) => s + p.paise, 0) / payments.length)
    : null
  const avgSessionBilling = sessionsBehaviour.length
    ? lifetimeBilled / sessionsBehaviour.length
    : 0

  const monthHistogram: Record<string, number> = {}
  const totalPaid = payments.reduce((s, p) => s + p.paise, 0)
  if (totalPaid > 0) {
    for (const p of payments) {
      const month = String(p.at.getMonth() + 1)
      monthHistogram[month] = (monthHistogram[month] ?? 0) + p.paise / totalPaid
    }
  }

  const firstPaymentDays = closed
    .map((s) => s.firstPaymentDay)
    .filter((d): d is number => d !== null)
  const clearanceDays = closed.map((s) => s.clearanceDay).filter((d): d is number => d !== null)

  const totalInstDue = sessionsBehaviour.reduce((s, x) => s + x.installmentsDue, 0)
  const totalOnTime = sessionsBehaviour.reduce((s, x) => s + x.installmentsPaidOnTime, 0)
  const lateSessions = sessionsBehaviour.filter((s) => s.avgDaysLate !== null)

  /* ── Contact and promise history ────────────────────────────────────── */

  const REACHED = new Set([
    'PROMISED',
    'PAID_ALREADY',
    'NEEDS_TIME',
    'REFUSED',
    'DISPUTED',
    'CALL_BACK_LATER',
  ])
  // input.contacts arrives newest-first.
  const reached = input.contacts.filter((c) => REACHED.has(c.outcome)).length
  let consecutiveNoAnswer = 0
  for (const c of input.contacts) {
    if (REACHED.has(c.outcome)) break
    consecutiveNoAnswer++
  }

  const openPromise = input.promises
    .filter((p) => p.status === 'OPEN')
    .sort((a, b) => a.promisedFor.getTime() - b.promisedFor.getTime())[0]

  const discountTotal = [...perSession.values()].reduce((s, x) => s + x.discount, 0)

  return {
    guardianId,
    childrenCount: children.length,
    sessions: sessionsBehaviour,
    closedSessions: closed,
    current,

    lifetimeBilledPaise: lifetimeBilled,
    lifetimePaidPaise: lifetimePaid,
    totalOutstandingPaise: totalOutstanding,
    currentSessionDuePaise: current?.duePaise ?? 0,
    pastSessionsDuePaise: pastDue,

    sessionsTracked: sessionsBehaviour.length,
    sessionsWithDues: sessionsBehaviour.filter((s) => s.duePaise > 0).length,
    rolloverStreak,
    openDueSessions,

    lastPaymentAt: lastPayment?.at ?? null,
    lastPaymentPaise: lastPayment?.paise ?? null,
    daysSinceLastPayment: lastPayment ? dayDiff(now, lastPayment.at) : null,
    avgTicketPaise: avgTicket,
    avgTicketShare: avgTicket && avgSessionBilling > 0 ? avgTicket / avgSessionBilling : null,

    avgDaysToFirstPayment: firstPaymentDays.length
      ? Math.round(firstPaymentDays.reduce((a, b) => a + b, 0) / firstPaymentDays.length)
      : null,
    avgClearanceDay: clearanceDays.length
      ? Math.round(clearanceDays.reduce((a, b) => a + b, 0) / clearanceDays.length)
      : null,
    onTimeInstallmentRate: totalInstDue > 0 ? Math.round((totalOnTime / totalInstDue) * 100) : null,
    avgDaysLate: lateSessions.length
      ? Math.round(
          lateSessions.reduce((s, x) => s + (x.avgDaysLate ?? 0), 0) / lateSessions.length
        )
      : null,

    monthHistogram,

    hasBusFee: [...perSession.values()].some((s) => s.hasBus),
    discountShare: lifetimeBilled + discountTotal > 0
      ? discountTotal / (lifetimeBilled + discountTotal)
      : 0,

    contactAttempts: input.contacts.length,
    contactsReached: reached,
    consecutiveNoAnswer,
    lastContactAt: input.contacts[0]?.contactedAt ?? null,
    promisesMade: input.promises.length,
    promisesKept: input.promises.filter((p) => p.status === 'KEPT' || p.status === 'PARTIAL').length,
    promisesBroken: input.promises.filter((p) => p.status === 'BROKEN').length,
    hasOpenPromise: !!openPromise,
    openPromiseDate: openPromise?.promisedFor ?? null,
    openPromisePaise: openPromise
      ? toPaise(openPromise.amount as number) - toPaise(openPromise.settledAmount as number)
      : 0,
  }
}
