'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileUp, Loader2, PlayCircle, Upload } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner, inputCls, inputStyle } from '@/components/v2/ui'
import { fmtAmt } from '@/lib/v2/format'
import { parseCsv } from '@/lib/recovery/csv'

type FieldKey = 'studentId' | 'admissionNo' | 'studentName' | 'fatherName' | 'amount' | 'paidAt' | 'mode' | 'reference' | 'category'

const FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: 'studentName', label: 'Student Name' },
  { key: 'fatherName', label: "Father's Name" },
  { key: 'admissionNo', label: 'Admission No' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'paidAt', label: 'Payment Date', required: true },
  { key: 'mode', label: 'Mode' },
  { key: 'reference', label: 'Reference' },
  { key: 'category', label: 'Category (SCHOOL/BUS/OTHER)' },
]

interface StudentSummary {
  studentId: number
  studentLabel: string
  rows: number
  importTotal: number
  recordedTotal: number
  mismatch: boolean
  committed?: boolean
  error?: string
}
interface ImportReport {
  dryRun: boolean
  totals: Record<string, number>
  students: StudentSummary[]
  unmatched: { index: number }[]
  ambiguous: { index: number; candidates: number[] }[]
  invalid: { index: number; reason: string }[]
}

export default function ImportPage() {
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [allowAdjust, setAllowAdjust] = useState(false)
  const [busy, setBusy] = useState<'dryrun' | 'commit' | null>(null)
  const [error, setError] = useState('')

  function onFile(file: File) {
    setFileName(file.name)
    setReport(null)
    const reader = new FileReader()
    reader.onload = () => {
      const { headers: h, rows } = parseCsv(String(reader.result))
      setHeaders(h)
      setCsvRows(rows)
      // Best-effort auto-map by header name.
      const auto: Record<FieldKey, string> = {} as Record<FieldKey, string>
      for (const f of FIELDS) {
        const match = h.find((col) => col.toLowerCase().replace(/[^a-z]/g, '').includes(f.key.toLowerCase().replace(/[^a-z]/g, '')))
        if (match) auto[f.key] = match
      }
      setMapping(auto)
    }
    reader.readAsText(file)
  }

  const rowsForApi = useMemo(() => {
    if (headers.length === 0) return []
    const colIndex = (col: string) => headers.indexOf(col)
    return csvRows.map((r) => {
      const get = (key: FieldKey) => {
        const col = mapping[key]
        if (!col) return undefined
        const idx = colIndex(col)
        return idx >= 0 ? r[idx]?.trim() : undefined
      }
      const amountRaw = get('amount')
      const studentIdRaw = get('studentId')
      return {
        studentId: studentIdRaw ? parseInt(studentIdRaw) : undefined,
        admissionNo: get('admissionNo') || undefined,
        studentName: get('studentName') || undefined,
        fatherName: get('fatherName') || undefined,
        amount: amountRaw ? parseFloat(amountRaw) : undefined,
        paidAt: get('paidAt') || undefined,
        mode: get('mode')?.toUpperCase() || undefined,
        reference: get('reference') || undefined,
        category: get('category')?.toUpperCase() || undefined,
      }
    })
  }, [csvRows, headers, mapping])

  const canRun = mapping.amount && mapping.paidAt && (mapping.studentId || mapping.admissionNo || (mapping.studentName && mapping.fatherName))

  async function run(commit: boolean) {
    setBusy(commit ? 'commit' : 'dryrun')
    setError('')
    try {
      const res = await fetch('/api/v2/recovery/import/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rowsForApi, commit, allowAdjust }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'import failed')
      setReport(body)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader section="Import Data" subtitle="Replace estimated payment timing with real payment history" />

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1100px] space-y-5">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

          <div className="card p-6">
            <h3 className="text-[14px] font-semibold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>1. Upload CSV</h3>
            <p className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>
              Any export with a student identifier, an amount, and a payment date works. Extra columns are fine — you&apos;ll map only what&apos;s needed next.
            </p>
            <label
              className="flex items-center justify-center gap-2.5 h-24 rounded-xl border-2 border-dashed cursor-pointer transition-colors"
              style={{ borderColor: 'var(--border-hover)', color: 'var(--text-muted)' }}
            >
              <Upload className="w-5 h-5" />
              <span className="text-[13px]">{fileName || 'Click to choose a .csv file'}</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </div>

          {headers.length > 0 && (
            <div className="card p-6">
              <h3 className="text-[14px] font-semibold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>2. Map Columns</h3>
              <p className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>
                {csvRows.length} row(s) detected. Map at least Amount, Payment Date, and one way to identify the student.
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="label-micro block mb-1.5">{f.label}{f.required ? ' *' : ''}</span>
                    <select
                      className={inputCls}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                      value={mapping[f.key] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    >
                      <option value="">— Ignore —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-5">
                <Button onClick={() => run(false)} disabled={!canRun || busy !== null}>
                  {busy === 'dryrun' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                  {busy === 'dryrun' ? 'Checking…' : 'Run Dry Run'}
                </Button>
                {!canRun && <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>Map the required fields to continue.</span>}
              </div>
            </div>
          )}

          {report && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  {report.dryRun ? '3. Review' : 'Import Complete'}
                </h3>
                {report.dryRun && (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={allowAdjust} onChange={(e) => setAllowAdjust(e.target.checked)} />
                      Commit mismatched students anyway
                    </label>
                    <Button onClick={() => run(true)} disabled={busy !== null}>
                      {busy === 'commit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
                      {busy === 'commit' ? 'Committing…' : 'Commit Import'}
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <MiniStat label="Matched" value={report.totals.matched} />
                <MiniStat label="Unmatched" value={report.totals.unmatched} warn={report.totals.unmatched > 0} />
                <MiniStat label="Ambiguous" value={report.totals.ambiguous} warn={report.totals.ambiguous > 0} />
                <MiniStat label="Invalid" value={report.totals.invalid} warn={report.totals.invalid > 0} />
                {!report.dryRun && (
                  <>
                    <MiniStat label="Committed" value={report.totals.committed ?? 0} good />
                    <MiniStat label="Skipped" value={report.totals.skipped ?? 0} warn={(report.totals.skipped ?? 0) > 0} />
                  </>
                )}
              </div>

              {report.students.length === 0 ? (
                <EmptyState text="No matched students to show." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Student', 'Rows', 'Import Total', 'Recorded Total', 'Status'].map((h, i) => (
                          <th key={h} className={`px-3 py-2 label-micro font-medium ${i >= 1 && i <= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.students.map((s) => (
                        <tr key={s.studentId} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{s.studentLabel}</td>
                          <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>{s.rows}</td>
                          <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-primary)' }}>{fmtAmt(s.importTotal)}</td>
                          <td className="px-3 py-2.5 text-right mono" style={{ color: 'var(--text-secondary)' }}>{fmtAmt(s.recordedTotal)}</td>
                          <td className="px-3 py-2.5">
                            {s.committed === true && <span className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--good-2)' }}><CheckCircle2 className="w-3 h-3" /> Committed</span>}
                            {s.committed === false && <span className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--critical)' }}><AlertTriangle className="w-3 h-3" /> {s.error}</span>}
                            {s.committed === undefined && s.mismatch && <span className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--warning)' }}><AlertTriangle className="w-3 h-3" /> Totals don&apos;t match</span>}
                            {s.committed === undefined && !s.mismatch && <span className="text-[11.5px]" style={{ color: 'var(--good-2)' }}>Ready</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}

function MiniStat({ label, value, warn, good }: { label: string; value: number; warn?: boolean; good?: boolean }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--elevated)' }}>
      <p className="label-micro mb-1">{label}</p>
      <p className="mono text-[16px] font-semibold" style={{ color: good ? 'var(--good-2)' : warn ? 'var(--warning)' : 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}
