import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/session'

/**
 * Public auth status for the login screen and the sidebar:
 * - authenticated + the current user (if signed in)
 * - needsSetup: true when no accounts exist yet (first-run bootstrap)
 */
export async function GET() {
  const user = await getCurrentUser()
  if (user) {
    return NextResponse.json({ authenticated: true, needsSetup: false, user })
  }
  const count = await prisma.user.count()
  return NextResponse.json({ authenticated: false, needsSetup: count === 0, user: null })
}
