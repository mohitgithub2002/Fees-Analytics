import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok } from '@/lib/teaching/http'

const PACING_INCLUDE = {
  chapter: { select: { id: true, name: true, displayOrder: true } },
  assignment: {
    include: {
      teacher: { select: { id: true, name: true, employeeId: true } },
      subject: { select: { id: true, name: true } },
      classroom: { include: { class: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.SyllabusPacingInclude

/** Only assignments currently behind schedule — the alert feed. */
export async function GET() {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const pacing = await prisma.syllabusPacing.findMany({
    where: { status: 'BEHIND' },
    include: PACING_INCLUDE,
    orderBy: { daysBehind: 'desc' },
  })
  return ok(pacing)
}
