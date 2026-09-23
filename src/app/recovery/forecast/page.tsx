'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { PageHeader } from '@/components/v2/PageHeader'
import { EmptyState, ErrorBanner } from '@/components/v2/ui'
import { ArchetypeChip, CoverageNote, SectionCard, Stat } from '@/components/recovery/chips'
import { fmtAmt, fmtCur } from '@/lib/v2/format'

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function ForecastPage() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [monthIndex, setMonthIndex] = useState(0)

  useEffect(() => {
    fetch('/api/v2/recovery/forecast?months=6')
      .then((r) => r.json())
      .then((b) => {
        if (b.error) throw new Error(b.error)
        setData(b.data)
      })
      .catch((e) => setError((e as Error).message))
  }, [])

  if (!data) {
    return (
      <>
        <PageHeader section="Cash Forecast" />
        <div className="flex-1 p-8">
          {error ? <ErrorBanner error={error} /> : <EmptyState text="Loading…" />}
        </div>
      </>
    )
  }

  const months = data.months ?? []
  const selected = months[monthIndex]
  const monthLabel = (m: string) =>
    new Date(`${m}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  const chart = months.map((m: any) => ({
    name: new Date(`${m.month}-01`).toLocaleDateString('en-IN', { month: 'short' }),
    'Safe to plan on': m.committed,
    'Likely on top': Math.max(0, m.likely - m.committed),
    'With hard follow-up': Math.max(0, m.stretch - m.likely),
  }))

  return (
    <>
      <PageHeader
        section="Cash Forecast"
        subtitle={`${data.session.name} · worked out on ${data.generatedOn}`}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5 max-w-5xl">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
        <CoverageNote message={data.coverage?.message ?? null} />

        {selected && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat
              label={`${monthLabel(selected.month)} — safe to plan on`}
              value={fmtCur(selected.committed)}
              hint="Promises families made, plus dues from those who pay on time"
              tone="good"
            />
            <Stat
              label="Likely"
              value={fmtCur(selected.likely)}
              hint="With the follow-up you normally do"
            />
            <Stat
              label="With hard follow-up"
              value={fmtCur(selected.stretch)}
              hint="A very good month of chasing"
            />
          </div>
        )}

        <SectionCard
          title="The next six months"
          subtitle="The bands stack: safe to plan on sits inside likely, which sits inside the best case"
        >
          <div className="p-4" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtCur} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  formatter={(value: unknown) => fmtAmt(Math.round(Number(value) || 0))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Safe to plan on" stackId="a" fill="var(--good-2)" />
                <Bar dataKey="Likely on top" stackId="a" fill="var(--data-2)" />
                <Bar dataKey="With hard follow-up" stackId="a" fill="var(--elevated-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {months.map((m: any, i: number) => (
              <button
                key={m.month}
                onClick={() => setMonthIndex(i)}
                className="px-3 h-8 rounded-lg text-[12px] font-medium"
                style={{
                  background: i === monthIndex ? 'var(--accent)' : 'var(--elevated)',
                  color: i === monthIndex ? 'var(--accent-fg)' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}
              >
                {new Date(`${m.month}-01`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
              </button>
            ))}
          </div>
        </SectionCard>

        {selected && (
          <>
            {/* ── Where it comes from ───────────────────────
                The whole point: "₹4 lakh next month" is not actionable;
                "₹1.2 lakh of it is these nine families" is. */}
            <SectionCard
              title={`Where ${monthLabel(selected.month)}'s money comes from`}
              subtitle="Click through to the families behind each number"
            >
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {selected.sources.map((s: any) => (
                  <div key={s.key} className="px-4 py-3 flex items-center gap-4">
                    <div className="flex-1">
                      <p className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                        {s.label}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[12.5px] mono font-medium" style={{ color: 'var(--good-2)' }}>
                        {fmtCur(s.committed)}
                      </p>
                      <p className="text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
                        safe
                      </p>
                    </div>
                    <div className="text-right w-24">
                      <p className="text-[12.5px] mono" style={{ color: 'var(--text-secondary)' }}>
                        {fmtCur(s.likely)}
                      </p>
                      <p className="text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
                        likely
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {selected.byClass.length > 0 && (
              <SectionCard title="Which classes it comes from">
                <div className="p-4 space-y-2">
                  {selected.byClass.slice(0, 10).map((c: any) => {
                    const max = selected.byClass[0].expected || 1
                    return (
                      <div key={c.classId} className="flex items-center gap-3">
                        <span className="text-[12px] w-12" style={{ color: 'var(--text-secondary)' }}>
                          {c.className}
                        </span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--elevated)' }}>
                          <div
                            style={{
                              width: `${(c.expected / max) * 100}%`,
                              background: 'var(--data-2)',
                              height: '100%',
                            }}
                          />
                        </div>
                        <span className="text-[12px] mono w-20 text-right" style={{ color: 'var(--text-primary)' }}>
                          {fmtCur(c.expected)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </SectionCard>
            )}

            <SectionCard
              title="The families behind the number"
              subtitle="These are the calls that make the forecast come true"
            >
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {selected.topHouseholds.map((h: any) => (
                  <Link
                    key={h.householdId}
                    href={`/recovery/parents/${h.householdId}`}
                    className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {h.displayName}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <ArchetypeChip archetype={h.archetype} small />
                        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                          {h.reason}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[12.5px] mono font-medium" style={{ color: 'var(--good-2)' }}>
                        {fmtCur(h.expected)}
                      </p>
                      <p className="text-[10.5px] mono" style={{ color: 'var(--text-muted)' }}>
                        owes {fmtCur(h.outstanding)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </SectionCard>
          </>
        )}

        {/* ── Accuracy ───────────────────────────────────── */}
        <SectionCard
          title="How good past forecasts turned out"
          subtitle="Each month is graded against the earliest forecast made for it, not the last"
        >
          {data.accuracy.length === 0 ? (
            <EmptyState text="No month has finished since forecasting started. Come back after month end." />
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {data.accuracy.map((a: any) => (
                <div key={a.month} className="px-4 py-2.5 flex items-center gap-4 text-[12.5px]">
                  <span className="w-24" style={{ color: 'var(--text-secondary)' }}>
                    {monthLabel(a.month)}
                  </span>
                  <span className="mono" style={{ color: 'var(--text-muted)' }}>
                    forecast {fmtCur(a.predicted)}
                  </span>
                  <span className="mono" style={{ color: 'var(--good-2)' }}>
                    actual {fmtCur(a.actual)}
                  </span>
                  <span
                    className="ml-auto mono font-medium"
                    style={{ color: a.ratio >= 0.9 ? 'var(--good-2)' : 'var(--warning)' }}
                  >
                    {Math.round(a.ratio * 100)}%
                  </span>
                </div>
              ))}
              <div className="px-4 py-2.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                Forecasts are being adjusted by {data.calibrationFactor.toFixed(2)}× based on this
                record — the system correcting its own optimism.
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  )
}
