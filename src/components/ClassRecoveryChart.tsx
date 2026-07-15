'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import type { ClassBreakdown } from '@/lib/types'

const CLASS_ORDER = [
  'Nursery','LKG','UKG','I','II','III','IV','V','VI','VII','VIII','IX','X',
]

interface Props { data: ClassBreakdown[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--elevated)',
      border: '1px solid var(--border-hover)',
      borderRadius: 10, padding: '10px 12px', minWidth: 170,
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
    <div className="card p-6">
      <div className="mb-6">
        <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Collected vs Pending — By Class
        </h3>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
          Fees collected against outstanding dues per class
        </p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} barSize={13} barGap={4} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
          <XAxis
            dataKey="class"
            tick={{ fill: '#6e6e6e', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            axisLine={{ stroke: '#1f1f1f' }}
            tickLine={false} dy={4}
          />
          <YAxis
            tick={{ fill: '#6e6e6e', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false} tickLine={false}
            tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Legend iconType="circle" iconSize={7}
            wrapperStyle={{ fontSize: 11, color: '#a1a1a1', paddingTop: 18 }} />
          <Bar dataKey="Collected" fill="#1aa34a" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Pending"   fill="#e5484d" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
