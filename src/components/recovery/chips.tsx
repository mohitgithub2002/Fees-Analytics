'use client'

import { AlertTriangle, Info } from 'lucide-react'
import {
  ARCHETYPE_LABEL,
  STAGE_LABEL,
  TIER_LABEL,
  type EconomicTier,
  type PaymentArchetype,
  type RecoveryStage,
} from '@/lib/recovery/types'

/* ── Shared vocabulary for the recovery screens ───────────────────
 *
 * Colour carries meaning here, so it is defined once. An owner scanning a
 * list should be able to tell "owes for years" from "pays on time" without
 * reading, and the same behaviour must never be red on one screen and amber
 * on another.
 */

const ARCHETYPE_STYLE: Record<PaymentArchetype, { bg: string; color: string }> = {
  CHRONIC_DEFAULTER: { bg: 'var(--critical-soft)', color: 'var(--critical)' },
  NEXT_YEAR_PAYER: { bg: 'var(--critical-soft)', color: 'var(--critical)' },
  HEAVY_ROLLOVER: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  YEAR_END_PARTIAL: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  YEAR_END_FULL: { bg: 'var(--blue-soft)', color: 'var(--data-2)' },
  INSTALLMENT_REGULAR: { bg: 'var(--good-soft)', color: 'var(--good-2)' },
  EARLY_FULL: { bg: 'var(--good-soft)', color: 'var(--good-2)' },
  UNKNOWN: { bg: 'var(--elevated-2)', color: 'var(--text-muted)' },
}

export function ArchetypeChip({
  archetype,
  small,
}: {
  archetype: PaymentArchetype | string
  small?: boolean
}) {
  const key = (archetype as PaymentArchetype) in ARCHETYPE_STYLE
    ? (archetype as PaymentArchetype)
    : 'UNKNOWN'
  const s = ARCHETYPE_STYLE[key]
  return (
    <span
      className={`rounded-md font-medium whitespace-nowrap ${small ? 'px-1.5 py-0.5 text-[10.5px]' : 'px-2 py-0.5 text-[11px]'}`}
      style={{ background: s.bg, color: s.color }}
    >
      {ARCHETYPE_LABEL[key]}
    </span>
  )
}

const TIER_STYLE: Record<EconomicTier, { bg: string; color: string }> = {
  AFFLUENT: { bg: 'var(--good-soft)', color: 'var(--good-2)' },
  COMFORTABLE: { bg: 'var(--good-soft)', color: 'var(--good-2)' },
  STRAINED: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  POOR: { bg: 'var(--critical-soft)', color: 'var(--critical)' },
  SEVERE: { bg: 'var(--critical-soft)', color: 'var(--critical)' },
  UNKNOWN: { bg: 'var(--elevated-2)', color: 'var(--text-muted)' },
}

export function TierChip({ tier, small }: { tier: EconomicTier | string; small?: boolean }) {
  const key = (tier as EconomicTier) in TIER_STYLE ? (tier as EconomicTier) : 'UNKNOWN'
  const s = TIER_STYLE[key]
  return (
    <span
      className={`rounded-md font-medium whitespace-nowrap ${small ? 'px-1.5 py-0.5 text-[10.5px]' : 'px-2 py-0.5 text-[11px]'}`}
      style={{ background: s.bg, color: s.color }}
    >
      {TIER_LABEL[key]}
    </span>
  )
}

const STAGE_STYLE: Record<RecoveryStage, { bg: string; color: string }> = {
  NEW: { bg: 'var(--elevated-2)', color: 'var(--text-muted)' },
  CONTACTED: { bg: 'var(--blue-soft)', color: 'var(--data-2)' },
  PROMISED: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  PARTIAL: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  RECOVERED: { bg: 'var(--good-soft)', color: 'var(--good-2)' },
  SNOOZED: { bg: 'var(--elevated-2)', color: 'var(--text-muted)' },
  PARKED: { bg: 'var(--elevated-2)', color: 'var(--text-muted)' },
  ESCALATED: { bg: 'var(--critical-soft)', color: 'var(--critical)' },
}

export function StageChip({ stage }: { stage: RecoveryStage | string }) {
  const key = (stage as RecoveryStage) in STAGE_STYLE ? (stage as RecoveryStage) : 'NEW'
  const s = STAGE_STYLE[key]
  return (
    <span
      className="px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      {STAGE_LABEL[key]}
    </span>
  )
}

/**
 * How sure the system is, said in words rather than as a bare number.
 *
 * "0.45" means nothing to somebody deciding whether to trust a call order.
 * "Worth a look" does.
 */
export function ConfidenceChip({ value }: { value: number }) {
  const label =
    value >= 0.75 ? 'Confident' : value >= 0.5 ? 'Fairly sure' : value > 0 ? 'Early read' : 'No basis'
  const color =
    value >= 0.75 ? 'var(--good-2)' : value >= 0.5 ? 'var(--data-2)' : 'var(--text-muted)'
  return (
    <span className="text-[11px] font-medium whitespace-nowrap" style={{ color }}>
      {label}
    </span>
  )
}

/**
 * The reasons behind a verdict, rendered verbatim.
 *
 * The owner has to be able to disagree with the system out loud — "no, they
 * cleared by Diwali last year" — and see exactly which rule produced the
 * answer. A score with no reasoning gets ignored the first time it is wrong.
 */
export function EvidenceList({ lines, max }: { lines: string[]; max?: number }) {
  if (!lines?.length) return null
  const shown = max ? lines.slice(0, max) : lines
  return (
    <ul className="space-y-1">
      {shown.map((line, i) => (
        <li
          key={i}
          className="text-[12px] leading-relaxed flex gap-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * What the screen could not see.
 *
 * A chart drawn from installments that have no due dates looks exactly as
 * confident as a real one, and quietly teaches the owner something false.
 * Every lens that can be starved of data says so, here, in plain words.
 */
export function CoverageNote({ message, tone = 'warn' }: { message: string | null; tone?: 'warn' | 'info' }) {
  if (!message) return null
  const Icon = tone === 'warn' ? AlertTriangle : Info
  return (
    <div
      className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg text-[12px] leading-relaxed"
      style={{
        background: tone === 'warn' ? 'var(--warning-soft)' : 'var(--elevated)',
        color: tone === 'warn' ? 'var(--warning)' : 'var(--text-secondary)',
      }}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  )
}

/** A labelled number, the unit the dashboards are built from. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: 'good' | 'warn' | 'critical'
}) {
  const color =
    tone === 'good'
      ? 'var(--good-2)'
      : tone === 'warn'
        ? 'var(--warning)'
        : tone === 'critical'
          ? 'var(--critical)'
          : 'var(--text-primary)'
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <p className="label-micro mb-1.5">{label}</p>
      <p className="text-[20px] font-semibold tracking-tight mono" style={{ color }}>
        {value}
      </p>
      {hint && (
        <p className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div
        className="px-4 py-3 flex items-start justify-between gap-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="leading-tight">
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
