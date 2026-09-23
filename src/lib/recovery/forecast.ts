/**
 * Where next month's money comes from.
 *
 * Three NESTED bands, so they can be read as one sentence rather than three
 * competing numbers:
 *
 *   committed <= likely <= stretch
 *
 *   COMMITTED  Promises families have made themselves, plus installments
 *              falling due from households that reliably meet due dates.
 *              This is the number to plan salaries against.
 *   LIKELY     Committed plus a propensity- and season-weighted share of
 *              everything else, corrected by how optimistic past forecasts
 *              turned out to be.
 *   STRETCH    What a very good month of follow-up could reach.
 *
 * The point is the DECOMPOSITION, not the total. "₹4 lakh next month" is not
 * actionable; "₹1.2 lakh of it is these nine families who already promised,
 * and another ₹2 lakh is class IX arrears" is. So every band breaks down by
 * source, by class and by household, and the screen drills straight through to
 * the names.
 *
 * The forecast also grades itself. Every generation is snapshotted, and each
 * elapsed month is scored against what actually arrived — using the EARLIEST
 * snapshot for that month, because grading a forecast made on the 30th against
 * that month's takings would flatter the system into uselessness.
 */
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { UNDATED_RECEIPT_REGEX } from './provenance'

const UNDATED_PREFIX = UNDATED_RECEIPT_REGEX

/** Reliability at or above this counts a household's dues as committed. */
const RELIABLE_THRESHOLD = 0.7
/** What a very good month of follow-up adds on top of "likely". */
const STRETCH_UPLIFT = 1.45
/** Calibration is clamped here — never let one odd month swing the next. */
const CALIBRATION_MIN = 0.5
const CALIBRATION_MAX = 1.5

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

export interface ForecastSource {
  key: 'promises' | 'scheduled' | 'arrears'
  label: string
  committed: number
  likely: number
}

export interface ForecastHousehold {
  householdId: number
  displayName: string
  archetype: string
  tier: string
  outstanding: number
  expected: number
  reason: string
}

export interface ForecastMonth {
  month: string
  committed: number
  likely: number
  stretch: number
  sources: ForecastSource[]
  byClass: { classId: number; className: string; expected: number }[]
  topHouseholds: ForecastHousehold[]
}

export interface ForecastAccuracy {
  month: string
  predicted: number
  actual: number
  ratio: number
}

export interface ForecastResult {
  session: { id: number; name: string }
  generatedOn: string
  months: ForecastMonth[]
  calibrationFactor: number
  accuracy: ForecastAccuracy[]
  coverage: {
    datedPayments: number
    totalPayments: number
    scheduledInstallments: number
    openPromises: number
    message: string | null
  }
}

/**
 * Monthly hazard: the share of an outstanding balance a household of a given
 * propensity is expected to pay in any one month.
 *
 * Deliberately conservative. A forecast that overstates is worse than one that
 * understates, because it is used to decide whether salaries can be paid.
 */
function monthlyHazard(propensity: number, monthsOut: number): number {
  // Confidence decays the further out we look.
  const decay = 1 / (1 + monthsOut * 0.6)
  return Math.max(0, Math.min(0.9, propensity)) * decay
}

