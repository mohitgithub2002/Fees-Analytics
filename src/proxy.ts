import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { COOKIE_NAME, getAuthSecret } from '@/lib/auth/config'
import { verifyToken } from '@/lib/auth/token'

/**
 * Auth gate. Every request except public auth endpoints, the login page and
 * static assets must carry a valid session cookie. Unauthenticated page
 * requests are redirected to /login (preserving where they were headed);
 * unauthenticated API requests get a 401. Signed-in users hitting /login are
 * bounced to the dashboard.
 *
 * Token verification is stateless (signature + expiry only), so the gate adds
 * no database round-trip.
 */

const PUBLIC_API_PREFIX = '/api/auth/'
const LOGIN_PATH = '/login'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

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
