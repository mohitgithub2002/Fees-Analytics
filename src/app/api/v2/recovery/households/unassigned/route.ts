import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { handleError, ok } from '@/lib/fees/api'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'

/**
 * Students who do not belong to any family yet, plus a name search across all
 * students.
 *
 * Serves the "assign a parent" picker. A student with no family has no payer,
 * so they never reach the call list however much they owe — which makes this
 * list a work queue, not a curiosity.
 *
 * `?search=` searches every student (so a child can be moved from one family
 * to another); with no search it returns only the unassigned ones.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const search = request.nextUrl.searchParams.get('search')?.trim()

  try {
    const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })

    const where: Prisma.StudentWhereInput = { isActive: true }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { fatherName: { contains: search, mode: 'insensitive' } },
        { admissionNo: { contains: search, mode: 'insensitive' } },
      ]
    } else {
      where.householdLinks = { none: {} }
    }

    const students = await prisma.student.findMany({
      where,
      take: 50,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        fatherName: true,
        admissionNo: true,
        householdLinks: {
          select: { household: { select: { id: true, displayName: true } } },
        },
        enrollments: {
          where: session ? { sessionId: session.id } : undefined,
          take: 1,
          select: { classroom: { select: { section: true, class: { select: { name: true } } } } },
        },
      },
    })

    const unassignedTotal = await prisma.student.count({
      where: { isActive: true, householdLinks: { none: {} } },
    })

    return ok({
      data: students.map((s) => ({
        id: s.id,
        name: s.name,
        fatherName: s.fatherName,
        admissionNo: s.admissionNo,
        className: s.enrollments[0]?.classroom.class.name ?? null,
        section: s.enrollments[0]?.classroom.section ?? null,
        household: s.householdLinks[0]?.household ?? null,
      })),
      unassignedTotal,
    })
  } catch (e) {
    return handleError(e)
  }
}
