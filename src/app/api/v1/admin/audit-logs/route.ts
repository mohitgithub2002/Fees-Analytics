import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, parseId, parsePagination, paginationMeta } from '@/lib/teaching/http'

/** Audit trail, filterable by actor, entity, action and date range. */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const actorType = sp.get('actorType')
  const actorId = parseId(sp.get('actorId'))
  const entityType = sp.get('entityType')
  const entityId = parseId(sp.get('entityId'))
  const action = sp.get('action')
  const from = sp.get('from')
  const to = sp.get('to')
  const { page, pageSize, skip, take } = parsePagination(sp)

  const where: Prisma.TeachingAuditLogWhereInput = {}
  if (actorType) where.actorType = actorType as Prisma.TeachingAuditLogWhereInput['actorType']
  if (actorId) where.actorId = actorId
  if (entityType) where.entityType = entityType
  if (entityId) where.entityId = entityId
  if (action) where.action = action
  if (from || to) {
    where.createdAt = {
      ...(from && !isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}),
      ...(to && !isNaN(Date.parse(to)) ? { lte: new Date(to) } : {}),
    }
  }

  const [logs, total] = await Promise.all([
    prisma.teachingAuditLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        actorType: true,
        actorId: true,
        actorName: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
      },
    }),
    prisma.teachingAuditLog.count({ where }),
  ])

  return ok({ logs, pagination: paginationMeta(page, pageSize, total) })
}
