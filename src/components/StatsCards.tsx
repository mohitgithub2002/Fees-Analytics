import { Users, IndianRupee, TrendingUp, AlertCircle, Percent, Clock, School, Bus } from 'lucide-react'
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

const CARDS = (a: AnalyticsOverview) => [
  {
    label:    'Total Students',
    value:    a.totalStudents.toString(),
    icon:     Users,
    gradient: 'linear-gradient(135deg,#3b82f6,#6366f1)',
    glow:     'rgba(99,102,241,0.18)',
    desc:     'Enrolled this year',
  },
  {
    label:    'Total Fees',
    value:    fmtCur(a.totalFees),
    icon:     IndianRupee,
    gradient: 'linear-gradient(135deg,#6366f1,#a855f7)',
    glow:     'rgba(168,85,247,0.18)',
    desc:     'Expected this term',
  },
  {
    label:    'Fees Collected',
    value:    fmtCur(a.totalDeposit),
    icon:     TrendingUp,
    gradient: 'linear-gradient(135deg,#10b981,#059669)',
    glow:     'rgba(16,185,129,0.18)',
    desc:     'Successfully recovered',
  },
  {
    label:    'Total Pending',
    value:    fmtCur(a.totalDue),
    icon:     AlertCircle,
    gradient: 'linear-gradient(135deg,#f43f5e,#e11d48)',
    glow:     'rgba(244,63,94,0.20)',
    desc:     'Outstanding dues',
  },
  {
    label:    'Recovery Rate',
    value:    `${a.recoveryRate}%`,
    icon:     Percent,
    gradient: 'linear-gradient(135deg,#f59e0b,#d97706)',
    glow:     'rgba(245,158,11,0.18)',
    desc:     'Fees collected ratio',
  },
  {
    label:    'Prev. Year Due',
    value:    fmtCur(a.previousDue),
    icon:     Clock,
    gradient: 'linear-gradient(135deg,#ec4899,#db2777)',
    glow:     'rgba(236,72,153,0.18)',
    desc:     'Carried from last year',
  },
  {
    label:    'School Fees Due',
    value:    fmtCur(a.schoolDue),
    icon:     School,
    gradient: 'linear-gradient(135deg,#3b82f6,#2563eb)',
    glow:     'rgba(59,130,246,0.18)',
    desc:     'Current tuition pending',
  },
  {
    label:    'Bus Fees Due',
    value:    fmtCur(a.busDue),
    icon:     Bus,
    gradient: 'linear-gradient(135deg,#14b8a6,#0891b2)',
    glow:     'rgba(20,184,166,0.18)',
    desc:     'Transport pending',
  },
]

export function StatsCards({ analytics }: StatsCardsProps) {
  const cards = CARDS(analytics)
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-fadein">
      {cards.map((card, i) => (
        <div
          key={i}
          className="glass-card p-5 relative overflow-hidden group cursor-default"
          style={{ animationDelay: `${i * 40}ms` }}
        >
          {/* Hover glow */}
          <div
            className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
            style={{ background: card.glow }}
          />
          {/* Content */}
          <div className="relative z-10">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
              style={{ background: card.gradient }}
            >
              <card.icon className="w-5 h-5 text-white" />
            </div>
            <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-secondary)' }}>
              {card.label}
            </p>
            <p className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {card.value}
            </p>
            <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
              {card.desc}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
