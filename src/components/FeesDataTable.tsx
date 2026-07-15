'use client'

import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import type { StudentFee, PaginationInfo } from '@/lib/types'

type SortDir = 'asc' | 'desc'

interface Props {
  data:         StudentFee[]
  pagination:   PaginationInfo
  onPageChange: (page: number) => void
  sortKey:      string
  sortDir:      SortDir
  onSortChange: (key: string) => void
  isLoading?:   boolean
}

const COLUMNS = [
  { key: 'class',       label: 'Class',        sortable: true,  align: 'left'  },
  { key: 'studentName', label: 'Student',      sortable: true,  align: 'left'  },
  { key: 'fatherName',  label: "Father's Name",sortable: false, align: 'left'  },
  { key: 'previousDue', label: 'Prev Due',     sortable: true,  align: 'right' },
  { key: 'schoolDue',   label: 'School Due',   sortable: true,  align: 'right' },
  { key: 'busDue',      label: 'Bus Due',      sortable: true,  align: 'right' },
  { key: 'extraDue',    label: 'Extra Due',    sortable: true,  align: 'right' },
  { key: 'totalDue',    label: 'Total Due',    sortable: true,  align: 'right' },
  { key: 'remarks',     label: 'Remarks',      sortable: false, align: 'left'  },
] as const

function DueCell({ amount }: { amount: number }) {
  if (amount === 0)
    return <span className="mono" style={{ color: 'var(--good-2)', fontSize: 12.5, fontWeight: 500 }}>—</span>
  const color = amount > 15000 ? 'var(--critical)' : amount > 7000 ? 'var(--warning)' : 'var(--text-primary)'
  return (
    <span className="mono" style={{ color, fontWeight: 500, fontSize: 12.5 }}>
      ₹{amount.toLocaleString('en-IN')}
    </span>
  )
}

function RemarksChip({ text }: { text: string | null }) {
  if (!text) return null
  const map: Record<string, { bg: string; color: string }> = {
    'Cleared':         { bg: 'var(--good-soft)',     color: 'var(--good-2)'   },
    'High Due':        { bg: 'var(--critical-soft)', color: 'var(--critical)' },
    'Partial Payment': { bg: 'var(--warning-soft)',  color: 'var(--warning)'  },
  }
  const style = map[text] ?? { bg: 'var(--accent-soft)', color: 'var(--text-secondary)' }
  return (
    <span
      className="px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap"
      style={{ background: style.bg, color: style.color }}
    >
      {text}
    </span>
  )
}

function SkeletonRow() {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      {COLUMNS.map((c, i) => (
        <td key={i} className="px-4 py-3.5">
          <div
            className="skeleton h-3.5"
            style={{ width: i === 1 ? 130 : i === 2 ? 110 : 60, marginLeft: c.align === 'right' ? 'auto' : 0 }}
          />
        </td>
      ))}
    </tr>
  )
}

export function FeesDataTable({
  data, pagination, onPageChange, sortKey, sortDir, onSortChange, isLoading,
}: Props) {
  // Rows arrive already sorted server-side across the full dataset — render as-is.
  const rows = data

  const SortIcon = ({ col }: { col: string }) =>
    sortKey === col
      ? sortDir === 'asc'
        ? <ChevronUp className="w-3 h-3 ml-1 inline" style={{ color: 'var(--text-primary)' }} />
        : <ChevronDown className="w-3 h-3 ml-1 inline" style={{ color: 'var(--text-primary)' }} />
      : <ChevronDown className="w-3 h-3 ml-1 inline" style={{ color: 'var(--text-faint)' }} />

  const { page, pages, total } = pagination
  const pageNums: number[] = []
  if (pages <= 6) { for (let i = 1; i <= pages; i++) pageNums.push(i) }
  else {
    const s = Math.max(1, Math.min(page - 2, pages - 4))
    for (let i = s; i <= Math.min(s + 4, pages); i++) pageNums.push(i)
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div
        className="px-5 h-16 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Student Records
          </h3>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {isLoading ? 'Loading…' : <><span className="mono">{total}</span> students found</>}
          </p>
        </div>
        <button
          id="export-btn"
          className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12.5px] font-medium transition-transform hover:-translate-y-px active:translate-y-0"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          <Download className="w-3.5 h-3.5" />
          Export
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  id={`th-${col.key}`}
                  onClick={() => col.sortable && onSortChange(col.key)}
                  className="px-4 py-3 text-[11px] font-medium whitespace-nowrap select-none"
                  style={{
                    color: sortKey === col.key ? 'var(--text-primary)' : 'var(--text-muted)',
                    cursor: col.sortable ? 'pointer' : 'default',
                    textAlign: col.align,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
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
              Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-20 text-center text-[13px]"
                    style={{ color: 'var(--text-muted)' }}>
                  No records match your filters
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors"
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--card-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3.5">
                    <span
                      className="mono px-2 py-0.5 rounded-md text-[11px] font-semibold"
                      style={{ background: 'var(--accent-soft)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                    >
                      {row.class}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-[13px] font-medium whitespace-nowrap"
                      style={{ color: 'var(--text-primary)' }}>
                    {row.studentName}
                  </td>
                  <td className="px-4 py-3.5 text-[13px] whitespace-nowrap"
                      style={{ color: 'var(--text-secondary)' }}>
                    {row.fatherName}
                  </td>
                  <td className="px-4 py-3.5 text-right"><DueCell amount={row.previousDue} /></td>
                  <td className="px-4 py-3.5 text-right"><DueCell amount={row.schoolDue} /></td>
                  <td className="px-4 py-3.5 text-right"><DueCell amount={row.busDue} /></td>
                  <td className="px-4 py-3.5 text-right"><DueCell amount={row.extraDue} /></td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="mono font-semibold text-[13px]"
                          style={{ color: row.totalDue === 0 ? 'var(--good-2)' : 'var(--text-primary)' }}>
                      {row.totalDue === 0 ? 'Cleared' : `₹${row.totalDue.toLocaleString('en-IN')}`}
                    </span>
                  </td>
                  <td className="px-4 py-3.5"><RemarksChip text={row.remarks} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        className="px-5 py-3.5 flex items-center justify-between flex-wrap gap-3"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Page <span className="mono">{page}</span> of <span className="mono">{pages}</span>
          {' · '}<span className="mono">{total}</span> records
        </p>

        <div className="flex items-center gap-1">
          <PagBtn onClick={() => onPageChange(page - 1)} disabled={page <= 1} id="page-prev">
            <ChevronLeft className="w-3.5 h-3.5" />
          </PagBtn>

          {pageNums[0] > 1 && (
            <>
              <PagBtn onClick={() => onPageChange(1)} id="page-1">1</PagBtn>
              {pageNums[0] > 2 && <span style={{ color: 'var(--text-faint)', padding: '0 2px' }}>…</span>}
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
                <span style={{ color: 'var(--text-faint)', padding: '0 2px' }}>…</span>
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
      className="mono min-w-8 h-8 px-2 rounded-lg flex items-center justify-center text-[12.5px] font-medium transition-colors"
      style={{
        background: active ? 'var(--accent)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        color: active ? 'var(--accent-fg)' : disabled ? 'var(--text-faint)' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.borderColor = 'var(--border-strong)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      {children}
    </button>
  )
}
