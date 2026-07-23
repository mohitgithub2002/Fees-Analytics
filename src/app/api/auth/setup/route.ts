import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookieOptions, COOKIE_NAME } from '@/lib/auth/config'
import { createSessionToken } from '@/lib/auth/session'
import { hashPassword } from '@/lib/auth/password'

/**
 * First-run bootstrap: create the very first ADMIN account. Self-disables
 * once any user exists (returns 403), so it is safe to leave exposed — it can
 * only ever be used to seed the initial account on a fresh install.
 */
export async function POST(request: NextRequest) {
  const existing = await prisma.user.count()
  if (existing > 0) {
    return NextResponse.json(
      { error: 'setup already completed; sign in instead' },
      { status: 403 },
    )
  }

  let body: { email?: string; password?: string; name?: string } | null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const email = body?.email?.trim().toLowerCase()
  const name = body?.name?.trim()
  const password = body?.password
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'a valid email is required' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
  }

  // Guard against a race between the count check and insert.
  let user
  try {
    user = await prisma.user.create({
      data: { email, name, passwordHash: hashPassword(password), role: 'ADMIN' },
    })
  } catch {
    return NextResponse.json({ error: 'setup already completed; sign in instead' }, { status: 403 })
  }

  const token = await createSessionToken(user)
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
  res.cookies.set(COOKIE_NAME, token, cookieOptions())
  return res
}
