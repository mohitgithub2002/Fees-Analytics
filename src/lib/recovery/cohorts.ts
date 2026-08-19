import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { EconomicTier, PaymentArchetype } from './types'

/**
 * The four analytical lenses on collection, all read straight from the ledger:
 *
 *   installments — which installment leaves money on the table, and by how much
 *   months       — when in the year money actually arrives
 *   classes      — which classes pay above or below their own average
 *   segments     — the archetype × tier grid: where the money is stuck
 *
 * These answer the "why" behind the call list. The worklist tells you who to
 * ring today; these tell you whether the problem is one family, one class, or
 * an installment date set two months before anyone in town has money.
 */

const num = (v: unknown) => Number(v ?? 0)

/* ══ Installment behaviour ═══════════════════════════════════════════════ */

export interface InstallmentBehaviour {
  sequence: number
  label: string
  dueDate: string | null
  /**
   * False when this installment has no due date anywhere in the session. The
   * on-time/late split is then meaningless and reported as unknown rather than
   * flattered to 100% — see the mapping below.
   */
  hasDueDate: boolean
  /** Amount owed on this installment across the session. */
  expected: number
  collectedOnTime: number
  collectedLate: number
  /** Total collected. Equals onTime + late, and is the only figure that means anything when `hasDueDate` is false. */
  collected: number
  outstanding: number
  onTimePercent: number | null
  avgDaysLate: number | null
  studentsDue: number
  studentsCleared: number
}

/**
 * Expected vs collected per installment, split by whether the money arrived
 * before or after the due date. The gap between "collected on time" and
 * "collected late" on installment 2 is the difference between a fee plan that
 * works and one that quietly finances itself on a rolling overdraft.
 *
 * Installments with no due date are grouped by sequence and reported with a
 * null date — their timing cannot be judged, only their totals.
 */
export async function installmentBehaviour(sessionId: number): Promise<InstallmentBehaviour[]> {
  const rows = await prisma.$queryRaw<
    {
      sequence: number
      label: string
      dueDate: Date | null
      expected: unknown
      collectedOnTime: unknown
      collectedLate: unknown
      outstanding: unknown
      studentsDue: bigint
      studentsCleared: bigint
      avgDaysLate: unknown
    }[]
  >(Prisma.sql`
    -- FeeInstallment.dueDate is a timestamp, not a date, so both sides are cast
    -- to ::date before subtracting. date - timestamp yields an interval, which
    -- the Prisma pg adapter cannot map back (UnsupportedNativeDataType);
    -- date - date yields a plain integer number of days.
    WITH alloc AS (
      SELECT a."installmentId",
             SUM(CASE WHEN i."dueDate" IS NULL OR t."paidAt"::date <= i."dueDate"::date
                      THEN a.amount ELSE 0 END) AS "onTime",
             SUM(CASE WHEN i."dueDate" IS NOT NULL AND t."paidAt"::date > i."dueDate"::date
                      THEN a.amount ELSE 0 END) AS "late",
             MAX(CASE WHEN i."dueDate" IS NOT NULL AND t."paidAt"::date > i."dueDate"::date
                      THEN (t."paidAt"::date - i."dueDate"::date) END) AS "daysLate"
      FROM "TransactionAllocation" a
      JOIN "FeeTransaction" t ON t.id = a."transactionId" AND t.status = 'COMPLETED'
      JOIN "FeeInstallment" i ON i.id = a."installmentId"
      GROUP BY a."installmentId"
    )
    SELECT i.sequence,
           MIN(i.label)                                   AS label,
           MIN(i."dueDate")                               AS "dueDate",
           SUM(i."netAmount")                             AS expected,
           COALESCE(SUM(alloc."onTime"), 0)               AS "collectedOnTime",
           COALESCE(SUM(alloc."late"), 0)                 AS "collectedLate",
           SUM(i."netAmount" - i."paidAmount")            AS outstanding,
           COUNT(DISTINCT e."studentId")                  AS "studentsDue",
           COUNT(DISTINCT CASE WHEN i.status = 'PAID' THEN e."studentId" END) AS "studentsCleared",
           AVG(alloc."daysLate")                          AS "avgDaysLate"
    FROM "FeeInstallment"    i
    JOIN "StudentFeeItem"    fi ON fi.id = i."feeItemId"
    JOIN "StudentEnrollment" e  ON e.id  = fi."enrollmentId"
    LEFT JOIN alloc ON alloc."installmentId" = i.id
    WHERE e."sessionId" = ${sessionId}
      AND fi.category = 'SCHOOL'
    GROUP BY i.sequence
    ORDER BY i.sequence ASC
  `)

  return rows.map((r) => {
    const onTime = num(r.collectedOnTime)
    const late = num(r.collectedLate)
    const collected = onTime + late
    const hasDueDate = r.dueDate !== null

    return {
      sequence: r.sequence,
      label: r.label ?? `Installment ${r.sequence}`,
      dueDate: hasDueDate ? r.dueDate!.toISOString().slice(0, 10) : null,
      hasDueDate,
      expected: num(r.expected),
      // Without a due date the SQL counts everything as on time, which would
      // read as a flawless 100%. Report the total and admit the split is
      // unknown instead — a fabricated success figure is worse than a gap.
      collectedOnTime: hasDueDate ? onTime : 0,
      collectedLate: hasDueDate ? late : 0,
      collected,
      outstanding: num(r.outstanding),
      onTimePercent: hasDueDate && collected > 0 ? Math.round((onTime / collected) * 100) : null,
      avgDaysLate: r.avgDaysLate !== null ? Math.round(num(r.avgDaysLate)) : null,
      studentsDue: Number(r.studentsDue),
      studentsCleared: Number(r.studentsCleared),
    }
  })
}

