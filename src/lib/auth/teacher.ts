import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { signToken, verifyToken } from './token'
import {
  TEACHER_COOKIE_NAME,
  TEACHER_SESSION_TTL_MS,
  getTeacherAuthSecret,
  teacherCookieOptions,
} from './teacherConfig'

/**
 * Teacher session helpers — mirrors src/lib/auth/session.ts but through a
 * completely separate code path, cookie and lookup table. The two never
 * intersect: see docs for why the Teacher table is not folded into User.
 *
 * Unlike admin sessions (stateless, no DB round trip), every teacher session
 * lookup re-checks isActive in the database, so a deactivated teacher's
 * existing session stops resolving on the very next request.
 */

export interface TeacherTokenPayload {
  sub: number
  employeeId: string
  name: string
  kind: 'teacher'
  exp: number
}

export interface TeacherSession {
  id: number
  name: string
  employeeId: string
}

export async function createTeacherSessionToken(teacher: {
  id: number
  employeeId: string
  name: string
}): Promise<string> {
  return signToken<TeacherTokenPayload>(
    {
      sub: teacher.id,
      employeeId: teacher.employeeId,
      name: teacher.name,
      kind: 'teacher',
      exp: Date.now() + TEACHER_SESSION_TTL_MS,
    },
    getTeacherAuthSecret(),
  )
}

export async function setTeacherSessionCookie(teacher: {
  id: number
  employeeId: string
  name: string
}): Promise<void> {
  const token = await createTeacherSessionToken(teacher)
  ;(await cookies()).set(TEACHER_COOKIE_NAME, token, teacherCookieOptions())
}

export async function clearTeacherSessionCookie(): Promise<void> {
  ;(await cookies()).delete(TEACHER_COOKIE_NAME)
}

/** The signed-in teacher for the current request, or null. */
export async function getTeacherSession(): Promise<TeacherSession | null> {
  const token = (await cookies()).get(TEACHER_COOKIE_NAME)?.value
  if (!token) return null

  const payload = await verifyToken<TeacherTokenPayload>(token, getTeacherAuthSecret())
  if (!payload || payload.kind !== 'teacher') return null

  const teacher = await prisma.teacher.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, employeeId: true, isActive: true },
  })
  if (!teacher || !teacher.isActive) return null

  return { id: teacher.id, name: teacher.name, employeeId: teacher.employeeId }
}
