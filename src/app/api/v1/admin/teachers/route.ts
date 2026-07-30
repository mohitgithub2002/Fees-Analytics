import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, handleError, parsePagination, paginationMeta } from '@/lib/teaching/http'
import { hashPassword, generateTempPassword } from '@/lib/auth/password'
import { normalizePhone } from '@/lib/auth/phone'
import { writeAudit } from '@/lib/teaching/audit'

const TEACHER_SELECT = {
  id: true,
  employeeId: true,
  name: true,
  phone: true,
  email: true,
  qualification: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.TeacherSelect

/** List teachers, filterable by active status and searchable by name or employee ID. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const search = sp.get('search')?.trim()
  const activeParam = sp.get('active')
  const { page, pageSize, skip, take } = parsePagination(sp)

  const where: Prisma.TeacherWhereInput = {}
  if (activeParam === 'true') where.isActive = true
  if (activeParam === 'false') where.isActive = false
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { employeeId: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [teachers, total] = await Promise.all([
    prisma.teacher.findMany({
      where,
      skip,
      take,
      orderBy: { name: 'asc' },
      select: { ...TEACHER_SELECT, _count: { select: { assignments: true } } },
    }),
    prisma.teacher.count({ where }),
  ])

  return ok({ teachers, pagination: paginationMeta(page, pageSize, total) })
}

/** Create a teacher account and issue initial credentials. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  const { user } = gate

  const body = await readJson<{
    employeeId?: string
    name?: string
    phone?: string
    email?: string
    qualification?: string
    password?: string
  }>(request)
  if (!body) return err('invalid JSON body')

  const employeeId = body.employeeId?.trim()
  const name = body.name?.trim()
  const phone = body.phone ? normalizePhone(body.phone) : null
  const email = body.email?.trim() || null
  const qualification = body.qualification?.trim() || null

  if (!employeeId) return err('employeeId is required')
  if (!name) return err('name is required')
  if (!phone) return err('a valid phone number is required')

  let password: string
  let temporaryPassword: string | null = null
  if (body.password !== undefined) {
    if (body.password.length < 8) return err('password must be at least 8 characters')
    password = body.password
  } else {
    temporaryPassword = generateTempPassword()
    password = temporaryPassword
  }

  try {
    const teacher = await prisma.$transaction(async (tx) => {
      const created = await tx.teacher.create({
        data: {
          employeeId,
          name,
          phone,
          email,
          qualification,
          passwordHash: hashPassword(password),
          createdById: user.id,
        },
        select: TEACHER_SELECT,
      })
      await writeAudit(tx, {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.name,
        action: 'TEACHER_CREATED',
        entityType: 'Teacher',
        entityId: created.id,
        newValue: created,
      })
      return created
    })
    return ok({ teacher, temporaryPassword }, 201)
  } catch (e) {
    return handleError(e)
  }
}
