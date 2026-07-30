import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'

/** Update a subject's name, code or display order. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<{ name?: string; code?: string | null; displayOrder?: number; isActive?: boolean }>(request)
  if (!body) return err('invalid JSON body')

  const data: Prisma.SubjectUpdateInput = {}
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return err('name cannot be empty')
    data.name = name
  }
  if (body.code !== undefined) data.code = body.code?.trim() || null
  if (body.displayOrder !== undefined) data.displayOrder = body.displayOrder
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)
  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const subject = await prisma.subject.update({ where: { id }, data })
    return ok(subject)
  } catch (e) {
    return handleError(e)
  }
}

/** Soft-delete by setting isActive to false. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    const subject = await prisma.subject.update({ where: { id }, data: { isActive: false } })
    return ok(subject)
  } catch (e) {
    return handleError(e)
  }
}
