/**
 * Import what each child was billed.
 *
 * Most schools will define a fee structure per class once and let it apply
 * automatically. This exists for the two cases that cannot cover:
 *
 *  1. Amounts that genuinely vary per child (concessions, staff wards,
 *     part-year admissions).
 *  2. **Last year's unpaid balance.** This is the important one. "Owes for
 *     more than one year" and "always a year behind" are read off dues sitting
 *     open in two sessions at once, so a school that only loads this year's
 *     fees will see every family classified as a first-year unknown. Putting
 *     an old balance in under last session's name is what makes those
 *     patterns visible on day one, before any payment history exists.
 *
 * Fees are created through `createFeeItem`, the same function the app uses, so
 * installments, discounts and the opening paid amount are all distributed by
 * the real engine and every invariant in docs/FEES_V2.md holds.
 */
import { $Enums } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { createFeeItem } from '@/lib/fees/fee-items'
import { toPaise, toRupees } from '@/lib/fees/money'
import { parseAmount, parseCsv } from '@/lib/recovery/csv'
import { openingReceiptNo } from '@/lib/recovery/provenance'
import { autoMap, FEES_TEMPLATE } from './templates'

const CATEGORIES = new Set(Object.values($Enums.FeeCategory))

function norm(value: string | undefined | null): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

type RowStatus = 'READY' | 'SKIP_EXISTS' | 'UNMATCHED' | 'AMBIGUOUS' | 'INVALID'

interface StagedFee {
  rowNumber: number
  studentId: number | null
  studentName: string
  className: string
  sessionName: string
  category: $Enums.FeeCategory
  feeName: string
  amount: number
  discount: number
  paid: number
  installments: number
  status: RowStatus
  message: string | null
}

export interface FeeImportResult {
  counts: {
    total: number
    ready: number
    alreadyPresent: number
    unmatched: number
    invalid: number
    students: number
  }
  totals: { billed: number; discount: number; alreadyPaid: number; outstanding: number }
  bySession: { session: string; rows: number; billed: number }[]
  problems: { row: number; name: string; message: string }[]
  committed: boolean
  created?: { feeItems: number; failures: { row: number; name: string; error: string }[] }
}

export interface ImportFeesOptions {
  csv: string
  mapping?: Record<string, string>
  commit?: boolean
}

