import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/auth/password'
import { setTeacherSessionCookie } from '@/lib/auth/teacher'
import { ok, err, readJson } from '@/lib/teaching/http'

/**
 * Simple in-memory throttle to slow credential-stuffing, mirroring the admin
 * login route. Per-instance only — a coarse safety net, not a hard limit.
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

/** Authenticate with employee ID or phone plus password, set the teacher_session cookie. */
export async function POST(request: NextRequest) {
  const body = await readJson<{ employeeId?: string; phone?: string; password?: string }>(request)
  if (!body) return err('invalid JSON body', 400)

  const identifier = body.employeeId?.trim() || body.phone?.trim()
  const password = body.password
  if (!identifier || !password) {
    return err('employeeId or phone, and password, are required', 400)
  }

  if (throttled(identifier)) {
    return err('too many failed attempts; please try again later', 429)
  }

  const teacher = await prisma.teacher.findFirst({
    where: { OR: [{ employeeId: identifier }, { phone: identifier }] },
  })
  // Verify even when the teacher is missing/inactive to keep timing uniform.
  const passwordOk = teacher && teacher.isActive && verifyPassword(password, teacher.passwordHash)
  if (!passwordOk || !teacher) {
    recordFailure(identifier)
    return err('invalid credentials', 401)
  }

  attempts.delete(identifier)
  await prisma.teacher.update({ where: { id: teacher.id }, data: { lastLoginAt: new Date() } })
  await setTeacherSessionCookie(teacher)

  return ok({
    teacher: { id: teacher.id, employeeId: teacher.employeeId, name: teacher.name, phone: teacher.phone },
  })
}
