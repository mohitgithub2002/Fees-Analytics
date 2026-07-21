import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, readJson } from '@/lib/fees/api'
import { cached, invalidateTags, TAGS } from '@/lib/cache'

export async function GET() {
  const data = await cached('sessions:list', { tags: [TAGS.sessions], ttlMs: 120_000 }, () =>
    prisma.academicSession.findMany({
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { enrollments: true, classrooms: true } } },
    }),
  )
  return ok({ data })
}

export async function POST(request: NextRequest) {
  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { name, startDate, endDate, isCurrent } = body as {
    name?: string
    startDate?: string
    endDate?: string
    isCurrent?: boolean
  }
  if (!name?.trim()) return err('name is required')
  if (!startDate || isNaN(Date.parse(startDate))) return err('valid startDate is required')
  if (!endDate || isNaN(Date.parse(endDate))) return err('valid endDate is required')
  if (new Date(startDate) >= new Date(endDate)) return err('startDate must be before endDate')

  try {
    const session = await prisma.$transaction(async (tx) => {
      if (isCurrent) {
        await tx.academicSession.updateMany({ data: { isCurrent: false } })
      }
      return tx.academicSession.create({
        data: {
          name: name.trim(),
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          isCurrent: Boolean(isCurrent),
        },
      })
    })
    // isCurrent changes the default session for analytics/student lists.
    invalidateTags(TAGS.sessions, TAGS.fees)
    return ok(session, 201)
  } catch (e) {
    return handleError(e)
  }
}
