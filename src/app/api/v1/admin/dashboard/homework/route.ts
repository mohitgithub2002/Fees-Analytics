import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, parseId, todayDateOnly, daysBetween } from '@/lib/teaching/http'

/**
 * Homework-checking compliance per teacher: is the homework they set actually
 * being checked, and how long does it take them? `overdue` is homework still
 * unchecked more than `graceDays` after it was set — two days by default,
 * matching the "next day or the day after" expectation.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const sessionId = parseId(sp.get('sessionId'))
  const teacherId = parseId(sp.get('teacherId'))
  const graceDays = Math.max(0, parseInt(sp.get('graceDays') || '2', 10) || 0)

  const session = sessionId
    ? await prisma.academicSession.findUnique({ where: { id: sessionId } })
    : await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (!session) return err('no academic session found', 404)

  const where: Prisma.SessionLogWhereInput = {
    type: 'HOMEWORK',
    assignment: { classroom: { sessionId: session.id }, ...(teacherId ? { teacherId } : {}) },
  }

  const rows = await prisma.sessionLog.findMany({
    where,
    select: {
      sessionDate: true,
      homeworkCheck: { select: { checkedOn: true } },
      assignment: { select: { teacher: { select: { id: true, name: true, employeeId: true } } } },
    },
  })

  const today = todayDateOnly()
  interface Bucket {
    teacher: { id: number; name: string; employeeId: string }
    assigned: number
    checked: number
    unchecked: number
    overdue: number
    totalDelayDays: number
  }
  const byTeacher = new Map<number, Bucket>()

  for (const row of rows) {
    const t = row.assignment.teacher
    let bucket = byTeacher.get(t.id)
    if (!bucket) {
      bucket = { teacher: t, assigned: 0, checked: 0, unchecked: 0, overdue: 0, totalDelayDays: 0 }
      byTeacher.set(t.id, bucket)
    }
    bucket.assigned++
    if (row.homeworkCheck) {
      bucket.checked++
      bucket.totalDelayDays += daysBetween(row.sessionDate, row.homeworkCheck.checkedOn)
    } else {
      bucket.unchecked++
      if (daysBetween(row.sessionDate, today) > graceDays) bucket.overdue++
    }
  }

  const teachers = [...byTeacher.values()]
    .map((b) => ({
      teacher: b.teacher,
      assigned: b.assigned,
      checked: b.checked,
      unchecked: b.unchecked,
      overdue: b.overdue,
      checkedPercent: b.assigned ? Math.round((b.checked / b.assigned) * 100) : 0,
      // Average days between setting the homework and checking it, over the
      // ones that were checked — 0 delay means same-day, null means none yet.
      avgCheckDelayDays: b.checked ? Math.round((b.totalDelayDays / b.checked) * 10) / 10 : null,
    }))
    // Worst compliance first: most overdue, then least checked.
    .sort((a, b) => b.overdue - a.overdue || a.checkedPercent - b.checkedPercent)

  const totals = teachers.reduce(
    (acc, t) => ({
      assigned: acc.assigned + t.assigned,
      checked: acc.checked + t.checked,
      unchecked: acc.unchecked + t.unchecked,
      overdue: acc.overdue + t.overdue,
    }),
    { assigned: 0, checked: 0, unchecked: 0, overdue: 0 },
  )

  return ok({
    session: { id: session.id, name: session.name },
    graceDays,
    totals: {
      ...totals,
      checkedPercent: totals.assigned ? Math.round((totals.checked / totals.assigned) * 100) : 0,
    },
    teachers,
  })
}
