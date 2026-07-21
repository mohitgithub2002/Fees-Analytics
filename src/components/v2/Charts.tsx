'use client'

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { AnalyticsV2, FeeCategory } from '@/lib/v2/types'

/* Fee-category palette — reuses the validated data tokens from globals.css. */
const CAT_HEX: Record<FeeCategory, string> = {
  SCHOOL: '#3987e5', // --data-2
  BUS: '#199e70',    // --data-3
  OTHER: '#9085e9',  // --data-4
}
const COLLECTED_HEX = '#1aa34a' // --good
const PENDING_HEX = '#e5484d'   // --critical

const money = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`
const axisMoney = (v: number) =>
  v >= 1_00_000 ? `₹${(v / 1_00_000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}K`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StackTooltip({ active, payload, label, showTotal }: any) {
  if (!active || !payload?.length) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = payload.filter((p: any) => (p.value ?? 0) > 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0)
  return (
    <div style={{
      background: 'var(--elevated)', border: '1px solid var(--border-hover)',
      borderRadius: 10, padding: '10px 12px', minWidth: 180,
      boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
    }}>
      <p className="label-micro" style={{ marginBottom: 8 }}>Class {label}</p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {rows.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1.5" style={{ fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
          <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{p.name}</span>
          <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{money(p.value || 0)}</span>
        </div>
      ))}
      {showTotal && (
        <div style={{
          borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8,
          display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600,
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>Total</span>
          <span className="mono" style={{ color: 'var(--text-primary)' }}>{money(total)}</span>
        </div>
      )}
    </div>
  )
}

const axisX = {
  tick: { fill: '#6e6e6e', fontSize: 11, fontFamily: 'var(--font-mono)' },
  axisLine: { stroke: '#1f1f1f' }, tickLine: false, dy: 4,
}
const axisY = {
  tick: { fill: '#6e6e6e', fontSize: 10, fontFamily: 'var(--font-mono)' },
  axisLine: false as const, tickLine: false as const, tickFormatter: axisMoney,
}

function ChartCard({ title, subtitle, children, className }: {
  title: string; subtitle: string; children: React.ReactNode; className?: string
}) {
  return (
    <div className={`card p-6 ${className ?? ''}`}>
      <div className="mb-6">
        <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

/* ── Pending Dues by Class (stacked) ────────────────────────────── */
export function PendingDuesByClass({ byClass }: { byClass: AnalyticsV2['byClass'] }) {
  const data = byClass.map((c) => ({
    class: c.class, School: Math.round(c.schoolDue), Bus: Math.round(c.busDue), Other: Math.round(c.otherDue),
  }))
  const series: { key: 'School' | 'Bus' | 'Other'; hex: string }[] = [
    { key: 'School', hex: CAT_HEX.SCHOOL }, { key: 'Bus', hex: CAT_HEX.BUS }, { key: 'Other', hex: CAT_HEX.OTHER },
  ]
  return (
    <ChartCard title="Pending Dues by Class" subtitle="Stacked breakdown across all fee categories" className="h-full">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} barSize={18} margin={{ top: 4, right: 4, left: 2, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
          <XAxis dataKey="class" {...axisX} />
          <YAxis {...axisY} />
          <Tooltip content={<StackTooltip showTotal />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: '#a1a1a1', paddingTop: 18 }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.hex} stroke="var(--card)" strokeWidth={2}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/* ── Dues Distribution (donut) ──────────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function donutLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (percent < 0.07) return null
  const RADIAN = Math.PI / 180
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight={600} style={{ fontFamily: 'var(--font-mono)' }}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DonutTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--elevated)', border: '1px solid var(--border-hover)',
      borderRadius: 10, padding: '10px 12px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
    }}>
      <div className="flex items-center gap-2 mb-1" style={{ fontSize: 13 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: payload[0].payload.fill }} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{payload[0].name}</span>
      </div>
      <p className="mono" style={{ color: 'var(--text-secondary)', fontSize: 12, paddingLeft: 16 }}>
        {money(payload[0].value as number)}
      </p>
    </div>
  )
}

export function DuesDistribution({ byCategory }: { byCategory: AnalyticsV2['byCategory'] }) {
  const LABEL: Record<FeeCategory, string> = { SCHOOL: 'School', BUS: 'Bus', OTHER: 'Other' }
  const raw = (['SCHOOL', 'BUS', 'OTHER'] as FeeCategory[]).map((cat) => ({
    name: LABEL[cat],
    value: Math.round(byCategory.find((b) => b.category === cat)?._sum.dueAmount ?? 0),
    fill: CAT_HEX[cat],
  }))
  const data = raw.filter((d) => d.value > 0)
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <ChartCard title="Dues Distribution" subtitle="Category split of total pending" className="h-full">
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-60" style={{ color: 'var(--text-muted)' }}>
          <p className="text-sm">No pending dues 🎉</p>
        </div>
      ) : (
        <div className="relative">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={70} outerRadius={106} paddingAngle={2}
                dataKey="value" labelLine={false} label={donutLabel} stroke="var(--card)" strokeWidth={2}>
                {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: '#a1a1a1', paddingTop: 8 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ top: -28 }}>
            <p className="label-micro mb-1">Total Due</p>
            <p className="mono text-[19px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {total >= 1_00_000 ? `₹${(total / 1_00_000).toFixed(1)}L` : `₹${(total / 1000).toFixed(0)}K`}
            </p>
          </div>
        </div>
      )}
    </ChartCard>
  )
}

/* ── Collected vs Pending by Class (grouped) ────────────────────── */
export function CollectedVsPending({ byClass }: { byClass: AnalyticsV2['byClass'] }) {
  const data = byClass.map((c) => ({
    class: c.class, Collected: Math.round(c.paidAmount), Pending: Math.round(c.dueAmount),
  }))
  return (
    <ChartCard title="Collected vs Pending — By Class" subtitle="Fees collected against outstanding dues per class">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} barSize={13} barGap={4} margin={{ top: 4, right: 4, left: 2, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
          <XAxis dataKey="class" {...axisX} />
          <YAxis {...axisY} />
          <Tooltip content={<StackTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: '#a1a1a1', paddingTop: 18 }} />
          <Bar dataKey="Collected" fill={COLLECTED_HEX} radius={[4, 4, 0, 0]} />
          <Bar dataKey="Pending" fill={PENDING_HEX} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
