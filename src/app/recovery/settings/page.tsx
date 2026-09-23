'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner, apiCall, inputCls, inputStyle } from '@/components/v2/ui'
import { SectionCard } from '@/components/recovery/chips'
import type { RecoveryTuning } from '@/lib/recovery/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The rules are written as sentences rather than field names, because the
 * person who knows whether five days is too soon to call a family again is the
 * one running the school, not the one who wrote the code.
 */
const RULES: { key: keyof RecoveryTuning; label: string; hint: string; suffix?: string }[] = [
  {
    key: 'minOutstanding',
    label: 'Smallest amount worth a phone call',
    hint: 'Families owing less than this are left off the list.',
    suffix: '₹',
  },
  {
    key: 'justPaidSuppressDays',
    label: 'Leave a family alone after they pay',
    hint: 'Nothing is more annoying than a fee call three days after paying.',
    suffix: 'days',
  },
  {
    key: 'cooldownDays',
    label: 'Wait between calls to the same family',
    hint: 'How long before it is reasonable to ring again.',
    suffix: 'days',
  },
  {
    key: 'promiseGraceDays',
    label: 'Grace after a promised date',
    hint: 'How long to wait past the date they named before chasing again.',
    suffix: 'days',
  },
  {
    key: 'noAnswerBackoffThreshold',
    label: 'Unanswered calls before slowing down',
    hint: 'After this many in a row with no answer, the family is tried less often.',
    suffix: 'calls',
  },
  {
    key: 'noAnswerBackoffDays',
    label: 'How long to slow down for',
    hint: 'The pause once a family has stopped answering.',
    suffix: 'days',
  },
  {
    key: 'dailyCallTarget',
    label: 'Calls you plan to make a day',
    hint: 'Sets how many families the call list shows at once.',
    suffix: 'calls',
  },
]

const WEIGHTS: { key: string; label: string; hint: string }[] = [
  { key: 'archetype', label: 'Their payment pattern', hint: 'How much their history should matter.' },
  { key: 'tier', label: 'What they can afford', hint: 'How much your ability tag should matter.' },
  { key: 'recency', label: 'How recently they paid', hint: 'Whether a family is in a paying phase.' },
  { key: 'promises', label: 'Whether they keep their word', hint: 'Kept and broken promises.' },
  { key: 'contact', label: 'Whether they answer the phone', hint: 'Pick-up rate.' },
  {
    key: 'season',
    label: 'Time of year',
    hint: 'Kept low on purpose — with one year of history this is a single sample, not a habit.',
  },
  { key: 'askSize', label: 'Size of the ask', hint: 'Whether the balance is realistic for them.' },
]

export default function SettingsPage() {
  const [tuning, setTuning] = useState<RecoveryTuning | null>(null)
  const [limits, setLimits] = useState<Record<string, [number, number]>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/v2/recovery/config')
      .then((r) => r.json())
      .then((b) => {
        if (b.error) throw new Error(b.error)
        setTuning(b.data.tuning)
        setLimits(b.data.limits)
      })
      .catch((e) => setError((e as Error).message))
  }, [])

  async function save() {
    if (!tuning) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const body = await apiCall<any>('/api/v2/recovery/config', 'PATCH', tuning)
      // The server clamps everything, so the saved values are what comes back
      // — not what was typed.
      setTuning(body.data.tuning)
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!tuning) {
    return (
      <>
        <PageHeader section="Call Rules" />
        <div className="flex-1 p-8">
          {error ? <ErrorBanner error={error} /> : <EmptyState text="Loading…" />}
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader section="Call Rules" subtitle="Who gets called, how often, and what counts as worth chasing">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save rules'}
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5 max-w-3xl">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

        <SectionCard
          title="When to call, and when to leave people alone"
          subtitle="Every value is checked on save, so a slip cannot empty the call list without telling you"
        >
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {RULES.map((rule) => {
              const [min, max] = limits[rule.key] ?? [0, 9999]
              return (
                <div key={rule.key} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                      {rule.label}
                    </p>
                    <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
                      {rule.hint}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <input
                      type="number"
                      min={min}
                      max={max}
                      className={`${inputCls} w-24 text-right mono`}
                      style={inputStyle}
                      value={String(tuning[rule.key] ?? '')}
                      onChange={(e) =>
                        setTuning({ ...tuning, [rule.key]: Number(e.target.value) })
                      }
                    />
                    <span className="text-[11.5px] w-10" style={{ color: 'var(--text-muted)' }}>
                      {rule.suffix}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="What the ranking pays attention to"
          subtitle="Turn a signal down to zero to switch it off entirely"
        >
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {WEIGHTS.map((w) => {
              const value = tuning.scoreWeights?.[w.key] ?? 1
              return (
                <div key={w.key} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                      {w.label}
                    </p>
                    <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
                      {w.hint}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 w-44">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={value}
                      className="flex-1"
                      onChange={(e) =>
                        setTuning({
                          ...tuning,
                          scoreWeights: {
                            ...tuning.scoreWeights,
                            [w.key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                    <span className="text-[11.5px] mono w-10 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {value === 0 ? 'off' : `${Math.round(value * 100)}%`}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      </div>
    </>
  )
}
