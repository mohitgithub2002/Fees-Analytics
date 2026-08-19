'use client'

import { Sparkles } from 'lucide-react'

/**
 * The evidence list behind an archetype/propensity verdict, rendered
 * verbatim from the server (src/lib/recovery/archetype.ts,
 * src/lib/recovery/propensity.ts). The whole point of building the ranking
 * as explainable factors is defeated if the UI collapses them back into a
 * bare number — this component exists so it never does.
 */
export function WhyPanel({
  title = 'Why this ranking',
  evidence,
  compact,
}: {
  title?: string
  evidence: string[]
  compact?: boolean
}) {
  if (evidence.length === 0) return null
  return (
    <div className={compact ? '' : 'card p-4'}>
      {!compact && (
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </span>
        </div>
      )}
      <ul className="space-y-1.5">
        {evidence.map((line, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-[12.5px] leading-snug"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span
              className="mt-1.5 w-1 h-1 rounded-full flex-shrink-0"
              style={{ background: 'var(--text-muted)' }}
            />
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}
