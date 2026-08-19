'use client'

import { useCallback, useEffect, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { CalendarDays, Plus, Star, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import {
  apiCall, Button, EmptyState, ErrorBanner, Field, inputCls, inputStyle, Modal,
} from '@/components/v2/ui'
import { cachedFetch } from '@/lib/v2/client-cache'
import { fmtAmt, fmtDate } from '@/lib/v2/format'
import type { ClassroomV2, ClassV2, FeeCategory, FeeStructureV2, SessionV2 } from '@/lib/v2/types'

const tabTrigger =
  'px-3.5 h-9 rounded-lg text-[13px] font-medium transition-colors data-[state=active]:bg-[var(--accent-soft)] data-[state=active]:text-[var(--text-primary)]'

export default function SetupPage() {
  const [sessions, setSessions] = useState<SessionV2[]>([])
  const [classes, setClasses] = useState<ClassV2[]>([])
  const [classrooms, setClassrooms] = useState<ClassroomV2[]>([])
  const [structures, setStructures] = useState<FeeStructureV2[]>([])
  const [error, setError] = useState('')

  const [refreshKey, setRefreshKey] = useState(0)
  const load = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    Promise.all([
      cachedFetch<{ data: SessionV2[] }>('/api/v2/sessions', 120_000),
      cachedFetch<{ data: ClassV2[] }>('/api/v2/classes', 300_000),
      cachedFetch<{ data: ClassroomV2[] }>('/api/v2/classrooms', 120_000),
      cachedFetch<{ data: FeeStructureV2[] }>('/api/v2/fee-structures', 120_000),
    ])
      .then(([s, c, r, f]) => {
        if (!alive) return
        setSessions(s.data ?? [])
        setClasses(c.data ?? [])
        setClassrooms(r.data ?? [])
        setStructures(f.data ?? [])
      })
      .catch(console.error)
    return () => { alive = false }
  }, [refreshKey])

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setError('')
    try { await fn(); load() } catch (e) { setError((e as Error).message) }
  }

  return (
    <>
      <PageHeader section="Setup" subtitle="Sessions, classes, classrooms and class-wise fee structures" />
      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1100px] space-y-4">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

          <Tabs.Root defaultValue="sessions">
            <Tabs.List className="flex items-center gap-1 mb-4" style={{ color: 'var(--text-secondary)' }}>
              <Tabs.Trigger value="sessions" className={tabTrigger}>Sessions</Tabs.Trigger>
              <Tabs.Trigger value="classes" className={tabTrigger}>Classes</Tabs.Trigger>
              <Tabs.Trigger value="classrooms" className={tabTrigger}>Classrooms</Tabs.Trigger>
              <Tabs.Trigger value="structures" className={tabTrigger}>Fee Structures</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="sessions">
              <SessionsTab sessions={sessions} wrap={wrap} onChanged={load} setError={setError} />
            </Tabs.Content>
            <Tabs.Content value="classes">
              <ClassesTab classes={classes} onChanged={load} setError={setError} />
            </Tabs.Content>
            <Tabs.Content value="classrooms">
              <ClassroomsTab classrooms={classrooms} classes={classes} sessions={sessions} onChanged={load} setError={setError} />
            </Tabs.Content>
            <Tabs.Content value="structures">
              <StructuresTab structures={structures} classes={classes} sessions={sessions} onChanged={load} setError={setError} />
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </main>
    </>
  )
}

/* ── Sessions ───────────────────────────────────────────────────── */

