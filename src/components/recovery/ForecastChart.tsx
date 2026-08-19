'use client'

import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ForecastMonthDTO } from '@/lib/recovery/api-types'

const COMMITTED_HEX = '#1aa34a' // --good
const LIKELY_HEX = '#3987e5' // --data-2
const STRETCH_HEX = '#9085e9' // --data-4
const ACTUAL_HEX = '#fafafa' // --accent

const axisMoney = (v: number) => (v >= 1_00_000 ? `₹${(v / 1_00_000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}K`)
const money = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`

/**
 * Three nested bands, not one number: Committed (named dates only) is safe to
 * plan salaries against, Likely adds a propensity-weighted share of the rest,
 * Stretch is what a very good month of follow-up could reach. Past months
 * carry the actual collected line so the bands can be judged against reality.
 */
export function ForecastChart({ months }: { months: ForecastMonthDTO[] }) {
  const data = months.map((m) => ({
    label: m.label,
    Stretch: m.isPast ? 0 : Math.max(0, m.stretch - m.likely),
    Likely: m.isPast ? 0 : Math.max(0, m.likely - m.committed),
    Committed: m.isPast ? 0 : m.committed,
    Actual: m.actual,
    isCurrent: m.isCurrent,
  }))

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, left: 2, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: '#6e6e6e', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={{ stroke: '#1f1f1f' }} tickLine={false} />
        <YAxis tick={{ fill: '#6e6e6e', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={axisMoney} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const row = payload[0]?.payload
            return (
              <div style={{ background: 'var(--elevated)', border: '1px solid var(--border-hover)', borderRadius: 10, padding: '10px 12px', minWidth: 170 }}>
                <p className="label-micro" style={{ marginBottom: 8 }}>{label}</p>
                {row?.Committed > 0 && <Row color={COMMITTED_HEX} name="Committed" value={row.Committed} />}
                {row?.Likely > 0 && <Row color={LIKELY_HEX} name="Likely (extra)" value={row.Likely} />}
                {row?.Stretch > 0 && <Row color={STRETCH_HEX} name="Stretch (extra)" value={row.Stretch} />}
                {row?.Actual != null && <Row color={ACTUAL_HEX} name="Actual" value={row.Actual} />}
              </div>
            )
          }}
        />
        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: '#a1a1a1', paddingTop: 12 }} />
        <Bar dataKey="Committed" stackId="a" fill={COMMITTED_HEX} />
        <Bar dataKey="Likely" stackId="a" fill={LIKELY_HEX} />
        <Bar dataKey="Stretch" stackId="a" fill={STRETCH_HEX} radius={[4, 4, 0, 0]} />
        <Line type="monotone" dataKey="Actual" stroke={ACTUAL_HEX} strokeWidth={2} dot={{ r: 3, fill: ACTUAL_HEX }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function Row({ color, name, value }: { color: string; name: string; value: number }) {
  return (
    <div className="flex items-center gap-2 mb-1" style={{ fontSize: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{name}</span>
      <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{money(value)}</span>
    </div>
  )
}
