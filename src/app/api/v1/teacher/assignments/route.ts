import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok } from '@/lib/teaching/http'

/** Own assignments for the current academic session, with classroom and subject details. */
export async function GET() {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const assignments = await prisma.teacherAssignment.findMany({
    where: { teacherId: gate.teacher.id, isActive: true, classroom: { session: { isCurrent: true } } },
    include: {
      subject: { select: { id: true, name: true } },
      classroom: {
        include: {
          class: { select: { id: true, name: true } },
          session: { select: { id: true, name: true, isCurrent: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  })
  return ok(assignments)
}
