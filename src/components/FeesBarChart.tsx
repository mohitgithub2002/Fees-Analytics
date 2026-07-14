'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { ClassBreakdown } from '@/lib/types'

const CLASS_ORDER = [
  'Nursery','LKG','UKG','I','II','III','IV','V','VI','VII','VIII','IX','X',
]

const SERIES = [
  { key: 'Prev Year', color: 'var(--data-1)', hex: '#e66767' },
  { key: 'School',    color: 'var(--data-2)', hex: '#3987e5' },
  { key: 'Bus',       color: 'var(--data-3)', hex: '#199e70' },
  { key: 'Extra',     color: 'var(--data-4)', hex: '#9085e9' },
]

interface Props { data: ClassBreakdown[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0)
  return (
    <div style={{
      background: 'var(--elevated)',
      border: '1px solid var(--border-hover)',
      borderRadius: 10,
      padding: '10px 12px',
      minWidth: 190,
      boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
    }}>
      <p className="label-micro" style={{ marginBottom: 8 }}>Class {label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1.5" style={{ fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
          <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{p.name}</span>
          <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            ₹{(p.value || 0).toLocaleString('en-IN')}
          </span>
        </div>
      ))}
      <div style={{
        borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8,
        display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600,
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>Total</span>
        <span className="mono" style={{ color: 'var(--text-primary)' }}>
          ₹{total.toLocaleString('en-IN')}
        </span>
      </div>
    </div>
  )
}

export function FeesBarChart({ data }: Props) {
  const sorted = [...data].sort(
    (a, b) => CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class)
  )
  const chartData = sorted.map((d) => ({
    class: d.class,
    'Prev Year': Math.round(d._sum.previousDue ?? 0),
    'School':    Math.round(d._sum.schoolDue ?? 0),
    'Bus':       Math.round(d._sum.busDue ?? 0),
    'Extra':     Math.round(d._sum.extraDue ?? 0),
  }))

  return (
    <div className="card p-6 h-full">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Pending Dues by Class
          </h3>
          <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Stacked breakdown across all fee categories
          </p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} barSize={18} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
          <XAxis
            dataKey="class"
            tick={{ fill: '#6e6e6e', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            axisLine={{ stroke: '#1f1f1f' }}
            tickLine={false}
            dy={4}
          />
          <YAxis
            tick={{ fill: '#6e6e6e', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false} tickLine={false}
            tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Legend
            iconType="circle" iconSize={7}
            wrapperStyle={{ fontSize: 11, color: '#a1a1a1', paddingTop: 18 }}
          />
          {SERIES.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="a"
              fill={s.hex}
              stroke="var(--card)"
              strokeWidth={2}
              radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
