import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'

/** List subtopics for a topic. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const topicId = parseId(sp.get('topicId'))
  if (!topicId) return err('topicId is required', 400)

  const activeParam = sp.get('active')
  const where: Prisma.SubtopicWhereInput = { topicId }
  if (activeParam === 'false') where.isActive = false
  else if (activeParam !== 'all') where.isActive = true

  const subtopics = await prisma.subtopic.findMany({ where, orderBy: { displayOrder: 'asc' } })
  return ok(subtopics)
}

/** Add a subtopic to a topic. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const body = await readJson<{ topicId?: number; name?: string; displayOrder?: number }>(request)
  if (!body) return err('invalid JSON body')

  const topicId = body.topicId
  const name = body.name?.trim()
  if (!topicId) return err('topicId is required')
  if (!name) return err('name is required')

  try {
    const subtopic = await prisma.subtopic.create({
      data: { topicId, name, displayOrder: body.displayOrder ?? 0 },
    })
    return ok(subtopic, 201)
  } catch (e) {
    return handleError(e)
  }
}
