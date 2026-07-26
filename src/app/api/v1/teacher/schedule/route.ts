import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok } from '@/lib/teaching/http'

/** Own weekly timetable grid. */
export async function GET() {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const slots = await prisma.timetableSlot.findMany({
    where: { assignment: { teacherId: gate.teacher.id, isActive: true } },
    include: {
      assignment: {
        include: {
          subject: { select: { id: true, name: true } },
          classroom: { include: { class: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: [{ dayOfWeek: 'asc' }, { periodNumber: 'asc' }],
  })
  return ok(slots)
}
