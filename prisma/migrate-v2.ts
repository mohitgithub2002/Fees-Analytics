/**
 * One-time data migration: legacy StudentFee rows → the normalized v2 schema
 * (sessions, classes, classrooms, students, enrollments, fee items,
 * installments, discounts and legacy payment transactions).
 *
 * The legacy table is READ ONLY — nothing in it is modified.
 *
 * Usage:
 *   npx tsx prisma/migrate-v2.ts          # refuses to run if v2 data exists
 *   npx tsx prisma/migrate-v2.ts --force  # wipes v2 tables first, then migrates
 *
 * Mapping decisions (documented for auditability):
 * - Sessions: the legacy `academicYear` (e.g. "2024-25") becomes the current
 *   session; the year before it is created to hold carried-forward dues.
 *   Sessions run 1 April – 31 March.
 * - Previous-year fees become a single "Previous Session Balance" fee item on
 *   an enrollment in the previous session. The legacy table does not record
 *   which class the student was in last year, so the previous-session
 *   classroom reuses the current class name (best available data).
 * - Amounts are reconstructed as deposit + discount + due for each bucket so
 *   the migrated dues match the legacy dues exactly, even where the legacy
 *   `fees` column is internally inconsistent. Mismatches are logged.
 * - School fees are split into 3 installments; bus and extra fees get one
 *   installment each. Legacy deposits are recorded as one COMPLETED
 *   transaction per fee bucket (receipt "LEGACY-<row>-<bucket>") allocated
 *   installment-by-installment, so sum(allocations) = paidAmount holds.
 * - A class-wise FeeStructure for the current session is seeded from the most
 *   common school-fee amount per class, as an editable starting point.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { $Enums, PrismaClient, Prisma } from '../src/generated/prisma/client'
import { createFeeItem } from '../src/lib/fees/fee-items'
import { toPaise, toRupees } from '../src/lib/fees/money'

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const CLASS_ORDER = [
  'Play', 'Nursery', 'NC', 'KG', 'LKG', 'UKG',
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
]

function classOrder(name: string): number {
  const idx = CLASS_ORDER.findIndex((c) => c.toLowerCase() === name.toLowerCase())
  return idx === -1 ? 100 : idx
}

/** "2024-25" → "2023-24" */
function previousSessionName(name: string): string {
  const match = name.match(/^(\d{4})-(\d{2})$/)
  if (!match) return `before ${name}`
  const startYear = parseInt(match[1], 10) - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

function sessionDates(name: string): { startDate: Date; endDate: Date } {
  const match = name.match(/^(\d{4})-/)
  const year = match ? parseInt(match[1], 10) : new Date().getFullYear()
  return {
    startDate: new Date(Date.UTC(year, 3, 1)), // 1 April
    endDate: new Date(Date.UTC(year + 1, 2, 31)), // 31 March
  }
}

const clamp = (v: number) => Math.max(0, v ?? 0)

interface Bucket {
  deposit: number
  discount: number
  due: number
  recordedFees: number
  original: number // reconstructed: deposit + discount + due
}

function bucket(fees: number, deposit: number, discount: number, due: number): Bucket {
  const d = clamp(deposit)
  const disc = clamp(discount)
  const dueAmt = clamp(due)
  return {
    deposit: d,
    discount: disc,
    due: dueAmt,
    recordedFees: clamp(fees),
    original: toRupees(toPaise(d) + toPaise(disc) + toPaise(dueAmt)),
  }
}

const hasValue = (b: Bucket) => b.original > 0 || b.deposit > 0

async function wipeV2() {
  console.log('--force: wiping existing v2 data...')
  await prisma.transactionAllocation.deleteMany()
  await prisma.feeTransaction.deleteMany()
  await prisma.feeDiscount.deleteMany()
  await prisma.feeInstallment.deleteMany()
  await prisma.studentFeeItem.deleteMany()
  await prisma.feeStructureItem.deleteMany()
  await prisma.feeStructure.deleteMany()
  await prisma.studentEnrollment.deleteMany()
  await prisma.classroom.deleteMany()
  await prisma.student.deleteMany()
  await prisma.schoolClass.deleteMany()
  await prisma.academicSession.deleteMany()
}

async function createLegacyTransaction(
  tx: Prisma.TransactionClient,
  opts: {
    studentId: number
    category: $Enums.FeeCategory
    receiptNo: string
    paidAt: Date
    installments: { id: number; paidAmount: unknown }[]
  }
) {
  const paidInstallments = opts.installments
    .map((i) => ({ id: i.id, paidPaise: toPaise(i.paidAmount as never) }))
    .filter((i) => i.paidPaise > 0)
  if (paidInstallments.length === 0) return
  const totalPaise = paidInstallments.reduce((sum, i) => sum + i.paidPaise, 0)

  await tx.feeTransaction.create({
    data: {
      receiptNo: opts.receiptNo,
      studentId: opts.studentId,
      category: opts.category,
      amount: toRupees(totalPaise),
      mode: 'OTHER',
      remarks: 'Migrated from legacy StudentFee table',
      paidAt: opts.paidAt,
      allocations: {
        create: paidInstallments.map((i) => ({
          installmentId: i.id,
          amount: toRupees(i.paidPaise),
        })),
      },
    },
  })
}

async function main() {
  const force = process.argv.includes('--force')

  const existing = await prisma.student.count()
  if (existing > 0) {
    if (!force) {
      console.error(
        `❌ v2 tables already contain ${existing} students. Re-run with --force to wipe and re-migrate.`
      )
      process.exit(1)
    }
    await wipeV2()
  }

  const rows = await prisma.studentFee.findMany({ orderBy: { id: 'asc' } })
  if (rows.length === 0) {
    console.error('❌ Legacy StudentFee table is empty — nothing to migrate.')
    process.exit(1)
  }
  console.log(`Migrating ${rows.length} legacy StudentFee rows...`)

  // ---- Sessions -----------------------------------------------------------
  const currentName = rows
    .map((r) => r.academicYear)
    .sort()
    .at(-1)!
  const prevName = previousSessionName(currentName)

  const currentSession = await prisma.academicSession.create({
    data: { name: currentName, isCurrent: true, ...sessionDates(currentName) },
  })
  const previousSession = await prisma.academicSession.create({
    data: { name: prevName, isCurrent: false, ...sessionDates(prevName) },
  })
  console.log(`Sessions: ${prevName} (previous), ${currentName} (current)`)

  // ---- Classes & classrooms ----------------------------------------------
  const classNames = [...new Set(rows.map((r) => r.class.trim()).filter(Boolean))]
  classNames.sort((a, b) => classOrder(a) - classOrder(b))

  const classIdByName = new Map<string, number>()
  const currentClassroomByClass = new Map<string, number>()
  const previousClassroomByClass = new Map<string, number>()
  for (const [i, name] of classNames.entries()) {
    const cls = await prisma.schoolClass.create({ data: { name, displayOrder: i } })
    classIdByName.set(name, cls.id)
    const room = await prisma.classroom.create({
      data: { classId: cls.id, sessionId: currentSession.id },
    })
    currentClassroomByClass.set(name, room.id)
  }
  console.log(`Created ${classNames.length} classes with current-session classrooms.`)

  // ---- Students, enrollments, fees ---------------------------------------
  let feeMismatches = 0
  let migrated = 0
  const schoolFeeSamples = new Map<string, number[]>()

  for (const row of rows) {
    const className = row.class.trim()
    if (!className || !currentClassroomByClass.has(className)) {
      console.warn(`⚠️  Row ${row.id} (${row.studentName}): unknown class "${row.class}" — skipped`)
      continue
    }

    const prev = bucket(row.previousFees, row.previousDeposit, row.previousDiscount, row.previousDue)
    const school = bucket(row.schoolFees, row.schoolDeposit, row.schoolDiscount, row.schoolDue)
    const bus = bucket(row.busFees, row.busDeposit, row.busDiscount, row.busDue)
    const extra = bucket(row.extraFees, row.extraDeposit, row.extraDiscount, row.extraDue)
    for (const [name, b] of [['previous', prev], ['school', school], ['bus', bus]] as const) {
      if (b.recordedFees > 0 && toPaise(b.recordedFees) !== toPaise(b.original)) {
        feeMismatches++
        if (feeMismatches <= 5) {
          console.warn(
            `   note: row ${row.id} ${name} fees ${b.recordedFees} != deposit+discount+due ${b.original} — using ${b.original}`
          )
        }
      }
    }
    schoolFeeSamples.set(className, [...(schoolFeeSamples.get(className) ?? []), school.original])

    await prisma.$transaction(async (tx) => {
      const student = await tx.student.create({
        data: {
          name: row.studentName.trim(),
          fatherName: row.fatherName.trim(),
          remarks: row.remarks?.trim() || null,
          legacyStudentFeeId: row.id,
        },
      })

      // Current-session enrollment with its fee items.
      const enrollment = await tx.studentEnrollment.create({
        data: {
          studentId: student.id,
          sessionId: currentSession.id,
          classroomId: currentClassroomByClass.get(className)!,
        },
      })

      const buckets: { cat: $Enums.FeeCategory; name: string; b: Bucket; installments: number }[] = [
        { cat: 'SCHOOL', name: 'School Fees', b: school, installments: 3 },
        { cat: 'BUS', name: 'Bus Fees', b: bus, installments: 1 },
        { cat: 'OTHER', name: 'Other Fees', b: extra, installments: 1 },
      ]
      for (const { cat, name, b, installments } of buckets) {
        if (!hasValue(b)) continue
        const item = await createFeeItem(tx, {
          enrollmentId: enrollment.id,
          category: cat,
          name,
          amount: b.original,
          discount: b.discount,
          paid: b.deposit,
          installments,
        })
        await createLegacyTransaction(tx, {
          studentId: student.id,
          category: cat,
          receiptNo: `LEGACY-${row.id}-${cat}`,
          paidAt: row.createdAt,
          installments: item.installments,
        })
      }

      // Previous-session balance, if any.
      if (hasValue(prev)) {
        let prevRoomId = previousClassroomByClass.get(className)
        if (!prevRoomId) {
          const room = await tx.classroom.create({
            data: { classId: classIdByName.get(className)!, sessionId: previousSession.id },
          })
          prevRoomId = room.id
          previousClassroomByClass.set(className, room.id)
        }
        const prevEnrollment = await tx.studentEnrollment.create({
          data: {
            studentId: student.id,
            sessionId: previousSession.id,
            classroomId: prevRoomId,
            status: 'PROMOTED',
            notes: 'Backfilled from legacy previous-year balance; class is the current class (previous class unknown).',
          },
        })
        const item = await createFeeItem(tx, {
          enrollmentId: prevEnrollment.id,
          category: 'SCHOOL',
          name: 'Previous Session Balance',
          amount: prev.original,
          discount: prev.discount,
          paid: prev.deposit,
          installments: 1,
        })
        await createLegacyTransaction(tx, {
          studentId: student.id,
          category: 'SCHOOL',
          receiptNo: `LEGACY-${row.id}-PREV`,
          paidAt: row.createdAt,
          installments: item.installments,
        })
      }
    })

    migrated++
    if (migrated % 100 === 0) console.log(`  ...${migrated}/${rows.length} students migrated`)
  }

  // ---- Class-wise fee structures (editable starting point) ----------------
  for (const [className, samples] of schoolFeeSamples) {
    const nonZero = samples.filter((s) => s > 0)
    if (nonZero.length === 0) continue
    const counts = new Map<number, number>()
    for (const s of nonZero) counts.set(s, (counts.get(s) ?? 0) + 1)
    const modeAmount = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    await prisma.feeStructure.create({
      data: {
        sessionId: currentSession.id,
        classId: classIdByName.get(className)!,
        items: {
          create: [
            { category: 'SCHOOL', name: 'School Fees', amount: modeAmount, installmentCount: 3 },
          ],
        },
      },
    })
  }
  console.log(`Seeded fee structures for ${schoolFeeSamples.size} classes (most common school fee per class).`)

  // ---- Verification --------------------------------------------------------
  const [legacyTotals, v2Due, v2Paid] = await Promise.all([
    prisma.studentFee.aggregate({ _sum: { totalDue: true, totalDeposit: true } }),
    prisma.studentFeeItem.aggregate({ _sum: { dueAmount: true } }),
    prisma.studentFeeItem.aggregate({ _sum: { paidAmount: true } }),
  ])
  console.log(`\nMigrated ${migrated} students (${feeMismatches} rows had internally inconsistent legacy fee totals).`)
  console.log(`Legacy total due:     ${legacyTotals._sum.totalDue}`)
  console.log(`V2     total due:     ${Number(v2Due._sum.dueAmount)}`)
  console.log(`Legacy total deposit: ${legacyTotals._sum.totalDeposit}`)
  console.log(`V2     total paid:    ${Number(v2Paid._sum.paidAmount)}`)
  console.log('\n✅ Migration complete.')
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