function SessionsTab({
  sessions, wrap, onChanged, setError,
}: {
  sessions: SessionV2[]
  wrap: (fn: () => Promise<unknown>) => () => Promise<void>
  onChanged: () => void
  setError: (e: string) => void
}) {
  const [show, setShow] = useState(false)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      await apiCall('/api/v2/sessions', 'POST', { name, startDate, endDate })
      setShow(false); setName(''); setStartDate(''); setEndDate('')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 h-14 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Academic Sessions</h3>
        <Button small onClick={() => setShow(true)}><Plus className="w-3.5 h-3.5" /> New Session</Button>
      </div>
      {sessions.length === 0 && <EmptyState text="No sessions yet." />}
      {sessions.map((s) => (
        <div key={s.id} className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-medium mono" style={{ color: 'var(--text-primary)' }}>{s.name}</span>
              {s.isCurrent && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: 'var(--good-soft)', color: 'var(--good-2)' }}>Current</span>
              )}
            </div>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {fmtDate(s.startDate)} → {fmtDate(s.endDate)} · <span className="mono">{s._count?.enrollments ?? 0}</span> enrollments · <span className="mono">{s._count?.classrooms ?? 0}</span> classrooms
            </p>
          </div>
          {!s.isCurrent && (
            <Button variant="ghost" small onClick={wrap(() => apiCall(`/api/v2/sessions/${s.id}`, 'PATCH', { isCurrent: true }))}>
              <Star className="w-3.5 h-3.5" /> Make Current
            </Button>
          )}
        </div>
      ))}

      <Modal open={show} onClose={() => setShow(false)} title="New Session" subtitle="e.g. 2025-26, running 1 April to 31 March.">
        <div className="space-y-3.5">
          <Field label="Name"><input className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="2025-26" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start Date"><input type="date" className={inputCls} style={inputStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="End Date"><input type="date" className={inputCls} style={inputStyle} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
            <Button onClick={create} disabled={busy || !name.trim() || !startDate || !endDate}>{busy ? 'Creating…' : 'Create'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ── Classes ────────────────────────────────────────────────────── */

function ClassesTab({
  classes, onChanged, setError,
}: { classes: ClassV2[]; onChanged: () => void; setError: (e: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      await apiCall('/api/v2/classes', 'POST', { name, displayOrder: classes.length })
      setName('')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 h-14 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Class Master</h3>
        <div className="flex items-center gap-2">
          <input className={inputCls} style={{ ...inputStyle, width: 140 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. XI" />
          <Button small onClick={create} disabled={busy || !name.trim()}><Plus className="w-3.5 h-3.5" /> Add</Button>
        </div>
      </div>
      <div className="p-5 flex flex-wrap gap-2">
        {classes.length === 0 && <EmptyState text="No classes yet." />}
        {classes.map((c) => (
          <span
            key={c.id}
            className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium"
            style={{ background: 'var(--elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {c.name}
            <span className="ml-2 mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {c._count?.classrooms ?? 0} rooms
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Classrooms ─────────────────────────────────────────────────── */

function ClassroomsTab({
  classrooms, classes, sessions, onChanged, setError,
}: {
  classrooms: ClassroomV2[]
  classes: ClassV2[]
  sessions: SessionV2[]
  onChanged: () => void
  setError: (e: string) => void
}) {
  const [sessionId, setSessionId] = useState('')
  const [classId, setClassId] = useState('')
  const [section, setSection] = useState('A')
  const [filterSession, setFilterSession] = useState('all')
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      await apiCall('/api/v2/classrooms', 'POST', {
        sessionId: parseInt(sessionId),
        classId: parseInt(classId),
        section,
      })
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const visible = classrooms.filter((c) => filterSession === 'all' || String(c.sessionId) === filterSession)

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>Classrooms (class × session)</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <select className={inputCls} style={{ ...inputStyle, width: 120 }} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">Session…</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={inputCls} style={{ ...inputStyle, width: 110 }} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Class…</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className={inputCls} style={{ ...inputStyle, width: 64 }} value={section} onChange={(e) => setSection(e.target.value)} placeholder="Sec" />
          <Button small onClick={create} disabled={busy || !sessionId || !classId}><Plus className="w-3.5 h-3.5" /> Add</Button>
        </div>
      </div>
      <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="label-micro">Filter</span>
        <select className={inputCls} style={{ ...inputStyle, width: 140, height: 30 }} value={filterSession} onChange={(e) => setFilterSession(e.target.value)}>
          <option value="all">All sessions</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="p-5 flex flex-wrap gap-2">
        {visible.length === 0 && <EmptyState text="No classrooms for this filter." />}
        {visible.map((c) => (
          <span
            key={c.id}
            className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium"
            style={{ background: 'var(--elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {c.class?.name} · {c.section}
            <span className="ml-2 mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {c.session?.name} · {c._count?.enrollments ?? 0} students
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Fee Structures ─────────────────────────────────────────────── */

interface ItemDraft {
  category: FeeCategory
  name: string
  amount: string
  installmentCount: string
  /** One ISO date per installment; '' means "no due date for this one". */
  schedule: string[]
}

/** Grow/shrink the due-date list to match the installment count. */
function resizeSchedule(schedule: string[], count: number): string[] {
  const next = schedule.slice(0, count)
  while (next.length < count) next.push('')
  return next
}

function StructuresTab({
  structures, classes, sessions, onChanged, setError,
}: {
  structures: FeeStructureV2[]
  classes: ClassV2[]
  sessions: SessionV2[]
  onChanged: () => void
  setError: (e: string) => void
}) {
  const [editing, setEditing] = useState<{ sessionId: number; classId: number; items: ItemDraft[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const current = sessions.find((s) => s.isCurrent)

  function openEditor(sessionId: number, classId: number) {
    const existing = structures.find((f) => f.sessionId === sessionId && f.classId === classId)
    setEditing({
      sessionId,
      classId,
      items: existing?.items.map((i) => {
        const bySeq = new Map((i.schedule ?? []).map((s) => [s.sequence, s.dueDate.slice(0, 10)]))
        return {
          category: i.category,
          name: i.name,
          amount: String(i.amount),
          installmentCount: String(i.installmentCount),
          schedule: Array.from({ length: i.installmentCount }, (_, n) => bySeq.get(n + 1) ?? ''),
        }
      }) ?? [{ category: 'SCHOOL', name: 'School Fees', amount: '', installmentCount: '3', schedule: ['', '', ''] }],
    })
  }

  async function save() {
    if (!editing) return
    setBusy(true)
    try {
      await apiCall('/api/v2/fee-structures', 'POST', {
        sessionId: editing.sessionId,
        classId: editing.classId,
        items: editing.items.map((i) => {
          const count = parseInt(i.installmentCount) || 1
          const dates = resizeSchedule(i.schedule, count)
          // A schedule is all-or-nothing: the API rejects a partial one, since
          // an undated installment can't be judged on-time or late.
          const complete = dates.every((d) => d)
          return {
            category: i.category,
            name: i.name,
            amount: parseFloat(i.amount),
            installmentCount: count,
            ...(complete
              ? { schedule: dates.map((dueDate, n) => ({ sequence: n + 1, dueDate })) }
              : {}),
          }
        }),
      })
      setEditing(null)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const setItem = (idx: number, patch: Partial<ItemDraft>) =>
    setEditing((e) => e && {
      ...e,
      items: e.items.map((it, i) => {
        if (i !== idx) return it
        const merged = { ...it, ...patch }
        // Keep the due-date list in step with the installment count.
        if (patch.installmentCount !== undefined) {
          merged.schedule = resizeSchedule(merged.schedule, parseInt(patch.installmentCount) || 1)
        }
        return merged
      }),
    })

  const setDueDate = (itemIdx: number, seqIdx: number, value: string) =>
    setEditing((e) => e && {
      ...e,
      items: e.items.map((it, i) =>
        i === itemIdx
          ? { ...it, schedule: it.schedule.map((d, n) => (n === seqIdx ? value : d)) }
          : it
      ),
    })

  return (
    <div className="space-y-4">
      {sessions.map((s) => (
        <div key={s.id} className="card overflow-hidden">
          <div className="px-5 h-14 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="text-[14px] font-semibold mono" style={{ color: 'var(--text-primary)' }}>{s.name}</h3>
            {s.isCurrent && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: 'var(--good-soft)', color: 'var(--good-2)' }}>Current</span>
            )}
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {classes.map((c) => {
              const st = structures.find((f) => f.sessionId === s.id && f.classId === c.id)
              return (
                <button
                  key={c.id}
                  onClick={() => openEditor(s.id, c.id)}
                  className="text-left p-3.5 rounded-xl transition-colors hover:border-[var(--border-hover)]"
                  style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Class {c.name}</span>
                    <span className="text-[11.5px]" style={{ color: st ? 'var(--good-2)' : 'var(--text-faint)' }}>
                      {st ? `${st.items.length} item${st.items.length > 1 ? 's' : ''}` : 'Not set'}
                    </span>
                  </div>
                  {st ? (
                    <div className="space-y-0.5">
                      {st.items.map((i) => (
                        <p key={i.id} className="text-[12px] flex items-center justify-between" style={{ color: 'var(--text-secondary)' }}>
                          <span>
                            {i.name} <span style={{ color: 'var(--text-faint)' }}>×{i.installmentCount}</span>
                            {i.schedule && i.schedule.length > 0 && (
                              <CalendarDays className="inline w-3 h-3 ml-1" style={{ color: 'var(--good-2)' }} />
                            )}
                          </span>
                          <span className="mono">{fmtAmt(i.amount)}</span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Click to define fees for this class.</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {sessions.length === 0 && <EmptyState text="Create a session first." />}

      {editing && (
        <Modal
          open onClose={() => setEditing(null)} wide
          title={`Fee Structure · Class ${classes.find((c) => c.id === editing.classId)?.name} · ${sessions.find((s) => s.id === editing.sessionId)?.name}`}
          subtitle="Saving replaces the template items. Fees already assigned to students are not changed."
        >
          <div className="space-y-3">
            {editing.items.map((item, idx) => (
              <div key={idx} className="rounded-xl p-3" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                <div className="flex items-end gap-2">
                  <Field label={idx === 0 ? 'Category' : ''}>
                    <select className={inputCls} style={{ ...inputStyle, width: 110 }} value={item.category} onChange={(e) => setItem(idx, { category: e.target.value as FeeCategory })}>
                      <option value="SCHOOL">School</option>
                      <option value="BUS">Bus</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </Field>
                  <div className="flex-1">
                    <Field label={idx === 0 ? 'Name' : ''}>
                      <input className={inputCls} style={inputStyle} value={item.name} onChange={(e) => setItem(idx, { name: e.target.value })} />
                    </Field>
                  </div>
                  <Field label={idx === 0 ? 'Amount' : ''}>
                    <input type="number" className={`${inputCls} mono`} style={{ ...inputStyle, width: 110 }} value={item.amount} onChange={(e) => setItem(idx, { amount: e.target.value })} />
                  </Field>
                  <Field label={idx === 0 ? 'Inst.' : ''}>
                    <input type="number" min={1} max={12} className={`${inputCls} mono`} style={{ ...inputStyle, width: 64 }} value={item.installmentCount} onChange={(e) => setItem(idx, { installmentCount: e.target.value })} />
                  </Field>
                  <Button
                    variant="danger" small
                    onClick={() => setEditing((e) => e && { ...e, items: e.items.filter((_, i) => i !== idx) })}
                    disabled={editing.items.length <= 1}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Due dates drive every "paid on time / late" figure in the
                    recovery module. Leave them blank and installments simply
                    stay undated, exactly as before. */}
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <CalendarDays className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                    <span className="label-micro">Due Dates (optional)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.schedule.map((date, seq) => (
                      <div key={seq}>
                        <span className="block text-[10.5px] mb-1" style={{ color: 'var(--text-faint)' }}>#{seq + 1}</span>
                        <input
                          type="date"
                          className={inputCls}
                          style={{ ...inputStyle, width: 150, height: 32 }}
                          value={date}
                          onChange={(e) => setDueDate(idx, seq, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  {item.schedule.some((d) => d) && !item.schedule.every((d) => d) && (
                    <p className="text-[11px] mt-2" style={{ color: 'var(--warning)' }}>
                      Set a date for every installment, or leave them all blank — a partial schedule is ignored.
                    </p>
                  )}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="ghost" small
                onClick={() => setEditing((e) => e && { ...e, items: [...e.items, { category: 'OTHER', name: '', amount: '', installmentCount: '1', schedule: [''] }] })}
              >
                <Plus className="w-3.5 h-3.5" /> Add Item
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={save} disabled={busy || editing.items.some((i) => !i.name.trim() || !(parseFloat(i.amount) > 0))}>
                  {busy ? 'Saving…' : 'Save Structure'}
                </Button>
              </div>
            </div>
            {current && editing.sessionId !== current.id && (
              <p className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                Note: this structure is for a non-current session.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
