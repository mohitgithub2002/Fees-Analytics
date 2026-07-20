import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, ok, parseId } from '@/lib/fees/api'
import { Prisma } from '@/generated/prisma/client'

/**
 * Session-scoped fees analytics over the v2 schema.
 * ?sessionId=<id> — defaults to the current session.
 *
 * Returns an overview (assigned/discount/collected/due, split by category),
 * a class-wise breakdown, and the carried-forward dues that students enrolled
 * in this session still owe from earlier sessions.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  let sessionId = sp.get('sessionId') ? parseId(sp.get('sessionId')!) : null

  if (!sessionId) {
    const current = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (!current) return err('no current session set; pass ?sessionId=', 400)
    sessionId = current.id
  }
  const session = await prisma.academicSession.findUnique({ where: { id: sessionId } })
  if (!session) return err('session not found', 404)

  const [overview, byCategory, byClass, carriedForward] = await Promise.all([
    prisma.studentFeeItem.aggregate({
      where: { enrollment: { sessionId } },
      _sum: { originalAmount: true, discountAmount: true, netAmount: true, paidAmount: true, dueAmount: true },
    }),
    prisma.studentFeeItem.groupBy({
      by: ['category'],
      where: { enrollment: { sessionId } },
      _sum: { netAmount: true, paidAmount: true, dueAmount: true },
    }),
    prisma.$queryRaw<
      {
        classId: number
        class: string
        students: bigint
        netAmount: unknown
        paidAmount: unknown
        dueAmount: unknown
        schoolDue: unknown
        busDue: unknown
        otherDue: unknown
      }[]
    >(Prisma.sql`
      SELECT
        c.id                                                            AS "classId",
        c.name                                                          AS "class",
        COUNT(DISTINCT e.id)                                            AS "students",
        COALESCE(SUM(f."netAmount"), 0)                                 AS "netAmount",
        COALESCE(SUM(f."paidAmount"), 0)                                AS "paidAmount",
        COALESCE(SUM(f."dueAmount"), 0)                                 AS "dueAmount",
        COALESCE(SUM(CASE WHEN f.category = 'SCHOOL' THEN f."dueAmount" ELSE 0 END), 0) AS "schoolDue",
        COALESCE(SUM(CASE WHEN f.category = 'BUS'    THEN f."dueAmount" ELSE 0 END), 0) AS "busDue",
        COALESCE(SUM(CASE WHEN f.category = 'OTHER'  THEN f."dueAmount" ELSE 0 END), 0) AS "otherDue"
      FROM "StudentEnrollment" e
      JOIN "Classroom"   cr ON cr.id = e."classroomId"
      JOIN "SchoolClass" c  ON c.id  = cr."classId"
      LEFT JOIN "StudentFeeItem" f ON f."enrollmentId" = e.id
      WHERE e."sessionId" = ${sessionId}
      GROUP BY c.id, c.name, c."displayOrder"
      ORDER BY c."displayOrder" ASC
    `),
    // Dues that students enrolled in this session still owe from older sessions.
    prisma.$queryRaw<{ students: bigint; dueAmount: unknown }[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT e."studentId")     AS "students",
        COALESCE(SUM(f."dueAmount"), 0)   AS "dueAmount"
      FROM "StudentFeeItem" f
      JOIN "StudentEnrollment" e ON e.id = f."enrollmentId"
      JOIN "AcademicSession"  s ON s.id = e."sessionId"
      WHERE s."startDate" < ${session.startDate}
        AND f."dueAmount" > 0
        AND e."studentId" IN (
          SELECT "studentId" FROM "StudentEnrollment" WHERE "sessionId" = ${sessionId}
        )
    `),
  ])

  const students = await prisma.studentEnrollment.count({ where: { sessionId } })
  const net = Number(overview._sum.netAmount ?? 0)
  const paid = Number(overview._sum.paidAmount ?? 0)

  return ok({
    session: { id: session.id, name: session.name, isCurrent: session.isCurrent },
    overview: {
      totalStudents: students,
      totalFees: overview._sum.originalAmount ?? 0,
      totalDiscount: overview._sum.discountAmount ?? 0,
      netFees: net,
      totalCollected: paid,
      totalDue: overview._sum.dueAmount ?? 0,
      recoveryRate: net > 0 ? ((paid / net) * 100).toFixed(1) : '0',
    },
    byCategory,
    byClass,
    carriedForwardDues: carriedForward[0] ?? { students: 0, dueAmount: 0 },
  })
}
