import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, parseId } from '@/lib/teaching/http'

/** Test and revision frequency by subject and chapter. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const subjectId = parseId(request.nextUrl.searchParams.get('subjectId'))

  const chapters = await prisma.chapter.findMany({
    where: { isActive: true, ...(subjectId ? { subjectId } : {}) },
    select: {
      id: true,
      name: true,
      displayOrder: true,
      subject: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
      _count: { select: { topicDetails: { where: { sessionLog: { type: 'TEST' } } } } },
      topics: {
        where: { isActive: true },
        select: {
          subtopics: {
            where: { isActive: true },
            select: { _count: { select: { topicDetails: { where: { sessionLog: { type: 'REVISION' } } } } } },
          },
        },
      },
    },
    orderBy: [{ subjectId: 'asc' }, { displayOrder: 'asc' }],
  })

  const coverage = chapters.map((c) => ({
    chapterId: c.id,
    chapterName: c.name,
    subjectId: c.subject.id,
    subjectName: c.subject.name,
    className: c.class.name,
    testCount: c._count.topicDetails,
    revisionCount: c.topics.reduce(
      (sum, t) => sum + t.subtopics.reduce((s, st) => s + st._count.topicDetails, 0),
      0,
    ),
  }))

  return ok(coverage)
}
