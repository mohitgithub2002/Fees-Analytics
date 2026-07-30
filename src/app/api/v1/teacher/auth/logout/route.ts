import { clearTeacherSessionCookie } from '@/lib/auth/teacher'
import { ok } from '@/lib/teaching/http'

/** Clear the teacher session cookie. */
export async function POST() {
  await clearTeacherSessionCookie()
  return ok({ loggedOut: true })
}
