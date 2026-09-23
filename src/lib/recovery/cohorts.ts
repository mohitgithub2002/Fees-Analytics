/**
 * The analytical lenses — reading the ledger rather than scoring it.
 *
 * features.ts owns the SQL on the scoring path; this file owns the SQL behind
 * the behaviour screens. They are kept apart because they answer different
 * questions and fail differently: a bug here produces a wrong chart, a bug
 * there produces a wrong call list.
 *
 * Every lens reports what it could NOT see alongside what it found. An
 * installment chart drawn from installments that have no due dates, or a
 * seasonality chart drawn from payments that all carry the import date, looks
 * exactly as confident as a real one — and quietly teaches the owner something
 * false. So each result carries a `coverage` block, and the screens render it.
 */
import { prisma } from '@/lib/prisma'
import type { $Enums } from '@/generated/prisma/client'
import { UNDATED_RECEIPT_REGEX } from './provenance'


const UNDATED_PREFIX = UNDATED_RECEIPT_REGEX

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function resolveSession(sessionId?: number) {
  const session = sessionId
    ? await prisma.academicSession.findUnique({ where: { id: sessionId } })
    : await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (!session) throw new Error('no current academic session')
  return session
}

// =====================================================================
// 1. Installments — which one underperforms, and by how much?
// =====================================================================

export interface InstallmentBand {
  sequence: number
  label: string
  billed: number
  collected: number
  collectedOnTime: number
  collectedLate: number
  outstanding: number
  installments: number
  dated: number
  paidCount: number
  onTimeCount: number
  lateCount: number
  unpaidCount: number
  medianDaysLate: number | null
  collectionRate: number
}

export interface InstallmentLens {
  session: { id: number; name: string }
  category: $Enums.FeeCategory
  bands: InstallmentBand[]
  coverage: {
    datedInstallments: number
    totalInstallments: number
    /** True when no installment carries a due date — on-time is unanswerable. */
    noDueDates: boolean
    message: string | null
  }
}

/**
 * Per installment number: what was billed, what arrived, and how much of it
 * arrived on time.
 *
 * Scoped to one category because school fees are split into three installments
 * while bus and other fees get one each — mixing them would pile every
 * single-installment fee onto "installment 1" and make it look like the
 * strongest performer in the school.
 */
