import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok } from '@/lib/teaching/http'

/** Own pacing status by chapter, showing whether they are on track or behind. */
export async function GET() {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const pacing = await prisma.syllabusPacing.findMany({
    where: { assignment: { teacherId: gate.teacher.id, isActive: true } },
    include: {
      chapter: { select: { id: true, name: true, displayOrder: true } },
      assignment: {
        select: {
          id: true,
          subject: { select: { id: true, name: true } },
          classroom: { include: { class: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: [{ assignmentId: 'asc' }, { chapter: { displayOrder: 'asc' } }],
  })
  return ok(pacing)
}
