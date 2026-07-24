import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'
import { normalizePhone } from '@/lib/auth/phone'

/**
 * Admin account management. Restricted to the SUPERUSER — regular ADMINs
 * cannot list or create accounts. New accounts are always ADMIN (the single
 * SUPERUSER is created out-of-band via the CLI, never through the app).
 */

async function requireSuperuser() {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  if (user.role !== 'SUPERUSER') {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { user }
}

export async function GET() {
  const gate = await requireSuperuser()
  if (gate.error) return gate.error

  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    select: {
      id: true, phone: true, name: true, role: true,
      isActive: true, lastLoginAt: true, createdAt: true,
    },
  })
  return NextResponse.json({ data: users })
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperuser()
  if (gate.error) return gate.error

  let body: { name?: string; phone?: string; password?: string } | null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const name = body?.name?.trim()
  const phone = body?.phone ? normalizePhone(body.phone) : null
  const password = body?.password
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'a valid mobile number is required' }, { status: 400 })
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
  }

  try {
    const user = await prisma.user.create({
      data: { name, phone, passwordHash: hashPassword(password), role: 'ADMIN' },
      select: { id: true, phone: true, name: true, role: true, isActive: true, createdAt: true },
    })
    return NextResponse.json(user, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'an account with this mobile number already exists' }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: 'internal server error' }, { status: 500 })
  }
}
