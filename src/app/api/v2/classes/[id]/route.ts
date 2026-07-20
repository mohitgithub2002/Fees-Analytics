import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { name, displayOrder, isActive } = body as {
    name?: string
    displayOrder?: number
    isActive?: boolean
  }

  try {
    const schoolClass = await prisma.schoolClass.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(displayOrder !== undefined ? { displayOrder } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    })
    return ok(schoolClass)
  } catch (e) {
    return handleError(e)
  }
}
