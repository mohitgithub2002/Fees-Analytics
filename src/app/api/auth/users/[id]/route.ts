import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'

/**
 * Update an ADMIN account (SUPERUSER only): rename, activate/deactivate, or
 * reset the password. SUPERUSER accounts can't be modified here — they are
 * managed via the CLI — which also prevents the superuser from locking
 * themselves out.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const current = await getCurrentUser()
  if (!current) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (current.role !== 'SUPERUSER') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const id = parseInt((await params).id, 10)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  let body: { name?: string; isActive?: boolean; password?: string } | null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) return NextResponse.json({ error: 'account not found' }, { status: 404 })
  if (target.role === 'SUPERUSER') {
    return NextResponse.json(
      { error: 'superuser accounts are managed from the server, not the app' },
      { status: 403 },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {}
  if (body?.name !== undefined) {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive)
  if (body?.password !== undefined) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
    }
    data.passwordHash = hashPassword(body.password)
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, phone: true, name: true, role: true, isActive: true, createdAt: true },
  })
  return NextResponse.json(user)
}
