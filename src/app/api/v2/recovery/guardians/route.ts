import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { ok, parseId } from '@/lib/fees/api'

/**
 * Segmentation browser: filter households by archetype, tier, due band,
 * class, contact recency and promise status. Server-sorted and paginated,
 * same pattern as /api/v2/students.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const archetype = sp.get('archetype')
  const tier = sp.get('tier')
  const classId = sp.get('class') ? parseId(sp.get('class')!) : null
  const search = sp.get('search')?.trim()
  const minDue = sp.get('minDue') ? parseFloat(sp.get('minDue')!) : null
  const maxDue = sp.get('maxDue') ? parseFloat(sp.get('maxDue')!) : null
  const promiseStatus = sp.get('promiseStatus')
  const staleDays = sp.get('staleDays') ? parseInt(sp.get('staleDays')!) : null
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const limit = Math.min(100, Math.max(5, parseInt(sp.get('limit') || '50')))

  const archetypeSql = archetype ? Prisma.sql`AND p.archetype = ${archetype}::"PaymentArchetype"` : Prisma.empty
  const tierSql = tier
    ? Prisma.sql`AND (CASE WHEN g."economicTier" = 'UNKNOWN' THEN p."suggestedTier" ELSE g."economicTier" END) = ${tier}::"EconomicTier"`
    : Prisma.empty
  const searchSql = search ? Prisma.sql`AND g.name ILIKE ${'%' + search + '%'}` : Prisma.empty
  const classSql = classId
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "GuardianStudent" gs2
        JOIN "StudentEnrollment" e2 ON e2."studentId" = gs2."studentId"
        JOIN "Classroom" cr2 ON cr2.id = e2."classroomId"
        WHERE gs2."guardianId" = g.id AND gs2."isPayer" = true AND cr2."classId" = ${classId}
      )`
    : Prisma.empty
  const dueSql =
    minDue != null && maxDue != null
      ? Prisma.sql`AND p."totalOutstanding" BETWEEN ${minDue} AND ${maxDue}`
      : minDue != null
        ? Prisma.sql`AND p."totalOutstanding" >= ${minDue}`
        : maxDue != null
          ? Prisma.sql`AND p."totalOutstanding" <= ${maxDue}`
          : Prisma.empty
  const promiseSql = promiseStatus
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "PromiseToPay" pr WHERE pr."guardianId" = g.id AND pr.status = ${promiseStatus}::"PromiseStatus")`
    : Prisma.empty
  const staleSql =
    staleDays != null
      ? Prisma.sql`AND (p."calculatedAt" IS NULL OR NOT EXISTS (
          SELECT 1 FROM "ContactAttempt" ca WHERE ca."guardianId" = g.id
            AND ca."contactedAt" >= NOW() - (${staleDays}::text || ' days')::interval
        ))`
      : Prisma.empty

  const rows = await prisma.$queryRaw<
    {
      id: number
      name: string
      phone: string | null
      economicTier: string
      archetype: string | null
      suggestedTier: string | null
      totalOutstanding: unknown
      expectedRecovery30d: unknown
      childrenCount: number | null
      lastContactAt: Date | null
      fullCount: bigint
    }[]
  >(Prisma.sql`
    SELECT g.id, g.name, g.phone, g."economicTier",
           p.archetype, p."suggestedTier", p."totalOutstanding", p."expectedRecovery30d",
           p."childrenCount",
           (SELECT MAX(ca."contactedAt") FROM "ContactAttempt" ca WHERE ca."guardianId" = g.id) AS "lastContactAt",
           COUNT(*) OVER() AS "fullCount"
    FROM "Guardian" g
    LEFT JOIN "GuardianProfile" p ON p."guardianId" = g.id
    WHERE g."isActive" = true
      AND COALESCE(p."totalOutstanding", 0) > 0
      ${archetypeSql} ${tierSql} ${searchSql} ${classSql} ${dueSql} ${promiseSql} ${staleSql}
    ORDER BY p."expectedRecovery30d" DESC NULLS LAST
    LIMIT ${limit} OFFSET ${(page - 1) * limit}
  `)

  const total = rows.length ? Number(rows[0].fullCount) : 0
  return ok({
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      economicTier: r.economicTier,
      archetype: r.archetype ?? 'UNKNOWN',
      suggestedTier: r.suggestedTier ?? 'UNKNOWN',
      totalOutstanding: Number(r.totalOutstanding ?? 0),
      expectedRecovery30d: Number(r.expectedRecovery30d ?? 0),
      childrenCount: r.childrenCount ?? 0,
      lastContactAt: r.lastContactAt,
    })),
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  })
}
