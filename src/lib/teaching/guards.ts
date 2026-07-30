import { NextResponse } from 'next/server'
import { getCurrentUser, type SessionUser } from '@/lib/auth/session'
import { getTeacherSession, type TeacherSession } from '@/lib/auth/teacher'
import { err } from './http'

/**
 * Route guards for the two subsystems. Any authenticated admin (SUPERUSER or
 * ADMIN) may use the teacher-module admin routes — the existing role split
 * only matters for account management (see /api/auth/users). Proxy already
 * performs the cheap cookie-presence pre-filter; this is the authoritative,
 * DB-aware check every handler must call.
 */

export async function requireAdmin(): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const user = await getCurrentUser()
  if (!user) return { error: err('unauthorized', 401) }
  return { user }
}

export async function requireTeacher(): Promise<{ teacher: TeacherSession } | { error: NextResponse }> {
  const teacher = await getTeacherSession()
  if (!teacher) return { error: err('unauthorized', 401) }
  return { teacher }
}
