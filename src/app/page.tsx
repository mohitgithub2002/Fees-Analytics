import { Sidebar }         from '@/components/Sidebar'
import { DashboardClient } from '@/components/DashboardClient'
import { prisma }          from '@/lib/prisma'
import type { Analytics, StudentsResponse } from '@/lib/types'

const CLASS_ORDER = [
  'Nursery','LKG','UKG','I','II','III','IV','V','VI','VII','VIII','IX','X',
]

async function getInitialData(): Promise<{
  analytics: Analytics
  students:  StudentsResponse
}> {
  const [overview, byClassRaw, studentRows, total] = await Promise.all([
    prisma.studentFee.aggregate({
      _sum: {
        previousFees: true, previousDue: true,
        schoolFees: true,   schoolDue: true,
        busFees: true,      busDue: true,
        extraFees: true,    extraDue: true,
        totalFees: true,    totalDeposit: true, totalDue: true,
      },
      _count: { id: true },
    }),
    prisma.studentFee.groupBy({
      by: ['class'],
      _sum: {
        previousDue: true, schoolDue: true, busDue: true,
        extraDue: true,    totalDue: true,  totalFees: true, totalDeposit: true,
      },
      _count: { id: true },
    }),
    prisma.studentFee.findMany({
      take: 20,
      orderBy: [{ totalDue: 'desc' }, { studentName: 'asc' }],
      select: {
        id: true, class: true, studentName: true, fatherName: true,
        previousFees: true, previousDue: true,
        schoolFees: true,   schoolDue: true,
        busFees: true,      busDue: true,
        extraFees: true,    extraDue: true,
        totalFees: true,    totalDeposit: true, totalDue: true,
        academicYear: true, remarks: true,
      },
    }),
    prisma.studentFee.count(),
  ])

  const totalFees    = overview._sum.totalFees    ?? 0
  const totalDeposit = overview._sum.totalDeposit ?? 0

  // Sort by class order
  const byClass = byClassRaw.sort(
    (a, b) => CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class)
  )

  return {
    analytics: {
      overview: {
        totalStudents: overview._count.id,
        totalFees,
        totalDeposit,
        totalDue:    overview._sum.totalDue    ?? 0,
        previousDue: overview._sum.previousDue ?? 0,
        schoolDue:   overview._sum.schoolDue   ?? 0,
        busDue:      overview._sum.busDue      ?? 0,
        extraDue:    overview._sum.extraDue    ?? 0,
        recoveryRate:
          totalFees > 0
            ? ((totalDeposit / totalFees) * 100).toFixed(1)
            : '0',
      },
      byClass,
    },
    students: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: studentRows as any,
      pagination: {
        page:  1,
        limit: 20,
        total,
        pages: Math.max(1, Math.ceil(total / 20)),
      },
    },
  }
}

export default async function DashboardPage() {
  const { analytics, students } = await getInitialData()

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* ── Header ─────────────────────────────── */}
        <header
          className="px-8 py-4 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              Fees Recovery Dashboard
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Academic Year 2024-25 &bull; {analytics.overview.totalStudents} students enrolled
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Live badge */}
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: '#10b981', animation: 'pulse-glow 2s infinite' }}
              />
              Live
            </div>

            {/* Date */}
            <p className="text-xs hidden sm:block" style={{ color: 'var(--text-secondary)' }}>
              {new Date().toLocaleDateString('en-IN', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
          </div>
        </header>

        {/* ── Main content ────────────────────────── */}
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <DashboardClient
            initialAnalytics={analytics}
            initialStudents={students}
          />
        </main>
      </div>
    </div>
  )
}
