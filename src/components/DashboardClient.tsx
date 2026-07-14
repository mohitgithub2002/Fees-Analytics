'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { StatsCards }         from './StatsCards'
import { FeesBarChart }       from './FeesBarChart'
import { FeesPieChart }       from './FeesPieChart'
import { ClassRecoveryChart } from './ClassRecoveryChart'
import { FilterPanel }        from './FilterPanel'
import { FeesDataTable }      from './FeesDataTable'
import type { Analytics, StudentsResponse, FilterState } from '@/lib/types'

const DEFAULT_FILTERS: FilterState = {
  class:   'all',
  minDue:  '',
  maxDue:  '',
  search:  '',
  feeType: 'total',
}

interface Props {
  initialAnalytics: Analytics
  initialStudents:  StudentsResponse
}

export function DashboardClient({ initialAnalytics, initialStudents }: Props) {
  const [filters, setFilters]       = useState<FilterState>(DEFAULT_FILTERS)
  const [analytics, setAnalytics]   = useState<Analytics>(initialAnalytics)
  const [students, setStudents]     = useState<StudentsResponse>(initialStudents)
  const [currentPage, setCurrentPage] = useState(1)
  const [isPending, startTransition] = useTransition()

  const fetchData = useCallback(
    async (f: FilterState, page: number) => {
      try {
        // Build student params
        const sp = new URLSearchParams({ page: String(page), limit: '20' })
        if (f.class   !== 'all') sp.set('class', f.class)
        if (f.search)            sp.set('search', f.search)
        if (f.minDue)            sp.set('minDue', f.minDue)
        if (f.maxDue)            sp.set('maxDue', f.maxDue)
        if (f.feeType !== 'total') sp.set('feeType', f.feeType)

        // Build analytics params
        const ap = new URLSearchParams()
        if (f.class !== 'all') ap.set('class', f.class)

        const [studRes, analRes] = await Promise.all([
          fetch(`/api/fees?${sp}`),
          fetch(`/api/fees/analytics?${ap}`),
        ])
        const [studData, analData] = await Promise.all([studRes.json(), analRes.json()])

        startTransition(() => {
          setStudents(studData)
          setAnalytics(analData)
        })
      } catch (e) {
        console.error('Dashboard fetch error:', e)
      }
    },
    []
  )

  // Debounced auto-fetch on filter change
  useEffect(() => {
    const t = setTimeout(() => {
      setCurrentPage(1)
      fetchData(filters, 1)
    }, 380)
    return () => clearTimeout(t)
  }, [filters, fetchData])

  const handlePageChange = (p: number) => {
    setCurrentPage(p)
    fetchData(filters, p)
  }

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <StatsCards analytics={analytics.overview} />

      {/* Charts Row — Bar + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <FeesBarChart data={analytics.byClass} />
        </div>
        <div>
          <FeesPieChart
            previousDue={analytics.overview.previousDue}
            schoolDue={analytics.overview.schoolDue}
            busDue={analytics.overview.busDue}
            extraDue={analytics.overview.extraDue}
          />
        </div>
      </div>

      {/* Recovery comparison chart */}
      <ClassRecoveryChart data={analytics.byClass} />

      {/* Filter + Table */}
      <div>
        <FilterPanel
          filters={filters}
          onFiltersChange={setFilters}
          onReset={() => setFilters(DEFAULT_FILTERS)}
        />
        <FeesDataTable
          data={students.data}
          pagination={students.pagination}
          onPageChange={handlePageChange}
          isLoading={isPending}
        />
      </div>
    </div>
  )
}
