/**
 * Calendar-aware working-day counting for the pacing engine. All dates are
 * treated as pure calendar dates (matches Prisma's `@db.Date` columns, which
 * come back as UTC-midnight `Date` objects) — every calculation here uses
 * the UTC getters/setters so results never shift with server timezone.
 */

export interface DateRange {
  startDate: Date
  endDate: Date
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function isWithinAnyRange(date: Date, ranges: DateRange[]): boolean {
  return ranges.some((r) => date >= r.startDate && date <= r.endDate)
}

function isBlocked(
  date: Date,
  excludeSundays: boolean,
  excludeEvents: DateRange[],
  excludedKeys: Set<string>,
): boolean {
  if (excludeSundays && date.getUTCDay() === 0) return true
  if (isWithinAnyRange(date, excludeEvents)) return true
  if (excludedKeys.has(dateKey(date))) return true
  return false
}

interface CountWorkingDaysInput {
  from: Date
  to: Date
  excludeSundays?: boolean
  excludeEvents?: DateRange[] // CalendarEvent rows (holidays/exams)
  excludeDates?: Date[] // e.g. TeacherAttendance ABSENT rows
}

/** Count working days in [from, to] inclusive, after removing Sundays, calendar blockers and given dates. */
export function countWorkingDays(input: CountWorkingDaysInput): number {
  const { from, to, excludeSundays = true, excludeEvents = [], excludeDates = [] } = input
  if (from.getTime() > to.getTime()) return 0
  const excludedKeys = new Set(excludeDates.map(dateKey))

  let count = 0
  const cursor = new Date(from)
  while (cursor.getTime() <= to.getTime()) {
    if (!isBlocked(cursor, excludeSundays, excludeEvents, excludedKeys)) count++
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}

interface AddWorkingDaysOpts {
  excludeSundays?: boolean
  excludeEvents?: DateRange[]
  excludeDates?: Date[]
}

/**
 * Starting at `from`, step forward until `days` working days have been
 * consumed (from itself counts as day 1 when it isn't blocked), and return
 * the date the last one lands on. `days <= 0` returns `from` unchanged.
 */
export function addWorkingDays(from: Date, days: number, opts: AddWorkingDaysOpts = {}): Date {
  const { excludeSundays = true, excludeEvents = [], excludeDates = [] } = opts
  const excludedKeys = new Set(excludeDates.map(dateKey))

  const cursor = new Date(from)
  if (days <= 0) return cursor

  let remaining = days
  // Consume `from` itself first if it's a working day.
  if (!isBlocked(cursor, excludeSundays, excludeEvents, excludedKeys)) remaining--

  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (!isBlocked(cursor, excludeSundays, excludeEvents, excludedKeys)) remaining--
  }
  return cursor
}
