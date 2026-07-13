'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
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
  return (
    <div style={{
      background: '#0d1117',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 12, padding: '12px 16px', minWidth: 160,
    }}>
      <p style={{ color: '#e8edf5', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
        Class {label}
      </p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-6 mb-1" style={{ fontSize: 12 }}>
          <span style={{ color: '#7c8a9e' }}>{p.name}</span>
          <span style={{ color: p.fill, fontWeight: 600 }}>
            ₹{(p.value || 0).toLocaleString('en-IN')}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ClassRecoveryChart({ data }: Props) {
  const sorted = [...data].sort(
    (a, b) => CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class)
  )

  const chartData = sorted.map((d) => {
    const fees = d._sum.totalFees ?? 0
    const collected = d._sum.totalDeposit ?? 0
    const pending = d._sum.totalDue ?? 0
    return {
      class: d.class,
      Collected: Math.round(collected),
      Pending: Math.round(pending),
      rate: fees > 0 ? Math.round((collected / fees) * 100) : 0,
    }
  })

  return (
    <div className="glass-card p-6">
      <div className="mb-5">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Collected vs Pending — By Class
        </h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Compare fees collected against outstanding dues per class
        </p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart
          data={chartData}
          barSize={12}
          barGap={3}
          margin={{ top: 4, right: 4, left: -8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
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
            iconType="circle" iconSize={8}
            wrapperStyle={{ fontSize: 11, color: '#7c8a9e', paddingTop: 16 }}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" />
          <Bar dataKey="Collected" fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Pending"   fill="#f43f5e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
