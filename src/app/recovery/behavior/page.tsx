'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/v2/PageHeader'
import { EmptyState, ErrorBanner } from '@/components/v2/ui'
import { ArchetypeChip, CoverageNote, SectionCard, TierChip } from '@/components/recovery/chips'
import { ARCHETYPE_LABEL, TIER_LABEL, type EconomicTier, type PaymentArchetype } from '@/lib/recovery/types'
import { fmtAmt, fmtCur } from '@/lib/v2/format'

const TABS = [
  { key: 'installments', label: 'Installments', hint: 'Which installment underperforms' },
  { key: 'monthly', label: 'Months', hint: 'When money actually arrives' },
  { key: 'classes', label: 'Classes', hint: 'Who pays more, about average, or little' },
  { key: 'segments', label: 'Behaviour × Ability', hint: 'The targeting map' },
  { key: 'effectiveness', label: 'Is Calling Working?', hint: 'What calls actually produced' },
] as const

type TabKey = (typeof TABS)[number]['key']

const AXIS = { fontSize: 11, fill: 'var(--text-muted)' }
const GRID = 'var(--border)'

/** Shared tooltip styling plus rupee formatting, so every chart reads alike. */
function chartTooltip() {
  return {
    contentStyle: {
      background: 'var(--card)',
      border: '1px solid var(--border-strong)',
      borderRadius: 10,
      fontSize: 12,
    },
    labelStyle: { color: 'var(--text-primary)' },
    formatter: (value: unknown) => fmtAmt(Math.round(Number(value) || 0)),
  }
}

