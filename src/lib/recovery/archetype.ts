import type { ArchetypeVerdict, GuardianFeatures, PaymentArchetype, SessionBehaviour } from './types'

/**
 * Payment archetype: WHEN and WHETHER a household pays.
 *
 * A deliberately transparent rule cascade rather than a fitted model. The
 * output decides who gets called, so a school owner has to be able to disagree
 * with it out loud — "no, they cleared by Diwali last year" — and see which
 * rule produced the answer. Every verdict therefore carries the evidence that
 * produced it, and the UI renders those lines verbatim.
 *
 * Rules are checked worst-behaviour-first: a family owing across two sessions
 * is a chronic defaulter even if last year happened to look tidy.
 */

const RATIO_FULL = 0.95 // "cleared the year"
const RATIO_HALF = 0.5 // at or under this by year end = the bulk rolled over
const EARLY_WINDOW = 0.33 // first third of the session ≈ the first installment
const LATE_WINDOW = 0.75 // last quarter of the session
const ON_TIME_RATE = 70 // percent of installments met by their due date
const NEXT_YEAR_RATIO = 0.15 // current-session collection this low = nothing coming in

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const pct = (v: number) => `${Math.round(v * 100)}%`
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`

/** Turn a day-of-session offset into the month a human would name. */
function dayToMonth(session: SessionBehaviour, day: number): string {
  const d = new Date(session.startDate.getTime() + day * 86_400_000)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0

/**
 * Confidence reflects how much history the verdict rests on, not how neatly
 * the rule matched. One closed session can only ever be a provisional read.
 */
function baseConfidence(closedCount: number): number {
  if (closedCount >= 3) return 88
  if (closedCount === 2) return 74
  if (closedCount === 1) return 55
  return 30
}

export function classifyArchetype(f: GuardianFeatures): ArchetypeVerdict {
  const closed = f.closedSessions.filter((s) => s.billedPaise > 0)
  const evidence: string[] = []

  /* ── Not enough to go on ─────────────────────────────────────────────── */

  if (closed.length === 0) {
    const note = f.current
      ? `Only the current session on record — ${pct(f.current.paidRatio)} of ${rupees(
          f.current.billedPaise
        )} collected so far.`
      : 'No billed sessions on record yet.'
    return { archetype: 'UNKNOWN', confidence: 25, evidence: [note, 'Needs one completed session before a pattern can be read.'] }
  }

  const avgRatio = mean(closed.map((s) => s.paidRatio))
  const avgLastQuarter = mean(closed.map((s) => s.lastQuarterShare))
  const confidence = baseConfidence(closed.length)
  const seasonLine = seasonalityEvidence(f)

  const verdict = (archetype: PaymentArchetype, lines: string[], adjust = 0): ArchetypeVerdict => ({
    archetype,
    confidence: Math.max(15, Math.min(95, confidence + adjust)),
    evidence: [...lines, ...evidence, ...(seasonLine ? [seasonLine] : [])],
  })

  /* ── 1. Owes across multiple sessions at once ────────────────────────── */

  if (f.openDueSessions >= 2) {
    const names = f.sessions.filter((s) => s.duePaise > 0).map((s) => s.sessionName)
    return verdict(
      'CHRONIC_DEFAULTER',
      [
        `Owes money in ${f.openDueSessions} sessions at the same time (${names.join(', ')}).`,
        `${rupees(f.totalOutstandingPaise)} outstanding in total, ${rupees(
          f.pastSessionsDuePaise
        )} of it from earlier years.`,
      ],
      f.openDueSessions >= 3 ? 5 : 0
    )
  }

  /* ── 2. Always a year behind ─────────────────────────────────────────── */

  // Signature A: this year's fees untouched while last year's are being paid off.
  if (f.current && f.current.paidRatio < NEXT_YEAR_RATIO && f.current.paidTowardsPastPaise > 0) {
    return verdict('NEXT_YEAR_PAYER', [
      `Paying last session's dues right now (${rupees(
        f.current.paidTowardsPastPaise
      )} this year), while ${f.current.sessionName} sits at ${pct(f.current.paidRatio)} collected.`,
    ])
  }

  // Signature B: historically, most of a session's money lands after it ends.
  const lateArrivals = closed.filter((s) => s.paidPaise > 0)
  const afterEndShare = mean(
    lateArrivals.map((s) => s.paidAfterSessionEndPaise / Math.max(1, s.paidPaise))
  )
  if (lateArrivals.length > 0 && afterEndShare >= 0.6) {
    return verdict('NEXT_YEAR_PAYER', [
      `${pct(afterEndShare)} of their fees typically arrive after the session has already ended.`,
      'Money does come in — just a year late, every year.',
    ])
  }

  /* ── 3. Clears the year (≥95%) — the question is only when ───────────── */

  if (avgRatio >= RATIO_FULL) {
    const clearance = f.avgClearanceDay
    const reference = closed[closed.length - 1]
    const clearanceShare = clearance !== null ? clearance / reference.lengthDays : null

    if (clearanceShare !== null && clearanceShare <= EARLY_WINDOW) {
      return verdict(
        'EARLY_FULL',
        [
          `Clears the full year's fees early — typically by ${dayToMonth(reference, clearance!)}.`,
          `${pct(avgRatio)} collected across ${closed.length} completed session${closed.length > 1 ? 's' : ''}.`,
          'No follow-up needed; contacting them costs effort and returns nothing.',
        ],
        5
      )
    }

    if (f.onTimeInstallmentRate !== null && f.onTimeInstallmentRate >= ON_TIME_RATE) {
      return verdict(
        'INSTALLMENT_REGULAR',
        [
          `Meets ${f.onTimeInstallmentRate}% of installment due dates.`,
          `Clears the year in full (${pct(avgRatio)} collected), paying in ${Math.round(
            mean(closed.map((s) => s.paymentCount))
          )} instalments on average.`,
          'A due-date reminder is enough; a recovery call is wasted effort.',
        ],
        5
      )
    }

    if (avgLastQuarter >= RATIO_HALF || (clearanceShare !== null && clearanceShare >= LATE_WINDOW)) {
      const lines = [
        `Always clears the full amount, but late — ${pct(avgLastQuarter)} of it arrives in the last quarter of the session.`,
      ]
      if (clearance !== null) {
        lines.push(`Typically settled by ${dayToMonth(reference, clearance)}.`)
      }
      lines.push('Worth an early nudge: the money exists, only the timing slips.')
      return verdict('YEAR_END_FULL', lines)
    }

    // Clears fully, no strong timing signal either way.
    return verdict(
      'INSTALLMENT_REGULAR',
      [
        `Clears the year in full (${pct(avgRatio)} collected across ${closed.length} session${closed.length > 1 ? 's' : ''}).`,
        'No late-payment pattern in the record.',
      ],
      -10
    )
  }

  /* ── 4. Leaves the bulk unpaid at year end ───────────────────────────── */

  if (avgRatio > 0 && avgRatio <= RATIO_HALF) {
    return verdict('HEAVY_ROLLOVER', [
      `Pays only ${pct(avgRatio)} of the year's fees by the time the session ends.`,
      `The rest rolls forward — ${rupees(f.pastSessionsDuePaise)} is still carried from earlier sessions.`,
      f.rolloverStreak > 1
        ? `${f.rolloverStreak} sessions in a row have ended with money still owed.`
        : 'Last session ended with money still owed.',
    ])
  }

  if (avgRatio === 0) {
    return verdict('HEAVY_ROLLOVER', [
      'No payment recorded against any completed session.',
      `${rupees(f.totalOutstandingPaise)} outstanding.`,
    ])
  }

  /* ── 5. Pays most of it, late, and leaves a tail ─────────────────────── */

  return verdict('YEAR_END_PARTIAL', [
    `Pays ${pct(avgRatio)} of the year's fees, mostly late — the remainder carries into the next session.`,
    avgLastQuarter > 0.3
      ? `${pct(avgLastQuarter)} of their payments land in the last quarter.`
      : 'Payments are spread out but never quite complete the year.',
    `${rupees(f.pastSessionsDuePaise)} of old balance is still open.`,
  ])
}

/**
 * "They always pay in January" — the single most useful line to have in front
 * of you on a call, and the basis of the seasonal term in the forecast.
 * Only emitted when the concentration is real rather than an artefact of one
 * or two payments.
 */
function seasonalityEvidence(f: GuardianFeatures): string | null {
  const entries = Object.entries(f.monthHistogram)
  if (entries.length === 0) return null

  const sorted = entries.sort((a, b) => b[1] - a[1])
  const [topMonth, topShare] = sorted[0]
  if (topShare < 0.4) return null

  const second = sorted[1]
  const label = MONTHS[Number(topMonth) - 1]
  if (second && second[1] >= 0.25) {
    return `Most of their money arrives in ${label} and ${MONTHS[Number(second[0]) - 1]}.`
  }
  return `${pct(topShare)} of everything they have ever paid arrived in ${label}.`
}

/**
 * Whether this archetype is worth a phone call at all, before ability to pay
 * is considered. Used to keep reliable payers off the list entirely rather
 * than ranking them low — a list you have to scroll past is a list you stop
 * trusting.
 */
export function isWorthChasing(archetype: PaymentArchetype): boolean {
  return archetype !== 'EARLY_FULL' && archetype !== 'INSTALLMENT_REGULAR'
}
