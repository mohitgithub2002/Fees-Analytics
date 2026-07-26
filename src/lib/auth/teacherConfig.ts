import { getAuthSecret } from './config'

/**
 * Teacher auth configuration. Mirrors config.ts but stays fully separate:
 * own cookie name, own TTL, own signing secret. Must stay free of Node-only
 * imports (no `node:crypto`, no Prisma) so it can be imported from
 * proxy.ts, which runs before the app.
 */

export const TEACHER_COOKIE_NAME = 'teacher_session'

/** Session lifetime: 12 hours (a school day, not a persistent login). */
export const TEACHER_SESSION_TTL_MS = 12 * 60 * 60 * 1000

let warned = false

/**
 * The HMAC secret used to sign teacher session cookies. Deliberately
 * distinct from the admin secret (even without a dedicated env var) so a
 * teacher token can never verify successfully under the admin cookie/secret
 * pair, and vice versa — cross-subsystem cookie replay fails at the
 * signature check, not just on an application-level role/kind assertion.
 * Set `TEACHER_AUTH_SECRET` in the environment for anything real.
 */
export function getTeacherAuthSecret(): string {
  const secret = process.env.TEACHER_AUTH_SECRET
  if (secret && secret.length >= 16) return secret
  if (!warned) {
    warned = true
    console.warn(
      '[auth] TEACHER_AUTH_SECRET is not set (or too short); deriving from AUTH_SECRET. ' +
        'Set a dedicated TEACHER_AUTH_SECRET in production.',
    )
  }
  return `${getAuthSecret()}::teacher`
}

export function teacherCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(TEACHER_SESSION_TTL_MS / 1000),
  }
}
