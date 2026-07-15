import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const className = sp.get('class')
  const minDue = sp.get('minDue')
  const maxDue = sp.get('maxDue')
  const search = sp.get('search')
  const feeType = sp.get('feeType') || 'total'
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const limit = Math.min(100, Math.max(5, parseInt(sp.get('limit') || '50')))

  // Whitelisted sort fields (guards against arbitrary orderBy injection)
  const SORTABLE = new Set([
    'class', 'studentName', 'previousDue', 'schoolDue',
    'busDue', 'extraDue', 'totalDue',
  ])
  const sortKey = SORTABLE.has(sp.get('sortKey') || '') ? sp.get('sortKey')! : 'totalDue'
  const sortDir = sp.get('sortDir') === 'asc' ? 'asc' : 'desc'

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (className && className !== 'all') {
    where.class = className
  }

  if (search?.trim()) {
    where.OR = [
      { studentName: { contains: search.trim(), mode: 'insensitive' } },
      { fatherName: { contains: search.trim(), mode: 'insensitive' } },
    ]
  }

  // Map fee type to the correct due field
  const dueFieldMap: Record<string, string> = {
    previous: 'previousDue',
    school: 'schoolDue',
    bus: 'busDue',
    extra: 'extraDue',
    total: 'totalDue',
  }
  const dueField = dueFieldMap[feeType] || 'totalDue'

  if (minDue || maxDue) {
    where[dueField] = {}
    if (minDue) where[dueField].gte = parseFloat(minDue)
    if (maxDue) where[dueField].lte = parseFloat(maxDue)
  }

  const [total, students] = await Promise.all([
    prisma.studentFee.count({ where }),
    prisma.studentFee.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      // Sort across the ENTIRE filtered dataset, not just the current page.
      // A stable secondary key keeps ordering deterministic across pages.
      orderBy: sortKey === 'studentName'
        ? [{ studentName: sortDir }]
        : [{ [sortKey]: sortDir }, { studentName: 'asc' }],
      select: {
        id: true,
        class: true,
        studentName: true,
        fatherName: true,
        previousFees: true,
        previousDue: true,
        schoolFees: true,
        schoolDue: true,
        busFees: true,
        busDue: true,
        extraFees: true,
        extraDue: true,
        totalFees: true,
        totalDeposit: true,
        totalDue: true,
        academicYear: true,
        remarks: true,
      },
    }),
  ])

  return NextResponse.json({
    data: students,
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  })
}
