import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err } from '@/lib/teaching/http'
import { countWorkingDays } from '@/lib/teaching/working-days'

/** Count actual teaching days between two dates after removing Sundays, holidays and exams. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const fromRaw = sp.get('from')
  const toRaw = sp.get('to')
  if (!fromRaw || isNaN(Date.parse(fromRaw))) return err('a valid from date is required', 400)
  if (!toRaw || isNaN(Date.parse(toRaw))) return err('a valid to date is required', 400)

  const from = new Date(fromRaw)
  const to = new Date(toRaw)
  if (from > to) return err('from must be on or before to', 400)

  const events = await prisma.calendarEvent.findMany({
    where: { startDate: { lte: to }, endDate: { gte: from } },
    select: { startDate: true, endDate: true },
  })

  const effectiveDays = countWorkingDays({
    from,
    to,
    excludeSundays: true,
    excludeEvents: events.map((e) => ({ startDate: e.startDate, endDate: e.endDate })),
  })

  return ok({ from: fromRaw, to: toRaw, effectiveDays })
}
