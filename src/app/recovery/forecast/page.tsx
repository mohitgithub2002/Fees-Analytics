'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckSquare, Gauge, Pin, Target } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner } from '@/components/v2/ui'
import { ForecastChart } from '@/components/recovery/ForecastChart'
import { ArchetypeChip } from '@/components/recovery/chips'
import { fmtAmt, fmtCur } from '@/lib/v2/format'
import type { ForecastResponse } from '@/lib/recovery/api-types'
import type { PaymentArchetype } from '@/lib/recovery/types'

export default function ForecastPage() {
  const [data, setData] = useState<ForecastResponse | null>(null)
  const [error, setError] = useState('')
  const [pinning, setPinning] = useState(false)
  const [pinnedCount, setPinnedCount] = useState(0)

  useEffect(() => {
    fetch('/api/v2/recovery/forecast?months=6')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed to load forecast'))))
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const nextMonth = data?.months.find((m) => m.isCurrent === false && !m.isPast)
  const top20 = data?.topContributors.slice(0, 20) ?? []
  const top20Sum = top20.reduce((s, c) => s + c.expectedRecovery, 0)

  async function pinTop20() {
    if (!data) return
    setPinning(true)
    try {
      await Promise.all(
        top20.map((c) => fetch(`/api/v2/recovery/guardians/${c.guardianId}/pin`, { method: 'POST' }))
      )
      setPinnedCount(top20.length)
    } catch {
      setError('Some households could not be pinned.')
    } finally {
      setPinning(false)
    }
  }

  return (
    <>
      <PageHeader section="Forecast" subtitle="Where next month's fees come from" />

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1400px] space-y-5">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
          {!data ? (
            <EmptyState text="Loading forecast…" />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard label="Next Month, Committed" value={fmtCur(nextMonth?.committed ?? 0)} desc="Open promises + reliable due dates" color="var(--good-2)" />
                <StatCard label="Next Month, Likely" value={fmtCur(nextMonth?.likely ?? 0)} desc="Weighted by behaviour and season" color="var(--data-2)" />
                <StatCard label="Session Gap" value={fmtCur(data.totals.sessionGap)} desc="Total still outstanding this session" color="var(--critical)" />
              </div>

              <div className="card p-6">
                <h3 className="text-[14px] font-semibold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>6-Month Cash Flow</h3>
                <p className="text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>
                  Calibration factor <span className="mono">{data.calibrationFactor.toFixed(2)}×</span> applied, based on how the last {data.accuracy.length} forecasts compared to what actually arrived.
                </p>
                <ForecastChart months={data.months} />
              </div>

              {data.accuracy.length > 0 && (
                <div className="card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Gauge className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Forecast Accuracy</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Month', 'Predicted', 'Actual', 'Error'].map((h, i) => (
                            <th key={h} className={`px-3 py-2 label-micro font-medium ${i >= 1 ? 'text-right' : 'text-left'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.accuracy.map((a) => (
                          <tr key={a.month} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{a.label}</td>
                            <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>{fmtAmt(a.predicted)}</td>
                            <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-primary)' }}>{fmtAmt(a.actual)}</td>
                            <td className="px-3 py-2.5 text-right mono" style={{ color: Math.abs(a.errorPercent) <= 15 ? 'var(--good-2)' : Math.abs(a.errorPercent) <= 35 ? 'var(--warning)' : 'var(--critical)' }}>
                              {a.errorPercent > 0 ? '+' : ''}{a.errorPercent}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="card p-6">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Close the Gap</h3>
                  </div>
                  {pinnedCount === 0 ? (
                    <Button onClick={pinTop20} disabled={pinning || top20.length === 0}>
                      <Pin className="w-3.5 h-3.5" /> {pinning ? 'Pinning…' : 'Add all to call list'}
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: 'var(--good-2)' }}>
                      <CheckSquare className="w-3.5 h-3.5" /> {pinnedCount} pinned to today&apos;s list
                    </span>
                  )}
                </div>
                <p className="text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>
                  Of the {fmtCur(data.totals.sessionGap)} outstanding this session, the top {top20.length} households by expected recovery account for {fmtCur(top20Sum)}.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Household', 'Behaviour', 'Outstanding', 'Expected'].map((h, i) => (
                          <th key={h} className={`px-3 py-2 label-micro font-medium ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {top20.map((c) => (
                        <tr key={c.guardianId} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td className="px-3 py-2.5">
                            <Link href={`/recovery/parents/${c.guardianId}`} className="font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>{c.name}</Link>
                          </td>
                          <td className="px-3 py-2.5"><ArchetypeChip archetype={c.archetype as PaymentArchetype} small /></td>
                          <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>{fmtAmt(c.outstanding)}</td>
                          <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--good-2)' }}>{fmtAmt(c.expectedRecovery)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  )
}

function StatCard({ label, value, desc, color }: { label: string; value: string; desc: string; color: string }) {
  return (
    <div className="card p-5">
      <p className="label-micro mb-1.5">{label}</p>
      <p className="mono text-[22px] font-semibold tracking-tight" style={{ color }}>{value}</p>
      <p className="text-[12px] mt-2" style={{ color: 'var(--text-muted)' }}>{desc}</p>
    </div>
  )
}