export async function installmentBehaviour(opts: {
  sessionId?: number
  category?: $Enums.FeeCategory
} = {}): Promise<InstallmentLens> {
  const session = await resolveSession(opts.sessionId)
  const category = opts.category ?? 'SCHOOL'

  const totals = await prisma.$queryRaw<
    {
      sequence: number
      label: string
      billed: unknown
      collected: unknown
      outstanding: unknown
      installments: bigint
      dated: bigint
      paidCount: bigint
      unpaidCount: bigint
    }[]
  >`
    SELECT i."sequence"                                                    AS "sequence",
           MIN(i."label")                                                  AS "label",
           COALESCE(SUM(i."netAmount"), 0)                                 AS "billed",
           COALESCE(SUM(i."paidAmount"), 0)                                AS "collected",
           COALESCE(SUM(i."netAmount" - i."paidAmount"), 0)                AS "outstanding",
           COUNT(*)                                                        AS "installments",
           COUNT(*) FILTER (WHERE i."dueDate" IS NOT NULL)                 AS "dated",
           COUNT(*) FILTER (WHERE i."status" = 'PAID')                     AS "paidCount",
           COUNT(*) FILTER (WHERE i."status" <> 'PAID')                    AS "unpaidCount"
    FROM "FeeInstallment"    i
    JOIN "StudentFeeItem"    f ON f."id" = i."feeItemId"
    JOIN "StudentEnrollment" e ON e."id" = f."enrollmentId"
    WHERE e."sessionId" = ${session.id}
      AND f."category" = ${category}::"FeeCategory"
    GROUP BY i."sequence"
    ORDER BY i."sequence"
  `

  // Punctuality, measured at allocation level: the same installment can be
  // part-paid before its due date and finished after it, and both halves
  // deserve to land in the right column.
  const timing = await prisma.$queryRaw<
    { sequence: number; onTime: unknown; late: unknown; lateDays: number[] }[]
  >`
    SELECT i."sequence" AS "sequence",
           COALESCE(SUM(CASE WHEN t."paidAt" <= i."dueDate" THEN ta."amount" ELSE 0 END), 0) AS "onTime",
           COALESCE(SUM(CASE WHEN t."paidAt" >  i."dueDate" THEN ta."amount" ELSE 0 END), 0) AS "late",
           COALESCE(
             ARRAY_AGG(
               ROUND(EXTRACT(EPOCH FROM (t."paidAt" - i."dueDate")) / 86400)::int
               ORDER BY t."paidAt"
             ) FILTER (WHERE t."paidAt" > i."dueDate"),
             ARRAY[]::int[]
           ) AS "lateDays"
    FROM "FeeInstallment"        i
    JOIN "StudentFeeItem"        f  ON f."id" = i."feeItemId"
    JOIN "StudentEnrollment"     e  ON e."id" = f."enrollmentId"
    JOIN "TransactionAllocation" ta ON ta."installmentId" = i."id"
    JOIN "FeeTransaction"        t  ON t."id" = ta."transactionId"
                                   AND t."status" = 'COMPLETED'
                                   AND t."receiptNo" !~ ${UNDATED_PREFIX}
    WHERE e."sessionId" = ${session.id}
      AND f."category" = ${category}::"FeeCategory"
      AND i."dueDate" IS NOT NULL
    GROUP BY i."sequence"
  `
  const timingBySeq = new Map(timing.map((t) => [t.sequence, t]))

  let datedInstallments = 0
  let totalInstallments = 0

  const bands: InstallmentBand[] = totals.map((row) => {
    const t = timingBySeq.get(row.sequence)
    const lateDays = t?.lateDays ?? []
    const sorted = [...lateDays].sort((a, b) => a - b)
    const medianDaysLate =
      sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null

    const billed = num(row.billed)
    const collected = num(row.collected)
    datedInstallments += Number(row.dated)
    totalInstallments += Number(row.installments)

    return {
      sequence: row.sequence,
      label: row.label,
      billed,
      collected,
      collectedOnTime: num(t?.onTime),
      collectedLate: num(t?.late),
      outstanding: num(row.outstanding),
      installments: Number(row.installments),
      dated: Number(row.dated),
      paidCount: Number(row.paidCount),
      onTimeCount: sorted.length === 0 ? Number(row.paidCount) : Number(row.paidCount) - sorted.length,
      lateCount: sorted.length,
      unpaidCount: Number(row.unpaidCount),
      medianDaysLate,
      collectionRate: billed > 0 ? collected / billed : 0,
    }
  })

  const noDueDates = datedInstallments === 0
  return {
    session: { id: session.id, name: session.name },
    category,
    bands,
    coverage: {
      datedInstallments,
      totalInstallments,
      noDueDates,
      message: noDueDates
        ? 'No installment has a due date, so "on time" and "late" cannot be worked out. Add a schedule at Setup → Fee Structures, then run the due-date backfill.'
        : datedInstallments < totalInstallments
          ? `${totalInstallments - datedInstallments} of ${totalInstallments} installments have no due date and are left out of the on-time figures.`
          : null,
    },
  }
}

// =====================================================================
// 2. Months — when does the money actually arrive?
// =====================================================================

export interface MonthlyPoint {
  month: string
  year: number
  monthOfYear: number
  total: number
  currentSession: number
  arrears: number
  school: number
  bus: number
  other: number
  payments: number
}

export interface MonthlyLens {
  session: { id: number; name: string }
  points: MonthlyPoint[]
  coverage: {
    datedPayments: number
    totalPayments: number
    message: string | null
  }
}

/**
 * Collection by calendar month, separating this year's fees from arrears.
 *
 * Undated legacy receipts are excluded rather than bucketed: they all carry
 * the import run's timestamp, so including them would stack the entire
 * school's history onto a single month and invent a seasonal spike that never
 * happened.
 */
