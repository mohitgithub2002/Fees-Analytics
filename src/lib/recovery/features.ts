/**
 * Turn the ledger into a HouseholdFeatures vector per household.
 *
 * THIS IS THE ONLY FILE IN THE MODULE THAT TALKS TO THE DATABASE. Everything
 * downstream — archetype, tier, propensity, suppression, forecast — is pure,
 * which is what lets the fixture harness drive the scoring with plain objects
 * and what keeps the rules readable as rules.
 *
 * Seven bulk queries cover the whole school, not seven per family. On ~530
 * households that is the difference between a page load and a coffee break.
 * Each query returns every household's rows at once and the per-household
 * folding happens in memory, because the dataset is small (a few thousand
 * transactions) and the folding logic — cumulative clearance, consecutive
 * unanswered calls, month histograms — reads far better as code than as
 * window functions.
 *
 * The ledger is READ-ONLY from here. Nothing in this file writes.
 */
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { isUndatedReceipt } from './provenance'
import type { EconomicTier, HouseholdFeatures, OpenPromise, TimingProvenance } from './types'

const MS_PER_DAY = 86_400_000

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY)
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// --- Raw query row shapes ---------------------------------------------

interface MoneyRow {
  householdId: number
  sessionId: number
  sessionStart: Date
  sessionEnd: Date
  billed: unknown
  paid: unknown
  due: unknown
  discount: unknown
  busBilled: unknown
}

interface TransactionRow {
  householdId: number
  paidAt: Date
  amount: unknown
  receiptNo: string
}

interface InstallmentRow {
  householdId: number
  dueDate: Date | null
  netAmount: unknown
  paidAmount: unknown
  status: string
  settledAt: Date | null
}

interface PastDueShareRow {
  householdId: number
  toPast: unknown
  total: unknown
}

export interface BuildFeaturesResult {
  features: Map<number, HouseholdFeatures>
  session: { id: number; name: string; startDate: Date; endDate: Date }
}

/**
 * Build the feature vector for every household, scoped to one session.
 *
 * `now` is injectable so a recompute can be replayed against a fixed point in
 * time — useful when scoring a past forecast against what actually arrived.
 *
 * `householdIds` narrows every query to a few families. The school-wide path
 * is the normal one; the narrow path exists so recording a payment can
 * refresh just that household synchronously, without making the cashier wait
 * for the whole school to be rescored.
 */
