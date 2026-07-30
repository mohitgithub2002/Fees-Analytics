import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, readJson, parseId, handleError } from '@/lib/teaching/http'

/** Change the time or room of a slot. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<{ startTime?: string; endTime?: string; roomLabel?: string | null }>(request)
  if (!body) return err('invalid JSON body')

  const data: Prisma.TimetableSlotUpdateInput = {}
  if (body.startTime !== undefined) data.startTime = body.startTime
  if (body.endTime !== undefined) data.endTime = body.endTime
  if (body.roomLabel !== undefined) data.roomLabel = body.roomLabel?.trim() || null
  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const slot = await prisma.timetableSlot.update({ where: { id }, data })
    return ok(slot)
  } catch (e) {
    return handleError(e)
  }
}

/** Remove a period slot. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    await prisma.timetableSlot.delete({ where: { id } })
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
