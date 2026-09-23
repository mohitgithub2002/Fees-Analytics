'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Plus, Search, Split, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import {
  Button,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  apiCall,
  inputCls,
  inputStyle,
} from '@/components/v2/ui'
import { CoverageNote, SectionCard } from '@/components/recovery/chips'
import { fmtCur } from '@/lib/v2/format'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Who pays for whom.
 *
 * Fees are chased per family, not per child — one father with three children
 * should be one phone call, not three — so every student needs a payer. A
 * student with no family never reaches the call list however much they owe,
 * which is why the unassigned count sits at the top rather than being buried.
 *
 * Automatic grouping (from a Family ID column, a shared phone number, or the
 * school's own sibling notes) is only ever a starting point. A wrong merge is
 * far more damaging than a missed one, so anything uncertain is surfaced here
 * for a person to settle.
 */
export default function HouseholdsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [filter, setFilter] = useState<'review' | 'all'>('review')
  const [search, setSearch] = useState('')
  const [unassigned, setUnassigned] = useState<any[]>([])
  const [unassignedTotal, setUnassignedTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [splitting, setSplitting] = useState<any>(null)
  const [selectedChildren, setSelectedChildren] = useState<number[]>([])
  const [creating, setCreating] = useState(false)
  const [assigning, setAssigning] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ pageSize: '100', sortKey: 'outstanding' })
    if (filter === 'review') params.set('needsReview', 'true')
    if (search.trim()) params.set('search', search.trim())
    try {
      const [listRes, unassignedRes] = await Promise.all([
        fetch(`/api/v2/recovery/households?${params}`),
        fetch('/api/v2/recovery/households/unassigned'),
      ])
      const list = await listRes.json()
      const un = await unassignedRes.json()
      if (!listRes.ok) throw new Error(list.error || 'could not load families')
      setRows(list.data)
      if (unassignedRes.ok) {
        setUnassigned(un.data)
        setUnassignedTotal(un.unassignedTotal)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filter, search])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  async function act(payload: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      await apiCall('/api/v2/recovery/households', 'POST', payload)
      setSplitting(null)
      setAssigning(null)
      setCreating(false)
      setSelectedChildren([])
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        section="Parents & Families"
        subtitle="Decide who pays for whom — siblings under one parent become a single phone call"
      >
        <Button onClick={() => setCreating(true)}>
          <Plus className="w-3.5 h-3.5" />
          Add a parent
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4 max-w-4xl">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

        {/* ── Students with no payer ────────────────────────── */}
        {unassignedTotal > 0 && (
          <SectionCard
            title={`${unassignedTotal} student${unassignedTotal === 1 ? '' : 's'} with no parent attached`}
            subtitle="Until a student belongs to a family, nobody can be called about their fees"
          >
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {unassigned.map((s) => (
                <div key={s.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                      {s.name}
                      {s.className && (
                        <span style={{ color: 'var(--text-faint)' }}> · {s.className}</span>
                      )}
                    </p>
                    {s.fatherName && (
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        father: {s.fatherName}
                      </p>
                    )}
                  </div>
                  <Button
                    small
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setAssigning({ student: s })}
                  >
                    <UserPlus className="w-3 h-3" />
                    Attach to a parent
                  </Button>
                </div>
              ))}
              {unassignedTotal > unassigned.length && (
                <p className="px-4 py-2 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                  …and {unassignedTotal - unassigned.length} more.
                </p>
              )}
            </div>
          </SectionCard>
        )}

        <CoverageNote
          tone="info"
          message="Groupings the system was not certain about are listed below. A wrong merge invents a family that appears to owe two households' fees and floats it to the top of the call list, so it asks rather than guessing."
        />

        <div className="flex flex-wrap gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              className={`${inputCls} pl-9`}
              style={inputStyle}
              placeholder="Search by family or child name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setFilter(filter === 'review' ? 'all' : 'review')}
            className="px-3 h-9 rounded-lg text-[12.5px] font-medium"
            style={{
              background: filter === 'review' ? 'var(--accent)' : 'var(--elevated)',
              color: filter === 'review' ? 'var(--accent-fg)' : 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            {filter === 'review' ? 'Needs confirming' : 'All families'}
          </button>
        </div>

        <SectionCard
          title={filter === 'review' ? 'Waiting for confirmation' : 'All families'}
          subtitle={`${rows.length} shown`}
        >
          {loading && rows.length === 0 ? (
            <EmptyState text="Loading…" />
          ) : rows.length === 0 ? (
            <EmptyState
              text={
                filter === 'review'
                  ? 'Nothing needs confirming.'
                  : 'No families yet — add a parent, or upload your student list.'
              }
            />
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {rows.map((r) => (
                <div key={r.householdId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/recovery/parents/${r.householdId}`}
                        className="text-[13px] font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {r.displayName}
                      </Link>
                      <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-muted)' }}>
                        {r.children.length === 0
                          ? 'No children attached yet'
                          : r.children
                              .map((c: any) => `${c.name}${c.className ? ` (${c.className})` : ''}`)
                              .join(' · ')}
                        {r.childrenCount > r.children.length &&
                          ` and ${r.childrenCount - r.children.length} more`}
                      </p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                        {linkSourceLabel(r.linkSource)} · owes {fmtCur(r.outstanding)}
                        {r.reachableContacts === 0 && ' · no phone number'}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        small
                        disabled={busy}
                        onClick={() => setAssigning({ household: r })}
                      >
                        <UserPlus className="w-3 h-3" />
                        Add child
                      </Button>
                      {r.childrenCount > 1 && (
                        <Button
                          variant="ghost"
                          small
                          disabled={busy}
                          onClick={() => {
                            setSplitting(r)
                            setSelectedChildren([])
                          }}
                        >
                          <Split className="w-3 h-3" />
                          Split
                        </Button>
                      )}
                      {r.needsReview && (
                        <Button
                          small
                          disabled={busy}
                          onClick={() => act({ action: 'confirm', householdId: r.householdId })}
                        >
                          <Check className="w-3 h-3" />
                          Correct
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <CreateParentModal open={creating} onClose={() => setCreating(false)} onSubmit={act} busy={busy} />

      {/* Keyed so each open starts from a clean search box and selection,
          rather than the modal having to reset itself in an effect. */}
      {assigning && (
        <AssignModal
          key={assigning.student?.id ?? assigning.household?.householdId}
          target={assigning}
          onClose={() => setAssigning(null)}
          onSubmit={act}
          busy={busy}
        />
      )}

      {/* Names, never raw ids: picking the wrong number here would silently
          move a child into the wrong family. */}
      <Modal
        open={Boolean(splitting)}
        onClose={() => setSplitting(null)}
        title="Move children into their own family"
        subtitle={
          splitting
            ? `Tick the children who are NOT part of ${splitting.displayName}'s family. They become a separate family with their own call record.`
            : ''
        }
      >
        {splitting && (
          <div className="space-y-4">
            <div className="space-y-2">
              {splitting.children.map((c: any) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer"
                  style={{ background: 'var(--elevated)' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedChildren.includes(c.id)}
                    onChange={(e) =>
                      setSelectedChildren((ids) =>
                        e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)
                      )
                    }
                  />
                  <span className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                    {c.name}
                  </span>
                  {c.className && (
                    <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      {c.className}
                    </span>
                  )}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSplitting(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => act({ action: 'split', studentIds: selectedChildren })}
                disabled={busy || selectedChildren.length === 0}
              >
                Move {selectedChildren.length || ''} out
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function linkSourceLabel(source: string): string {
  switch (source) {
    case 'csv:siblings':
      return 'Grouped from the school’s sibling notes'
    case 'auto:father+surname':
      return 'Grouped on father’s name and surname'
    case 'import:familyId':
      return 'Grouped by Family ID from your upload'
    case 'import:phone':
      return 'Grouped by shared phone number'
    case 'manual':
      return 'Set by hand'
    default:
      return 'Single-child family'
  }
}

/* ── Create a parent ─────────────────────────────────────────── */
function CreateParentModal({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
  busy: boolean
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a parent"
      subtitle="Create the payer first, then attach their children to them."
    >
      <div className="space-y-4">
        <Field label="Parent or family name">
          <input
            className={inputCls}
            style={inputStyle}
            placeholder="e.g. Rajesh Sharma"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Phone number">
          <input
            className={inputCls}
            style={inputStyle}
            placeholder="10 digits, or with +91"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <span className="text-[11px] mt-1 block" style={{ color: 'var(--text-faint)' }}>
            Optional, but a family with no number cannot be called at all.
          </span>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSubmit({ action: 'create', displayName: name, phone: phone || undefined })
              setName('')
              setPhone('')
            }}
            disabled={busy || !name.trim()}
          >
            Create
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Attach a child to a parent ──────────────────────────────── */
function AssignModal({
  target,
  onClose,
  onSubmit,
  busy,
}: {
  target: { student?: any; household?: any }
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
  busy: boolean
}) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<any[]>([])
  const [picked, setPicked] = useState<number[]>([])
  const [searching, setSearching] = useState(false)

  const pickingChildren = Boolean(target.household)

  const search = useCallback(async () => {
    setSearching(true)
    try {
      if (pickingChildren) {
        const res = await fetch(
          `/api/v2/recovery/households/unassigned?${query.trim() ? `search=${encodeURIComponent(query)}` : ''}`
        )
        const body = await res.json()
        if (res.ok) setOptions(body.data)
      } else {
        const res = await fetch(
          `/api/v2/recovery/households?pageSize=20${query.trim() ? `&search=${encodeURIComponent(query)}` : ''}`
        )
        const body = await res.json()
        if (res.ok) setOptions(body.data)
      }
    } finally {
      setSearching(false)
    }
  }, [query, pickingChildren])

  useEffect(() => {
    const t = setTimeout(search, query ? 300 : 0)
    return () => clearTimeout(t)
  }, [query, search])

  return (
    <Modal
      open
      onClose={onClose}
      title={pickingChildren ? 'Attach children to this parent' : 'Choose a parent'}
      subtitle={
        pickingChildren
          ? `Pick the children ${target.household.displayName} pays for. A child already attached elsewhere is moved here.`
          : `Which family does ${target.student.name} belong to?`
      }
      wide
    >
      <div className="space-y-4">
        <input
          className={inputCls}
          style={inputStyle}
          placeholder={pickingChildren ? 'Search students by name' : 'Search families by name'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div
          className="rounded-lg max-h-72 overflow-y-auto divide-y"
          style={{ background: 'var(--elevated)', borderColor: 'var(--border)' }}
        >
          {searching && options.length === 0 ? (
            <p className="px-3 py-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Searching…
            </p>
          ) : options.length === 0 ? (
            <p className="px-3 py-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {pickingChildren ? 'No students found.' : 'No families found.'}
            </p>
          ) : pickingChildren ? (
            options.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={picked.includes(s.id)}
                  onChange={(e) =>
                    setPicked((ids) =>
                      e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)
                    )
                  }
                />
                <span className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                  {s.name}
                </span>
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  {s.className ?? '—'}
                  {s.household && ` · currently with ${s.household.displayName}`}
                </span>
              </label>
            ))
          ) : (
            options.map((h) => (
              <button
                key={h.householdId}
                onClick={() =>
                  onSubmit({
                    action: 'assign',
                    householdId: h.householdId,
                    studentIds: [target.student.id],
                  })
                }
                disabled={busy}
                className="w-full text-left px-3 py-2 hover:bg-white/[0.03]"
              >
                <span className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                  {h.displayName}
                </span>
                <span className="text-[11px] ml-2" style={{ color: 'var(--text-faint)' }}>
                  {h.childrenCount} {h.childrenCount === 1 ? 'child' : 'children'} · owes{' '}
                  {fmtCur(h.outstanding)}
                </span>
              </button>
            ))
          )}
        </div>

        {pickingChildren && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                onSubmit({
                  action: 'assign',
                  householdId: target.household.householdId,
                  studentIds: picked,
                })
              }
              disabled={busy || picked.length === 0}
            >
              Attach {picked.length || ''}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
