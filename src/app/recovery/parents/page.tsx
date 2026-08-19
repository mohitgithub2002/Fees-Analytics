'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Pin, Search, SlidersHorizontal, X } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner, inputCls, inputStyle } from '@/components/v2/ui'
import { ArchetypeChip, TierChip } from '@/components/recovery/chips'
import { cachedFetch } from '@/lib/v2/client-cache'
import { fmtAmt } from '@/lib/v2/format'
import { ARCHETYPE_META, TIER_META, type EconomicTier, type PaymentArchetype } from '@/lib/recovery/types'
import type { GuardianListRow } from '@/lib/recovery/api-types'
import type { ClassV2, PaginationV2 } from '@/lib/v2/types'

interface Filters {
  search: string
  archetype: string
  tier: string
  class: string
  minDue: string
  maxDue: string
}
const DEFAULT_FILTERS: Filters = { search: '', archetype: 'all', tier: 'all', class: 'all', minDue: '', maxDue: '' }

export default function ParentsPage() {
  return (
    <Suspense fallback={null}>
      <ParentsInner />
    </Suspense>
  )
}

function ParentsInner() {
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<Filters>({
    ...DEFAULT_FILTERS,
    archetype: searchParams.get('archetype') ?? 'all',
    tier: searchParams.get('tier') ?? 'all',
  })
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<GuardianListRow[]>([])
  const [pagination, setPagination] = useState<PaginationV2 | null>(null)
  const [classes, setClasses] = useState<ClassV2[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pinning, setPinning] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    cachedFetch<{ data: ClassV2[] }>('/api/v2/classes', 300_000).then((d) => setClasses(d.data ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const delay = filters.search ? 300 : 0
    debounce.current = setTimeout(() => {
      setLoading(true)
      const sp = new URLSearchParams({ page: String(page), limit: '50' })
      if (filters.search.trim()) sp.set('search', filters.search.trim())
      if (filters.archetype !== 'all') sp.set('archetype', filters.archetype)
      if (filters.tier !== 'all') sp.set('tier', filters.tier)
      if (filters.class !== 'all') sp.set('class', filters.class)
      if (filters.minDue) sp.set('minDue', filters.minDue)
      if (filters.maxDue) sp.set('maxDue', filters.maxDue)
      fetch(`/api/v2/recovery/guardians?${sp}`)
        .then((r) => r.json())
        .then((d) => { setRows(d.data ?? []); setPagination(d.pagination ?? null); setLoading(false) })
        .catch((e) => { setError(e.message); setLoading(false) })
    }, delay)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [filters, page])

  const setFilter = (key: keyof Filters, val: string) => {
    setFilters((f) => ({ ...f, [key]: val }))
    setPage(1)
  }
  const isActive =
    filters.class !== 'all' || filters.archetype !== 'all' || filters.tier !== 'all' ||
    !!filters.search || !!filters.minDue || !!filters.maxDue

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function pinSelected() {
    setPinning(true)
    setError('')
    try {
      await Promise.all(
        [...selected].map((id) => fetch(`/api/v2/recovery/guardians/${id}/pin`, { method: 'POST' }))
      )
      setSelected(new Set())
    } catch {
      setError('Some households could not be pinned — try again.')
    } finally {
      setPinning(false)
    }
  }

  return (
    <>
      <PageHeader
        section="Parents"
        subtitle={pagination ? <><span className="mono">{pagination.total}</span> households with dues</> : 'Loading…'}
      >
        {selected.size > 0 && (
          <Button onClick={pinSelected} disabled={pinning}>
            <Pin className="w-3.5 h-3.5" /> {pinning ? 'Pinning…' : `Pin ${selected.size} to today's list`}
          </Button>
        )}
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1400px] space-y-4">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Filters</span>
                {isActive && (
                  <span className="px-2 h-5 flex items-center rounded-full text-[11px] font-medium" style={{ background: 'var(--accent-soft)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
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
                  placeholder="Search guardian name…"
                  className={`${inputCls} pl-9`} style={inputStyle}
                />
              </div>
              <select value={filters.archetype} onChange={(e) => setFilter('archetype', e.target.value)} className={inputCls} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="all">All Behaviour Types</option>
                {(Object.keys(ARCHETYPE_META) as PaymentArchetype[]).map((a) => (
                  <option key={a} value={a}>{ARCHETYPE_META[a].label}</option>
                ))}
              </select>
              <select value={filters.tier} onChange={(e) => setFilter('tier', e.target.value)} className={inputCls} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="all">All Ability Tiers</option>
                {(Object.keys(TIER_META) as EconomicTier[]).map((t) => (
                  <option key={t} value={t}>{TIER_META[t].label}</option>
                ))}
              </select>
              <select value={filters.class} onChange={(e) => setFilter('class', e.target.value)} className={inputCls} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="all">All Classes</option>
                {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
              </select>
              <input type="number" min={0} value={filters.minDue} onChange={(e) => setFilter('minDue', e.target.value)} placeholder="Min ₹ Due" className={`${inputCls} mono`} style={inputStyle} />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th className="w-10 px-4 py-3" />
                    {['Household', 'Children', 'Behaviour', 'Ability', 'Outstanding', 'Expected (30d)', 'Last Contact'].map((h, i) => (
                      <th key={h} className={`px-4 py-3 label-micro font-medium ${i >= 4 && i <= 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 && <tr><td colSpan={8}><EmptyState text="Loading households…" /></td></tr>}
                  {!loading && rows.length === 0 && <tr><td colSpan={8}><EmptyState text="No households match these filters." /></td></tr>}
                  {rows.map((g) => (
                    <tr key={g.id} className="transition-colors hover:bg-[var(--card-hover)]" style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/recovery/parents/${g.id}`} className="font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>{g.name}</Link>
                        {g.phone && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{g.phone}</p>}
                      </td>
                      <td className="px-4 py-3 mono" style={{ color: 'var(--text-secondary)' }}>{g.childrenCount}</td>
                      <td className="px-4 py-3"><ArchetypeChip archetype={g.archetype} small /></td>
                      <td className="px-4 py-3">
                        <TierChip tier={g.economicTier !== 'UNKNOWN' ? g.economicTier : g.suggestedTier} suggested={g.economicTier === 'UNKNOWN'} small />
                      </td>
                      <td className="px-4 py-3 text-right mono" style={{ color: 'var(--text-primary)' }}>{fmtAmt(g.totalOutstanding)}</td>
                      <td className="px-4 py-3 text-right mono" style={{ color: 'var(--good-2)' }}>{fmtAmt(g.expectedRecovery30d)}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                        {g.lastContactAt ? new Date(g.lastContactAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
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
                  <Button variant="ghost" small disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-3.5 h-3.5" /> Prev</Button>
                  <Button variant="ghost" small disabled={page >= pagination.pages} onClick={() => setPage(page + 1)}>Next <ChevronRight className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
