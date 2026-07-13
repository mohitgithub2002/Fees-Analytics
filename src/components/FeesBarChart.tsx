'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { ClassBreakdown } from '@/lib/types'

const CLASS_ORDER = [
  'Nursery','LKG','UKG','I','II','III','IV','V','VI','VII','VIII','IX','X',
]

interface Props {
  data: ClassBreakdown[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0)
  return (
    <div
      style={{
        background: '#0d1117',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 12,
        padding: '12px 16px',
        minWidth: 180,
      }}
    >
      <p style={{ color: '#e8edf5', fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
        Class {label}
      </p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1" style={{ fontSize: 12 }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: p.fill,
            }}
          />
          <span style={{ color: '#7c8a9e', flex: 1 }}>{p.name}</span>
          <span style={{ color: '#e8edf5', fontWeight: 500 }}>
            ₹{(p.value || 0).toLocaleString('en-IN')}
          </span>
        </div>
      ))}
      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          marginTop: 8,
          paddingTop: 8,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          fontWeight: 600,
          color: '#e8edf5',
        }}
      >
        <span>Total</span>
        <span>₹{total.toLocaleString('en-IN')}</span>
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
    <div className="glass-card p-6 h-full">
      <div className="mb-5">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Pending Dues by Class
        </h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Stacked breakdown across all fee categories
        </p>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} barSize={14} barGap={2} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.05)"
            vertical={false}
          />
          <XAxis
            dataKey="class"
            tick={{ fill: '#7c8a9e', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.05)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#7c8a9e', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: '#7c8a9e', paddingTop: 16 }}
          />
          <Bar dataKey="Prev Year" stackId="a" fill="#f43f5e" />
          <Bar dataKey="School"    stackId="a" fill="#6366f1" />
          <Bar dataKey="Bus"       stackId="a" fill="#10b981" />
          <Bar dataKey="Extra"     stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
