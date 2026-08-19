'use client'

import { useState } from 'react'
import { Loader2, PhoneForwarded } from 'lucide-react'
import { Button, Field, inputCls, inputStyle } from '@/components/v2/ui'
import { OUTCOME_META, type ContactOutcome } from '@/lib/recovery/types'

const OUTCOME_ORDER: ContactOutcome[] = [
  'PROMISED', 'NEEDS_TIME', 'PAID_ALREADY', 'CALL_BACK_LATER',
  'REFUSED', 'DISPUTED', 'NO_ANSWER', 'SWITCHED_OFF', 'WRONG_NUMBER',
]

const TONE_STYLE: Record<'good' | 'warning' | 'critical' | 'neutral', React.CSSProperties> = {
  good: { background: 'var(--good-soft)', color: 'var(--good-2)' },
  warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  critical: { background: 'var(--critical-soft)', color: 'var(--critical)' },
  neutral: { background: 'var(--elevated)', color: 'var(--text-secondary)' },
}

/**
 * The call-outcome logging widget. Designed for speed under time pressure —
 * one tap for the outcome, a couple of optional fields only when the outcome
 * needs them (a promise needs an amount and date; everything else needs
 * nothing), then one button to log and move to the next household.
 */
export function OutcomeButtons({
  maxAmount,
  onSubmit,
}: {
  maxAmount: number
  onSubmit: (input: {
    outcome: ContactOutcome
    notes?: string
    promiseAmount?: number
    promiseDate?: string
  }) => Promise<void>
}) {
  const [outcome, setOutcome] = useState<ContactOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [promiseAmount, setPromiseAmount] = useState(String(maxAmount))
  const [promiseDate, setPromiseDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  })
  const [busy, setBusy] = useState(false)

  const needsPromise = outcome === 'PROMISED'

  async function submit() {
    if (!outcome) return
    setBusy(true)
    try {
      await onSubmit({
        outcome,
        notes: notes.trim() || undefined,
        promiseAmount: needsPromise ? parseFloat(promiseAmount) : undefined,
        promiseDate: needsPromise ? promiseDate : undefined,
      })
      setOutcome(null)
      setNotes('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3.5">
      <div>
        <span className="label-micro block mb-2">Outcome</span>
        <div className="grid grid-cols-3 gap-1.5">
          {OUTCOME_ORDER.map((o) => {
            const meta = OUTCOME_META[o]
            const active = outcome === o
            return (
              <button
                key={o}
                onClick={() => setOutcome(o)}
                className="px-2 py-2 rounded-lg text-[11.5px] font-medium text-center transition-all"
                style={
                  active
                    ? { ...TONE_STYLE[meta.tone], outline: `2px solid ${TONE_STYLE[meta.tone].color}`, outlineOffset: -2 }
                    : { background: 'var(--elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }
                }
              >
                {meta.label}
              </button>
            )
          })}
        </div>
      </div>

      {needsPromise && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount promised">
            <input
              type="number" min={1} max={maxAmount}
              className={`${inputCls} mono`} style={inputStyle}
              value={promiseAmount}
              onChange={(e) => setPromiseAmount(e.target.value)}
            />
          </Field>
          <Field label="By date">
            <input
              type="date" className={inputCls} style={inputStyle}
              value={promiseDate}
              onChange={(e) => setPromiseDate(e.target.value)}
            />
          </Field>
        </div>
      )}

      <Field label="Notes (optional)">
        <textarea
          className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-none"
          style={{ ...inputStyle, height: 60 }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth remembering for next time…"
        />
      </Field>

      <Button
        onClick={submit}
        disabled={!outcome || busy || (needsPromise && (!promiseAmount || !promiseDate))}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneForwarded className="w-3.5 h-3.5" />}
        {busy ? 'Logging…' : 'Log & Next'}
      </Button>
    </div>
  )
}
