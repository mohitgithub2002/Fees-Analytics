import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { requireTeacher } from '@/lib/teaching/guards'
import { ok, err, readJson } from '@/lib/teaching/http'

/** Change own password after verifying the current one. */
export async function POST(request: NextRequest) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error

  const body = await readJson<{ currentPassword?: string; newPassword?: string }>(request)
  if (!body) return err('invalid JSON body')

  const { currentPassword, newPassword } = body
  if (!currentPassword) return err('currentPassword is required')
  if (!newPassword || newPassword.length < 8) return err('newPassword must be at least 8 characters')

  const teacher = await prisma.teacher.findUnique({ where: { id: gate.teacher.id } })
  if (!teacher || !verifyPassword(currentPassword, teacher.passwordHash)) {
    return err('current password is incorrect', 401)
  }

  await prisma.teacher.update({ where: { id: teacher.id }, data: { passwordHash: hashPassword(newPassword) } })
  return ok({ changed: true })
}
