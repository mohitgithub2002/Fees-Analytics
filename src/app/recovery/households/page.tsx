'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, GitMerge, Split, Users } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner, inputCls, inputStyle } from '@/components/v2/ui'
import type { HouseholdRow } from '@/lib/recovery/api-types'

export default function HouseholdsPage() {
  const [showAll, setShowAll] = useState(false)
  const [rows, setRows] = useState<HouseholdRow[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [mergeTarget, setMergeTarget] = useState<Record<number, string>>({})

  function load() {
    fetch(`/api/v2/recovery/households${showAll ? '?status=all' : ''}`)
      .then((r) => r.json())
      .then((d) => setRows(d.data ?? []))
      .catch((e) => setError(e.message))
  }
  useEffect(load, [showAll])

  async function confirm(id: number) {
    setBusyId(id)
    try {
      await fetch('/api/v2/recovery/households', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', guardianId: id }),
      })
      load()
    } finally { setBusyId(null) }
  }

  async function split(guardianId: number, studentId: number) {
    setBusyId(guardianId)
    try {
      const res = await fetch('/api/v2/recovery/households', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'split', guardianId, studentId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusyId(null) }
  }

  async function merge(guardianId: number) {
    const target = parseInt(mergeTarget[guardianId] ?? '')
    if (!target) { setError('Enter the target guardian ID to merge into.'); return }
    setBusyId(guardianId)
    try {
      const res = await fetch('/api/v2/recovery/households', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', guardianId, targetGuardianId: target }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusyId(null) }
  }

  return (
    <>
      <PageHeader section="Households" subtitle="Review how students were grouped into paying households">
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--elevated)' }}>
          <button onClick={() => setShowAll(false)} className="px-2.5 h-7 rounded-md text-[12px] font-medium" style={!showAll ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { color: 'var(--text-secondary)' }}>Needs Review</button>
          <button onClick={() => setShowAll(true)} className="px-2.5 h-7 rounded-md text-[12px] font-medium" style={showAll ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { color: 'var(--text-secondary)' }}>All Households</button>
        </div>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1100px] space-y-3">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
          {!rows ? (
            <EmptyState text="Loading…" />
          ) : rows.length === 0 ? (
            <EmptyState text={showAll ? 'No households yet.' : 'Nothing needs review — every household was linked with high confidence.'} />
          ) : (
            rows.map((g) => (
              <div key={g.id} className="card p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{g.name}</span>
                      <span className="mono text-[11px]" style={{ color: 'var(--text-faint)' }}>#{g.id}</span>
                    </div>
                    {g.phone && <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{g.phone}</p>}
                  </div>
                  {g.needsReview && (
                    <Button small onClick={() => confirm(g.id)} disabled={busyId === g.id}>
                      <CheckCircle2 className="w-3 h-3" /> Confirm
                    </Button>
                  )}
                </div>
                {g.notes && (
                  <p className="text-[11.5px] mb-3 px-2.5 py-1.5 rounded-md" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>{g.notes}</p>
                )}
                <div className="space-y-1.5">
                  {g.students.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--elevated)' }}>
                      <div className="text-[12.5px]">
                        <span style={{ color: 'var(--text-primary)' }}>{s.name}</span>
                        {s.class && <span style={{ color: 'var(--text-muted)' }}> · Class {s.class}</span>}
                        {s.phone && <span style={{ color: 'var(--text-muted)' }}> · {s.phone}</span>}
                      </div>
                      {g.students.length > 1 && (
                        <button
                          onClick={() => split(g.id, s.id)}
                          disabled={busyId === g.id}
                          className="inline-flex items-center gap-1 text-[11px] font-medium"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <Split className="w-3 h-3" /> Split out
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-3.5 pt-3.5" style={{ borderTop: '1px solid var(--border)' }}>
                  <GitMerge className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Merge into guardian ID</span>
                  <input
                    className={`${inputCls} mono w-24`} style={{ ...inputStyle, height: 30 }}
                    value={mergeTarget[g.id] ?? ''}
                    onChange={(e) => setMergeTarget((m) => ({ ...m, [g.id]: e.target.value }))}
                    placeholder="e.g. 42"
                  />
                  <Button small variant="ghost" onClick={() => merge(g.id)} disabled={busyId === g.id}>Merge</Button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </>
  )
}
