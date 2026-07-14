import {
  Users, IndianRupee, TrendingUp, AlertCircle,
  Percent, Clock, School, Bus, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import type { AnalyticsOverview } from '@/lib/types'

interface StatsCardsProps {
  analytics: AnalyticsOverview
}

function fmtCur(n: number) {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`
  if (n >= 1_00_000)    return `₹${(n / 1_00_000).toFixed(2)}L`
  if (n >= 1_000)       return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n.toLocaleString('en-IN')}`
}

type Tone = 'neutral' | 'good' | 'critical' | 'accent' | 'warning'

const toneColor: Record<Tone, string> = {
  neutral:  'var(--text-primary)',
  good:     'var(--good-2)',
  critical: 'var(--critical)',
  accent:   'var(--data-2)',
  warning:  'var(--warning)',
}

const CARDS = (a: AnalyticsOverview) => {
  const recovery = parseFloat(a.recoveryRate)
  return [
    {
      label: 'Total Students', value: a.totalStudents.toLocaleString('en-IN'),
      icon: Users, tone: 'neutral' as Tone, desc: 'Enrolled this year',
      trend: null,
    },
    {
      label: 'Total Fees', value: fmtCur(a.totalFees),
      icon: IndianRupee, tone: 'neutral' as Tone, desc: 'Expected this term',
      trend: null,
    },
    {
      label: 'Fees Collected', value: fmtCur(a.totalDeposit),
      icon: TrendingUp, tone: 'good' as Tone, desc: 'Successfully recovered',
      trend: { dir: 'up' as const, text: `${recovery}%` },
    },
    {
      label: 'Total Pending', value: fmtCur(a.totalDue),
      icon: AlertCircle, tone: 'critical' as Tone, desc: 'Outstanding dues',
      trend: { dir: 'down' as const, text: `${(100 - recovery).toFixed(1)}%` },
    },
  ]
}

const SECONDARY = (a: AnalyticsOverview) => [
  { label: 'Recovery Rate',   value: `${a.recoveryRate}%`,   icon: Percent, tone: 'accent'   as Tone },
  { label: 'Prev. Year Due',  value: fmtCur(a.previousDue),  icon: Clock,   tone: 'warning'  as Tone },
  { label: 'School Fees Due', value: fmtCur(a.schoolDue),    icon: School,  tone: 'neutral'  as Tone },
  { label: 'Bus Fees Due',    value: fmtCur(a.busDue),       icon: Bus,     tone: 'neutral'  as Tone },
]

function IconBox({ icon: Icon }: { icon: React.ElementType }) {
  return (
    <div
      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
      style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
    >
      <Icon className="w-[17px] h-[17px]" style={{ color: 'var(--text-secondary)' }} />
    </div>
  )
}

export function StatsCards({ analytics }: StatsCardsProps) {
  const primary = CARDS(analytics)
  const secondary = SECONDARY(analytics)

  return (
    <div className="space-y-4">
      {/* ── Primary KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {primary.map((c, i) => (
          <div
            key={c.label}
            className="card card-hover p-5 animate-fadeup"
            style={{ animationDelay: `${i * 45}ms` }}
          >
            <div className="flex items-start justify-between mb-4">
              <IconBox icon={c.icon} />
              {c.trend && (
                <span
                  className="flex items-center gap-1 text-[12px] font-medium mono px-2 h-6 rounded-full"
                  style={{
                    background: c.trend.dir === 'up' ? 'var(--good-soft)' : 'var(--critical-soft)',
                    color: c.trend.dir === 'up' ? 'var(--good-2)' : 'var(--critical)',
                  }}
                >
                  {c.trend.dir === 'up'
                    ? <ArrowUpRight className="w-3.5 h-3.5" />
                    : <ArrowDownRight className="w-3.5 h-3.5" />}
                  {c.trend.text}
                </span>
              )}
            </div>
            <p className="label-micro mb-1.5">{c.label}</p>
            <p
              className="mono text-[26px] font-semibold tracking-tight leading-none"
              style={{ color: toneColor[c.tone] }}
            >
              {c.value}
            </p>
            <p className="text-[12px] mt-2" style={{ color: 'var(--text-muted)' }}>
              {c.desc}
            </p>
          </div>
        ))}
      </div>

      {/* ── Secondary metrics strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {secondary.map((c, i) => (
          <div
            key={c.label}
            className="card card-hover px-4 py-3.5 flex items-center gap-3.5 animate-fadeup"
            style={{ animationDelay: `${(i + 4) * 45}ms` }}
          >
            <IconBox icon={c.icon} />
            <div className="min-w-0">
              <p className="label-micro mb-1 truncate">{c.label}</p>
              <p
                className="mono text-[17px] font-semibold tracking-tight leading-none truncate"
                style={{ color: toneColor[c.tone] }}
              >
                {c.value}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
