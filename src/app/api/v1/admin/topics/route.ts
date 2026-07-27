import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'

/** List topics for a chapter. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const chapterId = parseId(sp.get('chapterId'))
  if (!chapterId) return err('chapterId is required', 400)

  const activeParam = sp.get('active')
  const where: Prisma.TopicWhereInput = { chapterId }
  if (activeParam === 'false') where.isActive = false
  else if (activeParam !== 'all') where.isActive = true

  const topics = await prisma.topic.findMany({
    where,
    orderBy: { displayOrder: 'asc' },
    include: { _count: { select: { subtopics: true } } },
  })
  return ok(topics)
}

/** Add a topic to a chapter. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const body = await readJson<{ chapterId?: number; name?: string; displayOrder?: number }>(request)
  if (!body) return err('invalid JSON body')

  const chapterId = body.chapterId
  const name = body.name?.trim()
  if (!chapterId) return err('chapterId is required')
  if (!name) return err('name is required')

  try {
    const topic = await prisma.topic.create({
      data: { chapterId, name, displayOrder: body.displayOrder ?? 0 },
    })
    return ok(topic, 201)
  } catch (e) {
    return handleError(e)
  }
}
