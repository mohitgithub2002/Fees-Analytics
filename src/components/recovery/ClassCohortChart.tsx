'use client'

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ClassCohortDTO } from '@/lib/recovery/api-types'
import { fmtAmt } from '@/lib/v2/format'

const GOOD = '#1aa34a'
const WARNING = '#fab219'
const CRITICAL = '#e5484d'

function recoveryColor(pct: number) {
  return pct >= 80 ? GOOD : pct >= 55 ? WARNING : CRITICAL
}

/**
 * Recovery rate by class, each bar coloured by how it's doing — plus the
 * within-class tercile split beneath, so a low bar can be read as either
 * "the whole class is behind" or "a third of the class is dragging the
 * average down," which call for very different responses.
 */
export function ClassCohortChart({ data }: { data: ClassCohortDTO[] }) {
  if (data.length === 0) {
    return <div className="py-14 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>No classes with fees assigned yet.</div>
  }

  const chartData = data.map((c) => ({ name: c.className, recovery: c.recoveryPercent }))

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} barSize={22} margin={{ top: 4, right: 4, left: 2, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1a1a1a" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: '#6e6e6e', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={{ stroke: '#1f1f1f' }} tickLine={false} />
          <YAxis tick={{ fill: '#6e6e6e', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div style={{ background: 'var(--elevated)', border: '1px solid var(--border-hover)', borderRadius: 10, padding: '8px 12px' }}>
                  <p className="label-micro" style={{ marginBottom: 4 }}>Class {label}</p>
                  <p className="mono" style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{payload[0].value}% recovered</p>
                </div>
              )
            }}
          />
          <Bar dataKey="recovery" radius={[4, 4, 0, 0]}>
            {chartData.map((c, i) => <Cell key={i} fill={recoveryColor(c.recovery)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto mt-5">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Class', 'Students', 'Recovery', 'Above Avg', 'At Avg', 'Below Avg'].map((h, i) => (
                <th key={h} className={`px-3 py-2 label-micro font-medium ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.classId} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{c.className}</td>
                <td className="px-3 py-2.5 mono" style={{ color: 'var(--text-secondary)' }}>{c.students}</td>
                <td className="px-3 py-2.5 text-right mono" style={{ color: recoveryColor(c.recoveryPercent) }}>{c.recoveryPercent}%</td>
                <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>{c.bands.above.students}</td>
                <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>{c.bands.at.students}</td>
                <td className="px-3 py-2.5 text-right mono" style={{ color: c.bands.below.students > c.students / 3 ? 'var(--critical)' : 'var(--text-secondary)' }}>
                  {c.bands.below.students} · {fmtAmt(c.bands.below.outstanding)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
