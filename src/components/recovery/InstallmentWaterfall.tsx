'use client'

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle } from 'lucide-react'
import type { InstallmentBehaviourDTO } from '@/lib/recovery/api-types'

const ON_TIME_HEX = '#1aa34a' // --good
const LATE_HEX = '#fab219' // --warning
const COLLECTED_HEX = '#3987e5' // --data-2, used when timing is unknown
const OUTSTANDING_HEX = '#e5484d' // --critical

const money = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`
const axisMoney = (v: number) => (v >= 1_00_000 ? `₹${(v / 1_00_000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}K`)

/**
 * Expected vs collected per installment — the answer to "which instalment
 * leaves money on the table". A wide amber-plus-red segment on installment 2
 * is a due date the school picked before anyone in town has money, not a
 * calling problem.
 */
export function InstallmentWaterfall({ data }: { data: InstallmentBehaviourDTO[] }) {
  if (data.length === 0) {
    return <div className="py-14 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>No installment data for this session yet.</div>
  }

  // With no due dates anywhere, on-time vs late is unknowable — show a single
  // neutral "Collected" series rather than implying a perfect record.
  const anyDueDates = data.some((d) => d.hasDueDate)

  const chartData = data.map((d) => ({
    label: d.label,
    'On Time': Math.round(d.collectedOnTime),
    Late: Math.round(d.collectedLate),
    Collected: Math.round(d.collected),
    Outstanding: Math.round(d.outstanding),
  }))

  return (
    <div>
      {!anyDueDates && (
        <div
          className="flex items-start gap-2 mb-4 px-3.5 py-2.5 rounded-lg text-[12px]"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span>
            No installment due dates are set, so on-time vs late cannot be measured — only totals are
            shown. Add a due-date schedule under <strong>Setup → Fee Structures</strong>, then run{' '}
            <span className="mono">npm run recovery:backfill-due-dates</span> to fill in existing installments.
          </span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} barSize={40} margin={{ top: 4, right: 4, left: 2, bottom: 0 }}>
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
                  {payload.map((p: any) => (
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
          {anyDueDates ? (
            <>
              <Bar dataKey="On Time" stackId="a" fill={ON_TIME_HEX} />
              <Bar dataKey="Late" stackId="a" fill={LATE_HEX} />
            </>
          ) : (
            <Bar dataKey="Collected" stackId="a" fill={COLLECTED_HEX} />
          )}
          <Bar dataKey="Outstanding" stackId="a" fill={OUTSTANDING_HEX} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto mt-5">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Installment', 'Due Date', 'On-Time %', 'Avg Days Late', 'Cleared'].map((h, i) => (
                <th key={h} className={`px-3 py-2 label-micro font-medium ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.sequence} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{d.label}</td>
                <td className="px-3 py-2.5" style={{ color: 'var(--text-muted)' }}>{d.dueDate ? new Date(d.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Not set'}</td>
                <td
                  className="px-3 py-2.5 text-right mono"
                  style={{
                    color:
                      d.onTimePercent === null ? 'var(--text-faint)'
                      : d.onTimePercent >= 70 ? 'var(--good-2)'
                      : d.onTimePercent >= 40 ? 'var(--warning)'
                      : 'var(--critical)',
                  }}
                  title={d.onTimePercent === null ? 'No due date set — cannot be measured' : undefined}
                >
                  {d.onTimePercent === null ? '—' : `${d.onTimePercent}%`}
                </td>
                <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>{d.avgDaysLate !== null ? `${d.avgDaysLate}d` : '—'}</td>
                <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>{d.studentsCleared}/{d.studentsDue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