export async function monthlyCollection(opts: { sessionId?: number } = {}): Promise<MonthlyLens> {
  const session = await resolveSession(opts.sessionId)

  const rows = await prisma.$queryRaw<
    {
      month: Date
      total: unknown
      currentSession: unknown
      arrears: unknown
      school: unknown
      bus: unknown
      other: unknown
      payments: bigint
    }[]
  >`
    SELECT DATE_TRUNC('month', t."paidAt")                                            AS "month",
           COALESCE(SUM(ta."amount"), 0)                                              AS "total",
           COALESCE(SUM(CASE WHEN e."sessionId" =  ${session.id} THEN ta."amount" ELSE 0 END), 0) AS "currentSession",
           COALESCE(SUM(CASE WHEN e."sessionId" <> ${session.id} THEN ta."amount" ELSE 0 END), 0) AS "arrears",
           COALESCE(SUM(CASE WHEN f."category" = 'SCHOOL' THEN ta."amount" ELSE 0 END), 0) AS "school",
           COALESCE(SUM(CASE WHEN f."category" = 'BUS'    THEN ta."amount" ELSE 0 END), 0) AS "bus",
           COALESCE(SUM(CASE WHEN f."category" = 'OTHER'  THEN ta."amount" ELSE 0 END), 0) AS "other",
           COUNT(DISTINCT t."id")                                                     AS "payments"
    FROM "FeeTransaction"        t
    JOIN "TransactionAllocation" ta ON ta."transactionId" = t."id"
    JOIN "FeeInstallment"        i  ON i."id" = ta."installmentId"
    JOIN "StudentFeeItem"        f  ON f."id" = i."feeItemId"
    JOIN "StudentEnrollment"     e  ON e."id" = f."enrollmentId"
    WHERE t."status" = 'COMPLETED'
      AND t."receiptNo" !~ ${UNDATED_PREFIX}
    GROUP BY 1
    ORDER BY 1
  `

  const [{ dated, total }] = await prisma.$queryRaw<{ dated: bigint; total: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE "receiptNo" !~ ${UNDATED_PREFIX}) AS "dated",
           COUNT(*)                                                      AS "total"
    FROM "FeeTransaction" WHERE "status" = 'COMPLETED'
  `

  const datedPayments = Number(dated)
  const totalPayments = Number(total)

  return {
    session: { id: session.id, name: session.name },
    points: rows.map((r) => ({
      month: r.month.toISOString().slice(0, 7),
      year: r.month.getFullYear(),
      monthOfYear: r.month.getMonth() + 1,
      total: num(r.total),
      currentSession: num(r.currentSession),
      arrears: num(r.arrears),
      school: num(r.school),
      bus: num(r.bus),
      other: num(r.other),
      payments: Number(r.payments),
    })),
    coverage: {
      datedPayments,
      totalPayments,
      message:
        datedPayments === 0
          ? 'No payment carries a real date yet — every recorded payment is a legacy import stamped with the migration date. Import your payment history to see when money actually arrives.'
          : datedPayments < totalPayments
            ? `${totalPayments - datedPayments} of ${totalPayments} payments have no real date and are left out of this chart.`
            : null,
    },
  }
}

// =====================================================================
// 3. Classes — who pays more, about average, or less?
// =====================================================================

export interface ClassCohort {
  classId: number
  className: string
  students: number
  billed: number
  collected: number
  outstanding: number
  collectionRate: number
  /** Paid 90% or more of what they were billed. */
  paidMost: number
  /** Between half and 90%. */
  paidAbout: number
  /** Less than half. */
  paidLittle: number
  /** Billed nothing at all — excluded from the three buckets above. */
  unbilled: number
  avgBilledPerStudent: number
  avgPaidPerStudent: number
}

export interface ClassLens {
  session: { id: number; name: string }
  classes: ClassCohort[]
}

/**
 * Per class, the spread of payers rather than just the total.
 *
 * A class total hides the shape: two classes can both sit at 60% collected,
 * one because everybody paid roughly 60%, the other because half paid in full
 * and half paid nothing. Those are completely different problems, and only the
 * second is a call list.
 */
export async function classCohorts(opts: { sessionId?: number } = {}): Promise<ClassLens> {
  const session = await resolveSession(opts.sessionId)

  const rows = await prisma.$queryRaw<
    {
      classId: number
      className: string
      students: bigint
      billed: unknown
      collected: unknown
      outstanding: unknown
      paidMost: bigint
      paidAbout: bigint
      paidLittle: bigint
      unbilled: bigint
    }[]
  >`
    WITH per_student AS (
      SELECT c."id"                            AS "classId",
             c."name"                          AS "className",
             c."displayOrder"                  AS "displayOrder",
             e."studentId"                     AS "studentId",
             COALESCE(SUM(f."netAmount"), 0)   AS "billed",
             COALESCE(SUM(f."paidAmount"), 0)  AS "collected",
             COALESCE(SUM(f."dueAmount"), 0)   AS "outstanding"
      FROM "StudentEnrollment" e
      JOIN "Classroom"         cr ON cr."id" = e."classroomId"
      JOIN "SchoolClass"       c  ON c."id" = cr."classId"
      LEFT JOIN "StudentFeeItem" f ON f."enrollmentId" = e."id"
      WHERE e."sessionId" = ${session.id}
      GROUP BY c."id", c."name", c."displayOrder", e."studentId"
    )
    SELECT "classId",
           "className",
           COUNT(*)                                                             AS "students",
           COALESCE(SUM("billed"), 0)                                           AS "billed",
           COALESCE(SUM("collected"), 0)                                        AS "collected",
           COALESCE(SUM("outstanding"), 0)                                      AS "outstanding",
           COUNT(*) FILTER (WHERE "billed" > 0 AND "collected" / "billed" >= 0.9) AS "paidMost",
           COUNT(*) FILTER (WHERE "billed" > 0 AND "collected" / "billed" >= 0.5
                                                AND "collected" / "billed" <  0.9) AS "paidAbout",
           COUNT(*) FILTER (WHERE "billed" > 0 AND "collected" / "billed" <  0.5) AS "paidLittle",
           COUNT(*) FILTER (WHERE "billed" <= 0)                                AS "unbilled"
    FROM per_student
    GROUP BY "classId", "className", "displayOrder"
    ORDER BY "displayOrder"
  `

  return {
    session: { id: session.id, name: session.name },
    classes: rows.map((r) => {
      const students = Number(r.students)
      const billed = num(r.billed)
      const collected = num(r.collected)
      return {
        classId: r.classId,
        className: r.className,
        students,
        billed,
        collected,
        outstanding: num(r.outstanding),
        collectionRate: billed > 0 ? collected / billed : 0,
        paidMost: Number(r.paidMost),
        paidAbout: Number(r.paidAbout),
        paidLittle: Number(r.paidLittle),
        unbilled: Number(r.unbilled),
        avgBilledPerStudent: students > 0 ? billed / students : 0,
        avgPaidPerStudent: students > 0 ? collected / students : 0,
      }
    }),
  }
}

// =====================================================================
// 4. Segments — the targeting map
// =====================================================================

export interface SegmentCell {
  archetype: string
  tier: string
  households: number
  children: number
  outstanding: number
  expectedRecovery: number
}

export interface SegmentLens {
  cells: SegmentCell[]
  totals: { households: number; outstanding: number; expectedRecovery: number }
  untaggedHouseholds: number
  untaggedOutstanding: number
}

/**
 * How a household pays, crossed with whether it can.
 *
 * This is the map the whole module exists to draw. Ranking on outstanding
 * alone cannot separate "they have it and are slow" from "they have nothing" —
 * and those two quadrants want completely different work: a phone call, and a
 * payment plan.
 */
export async function segmentMatrix(): Promise<SegmentLens> {
  const rows = await prisma.$queryRaw<
    {
      archetype: string
      tier: string
      households: bigint
      children: bigint
      outstanding: unknown
      expectedRecovery: unknown
    }[]
  >`
    SELECT p."archetype"::text                            AS "archetype",
           h."economicTier"::text                         AS "tier",
           COUNT(*)                                       AS "households",
           COALESCE(SUM(p."childrenCount"), 0)            AS "children",
           COALESCE(SUM(p."totalOutstanding"), 0)         AS "outstanding",
           COALESCE(SUM(p."expectedRecovery30d"), 0)      AS "expectedRecovery"
    FROM "HouseholdProfile" p
    JOIN "Household"        h ON h."id" = p."householdId"
    WHERE h."isActive" = true
    GROUP BY 1, 2
  `

  const cells = rows.map((r) => ({
    archetype: r.archetype,
    tier: r.tier,
    households: Number(r.households),
    children: Number(r.children),
    outstanding: num(r.outstanding),
    expectedRecovery: num(r.expectedRecovery),
  }))

  const untagged = cells.filter((c) => c.tier === 'UNKNOWN')

  return {
    cells,
    totals: {
      households: cells.reduce((n, c) => n + c.households, 0),
      outstanding: cells.reduce((n, c) => n + c.outstanding, 0),
      expectedRecovery: cells.reduce((n, c) => n + c.expectedRecovery, 0),
    },
    untaggedHouseholds: untagged.reduce((n, c) => n + c.households, 0),
    untaggedOutstanding: untagged.reduce((n, c) => n + c.outstanding, 0),
  }
}

// =====================================================================
// 5. Effectiveness — is reaching out worth the effort?
// =====================================================================

/** How long after a call a payment still counts as having come from it. */
const ATTRIBUTION_DAYS = 14

export interface EffectivenessRow {
  segment: string
  calls: number
  answered: number
  answerRate: number
  promises: number
  promisesKept: number
  promiseKeptRate: number
  recovered: number
  recoveredPerCall: number
}

export interface EffectivenessLens {
  byArchetype: EffectivenessRow[]
  byTier: EffectivenessRow[]
  overall: EffectivenessRow
  attributionDays: number
  coverage: { message: string | null }
}

/**
 * What calling actually produced, per segment.
 *
 * This closes the loop the rest of the module opens. Everything upstream is a
 * prediction about who is worth calling; this is the only place that checks
 * whether the calls worked — measured as money that arrived within
 * ATTRIBUTION_DAYS of somebody picking up the phone.
 *
 * Each payment is attributed to at most ONE call: the most recent one before
 * it inside the window. Summing a window per call instead would count the same
 * rupee once for every call that preceded it and make every segment look
 * excellent.
 */
export async function contactEffectiveness(): Promise<EffectivenessLens> {
  const contacts = await prisma.contactAttempt.findMany({
    select: { householdId: true, outcome: true, contactedAt: true },
    orderBy: { contactedAt: 'asc' },
  })

  if (contacts.length === 0) {
    const empty: EffectivenessRow = {
      segment: 'All',
      calls: 0,
      answered: 0,
      answerRate: 0,
      promises: 0,
      promisesKept: 0,
      promiseKeptRate: 0,
      recovered: 0,
      recoveredPerCall: 0,
    }
    return {
      byArchetype: [],
      byTier: [],
      overall: empty,
      attributionDays: ATTRIBUTION_DAYS,
      coverage: {
        message:
          'No calls have been logged yet. Once you start logging outcomes on the worklist, this shows which kinds of families actually pay after a call — and which are not worth the time.',
      },
    }
  }

  const profiles = await prisma.householdProfile.findMany({
    select: { householdId: true, archetype: true, household: { select: { economicTier: true } } },
  })
  const segmentOf = new Map(
    profiles.map((p) => [
      p.householdId,
      { archetype: String(p.archetype), tier: String(p.household.economicTier) },
    ])
  )

  const payments = await prisma.$queryRaw<
    { householdId: number; paidAt: Date; amount: unknown }[]
  >`
    SELECT m."householdId" AS "householdId", t."paidAt" AS "paidAt", t."amount" AS "amount"
    FROM "HouseholdMember" m
    JOIN "FeeTransaction" t ON t."studentId" = m."studentId"
    WHERE t."status" = 'COMPLETED' AND t."receiptNo" !~ ${UNDATED_PREFIX}
    ORDER BY t."paidAt" ASC
  `

  const contactsByHousehold = new Map<number, Date[]>()
  for (const c of contacts) {
    const list = contactsByHousehold.get(c.householdId)
    if (list) list.push(c.contactedAt)
    else contactsByHousehold.set(c.householdId, [c.contactedAt])
  }

  // Attribute each payment to the latest preceding call within the window.
  const recoveredByHousehold = new Map<number, number>()
  const windowMs = ATTRIBUTION_DAYS * 86_400_000
  for (const p of payments) {
    const calls = contactsByHousehold.get(p.householdId)
    if (!calls) continue
    let attributed = false
    for (let i = calls.length - 1; i >= 0; i--) {
      if (calls[i] <= p.paidAt) {
        attributed = p.paidAt.getTime() - calls[i].getTime() <= windowMs
        break
      }
    }
    if (attributed) {
      recoveredByHousehold.set(
        p.householdId,
        (recoveredByHousehold.get(p.householdId) ?? 0) + num(p.amount)
      )
    }
  }

  const promises = await prisma.promiseToPay.findMany({
    select: { householdId: true, status: true },
  })

  const ANSWERED = new Set([
    'PROMISED',
    'PAID_ALREADY',
    'NEEDS_TIME',
    'REFUSED',
    'DISPUTED',
    'CALL_BACK_LATER',
  ])

  function aggregate(key: 'archetype' | 'tier'): EffectivenessRow[] {
    const acc = new Map<string, EffectivenessRow>()
    const get = (segment: string): EffectivenessRow => {
      let row = acc.get(segment)
      if (!row) {
        row = {
          segment,
          calls: 0,
          answered: 0,
          answerRate: 0,
          promises: 0,
          promisesKept: 0,
          promiseKeptRate: 0,
          recovered: 0,
          recoveredPerCall: 0,
        }
        acc.set(segment, row)
      }
      return row
    }

    for (const c of contacts) {
      const segment = segmentOf.get(c.householdId)?.[key] ?? 'UNKNOWN'
      const row = get(segment)
      row.calls++
      if (ANSWERED.has(c.outcome)) row.answered++
    }
    for (const p of promises) {
      const segment = segmentOf.get(p.householdId)?.[key] ?? 'UNKNOWN'
      const row = get(segment)
      row.promises++
      if (p.status === 'KEPT' || p.status === 'PARTIAL') row.promisesKept++
    }
    for (const [householdId, amount] of recoveredByHousehold) {
      const segment = segmentOf.get(householdId)?.[key] ?? 'UNKNOWN'
      get(segment).recovered += amount
    }

    return [...acc.values()]
      .map((row) => ({
        ...row,
        answerRate: row.calls > 0 ? row.answered / row.calls : 0,
        promiseKeptRate: row.promises > 0 ? row.promisesKept / row.promises : 0,
        recoveredPerCall: row.calls > 0 ? row.recovered / row.calls : 0,
      }))
      .sort((a, b) => b.recovered - a.recovered)
  }

  const byArchetype = aggregate('archetype')
  const totalCalls = contacts.length
  const totalAnswered = contacts.filter((c) => ANSWERED.has(c.outcome)).length
  const totalRecovered = [...recoveredByHousehold.values()].reduce((n, v) => n + v, 0)
  const keptPromises = promises.filter(
    (p) => p.status === 'KEPT' || p.status === 'PARTIAL'
  ).length

  return {
    byArchetype,
    byTier: aggregate('tier'),
    overall: {
      segment: 'All',
      calls: totalCalls,
      answered: totalAnswered,
      answerRate: totalCalls > 0 ? totalAnswered / totalCalls : 0,
      promises: promises.length,
      promisesKept: keptPromises,
      promiseKeptRate: promises.length > 0 ? keptPromises / promises.length : 0,
      recovered: totalRecovered,
      recoveredPerCall: totalCalls > 0 ? totalRecovered / totalCalls : 0,
    },
    attributionDays: ATTRIBUTION_DAYS,
    coverage: {
      message:
        payments.length === 0
          ? 'Calls have been logged, but no payment carries a real date yet, so none can be attributed to a call. Import your payment history to make this meaningful.'
          : null,
    },
  }
}
