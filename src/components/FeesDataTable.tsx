'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import type { StudentFee, PaginationInfo } from '@/lib/types'

interface Props {
  data:         StudentFee[]
  pagination:   PaginationInfo
  onPageChange: (page: number) => void
  isLoading?:   boolean
}

type SortDir = 'asc' | 'desc'

const COLUMNS = [
  { key: 'class',       label: 'Class',       sortable: true  },
  { key: 'studentName', label: 'Student',      sortable: true  },
  { key: 'fatherName',  label: "Father's Name",sortable: false },
  { key: 'previousDue', label: 'Prev Due',     sortable: true  },
  { key: 'schoolDue',   label: 'School Due',   sortable: true  },
  { key: 'busDue',      label: 'Bus Due',      sortable: true  },
  { key: 'extraDue',    label: 'Extra Due',    sortable: true  },
  { key: 'totalDue',    label: 'Total Due',    sortable: true  },
  { key: 'remarks',     label: 'Remarks',      sortable: false },
]

function DueCell({ amount }: { amount: number }) {
  if (amount === 0)
    return <span style={{ color: '#10b981', fontSize: 12, fontWeight: 600 }}>Cleared</span>
  const color = amount > 15000 ? '#f43f5e' : amount > 7000 ? '#f59e0b' : '#e8edf5'
  return (
    <span style={{ color, fontWeight: 500, fontSize: 13 }}>
      ₹{amount.toLocaleString('en-IN')}
    </span>
  )
}

function RemarksChip({ text }: { text: string | null }) {
  if (!text) return null
  const map: Record<string, { bg: string; color: string }> = {
    'Cleared':         { bg: 'rgba(16,185,129,0.15)',  color: '#10b981' },
    'High Due':        { bg: 'rgba(244,63,94,0.15)',   color: '#f43f5e' },
    'Partial Payment': { bg: 'rgba(245,158,11,0.15)',  color: '#f59e0b' },
  }
  const style = map[text] ?? { bg: 'rgba(255,255,255,0.07)', color: '#7c8a9e' }
  return (
    <span
      className="px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap"
      style={{ background: style.bg, color: style.color }}
    >
      {text}
    </span>
  )
}

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      {COLUMNS.map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 rounded animate-pulse"
            style={{
              background: 'rgba(255,255,255,0.07)',
              width: i === 1 ? 140 : i === 2 ? 120 : 70,
            }}
          />
        </td>
      ))}
    </tr>
  )
}

export function FeesDataTable({ data, pagination, onPageChange, isLoading }: Props) {
  const [sortKey, setSortKey] = useState<string>('totalDue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...data].sort((a, b) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const av = (a as any)[sortKey], bv = (b as any)[sortKey]
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? av - bv : bv - av
  })

  const SortIcon = ({ col }: { col: string }) =>
    sortKey === col
      ? sortDir === 'asc'
        ? <ChevronUp className="w-3 h-3 ml-1 inline" />
        : <ChevronDown className="w-3 h-3 ml-1 inline" />
      : <ChevronDown className="w-3 h-3 ml-1 inline opacity-25" />

  // Page numbers
  const { page, pages, total } = pagination
  const pageNums: number[] = []
  if (pages <= 6) {
    for (let i = 1; i <= pages; i++) pageNums.push(i)
  } else {
    const s = Math.max(1, Math.min(page - 2, pages - 4))
    for (let i = s; i <= Math.min(s + 4, pages); i++) pageNums.push(i)
  }

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Student Records
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {isLoading ? 'Loading…' : `${total} students found`}
          </p>
        </div>
        <button
          id="export-btn"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-80"
          style={{
            background: 'rgba(99,102,241,0.12)',
            border: '1px solid rgba(99,102,241,0.25)',
            color: 'var(--indigo)',
          }}
        >
          <Download className="w-3.5 h-3.5" />
          Export
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  id={`th-${col.key}`}
                  onClick={() => col.sortable && handleSort(col.key)}
                  className="px-4 py-3 text-left text-xs font-medium whitespace-nowrap"
                  style={{
                    color: sortKey === col.key ? 'var(--indigo)' : 'var(--text-secondary)',
                    cursor: col.sortable ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                >
                  {col.label}
                  {col.sortable && <SortIcon col={col.key} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            ) : sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-4 py-16 text-center text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  No records match your filters
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr
                  key={row.id}
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3">
                    <span
                      className="px-2 py-0.5 rounded-md text-xs font-semibold"
                      style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--indigo)' }}
                    >
                      {row.class}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-sm font-medium whitespace-nowrap"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {row.studentName}
                  </td>
                  <td
                    className="px-4 py-3 text-sm whitespace-nowrap"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {row.fatherName}
                  </td>
                  <td className="px-4 py-3"><DueCell amount={row.previousDue} /></td>
                  <td className="px-4 py-3"><DueCell amount={row.schoolDue} /></td>
                  <td className="px-4 py-3"><DueCell amount={row.busDue} /></td>
                  <td className="px-4 py-3"><DueCell amount={row.extraDue} /></td>
                  <td className="px-4 py-3">
                    <DueCell amount={row.totalDue} />
                  </td>
                  <td className="px-4 py-3">
                    <RemarksChip text={row.remarks} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        className="px-5 py-3 flex items-center justify-between flex-wrap gap-3"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Page {page} of {pages} &bull; {total} total records
        </p>

        <div className="flex items-center gap-1">
          <PagBtn onClick={() => onPageChange(page - 1)} disabled={page <= 1} id="page-prev">
            <ChevronLeft className="w-3.5 h-3.5" />
          </PagBtn>

          {pageNums[0] > 1 && (
            <>
              <PagBtn onClick={() => onPageChange(1)} id="page-1">1</PagBtn>
              {pageNums[0] > 2 && <span style={{ color: 'var(--text-muted)', padding: '0 4px' }}>…</span>}
            </>
          )}

          {pageNums.map((p) => (
            <PagBtn key={p} onClick={() => onPageChange(p)} active={p === page} id={`page-${p}`}>
              {p}
            </PagBtn>
          ))}

          {pageNums[pageNums.length - 1] < pages && (
            <>
              {pageNums[pageNums.length - 1] < pages - 1 && (
                <span style={{ color: 'var(--text-muted)', padding: '0 4px' }}>…</span>
              )}
              <PagBtn onClick={() => onPageChange(pages)} id={`page-${pages}`}>{pages}</PagBtn>
            </>
          )}

          <PagBtn onClick={() => onPageChange(page + 1)} disabled={page >= pages} id="page-next">
            <ChevronRight className="w-3.5 h-3.5" />
          </PagBtn>
        </div>
      </div>
    </div>
  )
}

function PagBtn({
  children, onClick, disabled, active, id,
}: {
  children: React.ReactNode
  onClick:  () => void
  disabled?: boolean
  active?:   boolean
  id?:       string
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium transition-all"
      style={{
        background: active ? 'var(--indigo)' : 'rgba(255,255,255,0.05)',
        border: '1px solid var(--border)',
        color: active ? '#fff' : disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}
