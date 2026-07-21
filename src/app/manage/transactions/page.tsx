'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Undo2 } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import {
  apiCall, Button, CategoryChip, EmptyState, ErrorBanner, inputCls, inputStyle, StatusChip,
} from '@/components/v2/ui'
import { fmtAmt, fmtDate } from '@/lib/v2/format'
import type { PaginationV2, TransactionV2 } from '@/lib/v2/types'

export default function TransactionsPage() {
  const [rows, setRows] = useState<TransactionV2[]>([])
  const [pagination, setPagination] = useState<PaginationV2 | null>(null)
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [refreshKey, setRefreshKey] = useState(0)
  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    const sp = new URLSearchParams({ page: String(page), limit: '50' })
    if (category !== 'all') sp.set('category', category)
    fetch(`/api/v2/transactions?${sp}`)
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return
        setRows(data.data ?? [])
        setPagination(data.pagination ?? null)
        setLoading(false)
      })
      .catch(console.error)
    return () => { alive = false }
  }, [page, category, refreshKey])

  async function cancel(t: TransactionV2) {
    if (!confirm(`Cancel ${t.receiptNo} (${fmtAmt(t.amount)})? Its allocations will be reversed.`)) return
    try {
      await apiCall(`/api/v2/transactions/${t.id}`, 'DELETE')
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <PageHeader
        section="Transactions"
        subtitle={pagination ? <><span className="mono">{pagination.total}</span> payments recorded</> : 'Loading…'}
      >
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1) }}
          className={inputCls}
          style={{ ...inputStyle, width: 160 }}
        >
          <option value="all">All types</option>
          <option value="SCHOOL">School</option>
          <option value="BUS">Bus</option>
          <option value="OTHER">Other</option>
        </select>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1400px] space-y-4">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Receipt', 'Date', 'Student', 'Type', 'Mode', 'Allocated To', 'Amount', 'Status', ''].map((h, i) => (
                      <th key={i} className={`px-4 py-3 label-micro font-medium ${i === 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 && (
                    <tr><td colSpan={9}><EmptyState text="Loading transactions…" /></td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={9}><EmptyState text="No transactions yet." /></td></tr>
                  )}
                  {rows.map((t) => (
                    <tr key={t.id} className="transition-colors hover:bg-[var(--card-hover)]" style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-4 py-3 mono" style={{ color: 'var(--text-primary)' }}>{t.receiptNo}</td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{fmtDate(t.paidAt)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/manage/students/${t.studentId}`} className="hover:underline font-medium" style={{ color: 'var(--text-primary)' }}>
                          {t.student?.name ?? `#${t.studentId}`}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{t.category ? <CategoryChip category={t.category} /> : <span style={{ color: 'var(--text-muted)' }}>General</span>}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{t.mode}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                        <span className="line-clamp-1">
                          {t.allocations.map((a) => `${a.installment?.feeItem.name} (${fmtAmt(a.amount)})`).join(', ') || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right mono font-medium" style={{ color: t.status === 'CANCELLED' ? 'var(--text-faint)' : 'var(--good-2)', textDecoration: t.status === 'CANCELLED' ? 'line-through' : undefined }}>
                        {fmtAmt(t.amount)}
                      </td>
                      <td className="px-4 py-3"><StatusChip status={t.status === 'COMPLETED' ? 'PAID' : t.status} /></td>
                      <td className="px-4 py-3 text-right">
                        {t.status === 'COMPLETED' && (
                          <Button variant="danger" small onClick={() => cancel(t)}>
                            <Undo2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
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
    </>
  )
}
