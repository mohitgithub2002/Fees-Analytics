import { cookies } from 'next/headers'
import { COOKIE_NAME, getAuthSecret, SESSION_TTL_MS } from './config'
import { signToken, verifyToken } from './token'

/**
 * Session helpers for route handlers and server components. Reads/writes the
 * signed session cookie via `next/headers`.
 */

export interface SessionUser {
  id: number
  email: string
  name: string
  role: string
}

export async function createSessionToken(user: {
  id: number
  email: string
  name: string
  role: string
}): Promise<string> {
  return signToken(
    { sub: user.id, email: user.email, name: user.name, role: user.role, exp: Date.now() + SESSION_TTL_MS },
    getAuthSecret(),
  )
}

/** The signed-in user for the current request, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null
  const payload = await verifyToken(token, getAuthSecret())
  if (!payload) return null
  return { id: payload.sub, email: payload.email, name: payload.name, role: payload.role }
}
