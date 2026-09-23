'use client'

import { useCallback, useEffect, useState } from 'react'
import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Phone, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner, apiCall, inputCls, inputStyle } from '@/components/v2/ui'
import {
  ArchetypeChip,
  ConfidenceChip,
  CoverageNote,
  EvidenceList,
  SectionCard,
  StageChip,
  Stat,
  TierChip,
} from '@/components/recovery/chips'
import {
  OUTCOME_LABEL,
  TIER_LABEL,
  type ContactOutcome,
  type EconomicTier,
} from '@/lib/recovery/types'
import { isUndatedReceipt } from '@/lib/recovery/provenance'
import { fmtAmt, fmtCur, fmtDate } from '@/lib/v2/format'

const TIERS: EconomicTier[] = ['AFFLUENT', 'COMFORTABLE', 'STRAINED', 'POOR', 'SEVERE', 'UNKNOWN']

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function ParentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [newPhone, setNewPhone] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v2/recovery/households/${id}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'could not load this family')
      setData(body.data)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])

  // Deferred rather than called straight from the effect, to avoid a
  // cascading render from setting state synchronously inside one.
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  async function setTier(tier: EconomicTier) {
    setSaving(true)
    try {
      await apiCall(`/api/v2/recovery/households/${id}`, 'PATCH', { economicTier: tier })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function addPhone() {
    if (!newPhone.trim()) return
    setSaving(true)
    try {
      await apiCall(`/api/v2/recovery/households/${id}/contacts`, 'POST', { phone: newPhone })
      setNewPhone('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function removePhone(contactId: number) {
    setSaving(true)
    try {
      await apiCall(`/api/v2/recovery/households/${id}/contacts/${contactId}`, 'DELETE')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!data) {
    return (
      <>
        <PageHeader section="Family" />
        <div className="flex-1 p-8">
          {error ? <ErrorBanner error={error} /> : <EmptyState text="Loading…" />}
        </div>
      </>
    )
  }

  const { household, profile, children, payments, promises } = data
  const contactLog = data.contacts ?? []
  const recoveryCase = data.case
  const phones = recoveryCase?.contacts ?? []

  return (
    <>
      <PageHeader section={household.displayName} subtitle={`${data.session.name} · family record`}>
        <Link href="/recovery/worklist">
          <Button variant="ghost">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to call list
          </Button>
        </Link>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5 max-w-5xl">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

        {/* ── Headline ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {profile && <ArchetypeChip archetype={profile.archetype} />}
          <TierChip tier={household.tier} />
          {recoveryCase && <StageChip stage={recoveryCase.stage} />}
          {profile && (
            <ConfidenceChip value={Math.max(profile.carryConfidence, profile.timingConfidence)} />
          )}
        </div>

        {profile?.historyCaveat && <CoverageNote message={profile.historyCaveat} />}
        {household.tierNote && <CoverageNote message={household.tierNote} tone="info" />}
        {profile?.timingProvenance !== 'REAL' && (
          <CoverageNote message={profile?.timingProvenanceLabel ?? null} />
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Owes now" value={fmtAmt(profile?.totalOutstanding ?? 0)} tone="critical" />
          <Stat
            label="From earlier years"
            value={fmtAmt(profile?.pastSessionsDue ?? 0)}
            hint={profile?.sessionsWithOpenDues > 1 ? `Open in ${profile.sessionsWithOpenDues} years` : undefined}
          />
          <Stat
            label="Paid this year"
            value={`${Math.round((profile?.currentPaidRatio ?? 0) * 100)}%`}
            hint={`${fmtAmt(profile?.lifetimePaid ?? 0)} paid in total`}
          />
          <Stat
            label="Realistically recoverable"
            value={fmtAmt(recoveryCase?.expectedRecoveryValue ?? 0)}
            tone="good"
            hint={profile?.avgTicket > 0 ? `Usually pays ${fmtAmt(Math.round(profile.avgTicket))} at a time` : undefined}
          />
        </div>

        {/* ── Why ──────────────────────────────────────────── */}
        {recoveryCase?.evidence?.length > 0 && (
          <SectionCard
            title="What the system thinks, and why"
            subtitle="Every line is a rule that fired — disagree with any of them and overrule it"
          >
            <div className="p-4">
              <EvidenceList lines={recoveryCase.evidence} />
              {recoveryCase.suppressionReason && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    <strong style={{ color: 'var(--warning)' }}>Not on today&apos;s list:</strong>{' '}
                    {recoveryCase.suppressionReason}
                  </p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* ── Ability to pay ───────────────────────────────── */}
        <SectionCard
          title="What can this family afford?"
          subtitle={
            household.tierSetByName
              ? `Set by ${household.tierSetByName} on ${fmtDate(household.tierSetAt)}`
              : 'Not assessed yet — this is half the targeting and only a person can supply it'
          }
        >
          <div className="p-4 flex flex-wrap gap-2">
            {TIERS.map((t) => (
              <button
                key={t}
                onClick={() => setTier(t)}
                disabled={saving}
                className="px-3 h-8 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-40"
                style={{
                  background: household.tier === t ? 'var(--accent)' : 'var(--elevated)',
                  color: household.tier === t ? 'var(--accent-fg)' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}
              >
                {TIER_LABEL[t]}
              </button>
            ))}
          </div>
        </SectionCard>

        {/* ── Phones ───────────────────────────────────────── */}
        <SectionCard title="Phone numbers" subtitle="A family with no number cannot be chased at all">
          <div className="p-4 space-y-3">
            {phones.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: 'var(--warning)' }}>
                No number on record.
              </p>
            ) : (
              <div className="space-y-2">
                {phones.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <Phone className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    <span className="mono text-[13px]" style={{ color: 'var(--text-primary)' }}>
                      {c.phone}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      {c.name || c.relation.toLowerCase()}
                      {c.isPrimary && ' · main'}
                      {c.verification === 'VERIFIED' && ' · reached before'}
                      {c.verification === 'WRONG_NUMBER' && ' · wrong number'}
                    </span>
                    <button
                      onClick={() => removePhone(c.id)}
                      disabled={saving}
                      className="ml-auto"
                      aria-label="Remove number"
                    >
                      <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <input
                className={inputCls}
                style={inputStyle}
                placeholder="Add a phone number"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
              <Button onClick={addPhone} disabled={saving || !newPhone.trim()}>
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>
          </div>
        </SectionCard>

        {/* ── Children ─────────────────────────────────────── */}
        <SectionCard title="Children" subtitle={`${children.length} in this family`}>
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {children.map((child: any) => (
              <div key={child.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <Link
                    href={`/manage/students/${child.id}`}
                    className="text-[13px] font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {child.name}
                  </Link>
                  <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {child.linkSource === 'csv:siblings'
                      ? 'linked from school records'
                      : child.linkSource === 'manual'
                        ? 'linked by hand'
                        : child.linkSource}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {child.enrollments.map((e: any) => (
                    <div key={e.id} className="flex items-center gap-3 text-[11.5px]">
                      <span style={{ color: 'var(--text-muted)' }}>
                        {e.session.name} · {e.className}
                      </span>
                      <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                        billed {fmtCur(e.billed)}
                      </span>
                      <span className="mono" style={{ color: 'var(--good-2)' }}>
                        paid {fmtCur(e.paid)}
                      </span>
                      {e.due > 0 && (
                        <span className="mono" style={{ color: 'var(--critical)' }}>
                          owes {fmtCur(e.due)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ── Promises ─────────────────────────────────────── */}
        {promises.length > 0 && (
          <SectionCard
            title="Promises"
            subtitle="Settled automatically from recorded payments — nobody ticks a box"
          >
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {promises.map((p: any) => (
                <div key={p.id} className="px-4 py-2.5 flex items-center gap-3 text-[12.5px]">
                  <span className="mono font-medium" style={{ color: 'var(--text-primary)' }}>
                    {fmtAmt(Number(p.amount))}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>by {fmtDate(p.promisedFor)}</span>
                  <span
                    className="ml-auto text-[11.5px]"
                    style={{
                      color:
                        p.status === 'KEPT'
                          ? 'var(--good-2)'
                          : p.status === 'BROKEN'
                            ? 'var(--critical)'
                            : 'var(--text-muted)',
                    }}
                  >
                    {p.status === 'OPEN'
                      ? 'waiting'
                      : p.status === 'KEPT'
                        ? 'kept'
                        : p.status === 'PARTIAL'
                          ? `part paid (${fmtAmt(Number(p.settledAmount ?? 0))})`
                          : p.status.toLowerCase()}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── Call history ─────────────────────────────────── */}
        <SectionCard title="Call history" subtitle={`${contactLog.length} conversations logged`}>
          {contactLog.length === 0 ? (
            <EmptyState text="Nobody has called this family yet." />
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {contactLog.map((c: any) => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      {OUTCOME_LABEL[c.outcome as ContactOutcome] ?? c.outcome}
                    </span>
                    <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                      {fmtDate(c.contactedAt)}
                      {c.talkedTo && ` · spoke to ${c.talkedTo}`}
                      {c.loggedByName && ` · logged by ${c.loggedByName}`}
                    </span>
                  </div>
                  {c.notes && (
                    <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {c.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── Payments ─────────────────────────────────────── */}
        <SectionCard title="Payment history" subtitle={`${payments.length} payments recorded`}>
          {payments.length === 0 ? (
            <EmptyState text="No payments recorded." />
          ) : (
            <div className="divide-y max-h-[420px] overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
              {payments.map((p: any) => (
                <div key={p.id} className="px-4 py-2.5 flex items-center gap-3 text-[12.5px]">
                  <span className="mono font-medium w-24" style={{ color: 'var(--good-2)' }}>
                    {fmtAmt(Number(p.amount))}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{p.student.name}</span>
                  <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    {p.mode.toLowerCase().replace('_', ' ')}
                  </span>
                  <span className="ml-auto text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    {/* Migrated and opening-balance rows carry no real payment
                        date — saying so is better than showing a wrong one. */}
                    {isUndatedReceipt(p.receiptNo) ? 'date not recorded' : fmtDate(p.paidAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  )
}
