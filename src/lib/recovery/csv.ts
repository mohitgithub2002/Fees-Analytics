/**
 * A small CSV reader for uploaded payment history.
 *
 * The repo already depends on `csv-parser`, but that is a Node stream API and
 * this runs on a request body that is already a string. Rather than wrap a
 * stream around it, this handles the part of RFC 4180 that spreadsheet exports
 * actually produce: quoted fields, embedded commas, doubled quotes to escape a
 * quote, and either line ending.
 *
 * Pure, so the import's parsing can be reasoned about without a database.
 */

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

/** Split one CSV line, respecting quotes. */
function splitLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') inQuotes = true
    else if (char === ',') {
      out.push(field)
      field = ''
    } else field += char
  }
  out.push(field)
  return out.map((f) => f.trim())
}

export function parseCsv(text: string): ParsedCsv {
  // Strip a UTF-8 BOM — Excel adds one and it silently corrupts the first
  // header, which then fails to match any column mapping.
  const clean = text.replace(/^﻿/, '')
  const lines = clean.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = splitLine(lines[0])
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = values[index] ?? ''
    })
    rows.push(row)
  }

  return { headers, rows }
}

/** "1,250.50" / "₹1250" / "1 250" → 1250.5; null when it is not a number. */
export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^\d.-]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/**
 * Parse a date from an uploaded file.
 *
 * DAY-FIRST by default, because this data is Indian and `13/07/2026` is
 * unambiguous while `07/08/2026` is not — and guessing month-first would
 * silently move payments by months and wreck exactly the seasonality the
 * import exists to establish.
 */
export function parseImportDate(raw: string | undefined): Date | null {
  if (!raw?.trim()) return null
  const text = raw.trim()

  const dmy = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    let year = Number(dmy[3])
    if (year < 100) year += year < 70 ? 2000 : 1900
    if (day < 1 || day > 31 || month < 1 || month > 12) return null
    const date = new Date(Date.UTC(year, month - 1, day))
    // Rejects things like 31/02: the constructor would roll it into March.
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null
    return date
  }

  // ISO and anything else the runtime understands.
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
