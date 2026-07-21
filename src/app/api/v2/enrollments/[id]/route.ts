import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { $Enums } from '@/generated/prisma/client'
import { FeeItemError } from '@/lib/fees/fee-items'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const enrollment = await prisma.studentEnrollment.findUnique({
    where: { id },
    include: {
      student: true,
      session: { select: { id: true, name: true, isCurrent: true } },
      classroom: { include: { class: { select: { id: true, name: true } } } },
      feeItems: {
        include: {
          installments: { orderBy: { sequence: 'asc' } },
          discounts: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { id: 'asc' },
      },
    },
  })
  if (!enrollment) return err('enrollment not found', 404)
  return ok(enrollment)
}

const STATUSES = new Set(Object.values($Enums.EnrollmentStatus))

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { status, classroomId, rollNo, notes } = body as {
    status?: $Enums.EnrollmentStatus
    classroomId?: number
    rollNo?: number | null
    notes?: string | null
  }
  if (status !== undefined && !STATUSES.has(status)) {
    return err(`status must be one of: ${[...STATUSES].join(', ')}`)
  }

  try {
    const enrollment = await prisma.$transaction(async (tx) => {
      // A classroom change must stay inside the enrollment's session —
      // moving to another session is a new enrollment, not an edit.
      if (classroomId !== undefined) {
        const existing = await tx.studentEnrollment.findUnique({ where: { id } })
        if (!existing) throw new FeeItemError('enrollment not found', 404)
        const classroom = await tx.classroom.findUnique({ where: { id: classroomId } })
        if (!classroom) throw new FeeItemError('classroom not found', 404)
        if (classroom.sessionId !== existing.sessionId) {
          throw new FeeItemError(
            'classroom belongs to a different session; create a new enrollment instead'
          )
        }
      }
      return tx.studentEnrollment.update({
        where: { id },
        data: {
          ...(status !== undefined ? { status } : {}),
          ...(classroomId !== undefined ? { classroomId } : {}),
          ...(rollNo !== undefined ? { rollNo } : {}),
          ...(notes !== undefined ? { notes } : {}),
        },
        include: {
          classroom: { include: { class: { select: { id: true, name: true } } } },
        },
      })
    })
    invalidateTags(TAGS.fees, TAGS.classrooms)
    return ok(enrollment)
  } catch (e) {
    return handleError(e)
  }
}
