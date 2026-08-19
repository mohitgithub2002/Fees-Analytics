'use client'

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner, inputCls, inputStyle } from '@/components/v2/ui'
import type { RecoveryTuningDTO, TuningLimit } from '@/lib/recovery/api-types'

type NumericKey = Exclude<keyof RecoveryTuningDTO, 'scoreWeights' | 'minOutstandingPaise'>

export default function SettingsPage() {
  const [tuning, setTuning] = useState<RecoveryTuningDTO | null>(null)
  const [limits, setLimits] = useState<Record<string, TuningLimit> | null>(null)
  const [minOutstandingRupees, setMinOutstandingRupees] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/v2/recovery/config')
      .then((r) => r.json())
      .then((d) => {
        setTuning(d.tuning)
        setLimits(d.limits)
        setMinOutstandingRupees(String(d.tuning.minOutstandingPaise / 100))
      })
      .catch((e) => setError(e.message))
  }, [])

  function setField(key: NumericKey, value: number) {
    setTuning((t) => (t ? { ...t, [key]: value } : t))
  }

  async function save() {
    if (!tuning) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/v2/recovery/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tuning, minOutstandingPaise: Math.round(parseFloat(minOutstandingRupees || '0') * 100) }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'save failed')
      setTuning(body.tuning)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!tuning || !limits) {
    return (
      <>
        <PageHeader section="Settings" subtitle="Targeting rules" />
        <main className="flex-1 px-8 py-7"><EmptyState text="Loading…" /></main>
      </>
    )
  }

  const numericFields: NumericKey[] = [
    'cooldownDays', 'justPaidSuppressDays', 'promiseGraceDays',
    'noAnswerBackoffThreshold', 'noAnswerBackoffDays', 'dailyCallTarget',
  ]

  return (
    <>
      <PageHeader section="Settings" subtitle="Who gets called, and when to leave a household alone">
        <Button onClick={save} disabled={busy}>
          <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
        </Button>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[720px] space-y-4">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
          {saved && (
            <div className="px-3.5 py-2.5 rounded-lg text-[12.5px]" style={{ background: 'var(--good-soft)', color: 'var(--good-2)' }}>
              Settings saved. They apply on the next recalculation.
            </div>
          )}

          <div className="card p-6 space-y-5">
            {numericFields.map((key) => {
              const limit = limits[key]
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{limit.label}</span>
                    <input
                      type="number" min={limit.min} max={limit.max}
                      className={`${inputCls} mono w-20 text-right`} style={{ ...inputStyle, height: 32 }}
                      value={tuning[key]}
                      onChange={(e) => setField(key, Math.max(limit.min, Math.min(limit.max, parseInt(e.target.value) || 0)))}
                    />
                  </div>
                  <p className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{limit.help}</p>
                </div>
              )
            })}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{limits.minOutstandingPaise.label}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>₹</span>
                  <input
                    type="number" min={0}
                    className={`${inputCls} mono w-24 text-right`} style={{ ...inputStyle, height: 32 }}
                    value={minOutstandingRupees}
                    onChange={(e) => setMinOutstandingRupees(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{limits.minOutstandingPaise.help}</p>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
