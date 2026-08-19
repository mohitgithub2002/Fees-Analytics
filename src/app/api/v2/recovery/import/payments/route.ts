import { NextRequest } from 'next/server'
import { $Enums, Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { err, ok, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { allocatePayment, AllocationError, cancelTransaction } from '@/lib/fees/allocation'
import { toPaise } from '@/lib/fees/money'
import { recomputeRecovery } from '@/lib/recovery/recompute'

/**
 * The real payment-history backfill: replaces a student's estimated timing
 * (see prisma/seed-recovery-demo.ts and the LEGACY-* rows from migrate-v2.ts)
 * with actual dated payments, once the school has them to hand.
 *
 * CSV parsing and column mapping happen client-side (the school's export
 * formats vary too much to guess at reliably); this endpoint takes already
 * structured rows and does the two things that have to happen on the server:
 * matching each row to a student, and — on commit — replaying the payments
 * through the real allocation engine so installment status and dues stay
 * correct.
 *
 * `commit: false` (or omitted) is a dry run: matching and reconciliation only,
 * no writes. `commit: true` does the work, one student at a time, each inside
 * its own transaction so a bad row for one family never blocks the rest.
 */

interface ImportRow {
  studentId?: number
  admissionNo?: string
  studentName?: string
  fatherName?: string
  amount?: number
  paidAt?: string
  mode?: string
  reference?: string
  category?: string
}

interface RequestBody {
  rows?: ImportRow[]
  commit?: boolean
  allowAdjust?: boolean
}

const MODES = new Set(Object.values($Enums.PaymentMode))
const CATEGORIES = new Set(Object.values($Enums.FeeCategory))

export async function POST(request: NextRequest) {
  const body = await readJson<RequestBody>(request)
  if (!body) return err('invalid JSON body')

  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) return err('rows must be a non-empty array')
  if (rows.length > 5000) return err('a single import is limited to 5000 rows')

  const commit = body.commit === true
  const allowAdjust = body.allowAdjust === true

  /* ── Validate + match every row ──────────────────────────────────────── */

  const invalid: { index: number; row: ImportRow; reason: string }[] = []
  const unmatched: { index: number; row: ImportRow }[] = []
  const ambiguous: { index: number; row: ImportRow; candidates: number[] }[] = []
  const validRows: (ImportRow & { studentId: number })[] = []

  const candidateCache = new Map<string, number[]>()

  for (const [index, row] of rows.entries()) {
    if (!(typeof row.amount === 'number' && row.amount > 0)) {
      invalid.push({ index, row, reason: 'amount must be a positive number' })
      continue
    }
    if (!row.paidAt || isNaN(Date.parse(row.paidAt))) {
      invalid.push({ index, row, reason: 'paidAt is missing or invalid' })
      continue
    }
    if (row.mode !== undefined && !MODES.has(row.mode as never)) {
      invalid.push({ index, row, reason: `mode must be one of ${[...MODES].join(', ')}` })
      continue
    }
    if (row.category !== undefined && !CATEGORIES.has(row.category as never)) {
      invalid.push({ index, row, reason: `category must be one of ${[...CATEGORIES].join(', ')}` })
      continue
    }

    const studentId = await matchStudent(row, candidateCache)
    if (studentId === 'unmatched') {
      unmatched.push({ index, row })
    } else if (typeof studentId === 'object') {
      ambiguous.push({ index, row, candidates: studentId.candidates })
    } else {
      validRows.push({ ...row, studentId })
    }
  }

  /* ── Group by student and reconcile against the current ledger ──────── */

  const byStudent = new Map<number, (ImportRow & { studentId: number })[]>()
  for (const row of validRows) {
    const list = byStudent.get(row.studentId) ?? []
    list.push(row)
    byStudent.set(row.studentId, list)
  }

  const recordedByStudent = await prisma.studentFeeItem.groupBy({
    by: ['enrollmentId'],
    where: { enrollment: { studentId: { in: [...byStudent.keys()] } } },
    _sum: { paidAmount: true },
  })
  // groupBy is per-enrollment; roll it up to per-student via a second lookup.
  const enrollmentStudent = await prisma.studentEnrollment.findMany({
    where: { id: { in: recordedByStudent.map((r) => r.enrollmentId) } },
    select: { id: true, studentId: true },
  })
  const studentOfEnrollment = new Map(enrollmentStudent.map((e) => [e.id, e.studentId]))
  const recordedPaidByStudent = new Map<number, number>()
  for (const r of recordedByStudent) {
    const studentId = studentOfEnrollment.get(r.enrollmentId)
    if (!studentId) continue
    recordedPaidByStudent.set(
      studentId,
      (recordedPaidByStudent.get(studentId) ?? 0) + toPaise(r._sum.paidAmount ?? 0)
    )
  }

  const studentNames = await prisma.student.findMany({
    where: { id: { in: [...byStudent.keys()] } },
    select: { id: true, name: true, fatherName: true },
  })
  const nameById = new Map(studentNames.map((s) => [s.id, `${s.name} (${s.fatherName})`]))

  const summary: {
    studentId: number
    studentLabel: string
    rows: number
    importTotal: number
    recordedTotal: number
    mismatch: boolean
    committed?: boolean
    error?: string
  }[] = []

  for (const [studentId, studentRows] of byStudent) {
    const importTotalPaise = studentRows.reduce((s, r) => s + toPaise(r.amount!), 0)
    const recordedPaise = recordedPaidByStudent.get(studentId) ?? 0
    summary.push({
      studentId,
      studentLabel: nameById.get(studentId) ?? `#${studentId}`,
      rows: studentRows.length,
      importTotal: importTotalPaise / 100,
      recordedTotal: recordedPaise / 100,
      mismatch: importTotalPaise !== recordedPaise,
    })
  }

  if (!commit) {
    return ok({
      dryRun: true,
      totals: { rows: rows.length, matched: validRows.length, unmatched: unmatched.length, ambiguous: ambiguous.length, invalid: invalid.length },
      students: summary,
      unmatched,
      ambiguous,
      invalid,
    })
  }

  /* ── Commit: replay real payments through the allocation engine ─────── */

  for (const student of summary) {
    if (student.mismatch && !allowAdjust) {
      student.committed = false
      student.error = 'skipped: import total does not match the recorded paid amount (pass allowAdjust to override)'
      continue
    }

    const studentRows = (byStudent.get(student.studentId) ?? []).sort(
      (a, b) => Date.parse(a.paidAt!) - Date.parse(b.paidAt!)
    )

    try {
      await prisma.$transaction(async (tx) => {
        const toReplace = await tx.feeTransaction.findMany({
          where: {
            studentId: student.studentId,
            status: 'COMPLETED',
            OR: [{ receiptNo: { startsWith: 'DEMO-' } }, { receiptNo: { startsWith: 'LEGACY-' } }],
          },
          select: { id: true },
        })
        for (const t of toReplace) await cancelTransaction(tx, t.id)

        for (const row of studentRows) {
          await allocatePayment(tx, {
            studentId: student.studentId,
            amount: row.amount!,
            category: (row.category as $Enums.FeeCategory) ?? null,
            mode: (row.mode as $Enums.PaymentMode) ?? 'OTHER',
            reference: row.reference ?? null,
            remarks: 'Imported real payment history',
            paidAt: row.paidAt,
          })
        }
      })
      student.committed = true
    } catch (e) {
      student.committed = false
      student.error = e instanceof AllocationError ? e.message : 'unexpected error — see server log'
      if (!(e instanceof AllocationError)) console.error('recovery import commit failed:', e)
    }
  }

  const committedIds = summary.filter((s) => s.committed).map((s) => s.studentId)
  if (committedIds.length > 0) {
    invalidateTags(TAGS.fees, TAGS.recovery)
    const guardianLinks = await prisma.guardianStudent.findMany({
      where: { studentId: { in: committedIds } },
      select: { guardianId: true },
    })
    await recomputeRecovery([...new Set(guardianLinks.map((g) => g.guardianId))])
  }

  return ok({
    dryRun: false,
    totals: {
      rows: rows.length,
      matched: validRows.length,
      unmatched: unmatched.length,
      ambiguous: ambiguous.length,
      invalid: invalid.length,
      committed: summary.filter((s) => s.committed).length,
      skipped: summary.filter((s) => s.committed === false).length,
    },
    students: summary,
    unmatched,
    ambiguous,
    invalid,
  })
}

/**
 * Resolve one row to a student id: explicit id, then admission number, then
 * an exact (name, father's name) match. Case-insensitive, whitespace-trimmed.
 */
async function matchStudent(
  row: ImportRow,
  cache: Map<string, number[]>
): Promise<number | 'unmatched' | { candidates: number[] }> {
  if (Number.isInteger(row.studentId)) {
    const exists = await prisma.student.findUnique({ where: { id: row.studentId! }, select: { id: true } })
    return exists ? exists.id : 'unmatched'
  }

  if (row.admissionNo?.trim()) {
    const match = await prisma.student.findUnique({
      where: { admissionNo: row.admissionNo.trim() },
      select: { id: true },
    })
    return match ? match.id : 'unmatched'
  }

  if (row.studentName?.trim() && row.fatherName?.trim()) {
    const key = `${row.studentName.trim().toLowerCase()}|${row.fatherName.trim().toLowerCase()}`
    let ids = cache.get(key)
    if (!ids) {
      const matches = await prisma.student.findMany({
        where: {
          name: { equals: row.studentName.trim(), mode: Prisma.QueryMode.insensitive },
          fatherName: { equals: row.fatherName.trim(), mode: Prisma.QueryMode.insensitive },
        },
        select: { id: true },
      })
      ids = matches.map((m) => m.id)
      cache.set(key, ids)
    }
    if (ids.length === 0) return 'unmatched'
    if (ids.length === 1) return ids[0]
    return { candidates: ids }
  }

  return 'unmatched'
}
