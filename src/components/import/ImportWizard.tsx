'use client'

import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button, ErrorBanner, Field, apiCall, inputCls, inputStyle } from '@/components/v2/ui'
import { SectionCard } from '@/components/recovery/chips'
import { autoMap, type ImportTemplate } from '@/lib/import/templates'
import { parseCsv } from '@/lib/recovery/csv'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Download a template → upload a file → check the columns → dry run → commit.
 *
 * Shared by all three uploads because the shape is the same every time, and
 * because the dry run must never be skippable: each of these writes real
 * records, and the only honest way to let somebody commit is to show them
 * first exactly what will happen.
 *
 * Column matching is attempted automatically against each column's known
 * aliases, so a school can usually drop in its own export untouched — but the
 * guesses are always shown and always editable, because a silently mis-matched
 * column is worse than one the user had to pick.
 */
export function ImportWizard({
  template,
  endpoint,
  extraBody,
  renderDryRun,
  renderResult,
  onCommitted,
}: {
  template: ImportTemplate
  endpoint: string
  extraBody?: Record<string, unknown>
  renderDryRun: (data: any) => React.ReactNode
  renderResult: (data: any) => React.ReactNode
  onCommitted?: () => void
}) {
  const [csvText, setCsvText] = useState('')
  const [filename, setFilename] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rowCount, setRowCount] = useState(0)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [dryRun, setDryRun] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setCsvText('')
    setFilename('')
    setHeaders([])
    setRowCount(0)
    setMapping({})
    setDryRun(null)
    setResult(null)
    setError('')
  }

  function onFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const parsed = parseCsv(text)
      setCsvText(text)
      setFilename(file.name)
      setHeaders(parsed.headers)
      setRowCount(parsed.rows.length)
      setMapping(autoMap(template, parsed.headers))
      setDryRun(null)
      setResult(null)
      setError('')
    }
    reader.readAsText(file)
  }

  async function run(commit: boolean) {
    setBusy(true)
    setError('')
    try {
      const body = await apiCall<any>(endpoint, 'POST', {
        csv: csvText,
        mapping,
        commit,
        filename,
        ...(extraBody ?? {}),
      })
      if (commit) {
        setResult(body.data)
        onCommitted?.()
      } else {
        setDryRun(body.data)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const missingRequired = template.columns
    .filter((c) => c.required && !mapping[c.key])
    .map((c) => c.header)

  return (
    <div className="space-y-5">
      {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

      {/* ── 1. Template ─────────────────────────────────────── */}
      <SectionCard title={`1 · Get the format right`} subtitle={template.order}>
        <div className="p-4 space-y-3">
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {template.summary}
          </p>
          <a href={`/api/v2/import/template?type=${template.key}`} download>
            <Button variant="ghost">
              <Download className="w-3.5 h-3.5" />
              Download the template
            </Button>
          </a>
          <details>
            <summary
              className="text-[12px] cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              What each column means
            </summary>
            <div className="mt-2 space-y-2">
              {template.columns.map((c) => (
                <div key={c.key} className="text-[11.5px] flex gap-3">
                  <span
                    className="font-medium w-36 flex-shrink-0"
                    style={{ color: c.required ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                  >
                    {c.header}
                    {c.required && <span style={{ color: 'var(--critical)' }}> *</span>}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{c.hint}</span>
                </div>
              ))}
            </div>
          </details>
          <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
            The template comes with example rows filled in so the format is obvious — delete them
            before adding your own.
          </p>
        </div>
      </SectionCard>

      {/* ── 2. Upload ───────────────────────────────────────── */}
      <SectionCard title="2 · Choose your file" subtitle="Your own export works too — the columns are matched automatically">
        <div className="p-4">
          <label
            className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl cursor-pointer"
            style={{ border: '1px dashed var(--border-strong)', background: 'var(--elevated)' }}
          >
            <Upload className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            <span className="text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
              {filename || 'Click to choose a CSV file'}
            </span>
            {rowCount > 0 && (
              <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                {rowCount} rows, {headers.length} columns
              </span>
            )}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onFile(file)
              }}
            />
          </label>
          {filename && (
            <button
              onClick={reset}
              className="text-[11.5px] mt-2"
              style={{ color: 'var(--text-muted)' }}
            >
              Start over
            </button>
          )}
        </div>
      </SectionCard>

      {/* ── 3. Map ──────────────────────────────────────────── */}
      {headers.length > 0 && !result && (
        <SectionCard
          title="3 · Check the columns"
          subtitle="Matched automatically where possible — change anything that looks wrong"
        >
          <div className="p-4 grid sm:grid-cols-2 gap-4">
            {template.columns.map((c) => (
              <Field key={c.key} label={`${c.header}${c.required ? ' *' : ''}`}>
                <select
                  className={inputCls}
                  style={{
                    ...inputStyle,
                    ...(c.required && !mapping[c.key]
                      ? { border: '1px solid var(--critical)' }
                      : {}),
                  }}
                  value={mapping[c.key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [c.key]: e.target.value })}
                >
                  <option value="">— not in my file —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <div className="px-4 pb-4 flex items-center gap-3">
            <Button onClick={() => run(false)} disabled={busy || missingRequired.length > 0}>
              {busy ? 'Checking…' : 'Check the file'}
            </Button>
            {missingRequired.length > 0 && (
              <span className="text-[11.5px]" style={{ color: 'var(--critical)' }}>
                Still need: {missingRequired.join(', ')}
              </span>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── 4. Dry run ──────────────────────────────────────── */}
      {dryRun && !result && (
        <SectionCard title="4 · What would happen" subtitle="Nothing has been saved yet">
          <div className="p-4 space-y-4">
            {renderDryRun(dryRun)}
            <div
              className="flex items-center justify-end gap-3 pt-3"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <Button variant="ghost" onClick={() => setDryRun(null)}>
                Back
              </Button>
              <Button onClick={() => run(true)} disabled={busy}>
                {busy ? 'Saving…' : 'Save it for real'}
              </Button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── 5. Done ─────────────────────────────────────────── */}
      {result && (
        <SectionCard title="Done" subtitle="Saved, and everything recalculated">
          <div className="p-4 space-y-4">
            {renderResult(result)}
            <Button variant="ghost" onClick={reset}>
              Upload another file
            </Button>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

/** Problem rows, shown the same way by every importer. */
export function ProblemList({
  problems,
  emptyText,
}: {
  problems: { row: number; name: string; message: string }[]
  emptyText?: string
}) {
  if (!problems?.length) {
    return emptyText ? (
      <p className="text-[12px]" style={{ color: 'var(--good-2)' }}>
        {emptyText}
      </p>
    ) : null
  }
  return (
    <div>
      <p className="label-micro mb-2">Rows that need attention</p>
      <div
        className="rounded-lg max-h-64 overflow-y-auto divide-y"
        style={{ background: 'var(--elevated)', borderColor: 'var(--border)' }}
      >
        {problems.map((p, i) => (
          <div key={i} className="px-3 py-2 text-[11.5px] flex gap-3">
            <span className="mono w-14 flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
              row {p.row}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>{p.name}</span>
            <span className="ml-auto text-right" style={{ color: 'var(--warning)' }}>
              {p.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
