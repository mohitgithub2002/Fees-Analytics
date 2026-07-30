import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok } from '@/lib/teaching/http'

/** Today's periods only — the default mobile view. dayOfWeek: 1=Mon..6=Sat; Sundays have no periods. */
export async function GET() {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const dayOfWeek = new Date().getDay()
  if (dayOfWeek === 0) return ok([])

  const slots = await prisma.timetableSlot.findMany({
    where: { dayOfWeek, assignment: { teacherId: gate.teacher.id, isActive: true } },
    include: {
      assignment: {
        include: {
          subject: { select: { id: true, name: true } },
          classroom: { include: { class: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { periodNumber: 'asc' },
  })
  return ok(slots)
}
