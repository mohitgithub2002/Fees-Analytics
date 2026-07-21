'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Search, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import {
  apiCall, Button, DueAmount, EmptyState, ErrorBanner, Field, inputCls, inputStyle, Modal,
} from '@/components/v2/ui'
import type { PaginationV2, SessionV2, StudentV2 } from '@/lib/v2/types'

interface StudentRow extends StudentV2 {
  enrollments: StudentV2['enrollments']
}

function rowDues(s: StudentRow) {
  let current = 0
  let past = 0
  let cls = '—'
  for (const e of s.enrollments) {
    const due = e.feeItems.reduce((sum, f) => sum + f.dueAmount, 0)
    if (e.session.isCurrent) {
      current += due
      cls = e.classroom.class.name
    } else {
      past += due
    }
  }
  return { current, past, total: current + past, cls }
}

export default function StudentsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<StudentRow[]>([])
  const [pagination, setPagination] = useState<PaginationV2 | null>(null)
  const [sessions, setSessions] = useState<SessionV2[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (q: string, p: number) => {
    setLoading(true)
    try {
      const sp = new URLSearchParams({ page: String(p), limit: '50' })
      if (q.trim()) sp.set('search', q.trim())
      const res = await fetch(`/api/v2/students?${sp}`)
      const data = await res.json()
      setRows(data.data ?? [])
      setPagination(data.pagination ?? null)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/v2/sessions').then((r) => r.json()).then((d) => setSessions(d.data ?? []))
  }, [])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(search, page), search ? 300 : 0)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [search, page, load])

  return (
    <>
      <PageHeader
        section="Students"
        subtitle={pagination ? <><span className="mono">{pagination.total}</span> students on record</> : 'Loading…'}
      >
        <Button onClick={() => setShowAdd(true)}>
          <UserPlus className="w-3.5 h-3.5" /> New Student
        </Button>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1400px] space-y-4">
          {/* Search */}
          <div className="relative max-w-sm">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-faint)' }}
            />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search by name, father's name, admission no…"
              className={`${inputCls} pl-9`}
              style={inputStyle}
            />
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Student', "Father's Name", 'Class', 'Past Due', 'Current Due', 'Total Due', ''].map((h, i) => (
                      <th key={i} className={`px-4 py-3 label-micro font-medium ${i >= 3 && i <= 5 ? 'text-right' : 'text-left'}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 && (
                    <tr><td colSpan={7}><EmptyState text="Loading students…" /></td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={7}><EmptyState text="No students match this search." /></td></tr>
                  )}
                  {rows.map((s) => {
                    const d = rowDues(s)
                    return (
                      <tr
                        key={s.id}
                        className="transition-colors hover:bg-[var(--card-hover)]"
                        style={{ borderBottom: '1px solid var(--border)' }}
                      >
                        <td className="px-4 py-3">
                          <Link href={`/manage/students/${s.id}`} className="font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                            {s.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{s.fatherName}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{d.cls}</td>
                        <td className="px-4 py-3 text-right"><DueAmount amount={d.past} /></td>
                        <td className="px-4 py-3 text-right"><DueAmount amount={d.current} /></td>
                        <td className="px-4 py-3 text-right"><DueAmount amount={d.total} /></td>
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
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
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
        onCreated={() => { setShowAdd(false); load(search, page) }}
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
    fetch(`/api/v2/classrooms?sessionId=${currentSession.id}`)
      .then((r) => r.json())
      .then((d) =>
        setClassrooms(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (d.data ?? []).map((c: any) => ({ id: c.id, label: `${c.class.name} · ${c.section}` }))
        )
      )
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
