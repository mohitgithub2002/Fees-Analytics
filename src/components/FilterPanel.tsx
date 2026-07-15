'use client'

import { Search, SlidersHorizontal, X } from 'lucide-react'
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

const inputStyle: React.CSSProperties = {
  background: 'var(--elevated)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  outline: 'none',
  borderRadius: 9,
  fontSize: 13,
  height: 38,
  transition: 'border-color .15s, box-shadow .15s',
}

const focusOn = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
  e.target.style.borderColor = 'var(--border-strong)'
  e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'
}
const focusOff = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
  e.target.style.borderColor = 'var(--border)'
  e.target.style.boxShadow = 'none'
}

export function FilterPanel({ filters, onFiltersChange, onReset }: Props) {
  const isActive =
    filters.class !== 'all' || !!filters.search ||
    !!filters.minDue || !!filters.maxDue || filters.feeType !== 'total'

  const set = (key: keyof FilterState, val: string) =>
    onFiltersChange({ ...filters, [key]: val })

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Filters
          </span>
          {isActive && (
            <span
              className="px-2 h-5 flex items-center rounded-full text-[11px] font-medium"
              style={{ background: 'var(--accent-soft)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            >
              Active
            </span>
          )}
        </div>
        {isActive && (
          <button
            id="filter-reset-btn"
            onClick={onReset}
            className="flex items-center gap-1 text-[12px] transition-colors hover:brightness-125"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="w-3.5 h-3.5" />
            Reset all
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        {/* Search */}
        <div className="lg:col-span-2 relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
            style={{ color: 'var(--text-faint)' }}
          />
          <input
            id="filter-search"
            type="text"
            placeholder="Search student / father name…"
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
            style={{ ...inputStyle, width: '100%', padding: '0 12px 0 34px' }}
            onFocus={focusOn} onBlur={focusOff}
          />
        </div>

        <select
          id="filter-class"
          value={filters.class}
          onChange={(e) => set('class', e.target.value)}
          style={{ ...inputStyle, padding: '0 10px', width: '100%', cursor: 'pointer' }}
          onFocus={focusOn} onBlur={focusOff}
        >
          <option value="all">All Classes</option>
          {CLASSES.slice(1).map((c) => (
            <option key={c} value={c}>Class {c}</option>
          ))}
        </select>

        <select
          id="filter-fee-type"
          value={filters.feeType}
          onChange={(e) => set('feeType', e.target.value)}
          style={{ ...inputStyle, padding: '0 10px', width: '100%', cursor: 'pointer' }}
          onFocus={focusOn} onBlur={focusOff}
        >
          {FEE_TYPES.map((ft) => (
            <option key={ft.value} value={ft.value}>{ft.label}</option>
          ))}
        </select>

        <input
          id="filter-min-due"
          type="number" min={0}
          placeholder="Min ₹ Due"
          value={filters.minDue}
          onChange={(e) => set('minDue', e.target.value)}
          style={{ ...inputStyle, padding: '0 12px', width: '100%', fontFamily: 'var(--font-mono)' }}
          onFocus={focusOn} onBlur={focusOff}
        />

        <input
          id="filter-max-due"
          type="number" min={0}
          placeholder="Max ₹ Due"
          value={filters.maxDue}
          onChange={(e) => set('maxDue', e.target.value)}
          style={{ ...inputStyle, padding: '0 12px', width: '100%', fontFamily: 'var(--font-mono)' }}
          onFocus={focusOn} onBlur={focusOff}
        />
      </div>
    </div>
  )
}
