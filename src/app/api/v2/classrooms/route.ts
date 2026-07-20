import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const sessionId = sp.get('sessionId') ? parseId(sp.get('sessionId')!) : null
  const classId = sp.get('classId') ? parseId(sp.get('classId')!) : null

  const classrooms = await prisma.classroom.findMany({
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
  })
  return ok({ data: classrooms })
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
    return ok(classroom, 201)
  } catch (e) {
    return handleError(e)
  }
}
