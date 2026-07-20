import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { Prisma } from '@/generated/prisma/client'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const search = sp.get('search')?.trim()
  const sessionId = sp.get('sessionId') ? parseId(sp.get('sessionId')!) : null
  const classroomId = sp.get('classroomId') ? parseId(sp.get('classroomId')!) : null
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const limit = Math.min(100, Math.max(5, parseInt(sp.get('limit') || '50')))

  const where: Prisma.StudentWhereInput = {}
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { fatherName: { contains: search, mode: 'insensitive' } },
      { admissionNo: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (sessionId || classroomId) {
    where.enrollments = {
      some: {
        ...(sessionId ? { sessionId } : {}),
        ...(classroomId ? { classroomId } : {}),
      },
    }
  }

  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: {
        enrollments: {
          orderBy: { session: { startDate: 'desc' } },
          include: {
            session: { select: { id: true, name: true, isCurrent: true } },
            classroom: { include: { class: { select: { id: true, name: true } } } },
            feeItems: {
              select: { category: true, netAmount: true, paidAmount: true, dueAmount: true },
            },
          },
        },
      },
    }),
  ])

  return ok({
    data: students,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  })
}

export async function POST(request: NextRequest) {
  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { name, fatherName, motherName, phone, address, gender, dateOfBirth, admissionNo, remarks } =
    body as Record<string, string | undefined>
  if (!name?.trim()) return err('name is required')
  if (!fatherName?.trim()) return err('fatherName is required')
  if (dateOfBirth && isNaN(Date.parse(dateOfBirth))) return err('invalid dateOfBirth')

  try {
    const student = await prisma.student.create({
      data: {
        name: name.trim(),
        fatherName: fatherName.trim(),
        motherName: motherName?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        gender: gender?.trim() || null,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        admissionNo: admissionNo?.trim() || null,
        remarks: remarks?.trim() || null,
      },
    })
    return ok(student, 201)
  } catch (e) {
    return handleError(e)
  }
}
