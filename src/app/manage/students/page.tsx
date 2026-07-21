'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, UserPlus, X } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import {
  apiCall, Button, DueAmount, EmptyState, ErrorBanner, Field, inputCls, inputStyle, Modal,
} from '@/components/v2/ui'
import { cachedFetch } from '@/lib/v2/client-cache'
import type { ClassV2, PaginationV2, SessionV2 } from '@/lib/v2/types'

interface StudentRow {
  id: number
  name: string
  fatherName: string
  admissionNo: string | null
  class: string | null
  section: string | null
  schoolDue: number
  busDue: number
  otherDue: number
  currentDue: number
  pastDue: number
  totalDue: number
}

interface Filters {
  search: string
  class: string
  feeType: string
  minDue: string
  maxDue: string
}

const DEFAULT_FILTERS: Filters = { search: '', class: 'all', feeType: 'total', minDue: '', maxDue: '' }

const FEE_TYPES = [
  { value: 'total', label: 'Total Due' },
  { value: 'school', label: 'School Due' },
  { value: 'bus', label: 'Bus Due' },
  { value: 'other', label: 'Other Due' },
  { value: 'past', label: 'Past Year Due' },
]

export default function StudentsPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<StudentRow[]>([])
  const [pagination, setPagination] = useState<PaginationV2 | null>(null)
  const [sessions, setSessions] = useState<SessionV2[]>([])
  const [classes, setClasses] = useState<ClassV2[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    cachedFetch<{ data: SessionV2[] }>('/api/v2/sessions', 120_000).then((d) => setSessions(d.data ?? [])).catch(console.error)
    cachedFetch<{ data: ClassV2[] }>('/api/v2/classes', 300_000).then((d) => setClasses(d.data ?? [])).catch(console.error)
  }, [])

  // Debounced, filter-aware fetch. A ref-free refreshKey lets modals force a reload.
  useEffect(() => {
    let alive = true
    if (debounce.current) clearTimeout(debounce.current)
    const delay = filters.search ? 300 : 0
    debounce.current = setTimeout(() => {
      setLoading(true)
      const sp = new URLSearchParams({ page: String(page), limit: '50', feeType: filters.feeType })
      if (filters.search.trim()) sp.set('search', filters.search.trim())
      if (filters.class !== 'all') sp.set('class', filters.class)
      if (filters.minDue) sp.set('minDue', filters.minDue)
      if (filters.maxDue) sp.set('maxDue', filters.maxDue)
      fetch(`/api/v2/students?${sp}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return
          setRows(d.data ?? [])
          setPagination(d.pagination ?? null)
          setLoading(false)
        })
        .catch(console.error)
    }, delay)
    return () => { alive = false; if (debounce.current) clearTimeout(debounce.current) }
  }, [filters, page, refreshKey])

  const setFilter = (key: keyof Filters, val: string) => {
    setFilters((f) => ({ ...f, [key]: val }))
    setPage(1)
  }
  const isActive =
    filters.class !== 'all' || !!filters.search || !!filters.minDue ||
    !!filters.maxDue || filters.feeType !== 'total'

  return (
    <>
      <PageHeader
        section="Students"
        subtitle={pagination ? <><span className="mono">{pagination.total}</span> students match</> : 'Loading…'}
      >
        <Button onClick={() => setShowAdd(true)}>
          <UserPlus className="w-3.5 h-3.5" /> New Student
        </Button>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1400px] space-y-4">
          {/* Filters */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Filters</span>
                {isActive && (
                  <span className="px-2 h-5 flex items-center rounded-full text-[11px] font-medium"
                    style={{ background: 'var(--accent-soft)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                    Active
                  </span>
                )}
              </div>
              {isActive && (
                <button
                  onClick={() => { setFilters(DEFAULT_FILTERS); setPage(1) }}
                  className="flex items-center gap-1 text-[12px] transition-colors hover:brightness-125"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X className="w-3.5 h-3.5" /> Reset all
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="lg:col-span-2 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
                <input
                  value={filters.search}
                  onChange={(e) => setFilter('search', e.target.value)}
                  placeholder="Search student / father name…"
                  className={`${inputCls} pl-9`}
                  style={inputStyle}
                />
              </div>
              <select value={filters.class} onChange={(e) => setFilter('class', e.target.value)} className={inputCls} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="all">All Classes</option>
                {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
              </select>
              <select value={filters.feeType} onChange={(e) => setFilter('feeType', e.target.value)} className={inputCls} style={{ ...inputStyle, cursor: 'pointer' }}>
                {FEE_TYPES.map((ft) => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
              </select>
              <input type="number" min={0} value={filters.minDue} onChange={(e) => setFilter('minDue', e.target.value)} placeholder="Min ₹ Due" className={`${inputCls} mono`} style={inputStyle} />
              <input type="number" min={0} value={filters.maxDue} onChange={(e) => setFilter('maxDue', e.target.value)} placeholder="Max ₹ Due" className={`${inputCls} mono`} style={inputStyle} />
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Student', "Father's Name", 'Class', 'School Due', 'Bus Due', 'Past Due', 'Total Due', ''].map((h, i) => (
                      <th key={i} className={`px-4 py-3 label-micro font-medium ${i >= 3 && i <= 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 && (
                    <tr><td colSpan={8}><EmptyState text="Loading students…" /></td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={8}><EmptyState text="No students match these filters." /></td></tr>
                  )}
                  {rows.map((s) => (
                    <tr key={s.id} className="transition-colors hover:bg-[var(--card-hover)]" style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-4 py-3">
                        <Link href={`/manage/students/${s.id}`} className="font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{s.fatherName}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                        {s.class ? `${s.class}${s.section && s.section !== 'A' ? ` · ${s.section}` : ''}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right"><DueAmount amount={s.schoolDue} /></td>
                      <td className="px-4 py-3 text-right"><DueAmount amount={s.busDue} /></td>
                      <td className="px-4 py-3 text-right"><DueAmount amount={s.pastDue} /></td>
                      <td className="px-4 py-3 text-right"><DueAmount amount={s.totalDue} /></td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/manage/students/${s.id}`}
                          className="text-[12px] font-medium px-2.5 py-1.5 rounded-lg"
                          style={{ background: 'var(--elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination && pagination.pages > 1 && (
              <div className="px-5 h-14 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Page <span className="mono">{pagination.page}</span> of <span className="mono">{pagination.pages}</span>
                </p>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" small disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="w-3.5 h-3.5" /> Prev
                  </Button>
                  <Button variant="ghost" small disabled={page >= pagination.pages} onClick={() => setPage(page + 1)}>
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <AddStudentModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        sessions={sessions}
        onCreated={() => { setShowAdd(false); setRefreshKey((k) => k + 1) }}
      />
    </>
  )
}

function AddStudentModal({
  open, onClose, sessions, onCreated,
}: {
  open: boolean
  onClose: () => void
  sessions: SessionV2[]
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [fatherName, setFatherName] = useState('')
  const [phone, setPhone] = useState('')
  const [admissionNo, setAdmissionNo] = useState('')
  const [classroomId, setClassroomId] = useState('')
  const [applyStructure, setApplyStructure] = useState(true)
  const [classrooms, setClassrooms] = useState<{ id: number; label: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const currentSession = sessions.find((s) => s.isCurrent)

  useEffect(() => {
    if (!open || !currentSession) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cachedFetch<{ data: any[] }>(`/api/v2/classrooms?sessionId=${currentSession.id}`, 120_000)
      .then((d) =>
        setClassrooms((d.data ?? []).map((c) => ({ id: c.id, label: `${c.class.name} · ${c.section}` })))
      )
      .catch(console.error)
  }, [open, currentSession])

  async function submit() {
    setError('')
    setBusy(true)
    try {
      const student = await apiCall('/api/v2/students', 'POST', {
        name, fatherName, phone: phone || undefined, admissionNo: admissionNo || undefined,
      })
      if (classroomId) {
        await apiCall('/api/v2/enrollments', 'POST', {
          studentId: student.id,
          classroomId: parseInt(classroomId),
          applyFeeStructure: applyStructure,
        })
      }
      setName(''); setFatherName(''); setPhone(''); setAdmissionNo(''); setClassroomId('')
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Student" subtitle="Add a student and optionally enroll them in the current session.">
      <div className="space-y-3.5">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
        <Field label="Student Name"><input className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Father's Name"><input className={inputCls} style={inputStyle} value={fatherName} onChange={(e) => setFatherName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone (optional)"><input className={inputCls} style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Admission No (optional)"><input className={inputCls} style={inputStyle} value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} /></Field>
        </div>
        <Field label={`Enroll in classroom (${currentSession?.name ?? 'current session'}) — optional`}>
          <select className={inputCls} style={inputStyle} value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
            <option value="">Don&apos;t enroll yet</option>
            {classrooms.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        {classroomId && (
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={applyStructure} onChange={(e) => setApplyStructure(e.target.checked)} />
            Apply the class fee structure automatically
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name.trim() || !fatherName.trim()}>
            {busy ? 'Saving…' : 'Create Student'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
