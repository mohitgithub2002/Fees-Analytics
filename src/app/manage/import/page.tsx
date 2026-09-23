'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner, apiCall, inputCls, inputStyle } from '@/components/v2/ui'
import { CoverageNote, SectionCard, Stat } from '@/components/recovery/chips'
import { ImportWizard, ProblemList } from '@/components/import/ImportWizard'
import { FEES_TEMPLATE, PAYMENTS_TEMPLATE, STUDENTS_TEMPLATE } from '@/lib/import/templates'
import { fmtAmt, fmtCur } from '@/lib/v2/format'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TABS = [
  { key: 'setup', label: 'Setup' },
  { key: 'students', label: '1 · Students & parents' },
  { key: 'fees', label: '2 · Fees' },
  { key: 'payments', label: '3 · Payments' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function ImportPage() {
  const [tab, setTab] = useState<TabKey>('setup')
  const [status, setStatus] = useState<any>(null)
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v2/import/status')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'could not load')
      setStatus(body.data)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(loadStatus, 0)
    return () => clearTimeout(t)
  }, [loadStatus])

  return (
    <>
      <PageHeader
        section="School Data"
        subtitle="Load any school's students, fees and payments — the system works on whatever you put in"
      >
        {status && (
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {status.ready} of {status.total} steps done
          </span>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5 max-w-4xl">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-3 h-8 rounded-lg text-[12.5px] font-medium"
              style={{
                background: tab === t.key ? 'var(--accent)' : 'var(--elevated)',
                color: tab === t.key ? 'var(--accent-fg)' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'setup' && <Setup status={status} onChanged={loadStatus} />}

        {tab === 'students' && (
          <ImportWizard
            template={STUDENTS_TEMPLATE}
            endpoint="/api/v2/import/students"
            extraBody={{ applyFeeStructure: true }}
            onCommitted={loadStatus}
            renderDryRun={(d) => <StudentsDryRun data={d} />}
            renderResult={(d) => <StudentsResult data={d} />}
          />
        )}

        {tab === 'fees' && (
          <ImportWizard
            template={FEES_TEMPLATE}
            endpoint="/api/v2/import/fees"
            onCommitted={loadStatus}
            renderDryRun={(d) => <FeesDryRun data={d} />}
            renderResult={(d) => <FeesResult data={d} />}
          />
        )}

        {tab === 'payments' && (
          <ImportWizard
            template={PAYMENTS_TEMPLATE}
            endpoint="/api/v2/recovery/import/payments"
            onCommitted={loadStatus}
            renderDryRun={(d) => <PaymentsDryRun data={d} />}
            renderResult={(d) => <PaymentsResult data={d} />}
          />
        )}
      </div>
    </>
  )
}

/* ── Setup checklist ─────────────────────────────────────────────
 * Each step says what it BLOCKS, not just that it is missing. "0 phone
 * numbers" means nothing on its own; "349 families cannot be called at all"
 * is a reason to go and fix it. */
function Setup({ status, onChanged }: { status: any; onChanged: () => void }) {
  const [confirm, setConfirm] = useState('')
  const [scope, setScope] = useState<'recovery' | 'school'>('school')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function reset() {
    setBusy(true)
    setError('')
    setDone('')
    try {
      const body = await apiCall<any>('/api/v2/import/reset', 'POST', { scope, confirm })
      setDone(body.data.note)
      setConfirm('')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <EmptyState text="Loading…" />

  return (
    <div className="space-y-5">
      <SectionCard
        title="How to load a school"
        subtitle="Three files, in this order. Each one is checked before anything is saved."
      >
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {status.steps.map((step: any) => (
            <div key={step.key} className="px-4 py-3 flex items-start gap-3">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{
                  background: step.done
                    ? 'var(--good-soft)'
                    : step.blocking
                      ? 'var(--critical-soft)'
                      : 'var(--elevated-2)',
                }}
              >
                {step.done ? (
                  <Check className="w-3 h-3" style={{ color: 'var(--good-2)' }} />
                ) : step.blocking ? (
                  <AlertTriangle className="w-3 h-3" style={{ color: 'var(--critical)' }} />
                ) : (
                  <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>
                  {step.label}
                </p>
                <p
                  className="text-[11.5px] mt-0.5 leading-snug"
                  style={{ color: step.blocking ? 'var(--critical)' : 'var(--text-muted)' }}
                >
                  {step.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Don't have a file?"
        subtitle="Everything can be typed in by hand instead — the uploads are a shortcut, not a requirement"
      >
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          <ManualRow
            href="/manage/students"
            title="Add students one at a time"
            detail="Name, class, parent and contact details."
          />
          <ManualRow
            href="/recovery/households"
            title="Create a parent and attach their children"
            detail="Decide who pays for whom. Siblings under one parent become a single phone call."
          />
          <ManualRow
            href="/manage/setup"
            title="Set class-wise fees and due dates"
            detail="Define the fees once per class and they apply to every student in it."
          />
          <ManualRow
            href="/manage/transactions"
            title="Record a payment"
            detail="Payments recorded here carry a real date automatically."
          />
        </div>
      </SectionCard>

      {/* ── Danger zone ─────────────────────────────────────── */}
      <SectionCard
        title="Start from scratch"
        subtitle="Clear this school's data so a different school's can be loaded"
      >
        <div className="p-4 space-y-3">
          <CoverageNote message="This cannot be undone. Staff logins, classes and academic sessions are always kept." />
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
          {done && (
            <p className="text-[12.5px]" style={{ color: 'var(--good-2)' }}>
              {done}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setScope('recovery')}
              className="px-3 h-8 rounded-lg text-[12px]"
              style={{
                background: scope === 'recovery' ? 'var(--accent)' : 'var(--elevated)',
                color: scope === 'recovery' ? 'var(--accent-fg)' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Families & call history only
            </button>
            <button
              onClick={() => setScope('school')}
              className="px-3 h-8 rounded-lg text-[12px]"
              style={{
                background: scope === 'school' ? 'var(--accent)' : 'var(--elevated)',
                color: scope === 'school' ? 'var(--accent-fg)' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Everything: students, fees and payments
            </button>
          </div>
          <div className="flex gap-2">
            <input
              className={inputCls}
              style={inputStyle}
              placeholder='Type DELETE ALL SCHOOL DATA to confirm'
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <Button
              variant="danger"
              onClick={reset}
              disabled={busy || confirm !== 'DELETE ALL SCHOOL DATA'}
            >
              {busy ? 'Clearing…' : 'Clear data'}
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

function ManualRow({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link href={href} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </p>
      </div>
      <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
    </Link>
  )
}

/* ── Students ────────────────────────────────────────────────── */
function StudentsDryRun({ data }: { data: any }) {
  const c = data.counts
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="New students" value={c.newStudents} tone="good" />
        <Stat label="Existing, to update" value={c.updatedStudents} />
        <Stat label="Families" value={c.families} hint={`${c.multiChildFamilies} with siblings`} />
        <Stat
          label="Families with no phone"
          value={c.withoutPhone}
          tone={c.withoutPhone > 0 ? 'warn' : 'good'}
          hint={c.withoutPhone > 0 ? 'These cannot be called' : 'All reachable'}
        />
      </div>

      {c.newClasses > 0 && (
        <CoverageNote
          tone="info"
          message={`${c.newClasses} class(es) will be created: ${data.newClasses.join(', ')}. Students will be enrolled in ${data.session.name}.`}
        />
      )}

      {data.families?.length > 0 && (
        <div>
          <p className="label-micro mb-2">Siblings that will share one payer</p>
          <div
            className="rounded-lg max-h-56 overflow-y-auto divide-y"
            style={{ background: 'var(--elevated)', borderColor: 'var(--border)' }}
          >
            {data.families.map((f: any, i: number) => (
              <div key={i} className="px-3 py-2 text-[11.5px]">
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {f.label}
                </span>
                <span style={{ color: 'var(--text-muted)' }}> — {f.children.join(', ')}</span>
                {f.phones.length > 0 && (
                  <span className="mono ml-2" style={{ color: 'var(--text-faint)' }}>
                    {f.phones.join(' / ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <ProblemList problems={data.problems} emptyText="Every row is usable." />
    </>
  )
}

function StudentsResult({ data }: { data: any }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat label="Students added" value={data.created.students} tone="good" />
      <Stat label="Enrolled" value={data.created.enrollments} />
      <Stat label="Families created" value={data.created.households} />
      <Stat label="Phone numbers" value={data.created.contacts} />
    </div>
  )
}

/* ── Fees ────────────────────────────────────────────────────── */
function FeesDryRun({ data }: { data: any }) {
  const c = data.counts
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Fees to add" value={c.ready} tone="good" hint={`for ${c.students} students`} />
        <Stat label="Already charged" value={c.alreadyPresent} hint="Skipped — safe to re-run" />
        <Stat label="No matching student" value={c.unmatched} tone={c.unmatched > 0 ? 'warn' : undefined} />
        <Stat label="Unusable rows" value={c.invalid} tone={c.invalid > 0 ? 'warn' : undefined} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total billed" value={fmtCur(data.totals.billed)} />
        <Stat label="Concessions" value={fmtCur(data.totals.discount)} />
        <Stat label="Already collected" value={fmtCur(data.totals.alreadyPaid)} tone="good" />
        <Stat label="Will be owed" value={fmtCur(data.totals.outstanding)} tone="critical" />
      </div>

      {data.bySession?.length > 1 && (
        <CoverageNote
          tone="info"
          message={`Spread across ${data.bySession.length} sessions: ${data.bySession
            .map((s: any) => `${s.session} (${s.rows} fees, ${fmtAmt(Math.round(s.billed))})`)
            .join(', ')}. Bringing in an old year's balance is what lets the system spot families who are perpetually a year behind.`}
        />
      )}

      <ProblemList problems={data.problems} emptyText="Every row is usable." />
    </>
  )
}

function FeesResult({ data }: { data: any }) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Fees added" value={data.created.feeItems} tone="good" />
        <Stat label="Total billed" value={fmtCur(data.totals.billed)} />
        <Stat
          label="Failures"
          value={data.created.failures?.length ?? 0}
          tone={data.created.failures?.length ? 'critical' : undefined}
        />
      </div>
      {data.created.failures?.length > 0 && (
        <ProblemList
          problems={data.created.failures.map((f: any) => ({
            row: f.row,
            name: f.name,
            message: f.error,
          }))}
        />
      )}
    </>
  )
}

/* ── Payments ────────────────────────────────────────────────── */
function PaymentsDryRun({ data }: { data: any }) {
  const c = data.counts
  const mismatched = (data.reconciliation ?? []).filter((r: any) => !r.matches)
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Payments matched" value={c.matched} tone="good" />
        <Stat label="No matching student" value={c.unmatched + c.ambiguous} tone={c.unmatched ? 'warn' : undefined} />
        <Stat label="Unreadable" value={c.invalid} tone={c.invalid ? 'warn' : undefined} />
        <Stat label="Students affected" value={c.students} />
      </div>

      {c.mismatchedStudents > 0 && (
        <CoverageNote
          message={`${c.mismatchedStudents} student(s) have an imported total that does not match what the ledger says they have paid. They will be left untouched — a mismatch usually means a missing or duplicated row, not a ledger error.`}
        />
      )}

      {mismatched.length > 0 && (
        <div>
          <p className="label-micro mb-2">Totals that disagree</p>
          <div
            className="rounded-lg max-h-56 overflow-y-auto divide-y"
            style={{ background: 'var(--elevated)', borderColor: 'var(--border)' }}
          >
            {mismatched.map((r: any) => (
              <div key={r.studentId} className="px-3 py-2 text-[11.5px] flex gap-3">
                <span style={{ color: 'var(--text-secondary)' }}>{r.studentName}</span>
                <span className="ml-auto mono" style={{ color: 'var(--text-muted)' }}>
                  file {fmtAmt(r.imported)} · ledger {fmtAmt(r.recorded)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ProblemList problems={(data.problems ?? []).map((p: any) => ({ row: p.row, name: p.name, message: p.message }))} />
    </>
  )
}

function PaymentsResult({ data }: { data: any }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat label="Payments imported" value={data.committedRows} tone="good" />
      <Stat label="Students updated" value={data.committedStudents} />
      <Stat label="Students skipped" value={data.skippedStudents} />
      <Stat
        label="Failures"
        value={data.failures?.length ?? 0}
        tone={data.failures?.length ? 'critical' : undefined}
      />
    </div>
  )
}