/* ══ Seasonality ═════════════════════════════════════════════════════════ */

export interface MonthlyCollection {
  month: number // 1–12
  label: string
  /** Keyed by session name, so this year can be read against last year. */
  bySession: Record<string, number>
  total: number
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * When in the calendar year money arrives, by the session it was collected in.
 * Reading two years side by side is what turns "we had a bad October" into
 * "October is always bad" — one is a problem, the other is a plan.
 */
export async function monthlyCollection(limitSessions = 3): Promise<{
  months: MonthlyCollection[]
  sessions: string[]
}> {
  const rows = await prisma.$queryRaw<
    { month: number; sessionName: string; amount: unknown }[]
  >(Prisma.sql`
    SELECT EXTRACT(MONTH FROM t."paidAt")::int AS month,
           s.name                              AS "sessionName",
           SUM(t.amount)                       AS amount
    FROM "FeeTransaction" t
    JOIN "AcademicSession" s
      ON t."paidAt" >= s."startDate" AND t."paidAt" <= s."endDate"
    WHERE t.status = 'COMPLETED'
    GROUP BY EXTRACT(MONTH FROM t."paidAt"), s.name
  `)

  const sessionNames = [...new Set(rows.map((r) => r.sessionName))].sort().slice(-limitSessions)

  const months: MonthlyCollection[] = MONTH_LABELS.map((label, i) => ({
    month: i + 1,
    label,
    bySession: Object.fromEntries(sessionNames.map((s) => [s, 0])),
    total: 0,
  }))

  for (const row of rows) {
    if (!sessionNames.includes(row.sessionName)) continue
    const bucket = months[row.month - 1]
    bucket.bySession[row.sessionName] += num(row.amount)
    bucket.total += num(row.amount)
  }

  return { months, sessions: sessionNames }
}

/* ══ Class cohorts ═══════════════════════════════════════════════════════ */

export interface ClassCohort {
  classId: number
  className: string
  students: number
  billed: number
  collected: number
  outstanding: number
  recoveryPercent: number
  /** Share of the class's own average that each band pays. */
  bands: {
    above: { students: number; outstanding: number }
    at: { students: number; outstanding: number }
    below: { students: number; outstanding: number }
  }
}

const BAND_MARGIN = 0.1 // ±10 percentage points around the class average

/**
 * Per class, how each family pays relative to that class's own average.
 *
 * Comparing a class against itself rather than the school is deliberate: fee
 * amounts differ by class, so a school-wide average would just rediscover that
 * senior classes are billed more. A class where a third of families sit in the
 * "below" band has a structural problem — the fee, the intake, or the plan —
 * and no amount of calling will fix it.
 */
export async function classCohorts(sessionId: number): Promise<ClassCohort[]> {
  const rows = await prisma.$queryRaw<
    {
      classId: number
      className: string
      displayOrder: number
      studentId: number
      billed: unknown
      collected: unknown
      outstanding: unknown
    }[]
  >(Prisma.sql`
    SELECT c.id            AS "classId",
           c.name          AS "className",
           c."displayOrder",
           e."studentId",
           COALESCE(SUM(f."netAmount"), 0)  AS billed,
           COALESCE(SUM(f."paidAmount"), 0) AS collected,
           COALESCE(SUM(f."dueAmount"), 0)  AS outstanding
    FROM "StudentEnrollment" e
    JOIN "Classroom"   cr ON cr.id = e."classroomId"
    JOIN "SchoolClass" c  ON c.id  = cr."classId"
    LEFT JOIN "StudentFeeItem" f ON f."enrollmentId" = e.id
    WHERE e."sessionId" = ${sessionId}
    GROUP BY c.id, c.name, c."displayOrder", e."studentId"
  `)

  const byClass = new Map<number, typeof rows>()
  for (const row of rows) {
    const list = byClass.get(row.classId) ?? []
    list.push(row)
    byClass.set(row.classId, list)
  }

  const cohorts: ClassCohort[] = []
  for (const [classId, students] of byClass) {
    const billed = students.reduce((s, x) => s + num(x.billed), 0)
    const collected = students.reduce((s, x) => s + num(x.collected), 0)
    const outstanding = students.reduce((s, x) => s + num(x.outstanding), 0)
    const classAvg = billed > 0 ? collected / billed : 0

    const bands = {
      above: { students: 0, outstanding: 0 },
      at: { students: 0, outstanding: 0 },
      below: { students: 0, outstanding: 0 },
    }
    for (const student of students) {
      const studentBilled = num(student.billed)
      if (studentBilled <= 0) continue
      const ratio = num(student.collected) / studentBilled
      const band =
        ratio >= classAvg + BAND_MARGIN ? 'above' : ratio <= classAvg - BAND_MARGIN ? 'below' : 'at'
      bands[band].students++
      bands[band].outstanding += num(student.outstanding)
    }

    cohorts.push({
      classId,
      className: students[0].className,
      students: students.length,
      billed,
      collected,
      outstanding,
      recoveryPercent: billed > 0 ? Math.round((collected / billed) * 100) : 0,
      bands,
    })
  }

  const order = new Map(rows.map((r) => [r.classId, r.displayOrder]))
  return cohorts.sort((a, b) => (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0))
}

/* ══ The archetype × tier matrix ═════════════════════════════════════════ */

export interface SegmentCell {
  archetype: PaymentArchetype
  tier: EconomicTier
  households: number
  outstanding: number
  expectedRecovery: number
}

/**
 * Where the money is stuck, cross-cut by willingness and ability.
 *
 * This is the map the whole module exists to draw. The top-left of it —
 * families who can pay but are slow — is where a day of calling converts;
 * the bottom-right is where calling harder collects nothing and a payment plan
 * or a concession is the only honest answer.
 */
export async function segmentMatrix(): Promise<{
  cells: SegmentCell[]
  totals: { households: number; outstanding: number; expectedRecovery: number }
}> {
  const rows = await prisma.$queryRaw<
    {
      archetype: PaymentArchetype
      tier: EconomicTier
      households: bigint
      outstanding: unknown
      expectedRecovery: unknown
    }[]
  >(Prisma.sql`
    SELECT p.archetype,
           -- The confirmed tag where a human set one, the suggestion otherwise.
           CASE WHEN g."economicTier" = 'UNKNOWN' THEN p."suggestedTier" ELSE g."economicTier" END AS tier,
           COUNT(*)                        AS households,
           SUM(p."totalOutstanding")       AS outstanding,
           SUM(p."expectedRecovery30d")    AS "expectedRecovery"
    FROM "GuardianProfile" p
    JOIN "Guardian" g ON g.id = p."guardianId"
    WHERE p."totalOutstanding" > 0
    GROUP BY p.archetype, 2
  `)

  const cells = rows.map((r) => ({
    archetype: r.archetype,
    tier: r.tier,
    households: Number(r.households),
    outstanding: num(r.outstanding),
    expectedRecovery: num(r.expectedRecovery),
  }))

  return {
    cells,
    totals: {
      households: cells.reduce((s, c) => s + c.households, 0),
      outstanding: cells.reduce((s, c) => s + c.outstanding, 0),
      expectedRecovery: cells.reduce((s, c) => s + c.expectedRecovery, 0),
    },
  }
}

/**
 * How much of the ledger's payment timing is estimated rather than real.
 *
 * Seeded demo timing keeps every rupee correct but invents the dates, so any
 * chart built on *when* money arrived has to say so. Without this the owner
 * would be reading synthetic seasonality as fact.
 */
export async function timingProvenance(): Promise<{
  total: number
  estimated: number
  percentEstimated: number
}> {
  const [total, estimated] = await Promise.all([
    prisma.feeTransaction.count({ where: { status: 'COMPLETED' } }),
    prisma.feeTransaction.count({
      where: { status: 'COMPLETED', OR: [{ receiptNo: { startsWith: 'DEMO-' } }, { receiptNo: { startsWith: 'LEGACY-' } }] },
    }),
  ])
  return {
    total,
    estimated,
    percentEstimated: total > 0 ? Math.round((estimated / total) * 100) : 0,
  }
}
