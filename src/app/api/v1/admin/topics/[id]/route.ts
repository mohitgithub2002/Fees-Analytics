import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'

/** Update a topic. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<{ name?: string; displayOrder?: number; isActive?: boolean }>(request)
  if (!body) return err('invalid JSON body')

  const data: Prisma.TopicUpdateInput = {}
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return err('name cannot be empty')
    data.name = name
  }
  if (body.displayOrder !== undefined) data.displayOrder = body.displayOrder
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)
  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const topic = await prisma.topic.update({ where: { id }, data })
    return ok(topic)
  } catch (e) {
    return handleError(e)
  }
}

/** Soft-delete a topic. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    const topic = await prisma.topic.update({ where: { id }, data: { isActive: false } })
    return ok(topic)
  } catch (e) {
    return handleError(e)
  }
}
