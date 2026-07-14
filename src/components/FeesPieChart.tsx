'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Props {
  previousDue: number
  schoolDue:   number
  busDue:      number
  extraDue:    number
}

const COLORS = ['#e66767', '#3987e5', '#199e70', '#9085e9']
const RADIAN = Math.PI / 180

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.07) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x} y={y} fill="#fff"
      textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight={600}
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--elevated)',
      border: '1px solid var(--border-hover)',
      borderRadius: 10, padding: '10px 12px',
      boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
    }}>
      <div className="flex items-center gap-2 mb-1" style={{ fontSize: 13 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: payload[0].payload.fill }} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{payload[0].name}</span>
      </div>
      <p className="mono" style={{ color: 'var(--text-secondary)', fontSize: 12, paddingLeft: 16 }}>
        ₹{(payload[0].value as number).toLocaleString('en-IN')}
      </p>
    </div>
  )
}

export function FeesPieChart({ previousDue, schoolDue, busDue, extraDue }: Props) {
  const raw = [
    { name: 'Prev Year', value: Math.round(previousDue) },
    { name: 'School',    value: Math.round(schoolDue) },
    { name: 'Bus',       value: Math.round(busDue) },
    { name: 'Extra',     value: Math.round(extraDue) },
  ]
  const data = raw.filter((d) => d.value > 0)
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="card p-6 h-full">
      <div className="mb-2">
        <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Dues Distribution
        </h3>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
          Category split of total pending
        </p>
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-60" style={{ color: 'var(--text-muted)' }}>
          <p className="text-sm">No pending dues 🎉</p>
        </div>
      ) : (
        <div className="relative">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={data}
                cx="50%" cy="50%"
                innerRadius={70} outerRadius={106}
                paddingAngle={2}
                dataKey="value"
                labelLine={false}
                label={renderLabel}
                stroke="var(--card)"
                strokeWidth={2}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" iconSize={7}
                wrapperStyle={{ fontSize: 11, color: '#a1a1a1', paddingTop: 8 }} />
            </PieChart>
          </ResponsiveContainer>

          {/* Center total */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ top: -28 }}>
            <p className="label-micro mb-1">Total Due</p>
            <p className="mono text-[19px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {total >= 1_00_000 ? `₹${(total / 1_00_000).toFixed(1)}L` : `₹${(total / 1000).toFixed(0)}K`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
