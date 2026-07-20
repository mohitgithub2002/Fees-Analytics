import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, readJson } from '@/lib/fees/api'

export async function GET() {
  const classes = await prisma.schoolClass.findMany({
    orderBy: { displayOrder: 'asc' },
    include: { _count: { select: { classrooms: true, feeStructures: true } } },
  })
  return ok({ data: classes })
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
    return ok(schoolClass, 201)
  } catch (e) {
    return handleError(e)
  }
}
