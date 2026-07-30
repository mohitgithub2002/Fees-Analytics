import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok } from '@/lib/teaching/http'

/** Last logged session per teacher — surfaces inactive teachers (nulls/oldest first). */
export async function GET() {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const teachers = await prisma.teacher.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      employeeId: true,
      assignments: {
        where: { isActive: true },
        select: {
          sessionLogs: { orderBy: { sessionDate: 'desc' }, take: 1, select: { sessionDate: true } },
        },
      },
    },
  })

  const activity = teachers
    .map((t) => {
      const dates = t.assignments.flatMap((a) => a.sessionLogs.map((s) => s.sessionDate))
      const lastSessionDate = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null
      return { id: t.id, name: t.name, employeeId: t.employeeId, lastSessionDate }
    })
    .sort((a, b) => {
      if (!a.lastSessionDate && !b.lastSessionDate) return 0
      if (!a.lastSessionDate) return -1
      if (!b.lastSessionDate) return 1
      return a.lastSessionDate.getTime() - b.lastSessionDate.getTime()
    })

  return ok(activity)
}
