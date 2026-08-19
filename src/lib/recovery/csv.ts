/**
 * Minimal RFC-4180-ish CSV parser for the client-side import flow. Handles
 * quoted fields (with embedded commas, newlines, and escaped "" quotes) and
 * both \n and \r\n line endings — enough for the exports a school's fee
 * register or Excel/Tally sheet actually produces, without pulling in a
 * parsing library for one screen.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); rows.push(row); row = [] }

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { pushField(); i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { pushRow(); i++; continue }
    field += ch; i++
  }
  if (field.length > 0 || row.length > 0) pushRow()

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  const [headers, ...data] = nonEmpty
  return { headers: (headers ?? []).map((h) => h.trim()), rows: data }
}
