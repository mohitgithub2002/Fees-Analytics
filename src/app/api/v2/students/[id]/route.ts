import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      enrollments: {
        orderBy: { session: { startDate: 'desc' } },
        include: {
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
      },
      transactions: {
        orderBy: { paidAt: 'desc' },
        take: 20,
        include: { allocations: true },
      },
    },
  })
  if (!student) return err('student not found', 404)
  return ok(student)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const fields = [
    'name', 'fatherName', 'motherName', 'phone', 'address',
    'gender', 'admissionNo', 'remarks',
  ] as const
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {}
  for (const f of fields) {
    const v = (body as Record<string, unknown>)[f]
    if (v !== undefined) data[f] = typeof v === 'string' ? v.trim() || null : v
  }
  const { dateOfBirth, isActive } = body as { dateOfBirth?: string; isActive?: boolean }
  if (dateOfBirth !== undefined) {
    if (dateOfBirth && isNaN(Date.parse(dateOfBirth))) return err('invalid dateOfBirth')
    data.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null
  }
  if (isActive !== undefined) data.isActive = Boolean(isActive)
  if (data.name === null) return err('name cannot be empty')
  if (data.fatherName === null) return err('fatherName cannot be empty')

  try {
    const student = await prisma.student.update({ where: { id }, data })
    return ok(student)
  } catch (e) {
    return handleError(e)
  }
}
