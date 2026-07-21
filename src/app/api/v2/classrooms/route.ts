import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { cached, invalidateTags, TAGS } from '@/lib/cache'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const sessionId = sp.get('sessionId') ? parseId(sp.get('sessionId')!) : null
  const classId = sp.get('classId') ? parseId(sp.get('classId')!) : null

  const data = await cached(
    `classrooms:${sessionId ?? ''}:${classId ?? ''}`,
    { tags: [TAGS.classrooms], ttlMs: 120_000 },
    () =>
      prisma.classroom.findMany({
        where: {
          ...(sessionId ? { sessionId } : {}),
          ...(classId ? { classId } : {}),
        },
        include: {
          class: true,
          session: { select: { id: true, name: true, isCurrent: true } },
          _count: { select: { enrollments: true } },
        },
        orderBy: [{ class: { displayOrder: 'asc' } }, { section: 'asc' }],
      }),
  )
  return ok({ data })
}

export async function POST(request: NextRequest) {
  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { classId, sessionId, section } = body as {
    classId?: number
    sessionId?: number
    section?: string
  }
  if (!Number.isInteger(classId)) return err('classId is required')
  if (!Number.isInteger(sessionId)) return err('sessionId is required')

  try {
    const classroom = await prisma.classroom.create({
      data: {
        classId: classId!,
        sessionId: sessionId!,
        section: section?.trim() || 'A',
      },
      include: { class: true, session: { select: { id: true, name: true } } },
    })
    // classroom counts appear in the sessions/classes lists too.
    invalidateTags(TAGS.classrooms, TAGS.sessions, TAGS.classes)
    return ok(classroom, 201)
  } catch (e) {
    return handleError(e)
  }
}
