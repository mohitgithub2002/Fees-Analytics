import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { toPaise, toRupees } from '@/lib/fees/money'

/**
 * "Where does next month's money come from?"
 *
 * Three nested bands rather than one number, because a single figure invites
 * either false confidence or dismissal:
 *
 *   committed ≤ likely ≤ stretch
 *
 *   committed — money someone has actually named a date for: open promises,
 *               plus installments falling due from households that reliably
 *               pay them. This is the number to plan salaries against.
 *   likely    — committed plus a propensity- and season-weighted share of
 *               everything else outstanding.
 *   stretch   — what a very good month would look like if the follow-up went
 *               unusually well.
 *
 * Every generation is snapshotted (CollectionForecast) and later scored
 * against what actually arrived. A forecast nobody grades is a guess, and the
 * resulting calibration factor is the system correcting its own optimism.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Confidence in the "likely" band decays with distance out. */
const HORIZON_DECAY = [1, 0.85, 0.7, 0.6, 0.5, 0.42, 0.36, 0.3, 0.26, 0.22, 0.2, 0.18]
/** Share of the not-yet-expected balance that a very good month could reach. */
const STRETCH_REACH = 0.15

export interface ForecastMonth {
  month: string // ISO date, first of month
  label: string // "Sep 2026"
  isPast: boolean
  isCurrent: boolean
  committed: number
  likely: number
  stretch: number
  actual: number | null
  /** What drives the committed band — shown when the user asks "why?" */
  drivers: { promises: number; dueInstallments: number }
}

export interface ForecastResult {
  sessionId: number
  sessionName: string
  generatedAt: string
  calibrationFactor: number
  months: ForecastMonth[]
  accuracy: { month: string; label: string; predicted: number; actual: number; errorPercent: number }[]
  /** Households whose expected recovery adds up fastest — the gap-closers. */
  topContributors: {
    guardianId: number
    name: string
    phone: string | null
    outstanding: number
    expectedRecovery: number
    archetype: string
    childrenCount: number
  }[]
  totals: { outstanding: number; expectedNext30d: number; sessionGap: number }
}

const firstOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
const addMonths = (d: Date, n: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
const monthLabel = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

export async function buildForecast(
  sessionId: number,
  monthsAhead = 6,
  now: Date = new Date()
): Promise<ForecastResult> {
  const session = await prisma.academicSession.findUniqueOrThrow({ where: { id: sessionId } })
  const thisMonth = firstOfMonth(now)
  // Two months of history for context, then the forecast horizon.
  const windowStart = addMonths(thisMonth, -2)
  const windowEnd = addMonths(thisMonth, monthsAhead)

  const [openPromises, dueInstallments, profiles, actuals, history] = await Promise.all([
    prisma.promiseToPay.findMany({
      where: { status: 'OPEN', promisedFor: { gte: windowStart, lt: windowEnd } },
      select: { amount: true, settledAmount: true, promisedFor: true },
    }),

    // Installments falling due in the window, tagged with how reliably the
    // household that owes them actually meets a due date.
    prisma.$queryRaw<{ dueMonth: Date; amount: unknown; onTimeRate: number | null; archetype: string | null }[]>(
      Prisma.sql`
        SELECT date_trunc('month', i."dueDate")::date       AS "dueMonth",
               SUM(i."netAmount" - i."paidAmount")          AS amount,
               MAX(p."onTimeInstallmentRate")               AS "onTimeRate",
               MAX(p.archetype::text)                       AS archetype
        FROM "FeeInstallment"    i
        JOIN "StudentFeeItem"    fi ON fi.id = i."feeItemId"
        JOIN "StudentEnrollment" e  ON e.id  = fi."enrollmentId"
        LEFT JOIN "GuardianStudent" gs ON gs."studentId" = e."studentId" AND gs."isPayer" = true
        LEFT JOIN "GuardianProfile" p  ON p."guardianId"  = gs."guardianId"
        WHERE i."dueDate" >= ${windowStart}
          AND i."dueDate" <  ${windowEnd}
          AND i.status <> 'PAID'
        GROUP BY date_trunc('month', i."dueDate"), gs."guardianId"
      `
    ),

    prisma.guardianProfile.findMany({
      where: { totalOutstanding: { gt: 0 } },
      select: {
        guardianId: true,
        totalOutstanding: true,
        expectedRecovery30d: true,
        monthHistogram: true,
        archetype: true,
        guardian: { select: { name: true, phone: true } },
        childrenCount: true,
      },
      orderBy: { expectedRecovery30d: 'desc' },
    }),

    // What actually arrived, per month, for elapsed months.
    prisma.$queryRaw<{ month: Date; amount: unknown }[]>(Prisma.sql`
      SELECT date_trunc('month', t."paidAt")::date AS month, SUM(t.amount) AS amount
      FROM "FeeTransaction" t
      WHERE t.status = 'COMPLETED'
        AND t."paidAt" >= ${windowStart}
        AND t."paidAt" <  ${windowEnd}
      GROUP BY date_trunc('month', t."paidAt")
    `),

    // Earlier snapshots, for scoring past forecasts.
    prisma.collectionForecast.findMany({
      where: { sessionId, actualCollected: { not: null } },
      orderBy: { month: 'desc' },
      take: 6,
      distinct: ['month'],
    }),
  ])

  /* ── How wrong have we been lately? ─────────────────────────────────── */

  const accuracy = history
    .filter((h) => Number(h.likely) > 0)
    .map((h) => {
      const predicted = Number(h.likely)
      const actual = Number(h.actualCollected ?? 0)
      return {
        month: h.month.toISOString().slice(0, 10),
        label: monthLabel(h.month),
        predicted,
        actual,
        errorPercent: Math.round(((actual - predicted) / predicted) * 100),
      }
    })
    .reverse()

  const recent = accuracy.slice(-3)
  const calibrationFactor = recent.length
    ? Math.max(
        0.5,
        Math.min(
          1.5,
          recent.reduce((s, a) => s + (a.predicted > 0 ? a.actual / a.predicted : 1), 0) /
            recent.length
        )
      )
    : 1

  /* ── Index the inputs by month ──────────────────────────────────────── */

  const key = (d: Date) => d.toISOString().slice(0, 7)

  const promiseByMonth = new Map<string, number>()
  for (const p of openPromises) {
    const remaining = toPaise(p.amount) - toPaise(p.settledAmount)
    if (remaining <= 0) continue
    const k = key(p.promisedFor)
    promiseByMonth.set(k, (promiseByMonth.get(k) ?? 0) + remaining)
  }

  // An installment counts as committed only where the household has a record
  // of meeting due dates; from anyone else, a due date is an aspiration. The
  // rest of their balance still reaches the forecast through the propensity-
  // weighted `likely` band below.
  const reliableDueByMonth = new Map<string, number>()
  for (const row of dueInstallments) {
    const reliable =
      (row.onTimeRate ?? 0) >= 70 ||
      row.archetype === 'EARLY_FULL' ||
      row.archetype === 'INSTALLMENT_REGULAR'
    if (!reliable) continue
    const k = key(row.dueMonth)
    reliableDueByMonth.set(k, (reliableDueByMonth.get(k) ?? 0) + toPaise(row.amount as number))
  }

  const actualByMonth = new Map<string, number>()
  for (const row of actuals) actualByMonth.set(key(row.month), toPaise(row.amount as number))

  /* ── Spread each household's expected recovery over the horizon ─────── */

  const totalOutstandingPaise = profiles.reduce((s, p) => s + toPaise(p.totalOutstanding), 0)
  const expectedByMonth = new Map<string, number>()

  const horizonMonths: Date[] = []
  for (let i = 0; i < monthsAhead; i++) horizonMonths.push(addMonths(thisMonth, i))

  for (const profile of profiles) {
    const expected = toPaise(profile.expectedRecovery30d)
    if (expected <= 0) continue
    const histogram = (profile.monthHistogram as Record<string, number> | null) ?? {}

    // Weight each month by this household's own seasonal habit, falling back
    // to an even spread when they have no discernible rhythm.
    const weights = horizonMonths.map((m, i) => {
      const seasonal = histogram[String(m.getUTCMonth() + 1)] ?? 0
      return (0.4 + seasonal * 2) * HORIZON_DECAY[Math.min(i, HORIZON_DECAY.length - 1)]
    })
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1

    // `expectedRecovery30d` is a one-month figure; spreading it across the
    // horizon would silently multiply it, so the horizon total is capped at
    // roughly three months of it or the balance, whichever is smaller.
    const budget = Math.min(expected * 3, toPaise(profile.totalOutstanding))
    horizonMonths.forEach((m, i) => {
      const k = key(m)
      expectedByMonth.set(k, (expectedByMonth.get(k) ?? 0) + (budget * weights[i]) / totalWeight)
    })
  }

  /* ── Assemble the months ────────────────────────────────────────────── */

  const months: ForecastMonth[] = []
  for (let i = -2; i < monthsAhead; i++) {
    const m = addMonths(thisMonth, i)
    const k = key(m)
    const isPast = i < 0
    const isCurrent = i === 0

    const promises = promiseByMonth.get(k) ?? 0
    const reliableDue = reliableDueByMonth.get(k) ?? 0
    const committed = promises + reliableDue

    const weighted = (expectedByMonth.get(k) ?? 0) * calibrationFactor
    const likely = Math.max(committed, Math.round(weighted))

    const unclaimed = Math.max(0, totalOutstandingPaise - likely)
    const stretch = likely + Math.round(unclaimed * STRETCH_REACH * (HORIZON_DECAY[Math.max(0, i)] ?? 0.2))

    months.push({
      month: m.toISOString().slice(0, 10),
      label: monthLabel(m),
      isPast,
      isCurrent,
      committed: isPast ? 0 : toRupees(committed),
      likely: isPast ? 0 : toRupees(likely),
      stretch: isPast ? 0 : toRupees(stretch),
      actual: actualByMonth.has(k) ? toRupees(actualByMonth.get(k)!) : isPast || isCurrent ? 0 : null,
      drivers: { promises: toRupees(promises), dueInstallments: toRupees(reliableDue) },
    })
  }

  const nextMonthKey = key(addMonths(thisMonth, 1))

  return {
    sessionId,
    sessionName: session.name,
    generatedAt: now.toISOString(),
    calibrationFactor,
    months,
    accuracy,
    topContributors: profiles.slice(0, 20).map((p) => ({
      guardianId: p.guardianId,
      name: p.guardian.name,
      phone: p.guardian.phone,
      outstanding: Number(p.totalOutstanding),
      expectedRecovery: Number(p.expectedRecovery30d),
      archetype: p.archetype,
      childrenCount: p.childrenCount,
    })),
    totals: {
      outstanding: toRupees(totalOutstandingPaise),
      expectedNext30d: toRupees(
        Math.round((expectedByMonth.get(nextMonthKey) ?? 0) * calibrationFactor)
      ),
      sessionGap: toRupees(totalOutstandingPaise),
    },
  }
}

/**
 * Persist today's forecast and score any elapsed month against what actually
 * arrived. Safe to run repeatedly — one snapshot per month per day.
 */
export async function snapshotForecast(sessionId: number, now: Date = new Date()) {
  const forecast = await buildForecast(sessionId, 6, now)
  const generatedOn = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )

  for (const month of forecast.months) {
    if (month.isPast) continue
    await prisma.collectionForecast.upsert({
      where: {
        sessionId_month_generatedOn: { sessionId, month: new Date(month.month), generatedOn },
      },
      create: {
        sessionId,
        month: new Date(month.month),
        generatedOn,
        committed: month.committed,
        likely: month.likely,
        stretch: month.stretch,
        calibrationFactor: forecast.calibrationFactor,
        breakdown: month.drivers,
      },
      update: {
        committed: month.committed,
        likely: month.likely,
        stretch: month.stretch,
        calibrationFactor: forecast.calibrationFactor,
        breakdown: month.drivers,
      },
    })
  }

  // Score every elapsed month against the earliest snapshot taken for it —
  // grading a forecast made on the 30th against that month's takings would
  // flatter the system into uselessness.
  const elapsed = await prisma.collectionForecast.findMany({
    where: { sessionId, month: { lt: firstOfMonth(now) }, actualCollected: null },
    orderBy: [{ month: 'asc' }, { generatedOn: 'asc' }],
  })

  for (const snapshot of elapsed) {
    const monthEnd = addMonths(snapshot.month, 1)
    const collected = await prisma.feeTransaction.aggregate({
      where: { status: 'COMPLETED', paidAt: { gte: snapshot.month, lt: monthEnd } },
      _sum: { amount: true },
    })
    await prisma.collectionForecast.update({
      where: { id: snapshot.id },
      data: { actualCollected: collected._sum.amount ?? 0 },
    })
  }

  return forecast
}
