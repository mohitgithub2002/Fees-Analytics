'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Phone,
  PhoneOff,
  Pin,
  RefreshCw,
} from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner, Field, apiCall, inputCls, inputStyle } from '@/components/v2/ui'
import {
  ArchetypeChip,
  ConfidenceChip,
  CoverageNote,
  EvidenceList,
  StageChip,
  TierChip,
} from '@/components/recovery/chips'
import { OUTCOME_LABEL, TIER_LABEL, type ContactOutcome, type EconomicTier } from '@/lib/recovery/types'
import { fmtAmt, fmtCur, fmtDate } from '@/lib/v2/format'

interface QueueItem {
  caseId: number
  householdId: number
  displayName: string
  archetype: string
  archetypeLabel: string
  carryConfidence: number
  timingConfidence: number
  timingProvenance: string
  tier: string
  tierLabel: string
  suggestedTier: string
  tierNote: string | null
  stage: string
  outstanding: number
  currentSessionDue: number
  pastSessionsDue: number
  expectedRecoveryValue: number
  avgTicket: number
  lastPaymentAt: string | null
  lastPaymentAmount: number
  evidence: string[]
  suppressionRule: string | null
  suppressionReason: string | null
  isPinnedToday: boolean
  lastContactAt: string | null
  contactCount: number
  contactPickRate: number
  promisesMade: number
  promisesKept: number
  openPromise: { id: number; amount: number; promisedFor: string } | null
  contacts: {
    id: number
    name: string | null
    phone: string
    relation: string
    isPrimary: boolean
    verification: string
  }[]
  children: { id: number; name: string; className: string | null; section: string | null }[]
}

interface Worklist {
  session: { id: number; name: string }
  dailyCallTarget: number
  totals: {
    callable: number
    shown: number
    pinned: number
    skipped: number
    needsContactDetails: number
  }
  queue: QueueItem[]
  skipped: { reason: string | null; households: number; outstanding: number }[]
  toFix: QueueItem[]
}

/** The outcomes worth one tap, in the order a call actually tends to end. */
const OUTCOMES: ContactOutcome[] = [
  'PROMISED',
  'PAID_ALREADY',
  'NEEDS_TIME',
  'CALL_BACK_LATER',
  'REFUSED',
  'DISPUTED',
  'NO_ANSWER',
  'SWITCHED_OFF',
  'WRONG_NUMBER',
]

const TIERS: EconomicTier[] = ['AFFLUENT', 'COMFORTABLE', 'STRAINED', 'POOR', 'SEVERE']

