'use client'

import { Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { ARCHETYPE_META, TIER_META, type EconomicTier, type PaymentArchetype } from '@/lib/recovery/types'
import type { SegmentCellDTO } from '@/lib/recovery/api-types'
import { fmtCur } from '@/lib/v2/format'

/**
 * Where the outstanding money actually is, cross-cut by willingness
 * (archetype) and ability (tier). This is the map the whole recovery module
 * exists to draw: the top rows are households worth calling, the right-hand
 * columns are households a call cannot help. Cell intensity is scaled by ₹
 * outstanding so the eye goes straight to where the biggest pile of stuck
 * money sits, not just the most households.
 */

const ARCHETYPE_ORDER: PaymentArchetype[] = [
  'CHRONIC_DEFAULTER', 'NEXT_YEAR_PAYER', 'HEAVY_ROLLOVER', 'YEAR_END_PARTIAL',
  'YEAR_END_FULL', 'INSTALLMENT_REGULAR', 'EARLY_FULL', 'UNKNOWN',
]
const TIER_ORDER: EconomicTier[] = ['AFFLUENT', 'COMFORTABLE', 'STRAINED', 'POOR', 'SEVERE', 'UNKNOWN']

export function SegmentMatrix({
  cells,
  totals,
}: {
  cells: SegmentCellDTO[]
  totals: { households: number; outstanding: number; expectedRecovery: number }
}) {
  const router = useRouter()

  if (cells.length === 0 || totals.outstanding === 0) {
    return (
      <div className="py-14 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
        No outstanding balances to segment yet.
      </div>
    )
  }

  const byKey = new Map(cells.map((c) => [`${c.archetype}:${c.tier}`, c]))
  const maxOutstanding = Math.max(...cells.map((c) => c.outstanding), 1)

  const rows = ARCHETYPE_ORDER.filter((a) => cells.some((c) => c.archetype === a))
  const cols = TIER_ORDER.filter((t) => cells.some((c) => c.tier === t))

  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-1.5 min-w-[640px]"
        style={{ gridTemplateColumns: `140px repeat(${cols.length}, 1fr)` }}
      >
        <div />
        {cols.map((tier) => (
          <div
            key={tier}
            className="text-[11px] font-medium text-center pb-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            {TIER_META[tier].short}
          </div>
        ))}

        {rows.map((archetype) => (
          <Fragment key={archetype}>
            <div
              className="flex items-center text-[12px] font-medium pr-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {ARCHETYPE_META[archetype].label}
            </div>
            {cols.map((tier) => {
              const cell = byKey.get(`${archetype}:${tier}`)
              return (
                <MatrixCell
                  key={`${archetype}-${tier}`}
                  cell={cell}
                  intensity={cell ? cell.outstanding / maxOutstanding : 0}
                  onClick={() =>
                    cell && router.push(`/recovery/parents?archetype=${archetype}&tier=${tier}`)
                  }
                />
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function MatrixCell({
  cell,
  intensity,
  onClick,
}: {
  cell: SegmentCellDTO | undefined
  intensity: number
  onClick: () => void
}) {
  if (!cell) return <div className="rounded-lg" style={{ background: 'var(--elevated)', minHeight: 62 }} />

  const recoverability = cell.outstanding > 0 ? cell.expectedRecovery / cell.outstanding : 0
  const color =
    recoverability >= 0.35 ? 'var(--good-2)' : recoverability >= 0.15 ? 'var(--warning)' : 'var(--critical)'

  return (
    <button
      onClick={onClick}
      className="rounded-lg p-2.5 text-left transition-transform hover:-translate-y-0.5"
      style={{
        background: `color-mix(in srgb, ${color} ${8 + intensity * 22}%, var(--card))`,
        border: `1px solid color-mix(in srgb, ${color} ${20 + intensity * 30}%, var(--border))`,
        minHeight: 62,
      }}
      title={`${cell.households} household(s) · ${fmtCur(cell.outstanding)} outstanding · ${fmtCur(cell.expectedRecovery)} expected in 30 days`}
    >
      <p className="mono text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {fmtCur(cell.outstanding)}
      </p>
      <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
        {cell.households} household{cell.households === 1 ? '' : 's'}
      </p>
    </button>
  )
}
