'use client'

import { AlertTriangle, Info } from 'lucide-react'
import { ARCHETYPE_META, TIER_META, type EconomicTier, type PaymentArchetype } from '@/lib/recovery/types'

/* ── Shared chip primitives for the recovery module ──────────────────────
 * Same visual language as src/components/v2/ui.tsx (CategoryChip, StatusChip):
 * pill, 11px medium, background/foreground pair from the semantic tokens. */

const TONE_STYLE: Record<'critical' | 'warning' | 'neutral' | 'good', { bg: string; color: string }> = {
  critical: { bg: 'var(--critical-soft)', color: 'var(--critical)' },
  warning: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  good: { bg: 'var(--good-soft)', color: 'var(--good-2)' },
  neutral: { bg: 'var(--elevated)', color: 'var(--text-secondary)' },
}

export function ArchetypeChip({
  archetype,
  confidence,
  small,
}: {
  archetype: PaymentArchetype
  confidence?: number
  small?: boolean
}) {
  const meta = ARCHETYPE_META[archetype]
  const s = TONE_STYLE[meta.tone]
  return (
    <span
      title={meta.description}
      className={`inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap ${
        small ? 'px-1.5 py-0.5 text-[10.5px]' : 'px-2 py-0.5 text-[11px]'
      }`}
      style={{ background: s.bg, color: s.color }}
    >
      {small ? meta.short : meta.label}
      {confidence !== undefined && confidence < 45 && (
        <Info className="w-2.5 h-2.5 opacity-70" />
      )}
    </span>
  )
}

const TIER_TONE: Record<EconomicTier, 'critical' | 'warning' | 'neutral' | 'good'> = {
  AFFLUENT: 'good',
  COMFORTABLE: 'good',
  STRAINED: 'warning',
  POOR: 'critical',
  SEVERE: 'critical',
  UNKNOWN: 'neutral',
}

export function TierChip({
  tier,
  suggested,
  small,
}: {
  tier: EconomicTier
  /** True when this is a system suggestion, not a confirmed human tag. */
  suggested?: boolean
  small?: boolean
}) {
  const meta = TIER_META[tier]
  const s = TONE_STYLE[TIER_TONE[tier]]
  return (
    <span
      title={meta.description + (suggested ? ' (suggested — not yet confirmed)' : '')}
      className={`inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap ${
        small ? 'px-1.5 py-0.5 text-[10.5px]' : 'px-2 py-0.5 text-[11px]'
      }`}
      style={{
        background: s.bg,
        color: s.color,
        border: suggested ? `1px dashed ${s.color}66` : undefined,
      }}
    >
      {suggested ? `${meta.short}?` : meta.short}
    </span>
  )
}

const STAGE_LABEL: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  PROMISED: 'Promised',
  PARTIAL: 'Partial',
  RECOVERED: 'Recovered',
  SNOOZED: 'Snoozed',
  PARKED: 'Parked',
  ESCALATED: 'Escalated',
}
const STAGE_TONE: Record<string, 'critical' | 'warning' | 'neutral' | 'good'> = {
  NEW: 'neutral',
  CONTACTED: 'neutral',
  PROMISED: 'good',
  PARTIAL: 'warning',
  RECOVERED: 'good',
  SNOOZED: 'neutral',
  PARKED: 'critical',
  ESCALATED: 'critical',
}

export function StageChip({ stage }: { stage: string }) {
  const s = TONE_STYLE[STAGE_TONE[stage] ?? 'neutral']
  return (
    <span
      className="px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      {STAGE_LABEL[stage] ?? stage}
    </span>
  )
}

/**
 * Flags a chart or figure as built on synthesised payment timing rather than
 * real dates — see prisma/seed-recovery-demo.ts. Must appear wherever demo
 * timing drives what's on screen, so the owner never mistakes it for fact.
 */
export function EstimatedDataBadge({ percentEstimated }: { percentEstimated: number }) {
  if (percentEstimated <= 0) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
      style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
      title="Payment dates for older records were estimated from ledger totals, not imported from real receipts. Import real history to replace them."
    >
      <AlertTriangle className="w-3 h-3" />
      Estimated timing · {percentEstimated}% of payments
    </span>
  )
}