export default function WorklistPage() {
  const [data, setData] = useState<Worklist | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showSkipped, setShowSkipped] = useState(false)
  const [showToFix, setShowToFix] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v2/recovery/worklist')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'could not load the call list')
      setData(body.data)
      setSelectedId((current) => {
        if (current && body.data.queue.some((q: QueueItem) => q.householdId === current)) {
          return current
        }
        return body.data.queue[0]?.householdId ?? null
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Deferred rather than called straight from the effect: load() sets state
  // synchronously, which inside an effect triggers a cascading render.
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const selected = useMemo(
    () =>
      data?.queue.find((q) => q.householdId === selectedId) ??
      data?.toFix.find((q) => q.householdId === selectedId) ??
      null,
    [data, selectedId]
  )

  return (
    <>
      <PageHeader
        section="Call List"
        subtitle={
          data
            ? `${data.totals.callable} worth calling · ${data.totals.skipped} skipped today`
            : undefined
        }
      >
        <Button variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </PageHeader>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ── Queue ──────────────────────────────────────────── */}
        <div
          className="w-[340px] flex-shrink-0 flex flex-col min-h-0"
          style={{ borderRight: '1px solid var(--border)' }}
        >
          <div className="flex-1 overflow-y-auto">
            {error && (
              <div className="p-3">
                <ErrorBanner error={error} onDismiss={() => setError('')} />
              </div>
            )}

            {!data || data.queue.length === 0 ? (
              <EmptyState
                text={
                  loading
                    ? 'Loading…'
                    : 'Nobody to call today. Everyone either just paid, already promised, or was called recently.'
                }
              />
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {data.queue.map((item, index) => (
                  <button
                    key={item.householdId}
                    onClick={() => setSelectedId(item.householdId)}
                    className="w-full text-left px-3.5 py-3 transition-colors"
                    style={{
                      background:
                        item.householdId === selectedId ? 'var(--accent-soft)' : 'transparent',
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className="text-[11px] mono mt-0.5 w-5 flex-shrink-0"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {item.isPinnedToday && (
                            <Pin
                              className="w-3 h-3 flex-shrink-0"
                              style={{ color: 'var(--accent)' }}
                            />
                          )}
                          <p
                            className="text-[12.5px] font-medium truncate"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {item.displayName}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <ArchetypeChip archetype={item.archetype} small />
                          {item.tier !== 'UNKNOWN' && <TierChip tier={item.tier} small />}
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span
                            className="text-[11px] mono"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            owes {fmtCur(item.outstanding)}
                          </span>
                          <span
                            className="text-[11.5px] mono font-medium"
                            style={{ color: 'var(--good-2)' }}
                          >
                            {fmtCur(item.expectedRecoveryValue)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* ── Needs a phone number ────────────────────────
                Kept as its own band rather than buried in "skipped",
                because it is work somebody can do, not a wait. */}
            {data && data.totals.needsContactDetails > 0 && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <button
                  onClick={() => setShowToFix((v) => !v)}
                  className="w-full px-3.5 py-2.5 flex items-center gap-2 text-left"
                  style={{ background: 'var(--warning-soft)' }}
                >
                  {showToFix ? (
                    <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--warning)' }} />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--warning)' }} />
                  )}
                  <span className="text-[12px] font-medium" style={{ color: 'var(--warning)' }}>
                    {data.totals.needsContactDetails} need a phone number
                  </span>
                </button>
                {showToFix && (
                  <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {data.toFix.map((item) => (
                      <button
                        key={item.householdId}
                        onClick={() => setSelectedId(item.householdId)}
                        className="w-full text-left px-3.5 py-2.5"
                        style={{
                          background:
                            item.householdId === selectedId ? 'var(--accent-soft)' : 'transparent',
                        }}
                      >
                        <p
                          className="text-[12px] font-medium truncate"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {item.displayName}
                        </p>
                        <span className="text-[11px] mono" style={{ color: 'var(--text-muted)' }}>
                          owes {fmtCur(item.outstanding)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Skipped, with reasons ──────────────────────
                Never silently dropped: the owner overrules the system,
                not the other way round. */}
            {data && data.skipped.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <button
                  onClick={() => setShowSkipped((v) => !v)}
                  className="w-full px-3.5 py-2.5 flex items-center gap-2 text-left"
                >
                  {showSkipped ? (
                    <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  )}
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {data.totals.skipped} skipped today
                  </span>
                </button>
                {showSkipped && (
                  <div className="px-3.5 pb-3 space-y-2">
                    {data.skipped.map((s, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span
                          className="text-[11px] mono flex-shrink-0 w-7 text-right"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {s.households}
                        </span>
                        <span
                          className="text-[11.5px] leading-snug"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {s.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Call card ──────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {selected ? (
            <CallCard key={selected.householdId} item={selected} onDone={load} />
          ) : (
            <EmptyState text="Pick a family from the list." />
          )}
        </div>
      </div>
    </>
  )
}

function CallCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [outcome, setOutcome] = useState<ContactOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [talkedTo, setTalkedTo] = useState('')
  const [promiseAmount, setPromiseAmount] = useState('')
  const [promisedFor, setPromisedFor] = useState('')
  const [tier, setTier] = useState<EconomicTier | ''>('')
  const [contactId, setContactId] = useState<number | null>(item.contacts[0]?.id ?? null)
  const [newPhone, setNewPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const reachable = item.contacts.filter(
    (c) => c.verification !== 'WRONG_NUMBER' && c.verification !== 'UNREACHABLE'
  )

  async function addPhone() {
    if (!newPhone.trim()) return
    setSaving(true)
    setError('')
    try {
      await apiCall(`/api/v2/recovery/households/${item.householdId}/contacts`, 'POST', {
        phone: newPhone,
        isPrimary: item.contacts.length === 0,
      })
      setNewPhone('')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function logCall() {
    if (!outcome) return
    setSaving(true)
    setError('')
    try {
      await apiCall(`/api/v2/recovery/households/${item.householdId}/calls`, 'POST', {
        outcome,
        notes: notes.trim() || undefined,
        talkedTo: talkedTo.trim() || undefined,
        contactId: contactId ?? undefined,
        ...(outcome === 'PROMISED'
          ? { promiseAmount: Number(promiseAmount), promisedFor }
          : {}),
        ...(tier ? { economicTier: tier } : {}),
      })
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  async function caseAction(action: string, extra?: Record<string, unknown>) {
    setSaving(true)
    setError('')
    try {
      await apiCall(`/api/v2/recovery/cases/${item.caseId}`, 'PATCH', { action, ...extra })
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  const canSubmit =
    outcome !== null &&
    (outcome !== 'PROMISED' || (Number(promiseAmount) > 0 && promisedFor !== ''))

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* ── Who ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2
              className="text-[18px] font-semibold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              {item.displayName}
            </h2>
            <Link
              href={`/recovery/parents/${item.householdId}`}
              className="flex items-center gap-1 text-[12px]"
              style={{ color: 'var(--text-muted)' }}
            >
              Full history <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <ArchetypeChip archetype={item.archetype} />
            <TierChip tier={item.tier} />
            <StageChip stage={item.stage} />
            <ConfidenceChip value={Math.max(item.carryConfidence, item.timingConfidence)} />
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[22px] font-semibold mono" style={{ color: 'var(--critical)' }}>
            {fmtAmt(item.outstanding)}
          </p>
          <p className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {item.pastSessionsDue > 0
              ? `${fmtCur(item.pastSessionsDue)} of it from earlier years`
              : 'all from this year'}
          </p>
        </div>
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

      {item.tierNote && <CoverageNote message={item.tierNote} tone="info" />}

      {/* ── Children ────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {item.children.map((c) => (
          <Link
            key={c.id}
            href={`/manage/students/${c.id}`}
            className="px-2.5 py-1.5 rounded-lg text-[12px]"
            style={{ background: 'var(--elevated)', color: 'var(--text-secondary)' }}
          >
            {c.name}
            {c.className && (
              <span style={{ color: 'var(--text-faint)' }}> · {c.className}</span>
            )}
          </Link>
        ))}
      </div>

      {/* ── Why this family, in words ───────────────────────── */}
      <div
        className="rounded-xl p-4"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <p className="label-micro mb-2.5">Why they are on today&apos;s list</p>
        <EvidenceList lines={item.evidence} max={8} />
        <div
          className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 pt-3 text-[11.5px]"
          style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <span>
            Expected from this call:{' '}
            <strong className="mono" style={{ color: 'var(--good-2)' }}>
              {fmtAmt(item.expectedRecoveryValue)}
            </strong>
          </span>
          {item.avgTicket > 0 && <span>Usually pays {fmtAmt(Math.round(item.avgTicket))} at a time</span>}
          {item.lastPaymentAt && <span>Last paid {fmtDate(item.lastPaymentAt)}</span>}
          {item.contactCount > 0 && (
            <span>
              {item.contactCount} calls, answers {Math.round(item.contactPickRate * 100)}%
            </span>
          )}
          {item.promisesMade > 0 && (
            <span>
              Kept {item.promisesKept} of {item.promisesMade} promises
            </span>
          )}
        </div>
      </div>

      {/* ── Numbers to try ──────────────────────────────────── */}
      <div>
        <p className="label-micro mb-2">Phone</p>
        {reachable.length === 0 ? (
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: 'var(--warning-soft)' }}
          >
            <p className="text-[12.5px]" style={{ color: 'var(--warning)' }}>
              No usable number on record — this family cannot be chased until somebody adds one.
            </p>
            <div className="flex gap-2">
              <input
                className={inputCls}
                style={inputStyle}
                placeholder="Phone number"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
              <Button onClick={addPhone} disabled={saving || !newPhone.trim()}>
                Add
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {reachable.map((c) => (
              <button
                key={c.id}
                onClick={() => setContactId(c.id)}
                className="px-3 py-2 rounded-lg text-left transition-colors"
                style={{
                  background: contactId === c.id ? 'var(--accent-soft)' : 'var(--elevated)',
                  border: `1px solid ${contactId === c.id ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-[13px] mono" style={{ color: 'var(--text-primary)' }}>
                    {c.phone}
                  </span>
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  {c.name || c.relation.toLowerCase()}
                  {c.verification === 'VERIFIED' && ' · reached before'}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Log what happened ───────────────────────────────── */}
      <div
        className="rounded-xl p-4 space-y-4"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <p className="label-micro">How did the call go?</p>

        <div className="flex flex-wrap gap-2">
          {OUTCOMES.map((o) => (
            <button
              key={o}
              onClick={() => setOutcome(o)}
              className="px-3 h-8 rounded-lg text-[12px] font-medium transition-colors"
              style={{
                background: outcome === o ? 'var(--accent)' : 'var(--elevated)',
                color: outcome === o ? 'var(--accent-fg)' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              {OUTCOME_LABEL[o]}
            </button>
          ))}
        </div>

        {outcome === 'PROMISED' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="How much did they promise?">
              <input
                className={inputCls}
                style={inputStyle}
                type="number"
                min={1}
                placeholder="5000"
                value={promiseAmount}
                onChange={(e) => setPromiseAmount(e.target.value)}
              />
            </Field>
            <Field label="By when?">
              <input
                className={inputCls}
                style={inputStyle}
                type="date"
                value={promisedFor}
                onChange={(e) => setPromisedFor(e.target.value)}
              />
            </Field>
          </div>
        )}

        {outcome && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Who did you speak to?">
                <input
                  className={inputCls}
                  style={inputStyle}
                  placeholder="Father / mother / name"
                  value={talkedTo}
                  onChange={(e) => setTalkedTo(e.target.value)}
                />
              </Field>
              {/* Tagging ability to pay here is how the second axis actually
                  gets filled in — asking someone to open another screen for it
                  means it never happens. */}
              <Field label="What can they afford?">
                <select
                  className={inputCls}
                  style={inputStyle}
                  value={tier}
                  onChange={(e) => setTier(e.target.value as EconomicTier | '')}
                >
                  <option value="">
                    {item.tier === 'UNKNOWN' ? 'Not assessed — tag it now' : `Keep: ${item.tierLabel}`}
                  </option>
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {TIER_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="What did they say?">
              <textarea
                className="w-full px-3 py-2 rounded-lg text-[13px] outline-none min-h-[72px]"
                style={inputStyle}
                placeholder="Said he will pay after the harvest…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              small
              onClick={() => caseAction('snooze', { days: 14 })}
              disabled={saving}
            >
              Snooze 2 weeks
            </Button>
            <Button
              variant="ghost"
              small
              onClick={() => {
                const reason = window.prompt(
                  'Why park this family? They will stop appearing until you reopen them.'
                )
                if (reason?.trim()) caseAction('park', { reason: reason.trim() })
              }}
              disabled={saving}
            >
              <PhoneOff className="w-3 h-3" />
              Park — cannot pay
            </Button>
          </div>
          <Button onClick={logCall} disabled={!canSubmit || saving}>
            {saving ? 'Saving…' : 'Save and next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