export async function buildForecast(opts: {
  sessionId?: number
  months?: number
  now?: Date
} = {}): Promise<ForecastResult> {
  const now = opts.now ?? new Date()
  const horizon = Math.min(12, Math.max(1, opts.months ?? 3))

  const session = opts.sessionId
    ? await prisma.academicSession.findUnique({ where: { id: opts.sessionId } })
    : await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (!session) throw new Error('no current academic session')

  // --- What we know about every household -----------------------------
  const cases = await prisma.recoveryCase.findMany({
    where: { sessionId: session.id, outstanding: { gt: 0 } },
    select: {
      householdId: true,
      outstanding: true,
      expectedRecoveryValue: true,
      household: {
        select: {
          displayName: true,
          economicTier: true,
          profile: {
            select: {
              archetype: true,
              propensityScore: true,
              reliabilityScore: true,
              monthHistogram: true,
            },
          },
          members: {
            select: {
              student: {
                select: {
                  enrollments: {
                    where: { sessionId: session.id },
                    take: 1,
                    select: {
                      classroom: { select: { class: { select: { id: true, name: true } } } },
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

  // --- Promises, by the month they fall due ----------------------------
  const openPromises = await prisma.promiseToPay.findMany({
    where: { status: 'OPEN' },
    select: { householdId: true, amount: true, promisedFor: true },
  })

  // --- Installments falling due, by month -------------------------------
  const scheduled = await prisma.$queryRaw<
    { householdId: number; dueMonth: Date; amount: unknown }[]
  >`
    SELECT m."householdId"                        AS "householdId",
           DATE_TRUNC('month', i."dueDate")       AS "dueMonth",
           COALESCE(SUM(i."netAmount" - i."paidAmount"), 0) AS "amount"
    FROM "HouseholdMember"   m
    JOIN "StudentEnrollment" e ON e."studentId" = m."studentId"
    JOIN "StudentFeeItem"    f ON f."enrollmentId" = e."id"
    JOIN "FeeInstallment"    i ON i."feeItemId" = f."id"
    WHERE e."sessionId" = ${session.id}
      AND i."dueDate" IS NOT NULL
      AND i."status" <> 'PAID'
    GROUP BY 1, 2
  `

  const [{ dated, total }] = await prisma.$queryRaw<{ dated: bigint; total: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE "receiptNo" !~ ${UNDATED_PREFIX}) AS "dated",
           COUNT(*)                                                      AS "total"
    FROM "FeeTransaction" WHERE "status" = 'COMPLETED'
  `

  const accuracy = await scoreHistory(session.id)
  const calibrationFactor = calibrationFrom(accuracy)

  // --- Build each month --------------------------------------------------
  const firstMonth = startOfMonth(now)
  const months: ForecastMonth[] = []

  for (let offset = 1; offset <= horizon; offset++) {
    const monthStart = addMonths(firstMonth, offset)
    const monthEnd = addMonths(firstMonth, offset + 1)
    const monthKey = monthStart.toISOString().slice(0, 7)
    const monthOfYear = String(monthStart.getUTCMonth() + 1)

    let promiseTotal = 0
    let scheduledCommitted = 0
    let scheduledLikely = 0
    let arrearsLikely = 0

    const promiseByHousehold = new Map<number, number>()
    for (const p of openPromises) {
      if (p.promisedFor >= monthStart && p.promisedFor < monthEnd) {
        const amount = num(p.amount)
        promiseTotal += amount
        promiseByHousehold.set(
          p.householdId,
          (promiseByHousehold.get(p.householdId) ?? 0) + amount
        )
      }
    }

    const scheduledByHousehold = new Map<number, number>()
    for (const s of scheduled) {
      if (s.dueMonth >= monthStart && s.dueMonth < monthEnd) {
        scheduledByHousehold.set(
          s.householdId,
          (scheduledByHousehold.get(s.householdId) ?? 0) + num(s.amount)
        )
      }
    }

    const byClass = new Map<number, { className: string; expected: number }>()
    const households: ForecastHousehold[] = []

    for (const c of cases) {
      const profile = c.household.profile
      const outstanding = num(c.outstanding)
      if (outstanding <= 0) continue

      const propensity = profile?.propensityScore ?? 0.2
      const reliability = profile?.reliabilityScore ?? 0.3
      const reliable = reliability >= RELIABLE_THRESHOLD

      const promised = promiseByHousehold.get(c.householdId) ?? 0
      const due = scheduledByHousehold.get(c.householdId) ?? 0

      // A promise is the family's own word about a specific amount and date,
      // so it is counted in full and replaces any model guess for them.
      let committedHere = Math.min(promised, outstanding)
      let likelyHere = committedHere

      if (due > 0) {
        const capped = Math.min(due, Math.max(0, outstanding - committedHere))
        if (reliable) {
          committedHere += capped
          likelyHere += capped
          scheduledCommitted += capped
        } else {
          const weighted = capped * monthlyHazard(propensity, offset)
          likelyHere += weighted
          scheduledLikely += weighted
        }
      }

      // Whatever is left over is arrears: no date attached, so it is weighted
      // by how likely this family is to pay at all, and by whether this is a
      // month they historically pay in.
      const remaining = Math.max(0, outstanding - committedHere - due)
      if (remaining > 0) {
        const histogram = (profile?.monthHistogram ?? {}) as Record<string, number>
        const share = Number(histogram[monthOfYear] ?? 0)
        // Seasonality is a nudge, not a driver — with one year of history the
        // histogram is a single sample.
        const seasonal = share > 0 ? 1 + Math.min(0.3, (share - 1 / 12) * 2) : 1
        const weighted = remaining * monthlyHazard(propensity, offset) * seasonal
        likelyHere += weighted
        arrearsLikely += weighted
      }

      if (likelyHere <= 0) continue

      const cls = c.household.members[0]?.student.enrollments[0]?.classroom.class
      if (cls) {
        const entry = byClass.get(cls.id)
        if (entry) entry.expected += likelyHere
        else byClass.set(cls.id, { className: cls.name, expected: likelyHere })
      }

      households.push({
        householdId: c.householdId,
        displayName: c.household.displayName,
        archetype: String(profile?.archetype ?? 'UNKNOWN'),
        tier: String(c.household.economicTier),
        outstanding,
        expected: likelyHere,
        reason:
          promised > 0
            ? `Promised ₹${Math.round(promised).toLocaleString('en-IN')} this month`
            : reliable && due > 0
              ? 'Installment falls due and they pay to schedule'
              : due > 0
                ? 'Installment falls due'
                : 'Weighted share of what they still owe',
      })
    }

    const committed = promiseTotal + scheduledCommitted
    const likelyRaw = committed + scheduledLikely + arrearsLikely
    const likely = committed + (likelyRaw - committed) * calibrationFactor
    const stretch = likely * STRETCH_UPLIFT

    months.push({
      month: monthKey,
      committed,
      likely,
      stretch,
      sources: [
        {
          key: 'promises',
          label: 'Promised by the family',
          committed: promiseTotal,
          likely: promiseTotal,
        },
        {
          key: 'scheduled',
          label: 'Installments falling due',
          committed: scheduledCommitted,
          likely: scheduledCommitted + scheduledLikely * calibrationFactor,
        },
        {
          key: 'arrears',
          label: 'Weighted share of arrears',
          committed: 0,
          likely: arrearsLikely * calibrationFactor,
        },
      ],
      byClass: [...byClass.entries()]
        .map(([classId, v]) => ({ classId, className: v.className, expected: v.expected }))
        .sort((a, b) => b.expected - a.expected),
      topHouseholds: households.sort((a, b) => b.expected - a.expected).slice(0, 25),
    })
  }

  const datedPayments = Number(dated)
  const totalPayments = Number(total)
  const scheduledCount = scheduled.length

  const warnings: string[] = []
  if (scheduledCount === 0) {
    warnings.push(
      'No installment has a due date, so nothing can be counted as "falling due" — the committed band only contains promises.'
    )
  }
  if (datedPayments === 0) {
    warnings.push(
      'No payment carries a real date, so there is no seasonality and no way to grade past forecasts.'
    )
  }
  if (accuracy.length === 0 && datedPayments > 0) {
    warnings.push('No month has elapsed since forecasting began, so this is uncalibrated.')
  }

  return {
    session: { id: session.id, name: session.name },
    generatedOn: now.toISOString().slice(0, 10),
    months,
    calibrationFactor,
    accuracy,
    coverage: {
      datedPayments,
      totalPayments,
      scheduledInstallments: scheduledCount,
      openPromises: openPromises.length,
      message: warnings.length > 0 ? warnings.join(' ') : null,
    },
  }
}

/**
 * Grade elapsed months against what actually arrived.
 *
 * Uses the EARLIEST snapshot for each month on purpose: a forecast is only
 * worth anything if it was made in advance, and scoring the one made on the
 * last day of the month would measure bookkeeping, not prediction.
 */
async function scoreHistory(sessionId: number): Promise<ForecastAccuracy[]> {
  const snapshots = await prisma.collectionForecast.findMany({
    where: { sessionId },
    orderBy: [{ forecastMonth: 'asc' }, { generatedOn: 'asc' }],
    select: { forecastMonth: true, likely: true, generatedOn: true },
  })
  if (snapshots.length === 0) return []

  const earliest = new Map<string, { predicted: number; month: Date }>()
  for (const s of snapshots) {
    const key = s.forecastMonth.toISOString().slice(0, 7)
    if (!earliest.has(key)) {
      earliest.set(key, { predicted: num(s.likely), month: s.forecastMonth })
    }
  }

  const actuals = await prisma.$queryRaw<{ month: Date; total: unknown }[]>`
    SELECT DATE_TRUNC('month', t."paidAt") AS "month",
           COALESCE(SUM(t."amount"), 0)    AS "total"
    FROM "FeeTransaction" t
    WHERE t."status" = 'COMPLETED' AND t."receiptNo" !~ ${UNDATED_PREFIX}
    GROUP BY 1
  `
  const actualByMonth = new Map(
    actuals.map((a) => [a.month.toISOString().slice(0, 7), num(a.total)])
  )

  const now = new Date()
  const currentKey = startOfMonth(now).toISOString().slice(0, 7)

  const out: ForecastAccuracy[] = []
  for (const [key, entry] of earliest) {
    // Only months that have finished can be graded.
    if (key >= currentKey) continue
    const actual = actualByMonth.get(key) ?? 0
    out.push({
      month: key,
      predicted: entry.predicted,
      actual,
      ratio: entry.predicted > 0 ? actual / entry.predicted : 0,
    })
  }
  return out.sort((a, b) => a.month.localeCompare(b.month))
}

/** Average of recent ratios, clamped so one odd month cannot swing the next. */
function calibrationFrom(accuracy: ForecastAccuracy[]): number {
  const usable = accuracy.filter((a) => a.predicted > 0).slice(-6)
  if (usable.length === 0) return 1
  const mean = usable.reduce((sum, a) => sum + a.ratio, 0) / usable.length
  return Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, mean))
}

/**
 * Persist today's forecast, one row per month.
 *
 * Snapshots are what make the forecast answerable for itself later, so this
 * runs on every full recompute rather than only when somebody opens the page.
 */
export async function snapshotForecast(opts: { sessionId?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date()
  const forecast = await buildForecast({ sessionId: opts.sessionId, months: 6, now })
  const generatedOn = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )

  for (const month of forecast.months) {
    const forecastMonth = new Date(`${month.month}-01T00:00:00.000Z`)
    // Only the top slice of households is stored: the snapshot exists to grade
    // the forecast later, not to be a second copy of the whole ledger.
    const breakdown = {
      sources: month.sources,
      byClass: month.byClass,
      topHouseholds: month.topHouseholds.slice(0, 10),
    } as unknown as Prisma.InputJsonValue

    await prisma.collectionForecast.upsert({
      where: {
        sessionId_forecastMonth_generatedOn: {
          sessionId: forecast.session.id,
          forecastMonth,
          generatedOn,
        },
      },
      create: {
        sessionId: forecast.session.id,
        forecastMonth,
        generatedOn,
        committed: month.committed,
        likely: month.likely,
        stretch: month.stretch,
        calibrationFactor: forecast.calibrationFactor,
        breakdown,
      },
      update: {
        committed: month.committed,
        likely: month.likely,
        stretch: month.stretch,
        calibrationFactor: forecast.calibrationFactor,
        breakdown,
      },
    })
  }

  return forecast
}
