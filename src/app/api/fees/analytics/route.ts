import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const className = sp.get('class')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}
  if (className && className !== 'all') {
    where.class = className
  }

  const [overview, byClass] = await Promise.all([
    prisma.studentFee.aggregate({
      where,
      _sum: {
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
      },
      _count: { id: true },
    }),
    prisma.studentFee.groupBy({
      by: ['class'],
      where,
      _sum: {
        previousDue: true,
        schoolDue: true,
        busDue: true,
        extraDue: true,
        totalDue: true,
        totalFees: true,
        totalDeposit: true,
      },
      _count: { id: true },
      orderBy: { class: 'asc' },
    }),
  ])

  const totalFees = overview._sum.totalFees ?? 0
  const totalDeposit = overview._sum.totalDeposit ?? 0

  return NextResponse.json({
    overview: {
      totalStudents: overview._count.id,
      totalFees,
      totalDeposit,
      totalDue: overview._sum.totalDue ?? 0,
      previousDue: overview._sum.previousDue ?? 0,
      schoolDue: overview._sum.schoolDue ?? 0,
      busDue: overview._sum.busDue ?? 0,
      extraDue: overview._sum.extraDue ?? 0,
      recoveryRate:
        totalFees > 0 ? ((totalDeposit / totalFees) * 100).toFixed(1) : '0',
    },
    byClass,
  })
}
