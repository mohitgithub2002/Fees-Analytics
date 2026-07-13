'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Props {
  previousDue: number
  schoolDue:   number
  busDue:      number
  extraDue:    number
}

const COLORS = ['#f43f5e', '#6366f1', '#10b981', '#f59e0b']
const RADIAN = Math.PI / 180

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.06) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x} y={y} fill="white"
      textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight={700}
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
      background: '#0d1117',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 12,
      padding: '10px 14px',
    }}>
      <p style={{ color: '#e8edf5', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        {payload[0].name}
      </p>
      <p style={{ color: '#7c8a9e', fontSize: 12 }}>
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

  return (
    <div className="glass-card p-6 h-full">
      <div className="mb-4">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Dues Distribution
        </h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Category split of total pending amount
        </p>
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-60" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-sm">No pending dues 🎉</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data}
              cx="50%" cy="50%"
              innerRadius={68} outerRadius={108}
              paddingAngle={3}
              dataKey="value"
              labelLine={false}
              label={renderLabel}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: '#7c8a9e', paddingTop: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
