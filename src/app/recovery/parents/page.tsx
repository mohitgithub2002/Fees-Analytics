'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { EmptyState, ErrorBanner, inputCls, inputStyle } from '@/components/v2/ui'
import { ArchetypeChip, TierChip } from '@/components/recovery/chips'
import { ARCHETYPE_LABEL, TIER_LABEL, type EconomicTier, type PaymentArchetype } from '@/lib/recovery/types'
import { fmtCur, fmtDate } from '@/lib/v2/format'

interface Row {
  caseId: number
  householdId: number
  displayName: string
  archetype: string
  tier: string
  stage: string
  outstanding: number
  pastSessionsDue: number
  expectedRecoveryValue: number
  suppressionReason: string | null
  lastContactAt: string | null
  contactCount: number
  childrenCount: number
  reachableContacts: number
  needsReview: boolean
  children: { id: number; name: string; className: string | null }[]
}

const ARCHETYPES = Object.keys(ARCHETYPE_LABEL) as PaymentArchetype[]
const TIERS = Object.keys(TIER_LABEL) as EconomicTier[]

const selectStyle = { ...inputStyle, cursor: 'pointer' }

export default function ParentsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [archetype, setArchetype] = useState('')
  const [tier, setTier] = useState('')
  const [status, setStatus] = useState('')
  const [sortKey, setSortKey] = useState('priority')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: '50', sortKey })
    if (search.trim()) params.set('search', search.trim())
    if (archetype) params.set('archetype', archetype)
    if (tier) params.set('tier', tier)
    if (status) params.set('status', status)

    try {
      const res = await fetch(`/api/v2/recovery/households?${params}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'could not load families')
      setRows(body.data)
      setTotal(body.pagination.total)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, search, archetype, tier, status, sortKey])

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  return (
    <>
      <PageHeader section="Families" subtitle={`${total} families · one row per payer, not per child`} />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

        {/* ── Filters ─────────────────────────────────────────
            A grid rather than a wrapping flex row: inputCls is w-full, so
            every control here fills whatever track it sits in and the four
            dropdowns line up beside the search box instead of each claiming
            a row of its own. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="relative sm:col-span-2">
            <Search
              className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              className={`${inputCls} pl-9`}
              style={inputStyle}
              placeholder="Search by family or child name"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <select
            className={inputCls}
            style={selectStyle}
            value={archetype}
            onChange={(e) => {
              setArchetype(e.target.value)
              setPage(1)
            }}
          >
            <option value="">Any payment pattern</option>
            {ARCHETYPES.map((a) => (
              <option key={a} value={a}>
                {ARCHETYPE_LABEL[a]}
              </option>
            ))}
          </select>
          <select
            className={inputCls}
            style={selectStyle}
            value={tier}
            onChange={(e) => {
              setTier(e.target.value)
              setPage(1)
            }}
          >
            <option value="">Any ability to pay</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
          <select
            className={inputCls}
            style={selectStyle}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            <option value="">Everyone</option>
            <option value="callable">Worth calling</option>
            <option value="skipped">Skipped today</option>
          </select>
          <select
            className={inputCls}
            style={selectStyle}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
          >
            <option value="priority">Best calls first</option>
            <option value="outstanding">Owes most first</option>
            <option value="expected">Most recoverable first</option>
            <option value="lastContact">Least recently called</option>
          </select>
        </div>

        {/* ── Table ───────────────────────────────────────── */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          {loading && rows.length === 0 ? (
            <EmptyState text="Loading…" />
          ) : rows.length === 0 ? (
            <EmptyState text="No families match those filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th className="text-left font-medium px-4 py-2.5">Family</th>
                    <th className="text-left font-medium px-4 py-2.5">How they pay</th>
                    <th className="text-left font-medium px-4 py-2.5">Can they pay</th>
                    <th className="text-right font-medium px-4 py-2.5">Owes</th>
                    <th className="text-right font-medium px-4 py-2.5">Recoverable</th>
                    <th className="text-left font-medium px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.householdId}
                      style={{ borderTop: '1px solid var(--border)' }}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link href={`/recovery/parents/${r.householdId}`}>
                          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {r.displayName}
                          </p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                            {r.children.map((c) => `${c.name}${c.className ? ` (${c.className})` : ''}`).join(', ')}
                            {r.childrenCount > r.children.length && ` +${r.childrenCount - r.children.length}`}
                          </p>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <ArchetypeChip archetype={r.archetype} small />
                      </td>
                      <td className="px-4 py-3">
                        <TierChip tier={r.tier} small />
                      </td>
                      <td className="px-4 py-3 text-right mono" style={{ color: 'var(--critical)' }}>
                        {fmtCur(r.outstanding)}
                        {r.pastSessionsDue > 0 && (
                          <p className="text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
                            {fmtCur(r.pastSessionsDue)} old
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right mono font-medium" style={{ color: 'var(--good-2)' }}>
                        {fmtCur(r.expectedRecoveryValue)}
                      </td>
                      <td className="px-4 py-3">
                        {r.suppressionReason ? (
                          <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                            {r.suppressionReason}
                          </span>
                        ) : (
                          <span className="text-[11.5px]" style={{ color: 'var(--good-2)' }}>
                            Worth calling
                          </span>
                        )}
                        {r.lastContactAt && (
                          <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                            last called {fmtDate(r.lastContactAt)}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {total > 50 && (
          <div className="flex items-center justify-between text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <span>
              Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 h-8 rounded-lg disabled:opacity-40"
                style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
              >
                Previous
              </button>
              <button
                disabled={page * 50 >= total}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 h-8 rounded-lg disabled:opacity-40"
                style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