export default function BehaviorPage() {
  const [tab, setTab] = useState<TabKey>('installments')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<Record<string, any>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (key: TabKey) => {
      if (data[key]) return
      setLoading(true)
      try {
        const res = await fetch(`/api/v2/recovery/behavior?lens=${key}`)
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'could not load')
        setData((d) => ({ ...d, [key]: body.data }))
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [data]
  )

  // Deferred rather than called straight from the effect: load() sets state
  // synchronously, which inside an effect triggers a cascading render.
  useEffect(() => {
    const t = setTimeout(() => load(tab), 0)
    return () => clearTimeout(t)
  }, [tab, load])

  const current = data[tab]

  return (
    <>
      <PageHeader section="How They Pay" subtitle={TABS.find((t) => t.key === tab)?.hint} />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-3 h-8 rounded-lg text-[12.5px] font-medium transition-colors"
              style={{
                background: tab === t.key ? 'var(--accent)' : 'var(--elevated)',
                color: tab === t.key ? 'var(--accent-fg)' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!current ? (
          <EmptyState text={loading ? 'Loading…' : 'No data.'} />
        ) : tab === 'installments' ? (
          <Installments data={current} />
        ) : tab === 'monthly' ? (
          <Monthly data={current} />
        ) : tab === 'classes' ? (
          <Classes data={current} />
        ) : tab === 'segments' ? (
          <Segments data={current} />
        ) : (
          <Effectiveness data={current} />
        )}
      </div>
    </>
  )
}

/* ── Installments ────────────────────────────────────────────────
 * The waterfall answers the question directly: of what was billed for
 * installment 2, how much arrived on time, how much arrived late, and how
 * much never came at all. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Installments({ data }: { data: any }) {
  const bands = data.bands ?? []
  const chart = bands.map(
    (b: {
      sequence: number
      billed: number
      collectedOnTime: number
      collectedLate: number
      collected: number
      outstanding: number
    }) => ({
      name: `Installment ${b.sequence}`,
      'On time': b.collectedOnTime,
      Late: b.collectedLate,
      // With no due dates there is no on-time/late split, so everything
      // collected shows as one bar rather than silently reading as zero.
      Collected: b.collectedOnTime + b.collectedLate === 0 ? b.collected : 0,
      'Still owed': b.outstanding,
    })
  )

  return (
    <div className="space-y-5">
      <CoverageNote message={data.coverage?.message ?? null} />

      <SectionCard
        title="What each installment actually collected"
        subtitle={`${data.session?.name} · ${data.category?.toLowerCase()} fees`}
      >
        <div className="p-4" style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={fmtCur} />
              <Tooltip {...chartTooltip()} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="On time" stackId="a" fill="var(--good-2)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Late" stackId="a" fill="var(--warning)" />
              <Bar dataKey="Collected" stackId="a" fill="var(--data-2)" />
              <Bar dataKey="Still owed" stackId="a" fill="var(--critical)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="overflow-x-auto" style={{ borderTop: '1px solid var(--border)' }}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-medium px-4 py-2">Installment</th>
                <th className="text-right font-medium px-4 py-2">Billed</th>
                <th className="text-right font-medium px-4 py-2">Collected</th>
                <th className="text-right font-medium px-4 py-2">Rate</th>
                <th className="text-right font-medium px-4 py-2">Still owed</th>
                <th className="text-right font-medium px-4 py-2">Paid in full</th>
                <th className="text-right font-medium px-4 py-2">Typical delay</th>
              </tr>
            </thead>
            <tbody>
              {bands.map(
                (b: {
                  sequence: number
                  label: string
                  billed: number
                  collected: number
                  collectionRate: number
                  outstanding: number
                  paidCount: number
                  installments: number
                  medianDaysLate: number | null
                }) => (
                  <tr key={b.sequence} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-2.5" style={{ color: 'var(--text-primary)' }}>
                      {b.label}
                    </td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>
                      {fmtCur(b.billed)}
                    </td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--good-2)' }}>
                      {fmtCur(b.collected)}
                    </td>
                    <td
                      className="px-4 py-2.5 text-right mono font-medium"
                      style={{
                        color:
                          b.collectionRate >= 0.6
                            ? 'var(--good-2)'
                            : b.collectionRate >= 0.3
                              ? 'var(--warning)'
                              : 'var(--critical)',
                      }}
                    >
                      {Math.round(b.collectionRate * 100)}%
                    </td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--critical)' }}>
                      {fmtCur(b.outstanding)}
                    </td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>
                      {b.paidCount} / {b.installments}
                    </td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--text-muted)' }}>
                      {b.medianDaysLate === null ? '—' : `${b.medianDaysLate}d late`}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}

/* ── Months ──────────────────────────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Monthly({ data }: { data: any }) {
  const points = (data.points ?? []).map(
    (p: { month: string; currentSession: number; arrears: number; total: number }) => ({
      name: new Date(`${p.month}-01`).toLocaleDateString('en-IN', {
        month: 'short',
        year: '2-digit',
      }),
      'This year': p.currentSession,
      Arrears: p.arrears,
      Total: p.total,
    })
  )

  return (
    <div className="space-y-5">
      <CoverageNote message={data.coverage?.message ?? null} />
      {points.length === 0 ? (
        <EmptyState text="No dated payments to chart yet." />
      ) : (
        <SectionCard
          title="When money actually arrives"
          subtitle="Split between this year's fees and old arrears"
        >
          <div className="p-4" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={fmtCur} />
                <Tooltip {...chartTooltip()} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="This year" stackId="a" fill="var(--data-2)" />
                <Bar dataKey="Arrears" stackId="a" fill="var(--warning)" radius={[4, 4, 0, 0]} />
                <Line dataKey="Total" stroke="var(--good-2)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

/* ── Classes ─────────────────────────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Classes({ data }: { data: any }) {
  const classes = data.classes ?? []
  return (
    <SectionCard
      title="Who pays what, class by class"
      subtitle="A class total hides the shape — half paying in full and half paying nothing looks identical to everyone paying half"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left font-medium px-4 py-2">Class</th>
              <th className="text-right font-medium px-4 py-2">Students</th>
              <th className="text-right font-medium px-4 py-2">Billed</th>
              <th className="text-right font-medium px-4 py-2">Collected</th>
              <th className="text-right font-medium px-4 py-2">Rate</th>
              <th className="text-left font-medium px-4 py-2 w-[180px]">Spread of payers</th>
              <th className="text-right font-medium px-4 py-2">Still owed</th>
            </tr>
          </thead>
          <tbody>
            {classes.map(
              (c: {
                classId: number
                className: string
                students: number
                billed: number
                collected: number
                collectionRate: number
                outstanding: number
                paidMost: number
                paidAbout: number
                paidLittle: number
              }) => {
                const total = c.paidMost + c.paidAbout + c.paidLittle || 1
                return (
                  <tr key={c.classId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {c.className}
                    </td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--text-muted)' }}>
                      {c.students}
                    </td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>
                      {fmtCur(c.billed)}
                    </td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--good-2)' }}>
                      {fmtCur(c.collected)}
                    </td>
                    <td
                      className="px-4 py-2.5 text-right mono font-medium"
                      style={{
                        color:
                          c.collectionRate >= 0.6
                            ? 'var(--good-2)'
                            : c.collectionRate >= 0.3
                              ? 'var(--warning)'
                              : 'var(--critical)',
                      }}
                    >
                      {Math.round(c.collectionRate * 100)}%
                    </td>
                    <td className="px-4 py-2.5">
                      <div
                        className="flex h-2 rounded-full overflow-hidden"
                        title={`${c.paidMost} paid most · ${c.paidAbout} paid about half · ${c.paidLittle} paid little`}
                      >
                        <div
                          style={{
                            width: `${(c.paidMost / total) * 100}%`,
                            background: 'var(--good-2)',
                          }}
                        />
                        <div
                          style={{
                            width: `${(c.paidAbout / total) * 100}%`,
                            background: 'var(--warning)',
                          }}
                        />
                        <div
                          style={{
                            width: `${(c.paidLittle / total) * 100}%`,
                            background: 'var(--critical)',
                          }}
                        />
                      </div>
                      <p className="text-[10.5px] mt-1" style={{ color: 'var(--text-faint)' }}>
                        {c.paidMost} most · {c.paidAbout} half · {c.paidLittle} little
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--critical)' }}>
                      {fmtCur(c.outstanding)}
                    </td>
                  </tr>
                )
              }
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

/* ── Segments ────────────────────────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Segments({ data }: { data: any }) {
  const cells: {
    archetype: string
    tier: string
    households: number
    outstanding: number
    expectedRecovery: number
  }[] = data.cells ?? []

  const archetypes = [...new Set(cells.map((c) => c.archetype))] as PaymentArchetype[]
  const tiers: EconomicTier[] = ['AFFLUENT', 'COMFORTABLE', 'STRAINED', 'POOR', 'SEVERE', 'UNKNOWN']
  const present = tiers.filter((t) => cells.some((c) => c.tier === t))

  return (
    <div className="space-y-5">
      {data.untaggedHouseholds > 0 && (
        <CoverageNote
          message={`${data.untaggedHouseholds} families (${fmtAmt(data.untaggedOutstanding)} owed) have no ability-to-pay tag yet. Until they do, this map only has one real axis — tag families as you call them.`}
        />
      )}

      <SectionCard
        title="How they pay, against whether they can"
        subtitle="Able but slow is a phone call. Unable is a payment plan. The balance column alone cannot tell them apart."
      >
        <div className="overflow-x-auto p-4">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className="text-left font-medium pb-2 pr-3" style={{ color: 'var(--text-muted)' }}>
                  Payment pattern
                </th>
                {present.map((t) => (
                  <th key={t} className="pb-2 px-2 text-center">
                    <TierChip tier={t} small />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {archetypes.map((a) => (
                <tr key={a} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-2.5 pr-3">
                    <ArchetypeChip archetype={a} small />
                  </td>
                  {present.map((t) => {
                    const cell = cells.find((c) => c.archetype === a && c.tier === t)
                    if (!cell) {
                      return (
                        <td key={t} className="py-2.5 px-2 text-center" style={{ color: 'var(--text-faint)' }}>
                          —
                        </td>
                      )
                    }
                    return (
                      <td key={t} className="py-2.5 px-2 text-center">
                        <p className="mono font-medium" style={{ color: 'var(--text-primary)' }}>
                          {cell.households}
                        </p>
                        <p className="text-[10.5px] mono" style={{ color: 'var(--text-muted)' }}>
                          {fmtCur(cell.outstanding)}
                        </p>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}

/* ── Effectiveness ───────────────────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Effectiveness({ data }: { data: any }) {
  const rows: {
    segment: string
    calls: number
    answered: number
    answerRate: number
    promises: number
    promiseKeptRate: number
    recovered: number
    recoveredPerCall: number
  }[] = data.byArchetype ?? []

  return (
    <div className="space-y-5">
      <CoverageNote message={data.coverage?.message ?? null} tone="info" />

      {rows.length > 0 && (
        <>
          <SectionCard
            title="What a call is worth, by payment pattern"
            subtitle={`Money that arrived within ${data.attributionDays} days of somebody picking up`}
          >
            <div className="p-4" style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows.map((r) => ({ ...r, name: ARCHETYPE_LABEL[r.segment as PaymentArchetype] ?? r.segment }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={fmtCur} />
                  <Tooltip {...chartTooltip()} />
                  <Bar dataKey="recoveredPerCall" name="Recovered per call" radius={[4, 4, 0, 0]}>
                    {rows.map((_, i) => (
                      <Cell key={i} fill="var(--good-2)" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto" style={{ borderTop: '1px solid var(--border)' }}>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left font-medium px-4 py-2">Pattern</th>
                    <th className="text-right font-medium px-4 py-2">Calls</th>
                    <th className="text-right font-medium px-4 py-2">Answered</th>
                    <th className="text-right font-medium px-4 py-2">Promises kept</th>
                    <th className="text-right font-medium px-4 py-2">Recovered</th>
                    <th className="text-right font-medium px-4 py-2">Per call</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.segment} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-4 py-2.5">
                        <ArchetypeChip archetype={r.segment} small />
                      </td>
                      <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>
                        {r.calls}
                      </td>
                      <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(r.answerRate * 100)}%
                      </td>
                      <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>
                        {r.promises === 0 ? '—' : `${Math.round(r.promiseKeptRate * 100)}%`}
                      </td>
                      <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--good-2)' }}>
                        {fmtCur(r.recovered)}
                      </td>
                      <td className="px-4 py-2.5 text-right mono font-medium" style={{ color: 'var(--text-primary)' }}>
                        {fmtAmt(Math.round(r.recoveredPerCall))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="By ability to pay" subtitle="Where calling harder does and does not create money">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left font-medium px-4 py-2">Ability</th>
                    <th className="text-right font-medium px-4 py-2">Calls</th>
                    <th className="text-right font-medium px-4 py-2">Answered</th>
                    <th className="text-right font-medium px-4 py-2">Recovered</th>
                    <th className="text-right font-medium px-4 py-2">Per call</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.byTier ?? []).map(
                    (r: { segment: string; calls: number; answerRate: number; recovered: number; recoveredPerCall: number }) => (
                      <tr key={r.segment} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="px-4 py-2.5">{TIER_LABEL[r.segment as EconomicTier] ?? r.segment}</td>
                        <td className="px-4 py-2.5 text-right mono">{r.calls}</td>
                        <td className="px-4 py-2.5 text-right mono">{Math.round(r.answerRate * 100)}%</td>
                        <td className="px-4 py-2.5 text-right mono" style={{ color: 'var(--good-2)' }}>
                          {fmtCur(r.recovered)}
                        </td>
                        <td className="px-4 py-2.5 text-right mono">{fmtAmt(Math.round(r.recoveredPerCall))}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  )
}
