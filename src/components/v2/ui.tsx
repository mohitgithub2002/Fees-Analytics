'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { FeeCategory, InstallmentStatus } from '@/lib/v2/types'
import { invalidateClientCache } from '@/lib/v2/client-cache'

/* ── Shared UI primitives for the v2 management screens ─────────── */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
        />
        <Dialog.Content
          className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-32px)] max-h-[85vh] overflow-y-auto rounded-2xl p-6"
          style={{
            maxWidth: wide ? 640 : 480,
            background: 'var(--card)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          }}
        >
          <div className="flex items-start justify-between mb-5">
            <div>
              <Dialog.Title
                className="text-[15px] font-semibold tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {subtitle}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: 'var(--text-muted)', background: 'var(--elevated)' }}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-micro block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

export const inputCls = 'w-full h-9 px-3 rounded-lg text-[13px] outline-none transition-colors'
export const inputStyle: React.CSSProperties = {
  background: 'var(--elevated-2)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  small,
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  small?: boolean
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: 'var(--accent-fg)' },
    ghost: {
      background: 'var(--elevated)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border)',
    },
    danger: { background: 'var(--critical-soft)', color: 'var(--critical)' },
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:pointer-events-none ${
        small ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[12.5px]'
      }`}
      style={styles[variant]}
    >
      {children}
    </button>
  )
}

const CATEGORY_STYLE: Record<FeeCategory, { bg: string; color: string; label: string }> = {
  SCHOOL: { bg: 'var(--blue-soft)', color: 'var(--data-2)', label: 'School' },
  BUS: { bg: 'rgba(25,158,112,0.14)', color: 'var(--data-3)', label: 'Bus' },
  OTHER: { bg: 'rgba(144,133,233,0.14)', color: 'var(--data-4)', label: 'Other' },
}

export function CategoryChip({ category }: { category: FeeCategory }) {
  const s = CATEGORY_STYLE[category]
  return (
    <span
      className="px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  )
}

const STATUS_STYLE: Record<InstallmentStatus, { bg: string; color: string }> = {
  PAID: { bg: 'var(--good-soft)', color: 'var(--good-2)' },
  PARTIAL: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  PENDING: { bg: 'var(--critical-soft)', color: 'var(--critical)' },
}

export function StatusChip({ status }: { status: InstallmentStatus | string }) {
  const s = STATUS_STYLE[status as InstallmentStatus] ?? {
    bg: 'var(--accent-soft)',
    color: 'var(--text-secondary)',
  }
  return (
    <span
      className="px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  )
}

export function DueAmount({ amount, size = 12.5 }: { amount: number; size?: number }) {
  if (amount === 0)
    return (
      <span className="mono" style={{ color: 'var(--good-2)', fontSize: size, fontWeight: 500 }}>
        —
      </span>
    )
  const color =
    amount > 15000 ? 'var(--critical)' : amount > 7000 ? 'var(--warning)' : 'var(--text-primary)'
  return (
    <span className="mono" style={{ color, fontWeight: 500, fontSize: size }}>
      ₹{amount.toLocaleString('en-IN')}
    </span>
  )
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-14 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
      {text}
    </div>
  )
}

export function ErrorBanner({ error, onDismiss }: { error: string; onDismiss?: () => void }) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg text-[12.5px]"
      style={{ background: 'var(--critical-soft)', color: 'var(--critical)' }}
    >
      <span>{error}</span>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="flex-shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

/** Small helper: POST/PATCH/DELETE JSON to a v2 endpoint, throwing `{error}` messages. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function apiCall<T = any>(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`)
  // A successful write can change any cached read — drop the client cache so
  // the next fetch reflects it (the server cache is tag-invalidated too).
  invalidateClientCache()
  return data as T
}
