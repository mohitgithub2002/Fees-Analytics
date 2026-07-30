import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'

/** Update name, order or estimated periods required. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<{
    name?: string
    displayOrder?: number
    periodsRequired?: number | null
    isActive?: boolean
  }>(request)
  if (!body) return err('invalid JSON body')

  const data: Prisma.ChapterUpdateInput = {}
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return err('name cannot be empty')
    data.name = name
  }
  if (body.displayOrder !== undefined) data.displayOrder = body.displayOrder
  if (body.periodsRequired !== undefined) data.periodsRequired = body.periodsRequired
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)
  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const chapter = await prisma.chapter.update({
      where: { id },
      data,
      include: { subject: { select: { id: true, name: true } }, class: { select: { id: true, name: true } } },
    })
    return ok(chapter)
  } catch (e) {
    return handleError(e)
  }
}

/** Soft-delete a chapter. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    const chapter = await prisma.chapter.update({ where: { id }, data: { isActive: false } })
    return ok(chapter)
  } catch (e) {
    return handleError(e)
  }
}