export async function buildFeatures(opts: {
  sessionId?: number
  now?: Date
  householdIds?: number[]
} = {}): Promise<BuildFeaturesResult> {
  const now = opts.now ?? new Date()
  const scopeIds = opts.householdIds
  // Appended to each raw query; Prisma.empty when the run is school-wide.
  const scope = scopeIds
    ? Prisma.sql`AND m."householdId" = ANY(${scopeIds}::int[])`
    : Prisma.empty

  const session = opts.sessionId
    ? await prisma.academicSession.findUnique({ where: { id: opts.sessionId } })
    : await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (!session) throw new Error('no current academic session')

  const sessionStart = session.startDate
  const sessionEnd = session.endDate
  const sessionSpan = Math.max(1, sessionEnd.getTime() - sessionStart.getTime())
  const sessionProgress = Math.min(
    1,
    Math.max(0, (now.getTime() - sessionStart.getTime()) / sessionSpan)
  )

  // --- 1. Households, their children and their reachable numbers -------
  const households = await prisma.household.findMany({
    where: { isActive: true, ...(scopeIds ? { id: { in: scopeIds } } : {}) },
    select: {
      id: true,
      displayName: true,
      economicTier: true,
      _count: { select: { members: true } },
      contacts: { select: { verification: true } },
    },
  })

  // --- 2. Money, per household per session ------------------------------
  const moneyRows = await prisma.$queryRaw<MoneyRow[]>`
    SELECT m."householdId"                                                     AS "householdId",
           e."sessionId"                                                       AS "sessionId",
           s."startDate"                                                       AS "sessionStart",
           s."endDate"                                                         AS "sessionEnd",
           COALESCE(SUM(f."netAmount"), 0)                                     AS "billed",
           COALESCE(SUM(f."paidAmount"), 0)                                    AS "paid",
           COALESCE(SUM(f."dueAmount"), 0)                                     AS "due",
           COALESCE(SUM(f."discountAmount"), 0)                                AS "discount",
           COALESCE(SUM(CASE WHEN f."category" = 'BUS' THEN f."netAmount" ELSE 0 END), 0) AS "busBilled"
    FROM "HouseholdMember" m
    JOIN "StudentEnrollment" e ON e."studentId" = m."studentId"
    JOIN "AcademicSession"   s ON s."id" = e."sessionId"
    LEFT JOIN "StudentFeeItem" f ON f."enrollmentId" = e."id"
    WHERE TRUE ${scope}
    GROUP BY m."householdId", e."sessionId", s."startDate", s."endDate"
  `

  // --- 3. Every completed payment ---------------------------------------
  const transactionRows = await prisma.$queryRaw<TransactionRow[]>`
    SELECT m."householdId" AS "householdId",
           t."paidAt"      AS "paidAt",
           t."amount"      AS "amount",
           t."receiptNo"   AS "receiptNo"
    FROM "HouseholdMember" m
    JOIN "FeeTransaction" t ON t."studentId" = m."studentId"
    WHERE t."status" = 'COMPLETED' ${scope}
    ORDER BY t."paidAt" ASC
  `

  // --- 4. Installments, with the date each was actually settled ---------
  // The settle date is the latest completed payment allocated to it, which is
  // the moment it stopped being owed.
  const installmentRows = await prisma.$queryRaw<InstallmentRow[]>`
    SELECT m."householdId"  AS "householdId",
           i."dueDate"      AS "dueDate",
           i."netAmount"    AS "netAmount",
           i."paidAmount"   AS "paidAmount",
           i."status"::text AS "status",
           st."settledAt"   AS "settledAt"
    FROM "HouseholdMember" m
    JOIN "StudentEnrollment" e ON e."studentId" = m."studentId"
    JOIN "StudentFeeItem"    f ON f."enrollmentId" = e."id"
    JOIN "FeeInstallment"    i ON i."feeItemId" = f."id"
    LEFT JOIN (
      SELECT ta."installmentId" AS "installmentId", MAX(t."paidAt") AS "settledAt"
      FROM "TransactionAllocation" ta
      JOIN "FeeTransaction" t ON t."id" = ta."transactionId"
      WHERE t."status" = 'COMPLETED'
      GROUP BY ta."installmentId"
    ) st ON st."installmentId" = i."id"
    WHERE TRUE ${scope}
  `

  // --- 5. Where this session's money actually went ----------------------
  // A family paying steadily into LAST year's bill while this year accrues
  // behind it looks identical to a good payer on totals alone. This is what
  // separates them.
  const pastDueRows = await prisma.$queryRaw<PastDueShareRow[]>`
    SELECT m."householdId" AS "householdId",
           COALESCE(SUM(CASE WHEN e."sessionId" <> ${session.id} THEN ta."amount" ELSE 0 END), 0) AS "toPast",
           COALESCE(SUM(ta."amount"), 0) AS "total"
    FROM "HouseholdMember" m
    JOIN "FeeTransaction"        t  ON t."studentId" = m."studentId" AND t."status" = 'COMPLETED'
    JOIN "TransactionAllocation" ta ON ta."transactionId" = t."id"
    JOIN "FeeInstallment"        i  ON i."id" = ta."installmentId"
    JOIN "StudentFeeItem"        f  ON f."id" = i."feeItemId"
    JOIN "StudentEnrollment"     e  ON e."id" = f."enrollmentId"
    WHERE t."paidAt" >= ${sessionStart} ${scope}
    GROUP BY m."householdId"
  `

  // --- 6. Contact history ------------------------------------------------
  const contactRows = await prisma.contactAttempt.findMany({
    where: scopeIds ? { householdId: { in: scopeIds } } : {},
    select: { householdId: true, outcome: true, contactedAt: true },
    orderBy: { contactedAt: 'asc' },
  })

  // --- 7. Promises -------------------------------------------------------
  const promiseRows = await prisma.promiseToPay.findMany({
    where: scopeIds ? { householdId: { in: scopeIds } } : {},
    select: { id: true, householdId: true, amount: true, promisedFor: true, status: true },
    orderBy: { promisedFor: 'asc' },
  })

  // ----------------------------------------------------------------------
  // Fold
  // ----------------------------------------------------------------------

  const moneyByHousehold = new Map<number, MoneyRow[]>()
  for (const row of moneyRows) {
    const list = moneyByHousehold.get(row.householdId)
    if (list) list.push(row)
    else moneyByHousehold.set(row.householdId, [row])
  }

  const txByHousehold = new Map<number, TransactionRow[]>()
  for (const row of transactionRows) {
    const list = txByHousehold.get(row.householdId)
    if (list) list.push(row)
    else txByHousehold.set(row.householdId, [row])
  }

  const instByHousehold = new Map<number, InstallmentRow[]>()
  for (const row of installmentRows) {
    const list = instByHousehold.get(row.householdId)
    if (list) list.push(row)
    else instByHousehold.set(row.householdId, [row])
  }

  const pastDueByHousehold = new Map<number, PastDueShareRow>()
  for (const row of pastDueRows) pastDueByHousehold.set(row.householdId, row)

  const contactsByHousehold = new Map<number, typeof contactRows>()
  for (const row of contactRows) {
    const list = contactsByHousehold.get(row.householdId)
    if (list) list.push(row)
    else contactsByHousehold.set(row.householdId, [row])
  }

  const promisesByHousehold = new Map<number, typeof promiseRows>()
  for (const row of promiseRows) {
    const list = promisesByHousehold.get(row.householdId)
    if (list) list.push(row)
    else promisesByHousehold.set(row.householdId, [row])
  }

  const features = new Map<number, HouseholdFeatures>()

  for (const h of households) {
    const money = moneyByHousehold.get(h.id) ?? []
    const txs = txByHousehold.get(h.id) ?? []
    const insts = instByHousehold.get(h.id) ?? []

    // --- Money ---------------------------------------------------------
    let currentSessionBilled = 0
    let currentSessionPaid = 0
    let currentSessionDue = 0
    let pastSessionsDue = 0
    let lifetimeBilled = 0
    let lifetimePaid = 0
    let lifetimeDiscount = 0
    let busBilled = 0
    let sessionsWithOpenDues = 0
    const sessionIds = new Set<number>()

    for (const row of money) {
      const billed = num(row.billed)
      const paid = num(row.paid)
      const due = num(row.due)

      sessionIds.add(row.sessionId)
      lifetimeBilled += billed
      lifetimePaid += paid
      lifetimeDiscount += num(row.discount)
      busBilled += num(row.busBilled)
      if (due > 0) sessionsWithOpenDues++

      if (row.sessionId === session.id) {
        currentSessionBilled += billed
        currentSessionPaid += paid
        currentSessionDue += due
      } else {
        pastSessionsDue += due
      }
    }

    const totalOutstanding = currentSessionDue + pastSessionsDue
    const currentPaidRatio =
      currentSessionBilled > 0 ? Math.min(1, currentSessionPaid / currentSessionBilled) : 0
    const discountShare =
      lifetimeBilled + lifetimeDiscount > 0
        ? lifetimeDiscount / (lifetimeBilled + lifetimeDiscount)
        : 0

    // rolloverStreak: how many past sessions ended still owing something.
    const rolloverStreak = money.filter(
      (r) => r.sessionId !== session.id && num(r.due) > 0
    ).length

    // --- Completed sessions ---------------------------------------------
    // Only a finished year can settle a pattern. These feed the year-end
    // rules so a family that clears every March is recognised in September
    // too, rather than being called "too early to say" for nine months of
    // every year.
    const finished = money.filter((r) => r.sessionEnd < now && num(r.billed) > 0)
    const avgEndPaidRatio =
      finished.length > 0
        ? finished.reduce((sum, r) => sum + Math.min(1, num(r.paid) / num(r.billed)), 0) /
          finished.length
        : null

    // --- Payment timing --------------------------------------------------
    const dated = txs.filter((t) => !isUndatedReceipt(t.receiptNo))
    const totalPaymentCount = txs.length
    const datedPaymentCount = dated.length

    let timingProvenance: TimingProvenance = 'NONE'
    if (datedPaymentCount > 0) {
      timingProvenance = datedPaymentCount === totalPaymentCount ? 'REAL' : 'PARTIAL'
    }

    const lastDated = dated.length > 0 ? dated[dated.length - 1] : null
    const lastPaymentAt = lastDated?.paidAt ?? null
    const lastPaymentAmount = lastDated ? num(lastDated.amount) : 0
    const daysSinceLastPayment = lastPaymentAt ? daysBetween(lastPaymentAt, now) : null

    const paidTotalForTicket = txs.reduce((sum, t) => sum + num(t.amount), 0)
    const avgTicket = totalPaymentCount > 0 ? paidTotalForTicket / totalPaymentCount : 0

    // Month histogram over dated payments only — an undated payment has no
    // month, and defaulting it to the import date would manufacture a spike.
    const monthHistogram: Record<string, number> = {}
    const datedTotal = dated.reduce((sum, t) => sum + num(t.amount), 0)
    if (datedTotal > 0) {
      for (const t of dated) {
        const key = String(t.paidAt.getMonth() + 1)
        monthHistogram[key] = (monthHistogram[key] ?? 0) + num(t.amount) / datedTotal
      }
    }

    // Within the current session: when did the first rupee arrive, and when
    // did they effectively finish?
    const inSession = dated.filter((t) => t.paidAt >= sessionStart && t.paidAt <= sessionEnd)
    const daysToFirstPayment =
      inSession.length > 0 ? daysBetween(sessionStart, inSession[0].paidAt) : null

    /** Day-of-session on which cumulative payments crossed 90% of the bill. */
    function clearanceWithin(start: Date, end: Date, billed: number): number | null {
      if (billed <= 0) return null
      const target = billed * 0.9
      let cumulative = 0
      for (const t of dated) {
        if (t.paidAt < start || t.paidAt > end) continue
        cumulative += num(t.amount)
        if (cumulative >= target) return daysBetween(start, t.paidAt)
      }
      return null
    }

    const clearanceDay = clearanceWithin(sessionStart, sessionEnd, currentSessionBilled)

    // The same reading, averaged over the years that have actually finished —
    // expressed as a fraction of the year so sessions of different lengths
    // stay comparable.
    const clearances = finished
      .map((r) => {
        const day = clearanceWithin(r.sessionStart, r.sessionEnd, num(r.billed))
        if (day === null) return null
        const span = Math.max(
          1,
          (r.sessionEnd.getTime() - r.sessionStart.getTime()) / MS_PER_DAY
        )
        return Math.min(1, Math.max(0, day / span))
      })
      .filter((v): v is number => v !== null)

    const avgClearanceProgress =
      clearances.length > 0
        ? clearances.reduce((sum, v) => sum + v, 0) / clearances.length
        : null

    // --- Installment punctuality ------------------------------------------
    let overdueAmount = 0
    let overdueInstallments = 0
    let datedSettled = 0
    let onTimeCount = 0
    let lateDaysTotal = 0
    let lateCount = 0

    for (const inst of insts) {
      const net = num(inst.netAmount)
      const paid = num(inst.paidAmount)
      const balance = net - paid

      if (inst.dueDate && inst.dueDate < now && balance > 0) {
        overdueAmount += balance
        overdueInstallments++
      }

      // Punctuality is only meaningful for a dated installment that was
      // actually settled; an undated one can be judged neither way.
      if (inst.dueDate && inst.status === 'PAID' && inst.settledAt) {
        datedSettled++
        if (inst.settledAt <= inst.dueDate) {
          onTimeCount++
        } else {
          lateCount++
          lateDaysTotal += daysBetween(inst.dueDate, inst.settledAt)
        }
      }
    }

    const onTimeInstallmentRate = datedSettled > 0 ? onTimeCount / datedSettled : null
    const avgDaysLate = lateCount > 0 ? lateDaysTotal / lateCount : datedSettled > 0 ? 0 : null

    // --- Is this year's money going to last year's bill? -------------------
    const pastDueRow = pastDueByHousehold.get(h.id)
    const pastDuePaid = pastDueRow ? num(pastDueRow.toPast) : 0
    const allPaidThisSession = pastDueRow ? num(pastDueRow.total) : 0
    const pastDuePaymentShare =
      allPaidThisSession > 0 ? pastDuePaid / allPaidThisSession : 0

    // --- Contact -----------------------------------------------------------
    const attempts = contactsByHousehold.get(h.id) ?? []
    const ANSWERED = new Set([
      'PROMISED',
      'PAID_ALREADY',
      'NEEDS_TIME',
      'REFUSED',
      'DISPUTED',
      'CALL_BACK_LATER',
    ])
    const contactAttempts = attempts.length
    const contactsAnswered = attempts.filter((a) => ANSWERED.has(a.outcome)).length
    const lastContactAt =
      attempts.length > 0 ? attempts[attempts.length - 1].contactedAt : null
    const daysSinceLastContact = lastContactAt ? daysBetween(lastContactAt, now) : null

    let consecutiveNoAnswer = 0
    for (let i = attempts.length - 1; i >= 0; i--) {
      if (ANSWERED.has(attempts[i].outcome)) break
      consecutiveNoAnswer++
    }

    const reachableContacts = h.contacts.filter(
      (c) => c.verification !== 'WRONG_NUMBER' && c.verification !== 'UNREACHABLE'
    ).length

    // --- Promises -----------------------------------------------------------
    const promises = promisesByHousehold.get(h.id) ?? []
    const promisesMade = promises.length
    const promisesKept = promises.filter(
      (p) => p.status === 'KEPT' || p.status === 'PARTIAL'
    ).length
    const promisesBroken = promises.filter((p) => p.status === 'BROKEN').length

    const openRow = promises.find((p) => p.status === 'OPEN')
    const openPromise: OpenPromise | null = openRow
      ? { id: openRow.id, amount: num(openRow.amount), promisedFor: openRow.promisedFor }
      : null

    features.set(h.id, {
      householdId: h.id,
      displayName: h.displayName,
      economicTier: h.economicTier as EconomicTier,
      childrenCount: h._count.members,

      totalOutstanding,
      currentSessionDue,
      currentSessionBilled,
      pastSessionsDue,
      overdueAmount,
      overdueInstallments,
      lifetimeBilled,
      lifetimePaid,
      avgTicket,
      discountShare,
      hasBusFee: busBilled > 0,

      sessionsTracked: sessionIds.size,
      sessionsWithOpenDues,
      currentPaidRatio,
      completedSessions: finished.length,
      avgEndPaidRatio,
      avgClearanceProgress,
      rolloverStreak,
      pastDuePaymentShare,

      timingProvenance,
      datedPaymentCount,
      totalPaymentCount,
      lastPaymentAt,
      lastPaymentAmount,
      daysSinceLastPayment,
      daysToFirstPayment,
      onTimeInstallmentRate,
      avgDaysLate,
      clearanceDay,
      monthHistogram,
      sessionProgress,

      reachableContacts,
      contactAttempts,
      contactsAnswered,
      contactPickRate: contactAttempts > 0 ? contactsAnswered / contactAttempts : 0,
      promisesMade,
      promisesKept,
      promisesBroken,
      lastContactAt,
      daysSinceLastContact,
      consecutiveNoAnswer,
      openPromise,
    })
  }

  return {
    features,
    session: {
      id: session.id,
      name: session.name,
      startDate: sessionStart,
      endDate: sessionEnd,
    },
  }
}

/**
 * How much of the school's payment timing is real.
 *
 * Every screen built on timing shows this, because an owner must never mistake
 * a reconstructed date for recorded history — and right now almost none of it
 * is real until the payment-history import has run.
 */
export function timingProvenance(features: Iterable<HouseholdFeatures>): {
  provenance: TimingProvenance
  datedPayments: number
  totalPayments: number
} {
  let dated = 0
  let total = 0
  for (const f of features) {
    dated += f.datedPaymentCount
    total += f.totalPaymentCount
  }
  if (total === 0 || dated === 0) return { provenance: 'NONE', datedPayments: dated, totalPayments: total }
  return {
    provenance: dated === total ? 'REAL' : 'PARTIAL',
    datedPayments: dated,
    totalPayments: total,
  }
}
