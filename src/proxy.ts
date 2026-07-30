import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { COOKIE_NAME, getAuthSecret } from '@/lib/auth/config'
import { verifyToken } from '@/lib/auth/token'
import { TEACHER_COOKIE_NAME } from '@/lib/auth/teacherConfig'

/**
 * Auth gate. Every request except public auth endpoints, the login page and
 * static assets must carry a valid session cookie. Unauthenticated page
 * requests are redirected to /login (preserving where they were headed);
 * unauthenticated API requests get a 401. Signed-in users hitting /login are
 * bounced to the dashboard.
 *
 * Token verification is stateless (signature + expiry only), so the gate adds
 * no database round-trip.
 *
 * The teacher panel (/api/v1/teacher/*) is a second, fully separate
 * subsystem: its own cookie, its own namespace. This gate only performs the
 * cheap presence check for it (is a teacher_session cookie attached at all);
 * the authoritative, DB-aware check happens in-handler via
 * getTeacherSession() (see lib/auth/teacher.ts) — mirroring the admin gate,
 * which likewise only checks the fees_session cookie here and never touches
 * the database.
 */

const PUBLIC_API_PREFIX = '/api/auth/'
const LOGIN_PATH = '/login'
const TEACHER_API_PREFIX = '/api/v1/teacher/'
const TEACHER_PUBLIC_PREFIX = '/api/v1/teacher/auth/'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Teacher panel: separate cookie, separate namespace, never touches the
  // admin session cookie or its verifier.
  if (pathname.startsWith(TEACHER_API_PREFIX)) {
    if (pathname.startsWith(TEACHER_PUBLIC_PREFIX)) return NextResponse.next()
    if (!request.cookies.get(TEACHER_COOKIE_NAME)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Public auth endpoints (login, logout, setup, status) are always reachable.
  if (pathname.startsWith(PUBLIC_API_PREFIX)) return NextResponse.next()

  const token = request.cookies.get(COOKIE_NAME)?.value
  const session = token ? await verifyToken(token, getAuthSecret()) : null

  if (pathname === LOGIN_PATH) {
    // Already signed in? Skip the login screen.
    if (session) return NextResponse.redirect(new URL('/manage', request.url))
    return NextResponse.next()
  }

  if (session) return NextResponse.next()

  // Unauthenticated.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = request.nextUrl.clone()
  url.pathname = LOGIN_PATH
  url.searchParams.set('next', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  // Run on everything except Next internals and static asset files.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|woff2?|map)$).*)',
  ],
}
