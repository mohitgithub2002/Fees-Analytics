'use client'

import { Search, Filter, X } from 'lucide-react'
import type { FilterState } from '@/lib/types'

const CLASSES = [
  'all', 'Nursery', 'LKG', 'UKG',
  'I', 'II', 'III', 'IV', 'V',
  'VI', 'VII', 'VIII', 'IX', 'X',
]

const FEE_TYPES = [
  { value: 'total',    label: 'Total Due'     },
  { value: 'previous', label: 'Prev Year Due' },
  { value: 'school',   label: 'School Due'    },
  { value: 'bus',      label: 'Bus Due'       },
  { value: 'extra',    label: 'Extra Due'     },
]

interface Props {
  filters:          FilterState
  onFiltersChange:  (f: FilterState) => void
  onReset:          () => void
}

const inputStyle = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  outline: 'none',
  borderRadius: 10,
  fontSize: 13,
  transition: 'border-color 0.15s',
}

export function FilterPanel({ filters, onFiltersChange, onReset }: Props) {
  const isActive =
    filters.class !== 'all' ||
    !!filters.search ||
    !!filters.minDue ||
    !!filters.maxDue ||
    filters.feeType !== 'total'

  const set = (key: keyof FilterState, val: string) =>
    onFiltersChange({ ...filters, [key]: val })

  return (
    <div className="glass-card p-5 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" style={{ color: 'var(--indigo)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Filters
          </span>
          {isActive && (
            <span
              className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: 'rgba(99,102,241,0.18)', color: 'var(--indigo)' }}
            >
              Active
            </span>
          )}
        </div>
        {isActive && (
          <button
            id="filter-reset-btn"
            onClick={onReset}
            className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X className="w-3 h-3" />
            Reset all
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        {/* Search — spans 2 cols */}
        <div className="lg:col-span-2 relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            id="filter-search"
            type="text"
            placeholder="Search student / father name…"
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
            style={{ ...inputStyle, width: '100%', padding: '9px 12px 9px 34px' }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--indigo)')}
            onBlur={(e)  => (e.target.style.borderColor = 'var(--border)')}
          />
        </div>

        {/* Class */}
        <select
          id="filter-class"
          value={filters.class}
          onChange={(e) => set('class', e.target.value)}
          style={{ ...inputStyle, padding: '9px 12px', width: '100%', cursor: 'pointer' }}
        >
          <option value="all">All Classes</option>
          {CLASSES.slice(1).map((c) => (
            <option key={c} value={c}>
              Class {c}
            </option>
          ))}
        </select>

        {/* Fee type */}
        <select
          id="filter-fee-type"
          value={filters.feeType}
          onChange={(e) => set('feeType', e.target.value)}
          style={{ ...inputStyle, padding: '9px 12px', width: '100%', cursor: 'pointer' }}
        >
          {FEE_TYPES.map((ft) => (
            <option key={ft.value} value={ft.value}>
              {ft.label}
            </option>
          ))}
        </select>

        {/* Min due */}
        <input
          id="filter-min-due"
          type="number"
          min={0}
          placeholder="Min ₹ Due"
          value={filters.minDue}
          onChange={(e) => set('minDue', e.target.value)}
          style={{ ...inputStyle, padding: '9px 12px', width: '100%' }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--indigo)')}
          onBlur={(e)  => (e.target.style.borderColor = 'var(--border)')}
        />

        {/* Max due */}
        <input
          id="filter-max-due"
          type="number"
          min={0}
          placeholder="Max ₹ Due"
          value={filters.maxDue}
          onChange={(e) => set('maxDue', e.target.value)}
          style={{ ...inputStyle, padding: '9px 12px', width: '100%' }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--indigo)')}
          onBlur={(e)  => (e.target.style.borderColor = 'var(--border)')}
        />
      </div>
    </div>
  )
}
