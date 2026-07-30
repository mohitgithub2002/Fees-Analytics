import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, parseId } from '@/lib/teaching/http'

/** Subtopics not yet covered anywhere, filterable by class and subject. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const classId = parseId(sp.get('classId'))
  const subjectId = parseId(sp.get('subjectId'))

  const subtopics = await prisma.subtopic.findMany({
    where: {
      isActive: true,
      topic: {
        isActive: true,
        chapter: {
          isActive: true,
          ...(classId ? { classId } : {}),
          ...(subjectId ? { subjectId } : {}),
        },
      },
      topicDetails: {
        none: { status: 'COMPLETE', sessionLog: { type: 'TEACHING' } },
      },
    },
    select: {
      id: true,
      name: true,
      displayOrder: true,
      topic: {
        select: {
          id: true,
          name: true,
          chapter: {
            select: {
              id: true,
              name: true,
              subject: { select: { id: true, name: true } },
              class: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: [
      { topic: { chapter: { displayOrder: 'asc' } } },
      { topic: { displayOrder: 'asc' } },
      { displayOrder: 'asc' },
    ],
  })

  return ok(subtopics)
}
