'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, BadgePercent, IndianRupee, Pencil, Plus, Trash2, Undo2,
} from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import {
  apiCall, Button, CategoryChip, DueAmount, EmptyState, ErrorBanner, Field,
  inputCls, inputStyle, Modal, StatusChip,
} from '@/components/v2/ui'
import { fmtAmt, fmtDate } from '@/lib/v2/format'
import type { DuesV2, EnrollmentV2, FeeCategory, FeeItemV2, StudentV2 } from '@/lib/v2/types'

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const studentId = parseInt(id)

  const [student, setStudent] = useState<StudentV2 | null>(null)
  const [dues, setDues] = useState<DuesV2 | null>(null)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<
    | { kind: 'payment' }
    | { kind: 'discount'; item: FeeItemV2 }
    | { kind: 'amount'; item: FeeItemV2 }
    | { kind: 'addFee'; enrollment: EnrollmentV2 }
    | null
  >(null)

  const [refreshKey, setRefreshKey] = useState(0)
  const load = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`/api/v2/students/${studentId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/v2/students/${studentId}/dues`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([s, d]) => {
        if (!alive) return
        if (s) setStudent(s)
        if (d) setDues(d)
      })
      .catch(console.error)
    return () => { alive = false }
  }, [studentId, refreshKey])

  async function removeFee(item: FeeItemV2) {
    if (!confirm(`Remove "${item.name}" (₹${item.netAmount.toLocaleString('en-IN')})?`)) return
    try {
      await apiCall(`/api/v2/fee-items/${item.id}`, 'DELETE')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function cancelTxn(txnId: number, receiptNo: string) {
    if (!confirm(`Cancel transaction ${receiptNo}? Its payments will be reversed.`)) return
    try {
      await apiCall(`/api/v2/transactions/${txnId}`, 'DELETE')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!student) {
    return (
      <>
        <PageHeader section="Student" subtitle="Loading…" />
        <main className="flex-1 px-8 py-7"><EmptyState text="Loading student…" /></main>
      </>
    )
  }

  return (
    <>
      <PageHeader
        section={student.name}
        subtitle={<>S/o {student.fatherName}{student.admissionNo ? <> · Adm. <span className="mono">{student.admissionNo}</span></> : null}</>}
      >
        <Link
          href="/manage/students"
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium"
          style={{ background: 'var(--elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>
        <Button onClick={() => setModal({ kind: 'payment' })}>
          <IndianRupee className="w-3.5 h-3.5" /> Record Payment
        </Button>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1100px] space-y-4">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

          {/* Dues summary */}
          {dues && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Outstanding', value: dues.totalDue, color: dues.totalDue > 0 ? 'var(--critical)' : 'var(--good-2)' },
                { label: 'Past Sessions Due', value: dues.pastSessionsDue, color: dues.pastSessionsDue > 0 ? 'var(--warning)' : 'var(--good-2)' },
                ...(['SCHOOL', 'BUS'] as FeeCategory[]).map((c) => ({
                  label: `${c === 'SCHOOL' ? 'School' : 'Bus'} Due (current)`,
                  value: dues.bySession.find((s) => s.session.isCurrent)?.dueByCategory[c] ?? 0,
                  color: 'var(--text-primary)',
                })),
              ].map((c) => (
                <div key={c.label} className="card p-4">
                  <p className="label-micro mb-1.5">{c.label}</p>
                  <p className="mono text-[20px] font-semibold tracking-tight" style={{ color: c.color }}>
                    {fmtAmt(c.value)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Enrollments with fee items */}
          {student.enrollments.map((enr) => (
            <div key={enr.id} className="card overflow-hidden">
              <div className="px-5 h-14 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2.5">
                  <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    {enr.session.name} · Class {enr.classroom.class.name}
                    {enr.classroom.section !== 'A' ? ` (${enr.classroom.section})` : ''}
                  </h3>
                  {enr.session.isCurrent && (
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: 'var(--good-soft)', color: 'var(--good-2)' }}>
                      Current
                    </span>
                  )}
                  <StatusChip status={enr.status} />
                </div>
                <Button variant="ghost" small onClick={() => setModal({ kind: 'addFee', enrollment: enr })}>
                  <Plus className="w-3.5 h-3.5" /> Add Fee
                </Button>
              </div>

              {enr.feeItems.length === 0 && <EmptyState text="No fees assigned for this session yet." />}

              {enr.feeItems.map((item) => (
                <div key={item.id} className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                    <div className="flex items-center gap-2.5">
                      <CategoryChip category={item.category} />
                      <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                      {item.discountAmount > 0 && (
                        <span className="text-[11.5px]" style={{ color: 'var(--data-4)' }}>
                          −{fmtAmt(item.discountAmount)} discount
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" small onClick={() => setModal({ kind: 'discount', item })}>
                        <BadgePercent className="w-3.5 h-3.5" /> Discount
                      </Button>
                      <Button variant="ghost" small onClick={() => setModal({ kind: 'amount', item })}>
                        <Pencil className="w-3.5 h-3.5" /> Amount
                      </Button>
                      {item.paidAmount === 0 && (
                        <Button variant="danger" small onClick={() => removeFee(item)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
                          {['Installment', 'Due Date', 'Amount', 'Discount', 'Net', 'Paid', 'Due', 'Status'].map((h, i) => (
                            <th key={h} className={`px-3 py-2 label-micro font-medium ${i < 2 ? 'text-left' : i === 7 ? 'text-center' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {item.installments.map((inst) => (
                          <tr key={inst.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{inst.label}</td>
                            <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{fmtDate(inst.dueDate)}</td>
                            <td className="px-3 py-2 text-right mono" style={{ color: 'var(--text-secondary)' }}>{fmtAmt(inst.originalAmount)}</td>
                            <td className="px-3 py-2 text-right mono" style={{ color: inst.discountAmount ? 'var(--data-4)' : 'var(--text-faint)' }}>
                              {inst.discountAmount ? `−${fmtAmt(inst.discountAmount)}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right mono" style={{ color: 'var(--text-secondary)' }}>{fmtAmt(inst.netAmount)}</td>
                            <td className="px-3 py-2 text-right mono" style={{ color: 'var(--good-2)' }}>{fmtAmt(inst.paidAmount)}</td>
                            <td className="px-3 py-2 text-right"><DueAmount amount={inst.netAmount - inst.paidAmount} size={12} /></td>
                            <td className="px-3 py-2 text-center"><StatusChip status={inst.status} /></td>
                          </tr>
                        ))}
                        <tr style={{ background: 'var(--elevated)' }}>
                          <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }} colSpan={2}>Total</td>
                          <td className="px-3 py-2 text-right mono font-medium" style={{ color: 'var(--text-primary)' }}>{fmtAmt(item.originalAmount)}</td>
                          <td className="px-3 py-2 text-right mono" style={{ color: item.discountAmount ? 'var(--data-4)' : 'var(--text-faint)' }}>
                            {item.discountAmount ? `−${fmtAmt(item.discountAmount)}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right mono font-medium" style={{ color: 'var(--text-primary)' }}>{fmtAmt(item.netAmount)}</td>
                          <td className="px-3 py-2 text-right mono font-medium" style={{ color: 'var(--good-2)' }}>{fmtAmt(item.paidAmount)}</td>
                          <td className="px-3 py-2 text-right"><DueAmount amount={item.dueAmount} size={12} /></td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Recent transactions */}
          <div className="card overflow-hidden">
            <div className="px-5 h-14 flex items-center" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Recent Transactions
              </h3>
            </div>
            {(!student.transactions || student.transactions.length === 0) && (
              <EmptyState text="No payments recorded yet." />
            )}
            {student.transactions && student.transactions.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Receipt', 'Date', 'Type', 'Mode', 'Amount', 'Status', ''].map((h, i) => (
                        <th key={i} className={`px-4 py-3 label-micro font-medium ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {student.transactions.map((t) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="px-4 py-3 mono" style={{ color: 'var(--text-primary)' }}>{t.receiptNo}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{fmtDate(t.paidAt)}</td>
                        <td className="px-4 py-3">{t.category ? <CategoryChip category={t.category} /> : <span style={{ color: 'var(--text-muted)' }}>General</span>}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{t.mode}</td>
                        <td className="px-4 py-3 text-right mono font-medium" style={{ color: t.status === 'CANCELLED' ? 'var(--text-faint)' : 'var(--good-2)', textDecoration: t.status === 'CANCELLED' ? 'line-through' : undefined }}>
                          {fmtAmt(t.amount)}
                        </td>
                        <td className="px-4 py-3"><StatusChip status={t.status === 'COMPLETED' ? 'PAID' : t.status} /></td>
                        <td className="px-4 py-3 text-right">
                          {t.status === 'COMPLETED' && (
                            <Button variant="danger" small onClick={() => cancelTxn(t.id, t.receiptNo)}>
                              <Undo2 className="w-3.5 h-3.5" /> Cancel
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modals */}
      {dues && (
        <PaymentModal
          open={modal?.kind === 'payment'}
          onClose={() => setModal(null)}
          studentId={studentId}
          dues={dues}
          onDone={() => { setModal(null); load() }}
        />
      )}
      {modal?.kind === 'discount' && (
        <DiscountModal item={modal.item} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />
      )}
      {modal?.kind === 'amount' && (
        <AmountModal item={modal.item} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />
      )}
      {modal?.kind === 'addFee' && (
        <AddFeeModal enrollment={modal.enrollment} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />
      )}
    </>
  )
}

/* ── Record Payment ─────────────────────────────────────────────── */

function PaymentModal({
  open, onClose, studentId, dues, onDone,
}: {
  open: boolean
  onClose: () => void
  studentId: number
  dues: DuesV2
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<'GENERAL' | FeeCategory>('GENERAL')
  const [mode, setMode] = useState('CASH')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Mirror the server's allocation scope so the cashier sees the payable cap.
  const current = dues.bySession.find((s) => s.session.isCurrent)
  const capacity =
    category === 'BUS' || category === 'OTHER'
      ? dues.bySession.reduce((sum, s) => sum + s.dueByCategory[category], 0)
      : dues.pastSessionsDue + (current?.dueByCategory.SCHOOL ?? 0)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await apiCall('/api/v2/transactions', 'POST', {
        studentId,
        amount: parseFloat(amount),
        category: category === 'GENERAL' ? null : category,
        mode,
        remarks: remarks || undefined,
      })
      setAmount(''); setRemarks('')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record Payment"
      subtitle="Past-session dues are settled first for school/general payments; bus and other payments go to their own installments."
    >
      <div className="space-y-3.5">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fee Type">
            <select className={inputCls} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value as 'GENERAL' | FeeCategory)}>
              <option value="GENERAL">General (past dues + school)</option>
              <option value="SCHOOL">School Fees</option>
              <option value="BUS">Bus Fees</option>
              <option value="OTHER">Other Fees</option>
            </select>
          </Field>
          <Field label="Mode">
            <select className={inputCls} style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value)}>
              {['CASH', 'ONLINE', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'OTHER'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        <Field label={`Amount — payable up to ₹${capacity.toLocaleString('en-IN')}`}>
          <input
            type="number" min={1} className={`${inputCls} mono`} style={inputStyle}
            value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
          />
        </Field>
        <Field label="Remarks (optional)">
          <input className={inputCls} style={inputStyle} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !(parseFloat(amount) > 0)}>
            {busy ? 'Recording…' : 'Record Payment'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Apply Discount ─────────────────────────────────────────────── */

function DiscountModal({
  item, onClose, onDone,
}: { item: FeeItemV2; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const unpaid = item.netAmount - item.paidAmount

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await apiCall(`/api/v2/fee-items/${item.id}/discount`, 'POST', {
        amount: parseFloat(amount),
        reason: reason || undefined,
      })
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open onClose={onClose}
      title={`Discount · ${item.name}`}
      subtitle="Reduces unpaid installments only (last first). Paid installments are never changed."
    >
      <div className="space-y-3.5">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
        <Field label={`Discount amount — up to ₹${unpaid.toLocaleString('en-IN')} unpaid`}>
          <input type="number" min={1} className={`${inputCls} mono`} style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Reason (optional)">
          <input className={inputCls} style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sibling discount" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !(parseFloat(amount) > 0)}>
            {busy ? 'Applying…' : 'Apply Discount'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Change Fee Amount ──────────────────────────────────────────── */

function AmountModal({
  item, onClose, onDone,
}: { item: FeeItemV2; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(item.originalAmount))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await apiCall(`/api/v2/fee-items/${item.id}`, 'PATCH', { amount: parseFloat(amount) })
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open onClose={onClose}
      title={`Change Amount · ${item.name}`}
      subtitle="Increases extend the last installment; decreases reduce unpaid balances only."
    >
      <div className="space-y-3.5">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
        <Field label={`New fee amount (currently ₹${item.originalAmount.toLocaleString('en-IN')}, ₹${item.paidAmount.toLocaleString('en-IN')} paid)`}>
          <input type="number" min={1} className={`${inputCls} mono`} style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !(parseFloat(amount) > 0)}>
            {busy ? 'Saving…' : 'Update Amount'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Add Fee ────────────────────────────────────────────────────── */

function AddFeeModal({
  enrollment, onClose, onDone,
}: { enrollment: EnrollmentV2; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState<FeeCategory>('OTHER')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [installments, setInstallments] = useState('1')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(fromStructure = false) {
    setError('')
    setBusy(true)
    try {
      await apiCall(
        `/api/v2/enrollments/${enrollment.id}/fees`,
        'POST',
        fromStructure
          ? { fromStructure: true }
          : { category, name, amount: parseFloat(amount), installments: parseInt(installments) || 1 }
      )
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open onClose={onClose}
      title={`Add Fee · ${enrollment.session.name}`}
      subtitle="Add a custom fee, or copy any missing items from the class fee structure."
    >
      <div className="space-y-3.5">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inputCls} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value as FeeCategory)}>
              <option value="SCHOOL">School</option>
              <option value="BUS">Bus</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Installments">
            <input type="number" min={1} max={12} className={`${inputCls} mono`} style={inputStyle} value={installments} onChange={(e) => setInstallments(e.target.value)} />
          </Field>
        </div>
        <Field label="Fee Name">
          <input className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Exam Fees" />
        </Field>
        <Field label="Amount">
          <input type="number" min={1} className={`${inputCls} mono`} style={inputStyle} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <div className="flex justify-between gap-2 pt-1">
          <Button variant="ghost" onClick={() => submit(true)} disabled={busy}>
            Copy from Structure
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => submit(false)} disabled={busy || !name.trim() || !(parseFloat(amount) > 0)}>
              {busy ? 'Adding…' : 'Add Fee'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
