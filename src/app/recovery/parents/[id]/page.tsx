'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, IndianRupee, Phone, PhoneCall, ShieldAlert, Users,
} from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import {
  apiCall, Button, EmptyState, ErrorBanner, Field, inputCls, inputStyle, Modal,
} from '@/components/v2/ui'
import { ArchetypeChip, StageChip, TierChip } from '@/components/recovery/chips'
import { WhyPanel } from '@/components/recovery/WhyPanel'
import { OutcomeButtons } from '@/components/recovery/OutcomeButtons'
import { PaymentTimeline } from '@/components/recovery/PaymentTimeline'
import { TIER_META, type ContactOutcome, type EconomicTier } from '@/lib/recovery/types'
import type { GuardianDetailResponse } from '@/lib/recovery/api-types'
import { fmtAmt, fmtDate } from '@/lib/v2/format'

const TIER_OPTIONS: EconomicTier[] = ['AFFLUENT', 'COMFORTABLE', 'STRAINED', 'POOR', 'SEVERE']

export default function ParentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const guardianId = parseInt(id)

  const [data, setData] = useState<GuardianDetailResponse | null>(null)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'call' | 'payment' | 'park' | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const load = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    fetch(`/api/v2/recovery/guardians/${guardianId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('guardian not found'))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [guardianId, refreshKey])

  async function logCall(input: {
    outcome: ContactOutcome
    notes?: string
    promiseAmount?: number
    promiseDate?: string
  }) {
    await apiCall(`/api/v2/recovery/guardians/${guardianId}/contacts`, 'POST', input)
    setModal(null)
    load()
  }

  async function setTier(tier: EconomicTier) {
    try {
      await apiCall(`/api/v2/recovery/guardians/${guardianId}`, 'PATCH', { economicTier: tier })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error && !data) {
    return (
      <>
        <PageHeader section="Parent" subtitle="Not found" />
        <main className="flex-1 px-8 py-7"><ErrorBanner error={error} /></main>
      </>
    )
  }
  if (!data) {
    return (
      <>
        <PageHeader section="Parent" subtitle="Loading…" />
        <main className="flex-1 px-8 py-7"><EmptyState text="Loading household…" /></main>
      </>
    )
  }

  const totalDue = data.children.reduce((s, c) => s + c.totalDue, 0)
  const outstanding = data.profile?.totalOutstanding ?? totalDue

  return (
    <>
      <PageHeader
        section={data.name}
        subtitle={<>{data.children.length} {data.children.length === 1 ? 'child' : 'children'} · {fmtAmt(outstanding)} outstanding</>}
      >
        <Link href="/recovery/parents" className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium" style={{ background: 'var(--elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>
        {data.phone && (
          <a href={`tel:${data.phone}`} className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium" style={{ background: 'var(--elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <Phone className="w-3.5 h-3.5" /> {data.phone}
          </a>
        )}
        <Button onClick={() => setModal('call')}><PhoneCall className="w-3.5 h-3.5" /> Log Call</Button>
        <Button onClick={() => setModal('payment')}><IndianRupee className="w-3.5 h-3.5" /> Record Payment</Button>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1100px] space-y-4">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

          {/* ── Profile strip ─────────────────────────────────────── */}
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-3 mb-1">
              {data.profile && (
                <ArchetypeChip archetype={data.profile.archetype} confidence={data.profile.archetypeConfidence} />
              )}
              <TierSelector current={data.economicTier} suggested={data.profile?.suggestedTier ?? 'UNKNOWN'} onChange={setTier} />
              <button
                onClick={() => setModal('park')}
                className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1 rounded-md"
                style={{ background: 'var(--elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              >
                <ShieldAlert className="w-3 h-3" /> Park as hardship
              </button>
            </div>
            {data.profile && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <Stat label="Reliability" value={`${data.profile.reliabilityScore}/100`} />
                <Stat label="Propensity (30d)" value={`${data.profile.propensityScore}/100`} />
                <Stat label="Sessions Tracked" value={String(data.profile.sessionsTracked)} />
                <Stat label="Promises Kept" value={`${data.profile.promisesKept}/${data.profile.promisesMade}`} />
              </div>
            )}
          </div>

          {data.profile?.evidence && data.profile.evidence.length > 0 && (
            <WhyPanel title="Behaviour evidence" evidence={data.profile.evidence} />
          )}

          {/* ── Children & dues ────────────────────────────────────── */}
          <div className="card overflow-hidden">
            <div className="px-5 h-12 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <Users className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Children</h3>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {data.children.map((child) => (
                <div key={child.id} className="px-5 py-3.5 flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{child.name}</p>
                    <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {child.enrollments.filter((e) => e.session.isCurrent).map((e) => `Class ${e.class}${e.section !== 'A' ? ` · ${e.section}` : ''}`).join(', ') || 'No current enrollment'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="mono text-[13px] font-medium" style={{ color: child.totalDue > 0 ? 'var(--critical)' : 'var(--good-2)' }}>
                      {fmtAmt(child.totalDue)}
                    </span>
                    <Link href={`/manage/students/${child.id}`} className="text-[11.5px] font-medium px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                      Manage fees
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Payment timeline ───────────────────────────────────── */}
          <div className="card p-5">
            <h3 className="text-[13px] font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Payment Timeline</h3>
            <PaymentTimeline entries={data.timeline} />
          </div>

          {/* ── Contacts & promises ────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card overflow-hidden">
              <div className="px-5 h-12 flex items-center" style={{ borderBottom: '1px solid var(--border)' }}>
                <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Contact History</h3>
              </div>
              {data.contacts.length === 0 ? (
                <EmptyState text="No calls logged yet." />
              ) : (
                <div className="divide-y max-h-80 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                  {data.contacts.map((c) => (
                    <div key={c.id} className="px-5 py-3" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>{c.outcomeLabel}</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtDate(c.contactedAt)}</span>
                      </div>
                      {c.notes && <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-secondary)' }}>{c.notes}</p>}
                      {c.loggedByName && <p className="text-[10.5px] mt-1" style={{ color: 'var(--text-faint)' }}>by {c.loggedByName}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card overflow-hidden">
              <div className="px-5 h-12 flex items-center" style={{ borderBottom: '1px solid var(--border)' }}>
                <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>Promise History</h3>
              </div>
              {data.promises.length === 0 ? (
                <EmptyState text="No promises recorded yet." />
              ) : (
                <div className="divide-y max-h-80 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
                  {data.promises.map((p) => (
                    <div key={p.id} className="px-5 py-3 flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                      <div>
                        <span className="mono text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>{fmtAmt(p.amount)}</span>
                        <span className="text-[11.5px] ml-2" style={{ color: 'var(--text-muted)' }}>by {fmtDate(p.promisedFor)}</span>
                      </div>
                      <StageChip stage={p.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Modal open={modal === 'call'} onClose={() => setModal(null)} title="Log Call" subtitle={data.name}>
        <OutcomeButtons maxAmount={outstanding} onSubmit={logCall} />
      </Modal>

      <RecordPaymentModal
        open={modal === 'payment'}
        onClose={() => setModal(null)}
        kids={data.children}
        onDone={() => { setModal(null); load() }}
      />

      <ParkModal
        open={modal === 'park'}
        onClose={() => setModal(null)}
        onSubmit={async (reason) => {
          await apiCall(`/api/v2/recovery/guardians/${guardianId}/park`, 'POST', { reason })
          setModal(null)
          load()
        }}
      />
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--elevated)' }}>
      <p className="label-micro mb-1">{label}</p>
      <p className="mono text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function TierSelector({
  current, suggested, onChange,
}: {
  current: EconomicTier
  suggested: EconomicTier
  onChange: (tier: EconomicTier) => void
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <select
        autoFocus
        className={inputCls}
        style={{ ...inputStyle, width: 200 }}
        defaultValue={current !== 'UNKNOWN' ? current : suggested}
        onChange={(e) => { onChange(e.target.value as EconomicTier); setEditing(false) }}
        onBlur={() => setEditing(false)}
      >
        {TIER_OPTIONS.map((t) => <option key={t} value={t}>{TIER_META[t].label}</option>)}
      </select>
    )
  }
  return (
    <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5">
      <TierChip tier={current !== 'UNKNOWN' ? current : suggested} suggested={current === 'UNKNOWN'} />
      <span className="text-[11px] underline" style={{ color: 'var(--text-muted)' }}>
        {current === 'UNKNOWN' ? 'confirm' : 'change'}
      </span>
    </button>
  )
}

function ParkModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onClose} title="Park as Hardship" subtitle="Stops this household appearing on the daily call list.">
      <div className="space-y-3.5">
        <Field label="Reason">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-none"
            style={{ ...inputStyle, height: 80 }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. father lost his job in June, family confirmed genuine hardship — revisit next term"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!reason.trim() || busy}
            onClick={async () => { setBusy(true); await onSubmit(reason.trim()); setBusy(false) }}
          >
            {busy ? 'Parking…' : 'Park Household'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function RecordPaymentModal({
  open, onClose, kids, onDone,
}: {
  open: boolean
  onClose: () => void
  kids: GuardianDetailResponse['children']
  onDone: () => void
}) {
  // Null means "nothing picked yet" — the first child is then used as the
  // default. Derived rather than synced into state by an effect, so opening
  // the modal doesn't cost an extra render pass.
  const [picked, setPicked] = useState<string | null>(null)
  const studentId = picked ?? (kids.length > 0 ? String(kids[0].id) : '')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await apiCall('/api/v2/transactions', 'POST', { studentId: parseInt(studentId), amount: parseFloat(amount) })
      setAmount('')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record Payment">
      <div className="space-y-3.5">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
        <Field label="Child">
          <select className={inputCls} style={inputStyle} value={studentId} onChange={(e) => setPicked(e.target.value)}>
            {kids.map((c) => (
              <option key={c.id} value={c.id}>{c.name} — {fmtAmt(c.totalDue)} due</option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <input type="number" min={1} className={`${inputCls} mono`} style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <p className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          Settles past-session dues first, then the current session&apos;s school fees. For a bus- or other-fee-specific payment, use the child&apos;s own fee page.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !studentId || !amount || parseFloat(amount) <= 0}>
            {busy ? 'Saving…' : 'Record Payment'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
