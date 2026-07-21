'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, IndianRupee, TrendingUp, AlertCircle, Percent, Clock, School, Bus, Sparkles,
} from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { CollectedVsPending, DuesDistribution, PendingDuesByClass } from '@/components/v2/Charts'
import { DueAmount, EmptyState } from '@/components/v2/ui'
import { fmtCur } from '@/lib/v2/format'
import type { AnalyticsV2, SessionV2 } from '@/lib/v2/types'

function StatCard({
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
      <p
        className="mono text-[24px] font-semibold tracking-tight leading-none"
        style={{ color: color ?? 'var(--text-primary)' }}
      >
        {value}
      </p>
      {desc && (
        <p className="text-[12px] mt-2" style={{ color: 'var(--text-muted)' }}>{desc}</p>
      )}
    </div>
  )
}

export default function ManageDashboard() {
  const [sessions, setSessions] = useState<SessionV2[]>([])
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsV2 | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v2/sessions')
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.data ?? [])
        const current = (d.data ?? []).find((s: SessionV2) => s.isCurrent)
        if (current) setSessionId(current.id)
        else if (d.data?.length) setSessionId(d.data[0].id)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (!sessionId) return
    let alive = true
    fetch(`/api/v2/analytics?sessionId=${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        if (d) setAnalytics(d)
        setLoading(false)
      })
      .catch(console.error)
    return () => { alive = false }
  }, [sessionId])

  const o = analytics?.overview
  const cat = (c: string) => analytics?.byCategory.find((b) => b.category === c)?._sum

  return (
    <>
      <PageHeader
        section="Dashboard"
        subtitle={
          o ? (
            <>
              <span className="mono">{o.totalStudents}</span> students enrolled · Session{' '}
              {analytics?.session.name}
            </>
          ) : 'Loading…'
        }
      >
        <select
          value={sessionId ?? ''}
          onChange={(e) => setSessionId(parseInt(e.target.value))}
          className="h-9 px-3 rounded-lg text-[13px] outline-none"
          style={{ background: 'var(--elevated-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.isCurrent ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1400px] space-y-4">
          {!analytics && loading && <EmptyState text="Loading analytics…" />}
          {analytics && o && (
            <>
              {/* Primary KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Students" value={o.totalStudents.toLocaleString('en-IN')} icon={Users} desc="Enrolled this session" delay={0} />
                <StatCard label="Net Fees" value={fmtCur(o.netFees)} icon={IndianRupee} desc={`${fmtCur(o.totalDiscount)} discount given`} delay={45} />
                <StatCard label="Collected" value={fmtCur(o.totalCollected)} icon={TrendingUp} color="var(--good-2)" desc={`${o.recoveryRate}% recovered`} delay={90} />
                <StatCard label="Outstanding" value={fmtCur(o.totalDue)} icon={AlertCircle} color="var(--critical)" desc="Across all fee types" delay={135} />
              </div>

              {/* Secondary strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Recovery Rate" value={`${o.recoveryRate}%`} icon={Percent} color="var(--data-2)" delay={180} />
                <StatCard
                  label="Carried-Forward Due"
                  value={fmtCur(analytics.carriedForwardDues.dueAmount)}
                  icon={Clock}
                  color="var(--warning)"
                  desc={`${analytics.carriedForwardDues.students} students owe from earlier sessions`}
                  delay={225}
                />
                <StatCard label="School Fees Due" value={fmtCur(cat('SCHOOL')?.dueAmount ?? 0)} icon={School} delay={270} />
                <StatCard label="Bus + Other Due" value={fmtCur((cat('BUS')?.dueAmount ?? 0) + (cat('OTHER')?.dueAmount ?? 0))} icon={Bus} delay={315} />
              </div>

              {/* Charts */}
              {analytics.byClass.length > 0 && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fadeup" style={{ animationDelay: '360ms' }}>
                    <div className="lg:col-span-2">
                      <PendingDuesByClass byClass={analytics.byClass} />
                    </div>
                    <DuesDistribution byCategory={analytics.byCategory} />
                  </div>
                  <div className="animate-fadeup" style={{ animationDelay: '405ms' }}>
                    <CollectedVsPending byClass={analytics.byClass} />
                  </div>
                </>
              )}

              {/* Class-wise table */}
              <div className="card overflow-hidden animate-fadeup" style={{ animationDelay: '450ms' }}>
                <div className="px-5 h-14 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                      Class-wise Dues · {analytics.session.name}
                    </h3>
                  </div>
                  {loading && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Refreshing…</span>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Class', 'Students', 'Net Fees', 'Collected', 'School Due', 'Bus Due', 'Other Due', 'Total Due'].map((h, i) => (
                          <th
                            key={h}
                            className={`px-4 py-3 label-micro font-medium ${i < 1 ? 'text-left' : 'text-right'}`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.byClass.map((c) => (
                        <tr
                          key={c.classId}
                          className="transition-colors hover:bg-[var(--card-hover)]"
                          style={{ borderBottom: '1px solid var(--border)' }}
                        >
                          <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{c.class}</td>
                          <td className="px-4 py-3 text-right mono" style={{ color: 'var(--text-secondary)' }}>{c.students}</td>
                          <td className="px-4 py-3 text-right mono" style={{ color: 'var(--text-secondary)' }}>{fmtCur(c.netAmount)}</td>
                          <td className="px-4 py-3 text-right mono" style={{ color: 'var(--good-2)' }}>{fmtCur(c.paidAmount)}</td>
                          <td className="px-4 py-3 text-right"><DueAmount amount={c.schoolDue} /></td>
                          <td className="px-4 py-3 text-right"><DueAmount amount={c.busDue} /></td>
                          <td className="px-4 py-3 text-right"><DueAmount amount={c.otherDue} /></td>
                          <td className="px-4 py-3 text-right"><DueAmount amount={c.dueAmount} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Looking for a student? Head to{' '}
                <Link href="/manage/students" className="underline" style={{ color: 'var(--text-secondary)' }}>
                  Students
                </Link>{' '}
                to search, collect fees, and manage individual accounts.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  )
}
