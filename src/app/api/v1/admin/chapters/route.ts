import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'

/** List chapters, filtered by subjectId and classId. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const subjectId = parseId(sp.get('subjectId'))
  const classId = parseId(sp.get('classId'))
  const activeParam = sp.get('active')

  const where: Prisma.ChapterWhereInput = {}
  if (subjectId) where.subjectId = subjectId
  if (classId) where.classId = classId
  if (activeParam === 'false') where.isActive = false
  else if (activeParam !== 'all') where.isActive = true

  const chapters = await prisma.chapter.findMany({
    where,
    orderBy: { displayOrder: 'asc' },
    include: {
      subject: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
      _count: { select: { topics: true } },
    },
  })
  return ok(chapters)
}

/** Create a chapter under a subject and class. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const body = await readJson<{
    subjectId?: number
    classId?: number
    name?: string
    displayOrder?: number
    periodsRequired?: number
  }>(request)
  if (!body) return err('invalid JSON body')

  const subjectId = body.subjectId
  const classId = body.classId
  const name = body.name?.trim()
  if (!subjectId) return err('subjectId is required')
  if (!classId) return err('classId is required')
  if (!name) return err('name is required')

  try {
    const chapter = await prisma.chapter.create({
      data: {
        subjectId,
        classId,
        name,
        displayOrder: body.displayOrder ?? 0,
        periodsRequired: body.periodsRequired ?? null,
      },
      include: {
        subject: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
      },
    })
    return ok(chapter, 201)
  } catch (e) {
    return handleError(e)
  }
}
