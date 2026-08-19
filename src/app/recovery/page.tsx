'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  IndianRupee, Target, PhoneCall, CalendarClock,
  AlertOctagon, Grid3x3, Trophy, RefreshCw, Phone,
} from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { EmptyState, ErrorBanner } from '@/components/v2/ui'
import { ArchetypeChip, TierChip, EstimatedDataBadge } from '@/components/recovery/chips'
import { SegmentMatrix } from '@/components/recovery/SegmentMatrix'
import { cachedFetch } from '@/lib/v2/client-cache'
import { fmtCur } from '@/lib/v2/format'
import type { OverviewResponse, SegmentMatrixResponse, WorklistCase } from '@/lib/recovery/api-types'

function KpiCard({
  label, value, icon: Icon, color, desc, delay,
}: {
  label: string
  value: string
  icon: React.ElementType
  color?: string
  desc?: string
  delay: number
}) {
  return (
    <div className="card card-hover p-5 animate-fadeup" style={{ animationDelay: `${delay}ms` }}>
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-4"
        style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
      >
        <Icon className="w-[17px] h-[17px]" style={{ color: 'var(--text-secondary)' }} />
      </div>
      <p className="label-micro mb-1.5">{label}</p>
      <p className="mono text-[24px] font-semibold tracking-tight leading-none" style={{ color: color ?? 'var(--text-primary)' }}>
        {value}
      </p>
      {desc && <p className="text-[12px] mt-2" style={{ color: 'var(--text-muted)' }}>{desc}</p>}
    </div>
  )
}

