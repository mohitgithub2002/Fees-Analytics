import { NextRequest } from 'next/server'
import { err, handleError, ok, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { allocatePayment, cancelTransaction } from '@/lib/fees/allocation'
import { toPaise } from '@/lib/fees/money'
import { parseAmount, parseCsv, parseImportDate } from '@/lib/recovery/csv'
import { UNDATED_RECEIPT_PREFIXES } from '@/lib/recovery/provenance'
import { recomputeRecovery } from '@/lib/recovery/recompute'
import { $Enums } from '@/generated/prisma/client'

/**
 * Import real payment history.
 *
 * This is the single most valuable thing that can be done to this system. The
 * whole timing half of the engine — when in the year a family pays, whether
 * they meet due dates, which months collect, what next month will bring — is
 * dark until real payment dates exist. Every migrated payment currently
 * carries the timestamp of the migration run, not the day money changed hands.
 *
 * Two phases, always:
 *
 *   DRY RUN  matches every row to a student, reports what could not be
 *            matched, and reconciles each student's imported total against
 *            what the ledger already says they paid. Nothing is written except
 *            the batch record itself.
 *   COMMIT   per student, inside its own transaction: cancel their undated
 *            transactions, then replay each real payment through
 *            allocatePayment.
 *
 * Cancelling first is what makes this SUPERSEDE rather than double-count. A
 * student's existing paid amount comes from somewhere without dates — the
 * legacy migration, or an opening balance typed into the fee import — and that
 * is the same money this file describes properly. Replaying on top of it
 * without clearing it would record every rupee twice and quietly halve what
 * the school thinks it is owed.
 *
 * The commit deliberately REPLAYS rather than edits. Rewriting paidAt on the
 * existing rows would be far less code and would quietly break every ledger
 * invariant in docs/FEES_V2.md — allocations would still point at installments
 * settled in a different order, and sum(allocations) would drift from the
 * amounts. Going through the real allocation engine means installment
 * statuses, fee-item totals and receipts all come out consistent, because they
 * are produced by the same code that produces them normally.
 *
 * A student whose imported total disagrees with their recorded paid amount is
 * SKIPPED unless explicitly overridden. Their ledger is left exactly as it was.
 */

const MODES = new Set(Object.values($Enums.PaymentMode))

interface Mapping {
  studentName?: string
  admissionNo?: string
  className?: string
  fatherName?: string
  amount?: string
  paidAt?: string
  mode?: string
  reference?: string
}

interface Body {
  csv?: string
  mapping?: Mapping
  commit?: boolean
  /** Commit students whose imported total disagrees with the ledger. */
  allowMismatched?: boolean
  filename?: string
}

type RowStatus = $Enums.ImportRowStatus

interface StagedRow {
  rowNumber: number
  studentId: number | null
  rawName: string
  rawClass: string
  rawFatherName: string
  amount: number | null
  paidAt: Date | null
  mode: $Enums.PaymentMode | null
  reference: string | null
  status: RowStatus
  message: string | null
}

function norm(value: string | undefined | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const body = await readJson<Body>(request)
  if (!body) return err('invalid JSON body')
  if (!body.csv?.trim()) return err('csv content is required')

  const mapping = body.mapping ?? {}
  if (!mapping.amount) return err('mapping.amount is required — which column holds the amount?')
  if (!mapping.paidAt) {
    return err('mapping.paidAt is required — an import without payment dates would add nothing')
  }
  if (!mapping.studentName && !mapping.admissionNo) {
    return err('mapping needs either studentName or admissionNo to match rows to students')
  }

  try {
    const { headers, rows } = parseCsv(body.csv)
    if (rows.length === 0) return err('no data rows found in the file')

    for (const [field, column] of Object.entries(mapping)) {
      if (column && !headers.includes(column)) {
        return err(`mapped column "${column}" (${field}) is not in the file`)
      }
    }

    // --- Load students once for matching ------------------------------
    const students = await prisma.student.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        fatherName: true,
        admissionNo: true,
        enrollments: {
          orderBy: { session: { startDate: 'desc' } },
          take: 1,
          select: { classroom: { select: { class: { select: { name: true } } } } },
        },
      },
    })

    const byAdmission = new Map<string, number>()
    const byClassName = new Map<string, number[]>()
    const byName = new Map<string, number[]>()

    for (const s of students) {
      if (s.admissionNo) byAdmission.set(norm(s.admissionNo), s.id)
      const className = norm(s.enrollments[0]?.classroom.class.name ?? '')
      const nameKey = norm(s.name)
      const push = (map: Map<string, number[]>, key: string) => {
        const list = map.get(key)
        if (list) list.push(s.id)
        else map.set(key, [s.id])
      }
      push(byName, nameKey)
      push(byClassName, `${className}|${nameKey}`)
    }

    // --- Stage every row ------------------------------------------------
    const staged: StagedRow[] = rows.map((row, index) => {
      const rawName = mapping.studentName ? (row[mapping.studentName] ?? '') : ''
      const rawClass = mapping.className ? (row[mapping.className] ?? '') : ''
      const rawFatherName = mapping.fatherName ? (row[mapping.fatherName] ?? '') : ''
      const amount = parseAmount(row[mapping.amount!])
      const paidAt = parseImportDate(row[mapping.paidAt!])

      const rawMode = mapping.mode ? row[mapping.mode]?.trim().toUpperCase() : undefined
      const mode =
        rawMode && MODES.has(rawMode as $Enums.PaymentMode)
          ? (rawMode as $Enums.PaymentMode)
          : null

      const base = {
        rowNumber: index + 2, // +1 for the header, +1 for 1-based rows
        rawName,
        rawClass,
        rawFatherName,
        amount,
        paidAt,
        mode,
        reference: mapping.reference ? (row[mapping.reference] || null) : null,
      }

      if (amount === null || amount <= 0) {
        return { ...base, studentId: null, status: 'INVALID', message: 'amount is missing or not a positive number' }
      }
      if (!paidAt) {
        return { ...base, studentId: null, status: 'INVALID', message: 'payment date is missing or unreadable' }
      }

      // Admission number first: it is the only identifier that is unique by
      // construction. Names are not, and two children called Kartik in
      // different classes is the normal case, not the edge case.
      if (mapping.admissionNo) {
        const admission = norm(row[mapping.admissionNo])
        if (admission) {
          const id = byAdmission.get(admission)
          if (id) return { ...base, studentId: id, status: 'MATCHED', message: null }
        }
      }

      const nameKey = norm(rawName)
      if (!nameKey) {
        return { ...base, studentId: null, status: 'UNMATCHED', message: 'no student name or admission number on this row' }
      }

      if (rawClass) {
        const scoped = byClassName.get(`${norm(rawClass)}|${nameKey}`) ?? []
        if (scoped.length === 1) return { ...base, studentId: scoped[0], status: 'MATCHED', message: null }
        if (scoped.length > 1) {
          return { ...base, studentId: null, status: 'AMBIGUOUS', message: `${scoped.length} students named "${rawName}" in class ${rawClass}` }
        }
      }

      const loose = byName.get(nameKey) ?? []
      if (loose.length === 1) return { ...base, studentId: loose[0], status: 'MATCHED', message: null }
      if (loose.length > 1) {
        return { ...base, studentId: null, status: 'AMBIGUOUS', message: `${loose.length} students named "${rawName}" — add a class or admission-number column` }
      }
      return { ...base, studentId: null, status: 'UNMATCHED', message: `no student named "${rawName}"` }
    })

    // --- Reconcile per student -------------------------------------------
    const matchedIds = [...new Set(staged.filter((r) => r.studentId).map((r) => r.studentId!))]
    const ledger = await prisma.studentFeeItem.groupBy({
      by: ['enrollmentId'],
      where: { enrollment: { studentId: { in: matchedIds } } },
      _sum: { paidAmount: true },
    })
    const enrollments = await prisma.studentEnrollment.findMany({
      where: { studentId: { in: matchedIds } },
      select: { id: true, studentId: true },
    })
    const studentByEnrollment = new Map(enrollments.map((e) => [e.id, e.studentId]))

    const recordedPaid = new Map<number, number>()
    for (const row of ledger) {
      const studentId = studentByEnrollment.get(row.enrollmentId)
      if (!studentId) continue
      recordedPaid.set(
        studentId,
        (recordedPaid.get(studentId) ?? 0) + Number(row._sum.paidAmount ?? 0)
      )
    }

    const importedByStudent = new Map<number, number>()
    for (const row of staged) {
      if (row.studentId && row.status === 'MATCHED') {
        importedByStudent.set(
          row.studentId,
          (importedByStudent.get(row.studentId) ?? 0) + (row.amount ?? 0)
        )
      }
    }

    const nameById = new Map(students.map((s) => [s.id, s.name]))
    const reconciliation = [...importedByStudent.entries()].map(([studentId, imported]) => {
      const recorded = recordedPaid.get(studentId) ?? 0
      // Compared in paise: a rupee total built from floats will not equal
      // another rupee total built from floats.
      const matches = toPaise(imported) === toPaise(recorded)
      return {
        studentId,
        studentName: nameById.get(studentId) ?? `#${studentId}`,
        imported,
        recorded,
        difference: imported - recorded,
        matches,
      }
    })
    const mismatched = reconciliation.filter((r) => !r.matches)

    const counts = {
      total: staged.length,
      matched: staged.filter((r) => r.status === 'MATCHED').length,
      unmatched: staged.filter((r) => r.status === 'UNMATCHED').length,
      ambiguous: staged.filter((r) => r.status === 'AMBIGUOUS').length,
      invalid: staged.filter((r) => r.status === 'INVALID').length,
      students: importedByStudent.size,
      mismatchedStudents: mismatched.length,
    }

    // --- Record the batch --------------------------------------------------
    const batch = await prisma.paymentImportBatch.create({
      data: {
        filename: body.filename ?? null,
        status: 'DRY_RUN',
        totalRows: counts.total,
        matchedRows: counts.matched,
        createdById: gate.user.id,
        createdByName: gate.user.name,
        summary: { mapping, counts, reconciliation: reconciliation.slice(0, 500) } as object,
        rows: {
          create: staged.map((r) => ({
            rowNumber: r.rowNumber,
            studentId: r.studentId,
            rawName: r.rawName || null,
            rawClass: r.rawClass || null,
            rawFatherName: r.rawFatherName || null,
            amount: r.amount,
            paidAt: r.paidAt,
            mode: r.mode,
            reference: r.reference,
            status: r.status,
            message: r.message,
          })),
        },
      },
    })

    if (!body.commit) {
      return ok({
        data: {
          batchId: batch.id,
          committed: false,
          counts,
          reconciliation,
          problems: staged
            .filter((r) => r.status !== 'MATCHED')
            .slice(0, 200)
            .map((r) => ({ row: r.rowNumber, name: r.rawName, status: r.status, message: r.message })),
          note:
            mismatched.length > 0
              ? `${mismatched.length} student(s) have an imported total that disagrees with the ledger. They will be skipped unless you commit with allowMismatched.`
              : 'Nothing was written. Re-send with commit: true to apply.',
        },
      })
    }

    // --- Commit -------------------------------------------------------------
    const skipIds = new Set(
      body.allowMismatched ? [] : mismatched.map((m) => m.studentId)
    )

    const byStudent = new Map<number, StagedRow[]>()
    for (const row of staged) {
      if (row.status !== 'MATCHED' || !row.studentId) continue
      if (skipIds.has(row.studentId)) continue
      const list = byStudent.get(row.studentId)
      if (list) list.push(row)
      else byStudent.set(row.studentId, [row])
    }

    const committedStudents: number[] = []
    const failures: { studentId: number; studentName: string; error: string }[] = []
    let committedRows = 0

    for (const [studentId, studentRows] of byStudent) {
      // Oldest first, so the allocation waterfall settles installments in the
      // order the family actually paid them.
      studentRows.sort((a, b) => a.paidAt!.getTime() - b.paidAt!.getTime())

      try {
        // This one genuinely has to be atomic — a half-applied student would
        // have their old payments cancelled and the new ones missing, which
        // reads as "they never paid". It is also inherently several round
        // trips (a cancel and an allocation per payment), so over a remote
        // database it needs more than the 5s default.
        await prisma.$transaction(async (tx) => {
          const undated = await tx.feeTransaction.findMany({
            where: {
              studentId,
              status: 'COMPLETED',
              OR: UNDATED_RECEIPT_PREFIXES.map((prefix) => ({
                receiptNo: { startsWith: prefix },
              })),
            },
            select: { id: true },
          })
          for (const t of undated) await cancelTransaction(tx, t.id)

          for (const row of studentRows) {
            await allocatePayment(tx, {
              studentId,
              amount: row.amount!,
              mode: row.mode ?? undefined,
              reference: row.reference ?? undefined,
              remarks: `Imported payment history (batch ${batch.id})`,
              paidAt: row.paidAt!.toISOString(),
            })
          }
        }, { timeout: 60_000, maxWait: 15_000 })
        committedStudents.push(studentId)
        committedRows += studentRows.length
      } catch (e) {
        // One student's bad data must not abandon the rest of the import.
        failures.push({
          studentId,
          studentName: nameById.get(studentId) ?? `#${studentId}`,
          error: e instanceof Error ? e.message : 'unknown error',
        })
      }
    }

    await prisma.paymentImportBatch.update({
      where: { id: batch.id },
      data: {
        status: failures.length > 0 && committedStudents.length === 0 ? 'FAILED' : 'COMMITTED',
        committedRows,
        skippedRows: counts.total - committedRows,
        committedAt: new Date(),
        summary: {
          mapping,
          counts,
          reconciliation: reconciliation.slice(0, 500),
          failures,
          skippedStudents: [...skipIds],
        } as object,
      },
    })

    // Every timing signal in the system has just changed.
    await recomputeRecovery().catch((e) => console.error('recompute after import failed', e))
    invalidateTags(TAGS.fees, TAGS.recovery)

    return ok({
      data: {
        batchId: batch.id,
        committed: true,
        counts,
        committedRows,
        committedStudents: committedStudents.length,
        skippedStudents: skipIds.size,
        failures,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}

/** Recent import runs, for the history panel on /recovery/import. */
export async function GET() {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  try {
    const batches = await prisma.paymentImportBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        filename: true,
        status: true,
        totalRows: true,
        matchedRows: true,
        committedRows: true,
        skippedRows: true,
        createdByName: true,
        createdAt: true,
        committedAt: true,
      },
    })
    return ok({ data: batches })
  } catch (e) {
    return handleError(e)
  }
}
