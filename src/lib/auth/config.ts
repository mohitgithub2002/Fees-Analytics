/**
 * Auth configuration shared by the proxy gate and the route handlers.
 *
 * This module must stay free of Node-only imports (no `node:crypto`, no
 * Prisma) so it can be imported from `proxy.ts`, which runs before the app.
 */

export const COOKIE_NAME = 'fees_session'

/** Session lifetime: 7 days. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const DEV_FALLBACK_SECRET = 'dev-insecure-secret-change-me-via-AUTH_SECRET'

let warned = false

/**
 * The HMAC secret used to sign session cookies. Set `AUTH_SECRET` in the
 * environment for anything real — without it a fixed dev secret is used so
 * local development works, but that secret is public and unsafe for prod.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (secret && secret.length >= 16) return secret
  if (!warned) {
    warned = true
    console.warn(
      '[auth] AUTH_SECRET is not set (or too short); using an insecure dev secret. ' +
        'Set AUTH_SECRET to a long random string in production.',
    )
  }
  return DEV_FALLBACK_SECRET
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}
