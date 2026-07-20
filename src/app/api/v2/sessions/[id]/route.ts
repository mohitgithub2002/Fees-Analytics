import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const session = await prisma.academicSession.findUnique({
    where: { id },
    include: {
      classrooms: { include: { class: true, _count: { select: { enrollments: true } } } },
      _count: { select: { enrollments: true } },
    },
  })
  if (!session) return err('session not found', 404)
  return ok(session)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { name, startDate, endDate, isCurrent } = body as {
    name?: string
    startDate?: string
    endDate?: string
    isCurrent?: boolean
  }
  if (startDate !== undefined && isNaN(Date.parse(startDate))) return err('invalid startDate')
  if (endDate !== undefined && isNaN(Date.parse(endDate))) return err('invalid endDate')

  try {
    const session = await prisma.$transaction(async (tx) => {
      if (isCurrent === true) {
        await tx.academicSession.updateMany({
          where: { id: { not: id } },
          data: { isCurrent: false },
        })
      }
      return tx.academicSession.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(startDate !== undefined ? { startDate: new Date(startDate) } : {}),
          ...(endDate !== undefined ? { endDate: new Date(endDate) } : {}),
          ...(isCurrent !== undefined ? { isCurrent } : {}),
        },
      })
    })
    return ok(session)
  } catch (e) {
    return handleError(e)
  }
}
