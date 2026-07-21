import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, readJson } from '@/lib/fees/api'
import { cached, invalidateTags, TAGS } from '@/lib/cache'

export async function GET() {
  const data = await cached('classes:list', { tags: [TAGS.classes], ttlMs: 300_000 }, () =>
    prisma.schoolClass.findMany({
      orderBy: { displayOrder: 'asc' },
      include: { _count: { select: { classrooms: true, feeStructures: true } } },
    }),
  )
  return ok({ data })
}

export async function POST(request: NextRequest) {
  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { name, displayOrder } = body as { name?: string; displayOrder?: number }
  if (!name?.trim()) return err('name is required')

  try {
    const schoolClass = await prisma.schoolClass.create({
      data: {
        name: name.trim(),
        displayOrder: typeof displayOrder === 'number' ? displayOrder : 0,
      },
    })
    invalidateTags(TAGS.classes)
    return ok(schoolClass, 201)
  } catch (e) {
    return handleError(e)
  }
}
