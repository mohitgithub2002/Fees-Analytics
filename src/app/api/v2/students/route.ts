import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { Prisma } from '@/generated/prisma/client'

// Whitelisted sort columns → aggregated aliases (guards against SQL injection).
const SORTABLE: Record<string, string> = {
  name: 'name', class: 'class',
  schoolDue: 'schoolDue', busDue: 'busDue', otherDue: 'otherDue',
  currentDue: 'currentDue', pastDue: 'pastDue', totalDue: 'totalDue',
}
// feeType → the due column the min/max range filters and sorts against.
const DUE_FIELD: Record<string, string> = {
  total: 'totalDue', school: 'schoolDue', bus: 'busDue', other: 'otherDue', past: 'pastDue',
}

interface StudentRow {
  id: number
  name: string
  fatherName: string
  admissionNo: string | null
  class: string | null
  section: string | null
  schoolDue: number
  busDue: number
  otherDue: number
  currentDue: number
  pastDue: number
  totalDue: number
  fullCount: number
}

/**
 * Session-scoped student directory with per-student due aggregation.
 *
 * Dues are summed in SQL from the student's current-session fee items (split
 * by category) plus a carried-forward "past" total from all earlier sessions,
 * so the list can be filtered/sorted on any due bucket with correct
 * server-side pagination. Students without a current-session enrollment still
 * appear (with null class / zero current dues) unless a class filter is set.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const search = sp.get('search')?.trim()
  const classId = sp.get('class') && sp.get('class') !== 'all' ? parseId(sp.get('class')!) : null
  const feeType = DUE_FIELD[sp.get('feeType') || 'total'] ? (sp.get('feeType') || 'total') : 'total'
  const dueField = DUE_FIELD[feeType]
  const minDue = sp.get('minDue') ? parseFloat(sp.get('minDue')!) : null
  const maxDue = sp.get('maxDue') ? parseFloat(sp.get('maxDue')!) : null
  const sortKey = SORTABLE[sp.get('sortKey') || ''] || 'totalDue'
  const sortDir = sp.get('sortDir') === 'asc' ? 'ASC' : 'DESC'
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const limit = Math.min(100, Math.max(5, parseInt(sp.get('limit') || '50')))

  let sessionId = sp.get('sessionId') ? parseId(sp.get('sessionId')!) : null
  const session = sessionId
    ? await prisma.academicSession.findUnique({ where: { id: sessionId } })
    : await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (!session) return ok({ data: [], pagination: { page, limit, total: 0, pages: 1 }, session: null })
  sessionId = session.id

  // Filter fragments (parameterised; column names come from whitelists only).
  const searchSql = search
    ? Prisma.sql`AND (s.name ILIKE ${'%' + search + '%'} OR s."fatherName" ILIKE ${'%' + search + '%'} OR s."admissionNo" ILIKE ${'%' + search + '%'})`
    : Prisma.empty
  const classSql = classId ? Prisma.sql`AND cl.id = ${classId}` : Prisma.empty
  const dueCol = Prisma.raw(`"${dueField}"`)
  const dueSql =
    minDue != null && maxDue != null ? Prisma.sql`WHERE ${dueCol} BETWEEN ${minDue} AND ${maxDue}`
    : minDue != null ? Prisma.sql`WHERE ${dueCol} >= ${minDue}`
    : maxDue != null ? Prisma.sql`WHERE ${dueCol} <= ${maxDue}`
    : Prisma.empty
  const orderSql = Prisma.raw(`"${sortKey}" ${sortDir}`)

  const rows = await prisma.$queryRaw<StudentRow[]>(Prisma.sql`
    WITH cur AS (
      SELECT
        s.id, s.name, s."fatherName", s."admissionNo",
        cl.name AS class, cr.section AS section,
        COALESCE(SUM(CASE WHEN f.category = 'SCHOOL' THEN f."dueAmount" ELSE 0 END), 0) AS "schoolDue",
        COALESCE(SUM(CASE WHEN f.category = 'BUS'    THEN f."dueAmount" ELSE 0 END), 0) AS "busDue",
        COALESCE(SUM(CASE WHEN f.category = 'OTHER'  THEN f."dueAmount" ELSE 0 END), 0) AS "otherDue",
        COALESCE(SUM(f."dueAmount"), 0) AS "currentDue"
      FROM "Student" s
      LEFT JOIN "StudentEnrollment" e ON e."studentId" = s.id AND e."sessionId" = ${sessionId}
      LEFT JOIN "Classroom"   cr ON cr.id = e."classroomId"
      LEFT JOIN "SchoolClass" cl ON cl.id = cr."classId"
      LEFT JOIN "StudentFeeItem" f ON f."enrollmentId" = e.id
      WHERE 1 = 1 ${searchSql} ${classSql}
      GROUP BY s.id, s.name, s."fatherName", s."admissionNo", cl.name, cr.section
    ),
    past AS (
      SELECT e."studentId" AS id, COALESCE(SUM(f."dueAmount"), 0) AS "pastDue"
      FROM "StudentEnrollment" e
      JOIN "AcademicSession" s2 ON s2.id = e."sessionId" AND s2."startDate" < ${session.startDate}
      JOIN "StudentFeeItem" f ON f."enrollmentId" = e.id
      GROUP BY e."studentId"
    ),
    combined AS (
      SELECT cur.*, COALESCE(past."pastDue", 0) AS "pastDue",
             cur."currentDue" + COALESCE(past."pastDue", 0) AS "totalDue"
      FROM cur LEFT JOIN past ON past.id = cur.id
    )
    SELECT *, COUNT(*) OVER() AS "fullCount"
    FROM combined
    ${dueSql}
    ORDER BY ${orderSql}, name ASC
    LIMIT ${limit} OFFSET ${(page - 1) * limit}
  `)

  const total = rows.length ? Number(rows[0].fullCount) : 0
  const data = rows.map((r) => ({
    id: r.id, name: r.name, fatherName: r.fatherName, admissionNo: r.admissionNo,
    class: r.class, section: r.section,
    schoolDue: Number(r.schoolDue), busDue: Number(r.busDue), otherDue: Number(r.otherDue),
    currentDue: Number(r.currentDue), pastDue: Number(r.pastDue), totalDue: Number(r.totalDue),
  }))

  return ok({
    data,
    session: { id: session.id, name: session.name },
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  })
}

export async function POST(request: NextRequest) {
  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { name, fatherName, motherName, phone, address, gender, dateOfBirth, admissionNo, remarks } =
    body as Record<string, string | undefined>
  if (!name?.trim()) return err('name is required')
  if (!fatherName?.trim()) return err('fatherName is required')
  if (dateOfBirth && isNaN(Date.parse(dateOfBirth))) return err('invalid dateOfBirth')

  try {
    const student = await prisma.student.create({
      data: {
        name: name.trim(),
        fatherName: fatherName.trim(),
        motherName: motherName?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        gender: gender?.trim() || null,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        admissionNo: admissionNo?.trim() || null,
        remarks: remarks?.trim() || null,
      },
    })
    return ok(student, 201)
  } catch (e) {
    return handleError(e)
  }
}
