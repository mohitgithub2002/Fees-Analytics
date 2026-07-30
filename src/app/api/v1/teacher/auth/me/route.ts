import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok, err } from '@/lib/teaching/http'

/** Return the logged-in teacher's own profile. */
export async function GET() {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const teacher = await prisma.teacher.findUnique({
    where: { id: gate.teacher.id },
    select: {
      id: true,
      employeeId: true,
      name: true,
      phone: true,
      email: true,
      qualification: true,
      lastLoginAt: true,
    },
  })
  if (!teacher) return err('teacher not found', 404)
  return ok(teacher)
}
