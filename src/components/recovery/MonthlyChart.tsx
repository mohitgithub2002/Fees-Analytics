'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthlyCollectionDTO } from '@/lib/recovery/api-types'

const SESSION_HEX = ['#3987e5', '#199e70', '#9085e9'] // --data-2, --data-3, --data-4

const axisMoney = (v: number) => (v >= 1_00_000 ? `₹${(v / 1_00_000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}K`)
const money = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`

/**
 * When in the calendar year money actually arrives, one series per session so
 * this year reads directly against last year. A month that's low every single
 * year is a pattern to plan the calendar around, not a surprise to react to.
 */
export function MonthlyChart({ months, sessions }: { months: MonthlyCollectionDTO[]; sessions: string[] }) {
  if (sessions.length === 0) {
    return <div className="py-14 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>No dated payments yet.</div>
  }

  const data = months.map((m) => ({ label: m.label, ...m.bySession }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} barGap={4} margin={{ top: 4, right: 4, left: 2, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: '#6e6e6e', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={{ stroke: '#1f1f1f' }} tickLine={false} />
        <YAxis tick={{ fill: '#6e6e6e', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={axisMoney} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div style={{ background: 'var(--elevated)', border: '1px solid var(--border-hover)', borderRadius: 10, padding: '10px 12px' }}>
                <p className="label-micro" style={{ marginBottom: 8 }}>{label}</p>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {payload.filter((p: any) => p.value > 0).map((p: any) => (
                  <div key={p.dataKey} className="flex items-center gap-2 mb-1" style={{ fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
                    <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{p.dataKey}</span>
                    <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{money(p.value)}</span>
                  </div>
                ))}
              </div>
            )
          }}
        />
        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: '#a1a1a1', paddingTop: 12 }} />
        {sessions.map((s, i) => (
          <Bar key={s} dataKey={s} fill={SESSION_HEX[i % SESSION_HEX.length]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
