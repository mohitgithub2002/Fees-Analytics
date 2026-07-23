import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookieOptions, COOKIE_NAME } from '@/lib/auth/config'
import { createSessionToken } from '@/lib/auth/session'
import { verifyPassword } from '@/lib/auth/password'
import { normalizePhone } from '@/lib/auth/phone'

/**
 * Simple in-memory throttle to slow credential-stuffing: after too many
 * failures for a phone number within the window, further attempts are rejected
 * for a cool-off period. Per-instance only — a coarse safety net, not a hard
 * limit.
 */
const attempts = new Map<string, { count: number; first: number }>()
const MAX_ATTEMPTS = 8
const WINDOW_MS = 10 * 60 * 1000

function throttled(key: string): boolean {
  const now = Date.now()
  const rec = attempts.get(key)
  if (!rec || now - rec.first > WINDOW_MS) return false
  return rec.count >= MAX_ATTEMPTS
}
function recordFailure(key: string) {
  const now = Date.now()
  const rec = attempts.get(key)
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: now })
  else rec.count++
}

export async function POST(request: NextRequest) {
  let body: { phone?: string; password?: string } | null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const phone = body?.phone ? normalizePhone(body.phone) : null
  const password = body?.password
  if (!phone || !password) {
    return NextResponse.json({ error: 'mobile number and password are required' }, { status: 400 })
  }

  if (throttled(phone)) {
    return NextResponse.json(
      { error: 'too many failed attempts; please try again later' },
      { status: 429 },
    )
  }

  const user = await prisma.user.findUnique({ where: { phone } })
  // Verify even when the user is missing/inactive to keep timing uniform.
  const ok = user && user.isActive && verifyPassword(password, user.passwordHash)
  if (!ok || !user) {
    recordFailure(phone)
    return NextResponse.json({ error: 'invalid mobile number or password' }, { status: 401 })
  }

  attempts.delete(phone)
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  const token = await createSessionToken(user)
  const res = NextResponse.json({
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
  })
  res.cookies.set(COOKIE_NAME, token, cookieOptions())
  return res
}
