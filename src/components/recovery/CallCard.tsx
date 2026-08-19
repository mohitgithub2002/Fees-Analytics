'use client'

import Link from 'next/link'
import { ExternalLink, Phone, User } from 'lucide-react'
import { ArchetypeChip, TierChip } from '@/components/recovery/chips'
import { WhyPanel } from '@/components/recovery/WhyPanel'
import { OutcomeButtons } from '@/components/recovery/OutcomeButtons'
import { fmtAmt } from '@/lib/v2/format'
import type { ContactOutcome } from '@/lib/recovery/types'
import type { WorklistCase } from '@/lib/recovery/api-types'

/**
 * The right-hand pane of the worklist: everything a caller needs for one
 * household without leaving the screen — who to call, why they're on the
 * list, what each child owes, and the one-tap outcome logger.
 */
export function CallCard({
  item,
  onLog,
}: {
  item: WorklistCase
  onLog: (input: {
    outcome: ContactOutcome
    notes?: string
    promiseAmount?: number
    promiseDate?: string
  }) => Promise<void>
}) {
  const { guardian } = item

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {guardian.name}
            </h2>
            <div className="flex items-center gap-2 mt-1.5">
              <ArchetypeChip archetype={guardian.archetype} confidence={guardian.archetypeConfidence} />
              <TierChip tier={guardian.economicTier} />
            </div>
          </div>
          {guardian.phone && (
            <a
              href={`tel:${guardian.phone}`}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12.5px] font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              <Phone className="w-3.5 h-3.5" /> {guardian.phone}
            </a>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg p-3" style={{ background: 'var(--elevated)' }}>
            <p className="label-micro mb-1">Outstanding</p>
            <p className="mono text-[16px] font-semibold" style={{ color: 'var(--critical)' }}>{fmtAmt(item.outstanding)}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--elevated)' }}>
            <p className="label-micro mb-1">Expected in 30 Days</p>
            <p className="mono text-[16px] font-semibold" style={{ color: 'var(--good-2)' }}>{fmtAmt(item.expectedRecoveryValue)}</p>
          </div>
        </div>

        <div className="space-y-1.5 mb-1">
          {guardian.children.map((child) => (
            <div key={child.id} className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
              <User className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
              <span>{child.name}</span>
              {child.class && <span style={{ color: 'var(--text-faint)' }}>· Class {child.class}</span>}
            </div>
          ))}
        </div>

        <Link
          href={`/recovery/parents/${guardian.id}`}
          className="inline-flex items-center gap-1 mt-3 text-[12px] font-medium hover:underline"
          style={{ color: 'var(--text-muted)' }}
        >
          Full profile & payment history <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {guardian.evidence && guardian.evidence.length > 0 && (
        <WhyPanel evidence={guardian.evidence} />
      )}

      <div className="card p-5">
        <p className="text-[12.5px] font-semibold mb-3.5" style={{ color: 'var(--text-primary)' }}>
          Log this call
        </p>
        <OutcomeButtons maxAmount={item.outstanding} onSubmit={onLog} />
      </div>
    </div>
  )
}
