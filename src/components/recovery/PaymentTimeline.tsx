'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TimelineEntry } from '@/lib/recovery/api-types'

const REAL_HEX = '#1aa34a' // --good
const ESTIMATED_HEX = '#fab219' // --warning

const money = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`

/**
 * One household's payments over time, real vs estimated dates distinguished
 * by colour — this is where "they always pay in January" becomes visible at
 * a glance, and where a caller can see how much of that story to trust.
 */
export function PaymentTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="py-10 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
        No payments recorded yet.
      </div>
    )
  }

  const byMonth = new Map<string, { label: string; real: number; estimated: number; sortKey: string }>()
  for (const e of entries) {
    const d = new Date(e.paidAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = byMonth.get(key) ?? {
      label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      real: 0,
      estimated: 0,
      sortKey: key,
    }
    if (e.isEstimatedTiming) bucket.estimated += e.amount
    else bucket.real += e.amount
    byMonth.set(key, bucket)
  }

  const data = [...byMonth.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  const hasEstimated = data.some((d) => d.estimated > 0)

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barSize={14} margin={{ top: 4, right: 4, left: 2, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#6e6e6e', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={{ stroke: '#1f1f1f' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#6e6e6e', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={money}
            width={56}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div style={{ background: 'var(--elevated)', border: '1px solid var(--border-hover)', borderRadius: 10, padding: '8px 12px' }}>
                  <p className="label-micro" style={{ marginBottom: 6 }}>{label}</p>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {payload.map((p: any) => p.value > 0 && (
                    <p key={p.dataKey} className="mono" style={{ fontSize: 12, color: p.color }}>
                      {p.dataKey === 'real' ? 'Real' : 'Estimated'}: {money(p.value)}
                    </p>
                  ))}
                </div>
              )
            }}
          />
          <Bar dataKey="real" stackId="a" fill={REAL_HEX} radius={[0, 0, 0, 0]} />
          <Bar dataKey="estimated" stackId="a" fill={ESTIMATED_HEX} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {hasEstimated && (
        <p className="text-[11px] mt-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <span className="w-2 h-2 rounded-sm inline-block" style={{ background: ESTIMATED_HEX }} />
          Amber bars use estimated timing — the amount is real, the date is not yet confirmed.
        </p>
      )}
    </div>
  )
}