function ActionCard({
  label, count, amount, href, icon: Icon, color, delay,
}: {
  label: string
  count: number
  amount: number
  href: string
  icon: React.ElementType
  color: string
  delay: number
}) {
  return (
    <Link
      href={href}
      className="card card-hover p-5 flex items-center gap-4 animate-fadeup"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}1f` }}>
        <Icon className="w-[18px] h-[18px]" style={{ color }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</p>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          <span className="mono">{count}</span> · {fmtCur(amount)}
        </p>
      </div>
    </Link>
  )
}

export default function RecoveryCommandCenter() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [segments, setSegments] = useState<SegmentMatrixResponse | null>(null)
  const [top, setTop] = useState<WorklistCase[]>([])
  const [error, setError] = useState('')
  const [recalculating, setRecalculating] = useState(false)

  function load() {
    cachedFetch<OverviewResponse>('/api/v2/recovery/overview', 20_000).then(setOverview).catch((e) => setError(e.message))
    cachedFetch<SegmentMatrixResponse>('/api/v2/recovery/behavior/segments', 30_000).then(setSegments).catch(() => {})
    fetch('/api/v2/recovery/worklist?limit=10').then((r) => r.json()).then((d) => setTop(d.queue ?? [])).catch(() => {})
  }

  useEffect(load, [])

  async function recalculate() {
    setRecalculating(true)
    setError('')
    try {
      const res = await fetch('/api/v2/recovery/profiles/recalculate', { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'recalculation failed')
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRecalculating(false)
    }
  }

  return (
    <>
      <PageHeader
        section="Command Center"
        subtitle={overview ? `Updated ${new Date(overview.generatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'Loading…'}
      >
        {overview && overview.dataQuality.percentEstimated > 0 && (
          <EstimatedDataBadge percentEstimated={overview.dataQuality.percentEstimated} />
        )}
        <button
          onClick={recalculate}
          disabled={recalculating}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium transition-all disabled:opacity-50"
          style={{ background: 'var(--elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${recalculating ? 'animate-spin' : ''}`} />
          {recalculating ? 'Recalculating…' : 'Recalculate'}
        </button>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1400px] space-y-6">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

          {!overview ? (
            <EmptyState text="Loading recovery data…" />
          ) : (
            <>
              {/* ── Money band ─────────────────────────────────────── */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <KpiCard label="Recoverable Now" value={fmtCur(overview.money.recoverableNow)} icon={Target} color="var(--good-2)" desc="Expected recovery across active cases" delay={0} />
                <KpiCard label="Total Outstanding" value={fmtCur(overview.money.totalOutstanding)} icon={AlertOctagon} color="var(--critical)" desc="Across every household" delay={45} />
                <KpiCard label="Recovered This Month" value={fmtCur(overview.money.recoveredThisMonth)} icon={IndianRupee} desc="All payments received so far" delay={90} />
              </div>

              {/* ── Action band ────────────────────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <ActionCard label="Calls Queued Today" count={overview.actions.queuedToday} amount={overview.money.recoverableNow} href="/recovery/worklist" icon={PhoneCall} color="var(--data-2)" delay={135} />
                <ActionCard label="Promises Due Today" count={overview.actions.promisesDueToday.count} amount={overview.actions.promisesDueToday.amount} href="/recovery/worklist?filter=promises" icon={CalendarClock} color="var(--good-2)" delay={180} />
                <ActionCard label="Promises Broken" count={overview.actions.promisesBroken.count} amount={overview.actions.promisesBroken.amount} href="/recovery/worklist?filter=broken" icon={AlertOctagon} color="var(--critical)" delay={225} />
              </div>

              {/* ── Where the money is ─────────────────────────────── */}
              <div className="card p-6 animate-fadeup" style={{ animationDelay: '270ms' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Grid3x3 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    Where the Money Is
                  </h3>
                </div>
                <p className="text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>
                  Households by how they pay (rows) and their ability to pay (columns). Click a cell to see who&apos;s in it.
                </p>
                {segments ? <SegmentMatrix cells={segments.cells} totals={segments.totals} /> : <EmptyState text="Loading…" />}
              </div>

              {/* ── Top by expected recovery ───────────────────────── */}
              <div className="card overflow-hidden animate-fadeup" style={{ animationDelay: '315ms' }}>
                <div className="px-5 h-14 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
                  <Trophy className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    Top by Expected Recovery
                  </h3>
                </div>
                {top.length === 0 ? (
                  <EmptyState text="Nothing to show — recalculate to populate the call list." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Household', 'Children', 'Outstanding', 'Expected', 'Behaviour', 'Ability', ''].map((h, i) => (
                            <th key={h} className={`px-4 py-3 label-micro font-medium ${i >= 2 && i <= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {top.map((c) => (
                          <tr key={c.caseId} className="transition-colors hover:bg-[var(--card-hover)]" style={{ borderBottom: '1px solid var(--border)' }}>
                            <td className="px-4 py-3">
                              <Link href={`/recovery/parents/${c.guardian.id}`} className="font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                                {c.guardian.name}
                              </Link>
                            </td>
                            <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                              {c.guardian.children.map((ch) => ch.class ?? ch.name).join(', ')}
                            </td>
                            <td className="px-4 py-3 text-right mono" style={{ color: 'var(--text-primary)' }}>{fmtCur(c.outstanding)}</td>
                            <td className="px-4 py-3 text-right mono" style={{ color: 'var(--good-2)' }}>{fmtCur(c.expectedRecoveryValue)}</td>
                            <td className="px-4 py-3"><ArchetypeChip archetype={c.guardian.archetype} small /></td>
                            <td className="px-4 py-3"><TierChip tier={c.guardian.economicTier} small /></td>
                            <td className="px-4 py-3 text-right">
                              {c.guardian.phone && (
                                <a
                                  href={`tel:${c.guardian.phone}`}
                                  className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg"
                                  style={{ background: 'var(--elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                                >
                                  <Phone className="w-3 h-3" /> Call
                                </a>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Ready to work the list? Head to{' '}
                <Link href="/recovery/worklist" className="underline" style={{ color: 'var(--text-secondary)' }}>
                  Call List
                </Link>{' '}
                for today&apos;s ranked households, or{' '}
                <Link href="/recovery/forecast" className="underline" style={{ color: 'var(--text-secondary)' }}>
                  Forecast
                </Link>{' '}
                to see where next month&apos;s fees come from.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  )
}