export async function importFees(opts: ImportFeesOptions): Promise<FeeImportResult> {
  const { headers, rows } = parseCsv(opts.csv)
  if (rows.length === 0) throw new Error('no data rows found in the file')

  const mapping = { ...autoMap(FEES_TEMPLATE, headers), ...(opts.mapping ?? {}) }
  const get = (row: Record<string, string>, key: string): string => {
    const column = mapping[key]
    return column ? (row[column] ?? '').trim() : ''
  }

  if (!mapping.feeName) throw new Error('mapping.feeName is required')
  if (!mapping.amount) throw new Error('mapping.amount is required')
  if (!mapping.admissionNo && !mapping.studentName) {
    throw new Error('mapping needs either admissionNo or studentName to match rows to students')
  }

  // --- Reference data, read once ---------------------------------------
  const [students, sessions, currentSession] = await Promise.all([
    prisma.student.findMany({
      select: {
        id: true,
        name: true,
        admissionNo: true,
        enrollments: {
          select: {
            id: true,
            sessionId: true,
            classroom: { select: { class: { select: { name: true } } } },
            feeItems: { select: { name: true } },
          },
        },
      },
    }),
    prisma.academicSession.findMany({ select: { id: true, name: true } }),
    prisma.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } }),
  ])

  const sessionByName = new Map(sessions.map((s) => [norm(s.name), s]))
  const byAdmission = new Map(
    students.filter((s) => s.admissionNo).map((s) => [norm(s.admissionNo), s.id])
  )
  const byName = new Map<string, number[]>()
  const byClassName = new Map<string, number[]>()
  for (const s of students) {
    const nameKey = norm(s.name)
    const push = (map: Map<string, number[]>, key: string) => {
      const list = map.get(key)
      if (list) list.push(s.id)
      else map.set(key, [s.id])
    }
    push(byName, nameKey)
    for (const e of s.enrollments) {
      push(byClassName, `${norm(e.classroom.class.name)}|${nameKey}`)
    }
  }
  const studentById = new Map(students.map((s) => [s.id, s]))

  // --- Stage ------------------------------------------------------------
  const staged: StagedFee[] = rows.map((row, index) => {
    const rowNumber = index + 2
    const studentName = get(row, 'studentName')
    const className = get(row, 'className')
    const feeName = get(row, 'feeName')
    const amount = parseAmount(get(row, 'amount'))
    const discount = parseAmount(get(row, 'discount')) ?? 0
    const paid = parseAmount(get(row, 'paid')) ?? 0
    const rawInstallments = Number(get(row, 'installments'))
    const installments =
      Number.isInteger(rawInstallments) && rawInstallments > 0 ? rawInstallments : 1

    const rawCategory = get(row, 'category').toUpperCase()
    const category = CATEGORIES.has(rawCategory as $Enums.FeeCategory)
      ? (rawCategory as $Enums.FeeCategory)
      : 'SCHOOL'

    const sessionName = get(row, 'session') || currentSession?.name || ''

    const base = {
      rowNumber,
      studentName,
      className,
      sessionName,
      category,
      feeName,
      amount: amount ?? 0,
      discount,
      paid,
      installments,
    }

    if (!feeName) {
      return { ...base, studentId: null, status: 'INVALID' as const, message: 'no fee name on this row' }
    }
    if (amount === null || amount <= 0) {
      return { ...base, studentId: null, status: 'INVALID' as const, message: 'amount is missing or not a positive number' }
    }
    if (discount > amount) {
      return { ...base, studentId: null, status: 'INVALID' as const, message: 'discount is larger than the amount' }
    }
    if (paid > amount - discount) {
      return { ...base, studentId: null, status: 'INVALID' as const, message: 'already-paid is larger than the amount after discount' }
    }

    // Match the student.
    let studentId: number | null = null
    const admissionNo = get(row, 'admissionNo')
    if (admissionNo) studentId = byAdmission.get(norm(admissionNo)) ?? null

    if (!studentId && studentName) {
      const scoped = className ? (byClassName.get(`${norm(className)}|${norm(studentName)}`) ?? []) : []
      if (scoped.length === 1) studentId = scoped[0]
      else if (scoped.length > 1) {
        return { ...base, studentId: null, status: 'AMBIGUOUS' as const, message: `${scoped.length} students named "${studentName}" in class ${className}` }
      } else {
        const loose = byName.get(norm(studentName)) ?? []
        if (loose.length === 1) studentId = loose[0]
        else if (loose.length > 1) {
          return { ...base, studentId: null, status: 'AMBIGUOUS' as const, message: `${loose.length} students named "${studentName}" — add a class or admission-number column` }
        }
      }
    }

    if (!studentId) {
      return { ...base, studentId: null, status: 'UNMATCHED' as const, message: `no student matches "${studentName || admissionNo}" — upload students first` }
    }

    const session = sessionByName.get(norm(sessionName))
    if (!session) {
      return { ...base, studentId, status: 'INVALID' as const, message: `no session named "${sessionName}" — create it first, or leave the column blank for the current one` }
    }

    const enrollment = studentById.get(studentId)?.enrollments.find((e) => e.sessionId === session.id)
    if (!enrollment) {
      return { ...base, studentId, status: 'INVALID' as const, message: `this student is not enrolled in ${sessionName}` }
    }

    // Same rule as applyStructureToEnrollment: a fee already assigned by that
    // name is left alone, so the file is safe to run twice.
    if (enrollment.feeItems.some((f) => norm(f.name) === norm(feeName))) {
      return { ...base, studentId, status: 'SKIP_EXISTS' as const, message: `"${feeName}" is already charged to this student for ${sessionName}` }
    }

    return { ...base, studentId, status: 'READY' as const, message: null }
  })

  const ready = staged.filter((r) => r.status === 'READY')
  const bySessionMap = new Map<string, { rows: number; billed: number }>()
  for (const row of ready) {
    const entry = bySessionMap.get(row.sessionName) ?? { rows: 0, billed: 0 }
    entry.rows++
    entry.billed += row.amount - row.discount
    bySessionMap.set(row.sessionName, entry)
  }

  const result: FeeImportResult = {
    counts: {
      total: staged.length,
      ready: ready.length,
      alreadyPresent: staged.filter((r) => r.status === 'SKIP_EXISTS').length,
      unmatched: staged.filter((r) => r.status === 'UNMATCHED' || r.status === 'AMBIGUOUS').length,
      invalid: staged.filter((r) => r.status === 'INVALID').length,
      students: new Set(ready.map((r) => r.studentId)).size,
    },
    totals: {
      billed: ready.reduce((n, r) => n + r.amount - r.discount, 0),
      discount: ready.reduce((n, r) => n + r.discount, 0),
      alreadyPaid: ready.reduce((n, r) => n + r.paid, 0),
      outstanding: ready.reduce((n, r) => n + (r.amount - r.discount - r.paid), 0),
    },
    bySession: [...bySessionMap.entries()].map(([session, v]) => ({ session, ...v })),
    problems: staged
      .filter((r) => r.status !== 'READY')
      .slice(0, 200)
      .map((r) => ({ row: r.rowNumber, name: r.studentName || `row ${r.rowNumber}`, message: r.message ?? r.status })),
    committed: false,
  }

  if (!opts.commit) return result

  // --- Commit -------------------------------------------------------------
  let createdCount = 0
  const failures: { row: number; name: string; error: string }[] = []

  // Grouped per student so one bad row cannot abandon another child's fees.
  const byStudent = new Map<number, StagedFee[]>()
  for (const row of ready) {
    const list = byStudent.get(row.studentId!)
    if (list) list.push(row)
    else byStudent.set(row.studentId!, [row])
  }

  for (const [studentId, studentRows] of byStudent) {
    for (const row of studentRows) {
      const session = sessionByName.get(norm(row.sessionName))!
      const enrollment = studentById
        .get(studentId)
        ?.enrollments.find((e) => e.sessionId === session.id)
      if (!enrollment) continue

      try {
        await prisma.$transaction(async (tx) => {
          const item = await createFeeItem(tx, {
            enrollmentId: enrollment.id,
            category: row.category,
            name: row.feeName,
            amount: row.amount,
            discount: row.discount,
            paid: row.paid,
            installments: row.installments,
          })

          // An opening balance has to be backed by a real transaction.
          // createFeeItem sets paidAmount on the item and its installments,
          // but on its own that leaves money the ledger cannot account for:
          // `sum(allocations) = paidAmount` would no longer hold, the family's
          // payment history would look empty, and a later payment-history
          // import would add the same money a second time. Mirrors how the
          // legacy migration records its deposits.
          if (row.paid > 0) {
            const paidInstallments = item.installments
              .map((i) => ({ id: i.id, paise: toPaise(i.paidAmount) }))
              .filter((i) => i.paise > 0)

            if (paidInstallments.length > 0) {
              await tx.feeTransaction.create({
                data: {
                  receiptNo: openingReceiptNo(item.id),
                  studentId,
                  category: row.category,
                  amount: toRupees(paidInstallments.reduce((n, i) => n + i.paise, 0)),
                  mode: 'OTHER',
                  remarks: 'Opening balance from the fee import — no payment date recorded',
                  allocations: {
                    create: paidInstallments.map((i) => ({
                      installmentId: i.id,
                      amount: toRupees(i.paise),
                    })),
                  },
                },
              })
            }
          }
        }, { timeout: 30_000, maxWait: 15_000 })
        createdCount++
      } catch (e) {
        failures.push({
          row: row.rowNumber,
          name: row.studentName,
          error: e instanceof Error ? e.message : 'unknown error',
        })
      }
    }
  }

  result.committed = true
  result.created = { feeItems: createdCount, failures }
  return result
}
