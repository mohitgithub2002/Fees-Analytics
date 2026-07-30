import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, handleError } from '@/lib/teaching/http'

/** List all subjects. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const activeParam = request.nextUrl.searchParams.get('active')
  const subjects = await prisma.subject.findMany({
    where: activeParam === 'false' ? { isActive: false } : activeParam === 'all' ? {} : { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  })
  return ok(subjects)
}

/** Create a subject. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const body = await readJson<{ name?: string; code?: string; displayOrder?: number }>(request)
  if (!body) return err('invalid JSON body')

  const name = body.name?.trim()
  if (!name) return err('name is required')

  try {
    const subject = await prisma.subject.create({
      data: { name, code: body.code?.trim() || null, displayOrder: body.displayOrder ?? 0 },
    })
    return ok(subject, 201)
  } catch (e) {
    return handleError(e)
  }
}
