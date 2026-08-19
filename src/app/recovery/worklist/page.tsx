'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { EmptyState, ErrorBanner } from '@/components/v2/ui'
import { CallCard } from '@/components/recovery/CallCard'
import { fmtAmt } from '@/lib/v2/format'
import type { ContactOutcome } from '@/lib/recovery/types'
import type { WorklistResponse, WorklistCase } from '@/lib/recovery/api-types'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'promises', label: 'Promises' },
  { value: 'broken', label: 'Broken' },
  { value: 'no-answer', label: 'No answer' },
]

export default function WorklistPage() {
  return (
    <Suspense fallback={null}>
      <WorklistInner />
    </Suspense>
  )
}

function WorklistInner() {
  const searchParams = useSearchParams()
  const [filter, setFilter] = useState(searchParams.get('filter') ?? 'all')
  const [data, setData] = useState<WorklistResponse | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [showSkipped, setShowSkipped] = useState(false)

  const load = useCallback((f: string) => {
    fetch(`/api/v2/recovery/worklist?filter=${f}`)
      .then((r) => r.json())
      .then((d: WorklistResponse) => {
        setData(d)
        setSelectedId((current) => {
          if (current && d.queue.some((c) => c.caseId === current)) return current
          return d.queue[0]?.caseId ?? null
        })
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => { load(filter) }, [filter, load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const selected = useMemo(
    () => data?.queue.find((c) => c.caseId === selectedId) ?? null,
    [data, selectedId]
  )

  async function logCall(input: {
    outcome: ContactOutcome
    notes?: string
    promiseAmount?: number
    promiseDate?: string
  }) {
    if (!selected) return
    const res = await fetch(`/api/v2/recovery/guardians/${selected.guardian.id}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'failed to log call')
      return
    }
    setToast(`Logged · ${selected.guardian.name}`)
    load(filter)
  }

  return (
    <>
      <PageHeader
        section="Call List"
        subtitle={data ? <><span className="mono">{data.queue.length}</span> households queued for today</> : 'Loading…'}
      >
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--elevated)' }}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className="px-2.5 h-7 rounded-md text-[12px] font-medium transition-colors"
              style={
                filter === f.value
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <main className="flex-1 overflow-hidden flex relative">
        {error && (
          <div className="absolute top-20 left-8 right-8 z-10">
            <ErrorBanner error={error} onDismiss={() => setError('')} />
          </div>
        )}
        {toast && (
          <div
            className="fixed bottom-6 right-6 z-20 flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] font-medium animate-fadeup"
            style={{ background: 'var(--good-soft)', color: 'var(--good-2)', border: '1px solid var(--border)' }}
          >
            <CheckCircle2 className="w-4 h-4" /> {toast}
          </div>
        )}

        {/* ── Queue pane ─────────────────────────────────────────────── */}
        <div className="w-[380px] flex-shrink-0 overflow-y-auto px-4 py-5 space-y-1.5" style={{ borderRight: '1px solid var(--border)' }}>
          {!data && <EmptyState text="Loading…" />}
          {data && data.queue.length === 0 && (
            <EmptyState text="Nothing queued for this filter. Everyone's either paid, on schedule, or already handled." />
          )}
          {data?.queue.map((item) => (
            <QueueRow
              key={item.caseId}
              item={item}
              active={item.caseId === selectedId}
              onClick={() => setSelectedId(item.caseId)}
            />
          ))}

          {data && data.skipped.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setShowSkipped((v) => !v)}
                className="w-full flex items-center gap-1.5 px-2 py-2 text-[12px] font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                {showSkipped ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {data.skipped.length} skipped today
              </button>
              {showSkipped && (
                <div className="space-y-1 mt-1">
                  {data.skipped.map((s) => (
                    <div key={s.caseId} className="px-3 py-2 rounded-lg text-[11.5px]" style={{ background: 'var(--elevated)' }}>
                      <div className="flex items-center justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>{s.name}</span>
                        <span className="mono" style={{ color: 'var(--text-muted)' }}>{fmtAmt(s.outstanding)}</span>
                      </div>
                      <p className="mt-0.5" style={{ color: 'var(--text-faint)' }}>{s.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Call card pane ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="max-w-[560px]">
            {selected ? (
              <CallCard key={selected.caseId} item={selected} onLog={logCall} />
            ) : (
              <EmptyState text="Select a household from the list." />
            )}
          </div>
        </div>
      </main>
    </>
  )
}

function QueueRow({ item, active, onClick }: { item: WorklistCase; active: boolean; onClick: () => void }) {
  const brokenPromise = item.promise?.status === 'BROKEN'
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3.5 py-3 rounded-xl transition-colors"
      style={
        active
          ? { background: 'var(--accent-soft)', border: '1px solid var(--border-strong)' }
          : { background: 'var(--card)', border: '1px solid var(--border)' }
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {item.guardian.name}
        </span>
        <span className="mono text-[12px] flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
          {fmtAmt(item.outstanding)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span>{item.guardian.children.length} {item.guardian.children.length === 1 ? 'child' : 'children'}</span>
        <span>·</span>
        <span>ERV {fmtAmt(item.expectedRecoveryValue)}</span>
      </div>
      {item.promise && (
        <p
          className="text-[11px] mt-1"
          style={{ color: brokenPromise ? 'var(--critical)' : 'var(--good-2)' }}
        >
          {brokenPromise ? '⚠ Broken promise' : 'Promised'} · {fmtAmt(item.promise.amount)} by{' '}
          {new Date(item.promise.promisedFor).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
        </p>
      )}
    </button>
  )
}
