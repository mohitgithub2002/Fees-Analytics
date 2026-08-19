/**
 * Demo timing seeder for the recovery module.
 *
 * Every migrated payment currently carries the timestamp of the CSV import
 * run (`LEGACY-*` transactions all share one `paidAt`), so there is no real
 * payment-timing history yet — every recovery screen that reads "when did
 * money arrive" would be blank or meaningless. This script makes those
 * screens demoable today without inventing any money:
 *
 *   THE CONTRACT: a transaction's AMOUNT and its ALLOCATIONS are never
 *   invented — only its `paidAt` is synthesised. Each LEGACY-* transaction is
 *   split into 1–4 dated pieces whose amounts sum EXACTLY to the original,
 *   and whose per-installment allocations sum EXACTLY to the original
 *   per-installment allocation. FeeInstallment.paidAmount and
 *   StudentFeeItem.paidAmount/dueAmount are never touched, so every ledger
 *   invariant that held before this script runs still holds after it.
 *
 * Every synthetic transaction is tagged `receiptNo: DEMO-<original>-<n>` and
 * `remarks: '[demo-timing]'`, so:
 *   - it is trivially identifiable (see src/lib/recovery/cohorts.ts →
 *     timingProvenance, surfaced in the UI as an "Estimated timing" badge)
 *   - it is fully reversible with --undo
 *   - a real backfill (POST /api/v2/recovery/import/payments) can replace it
 *     per student without touching anyone else's data
 *
 * Dates are generated per student from a pattern chosen using ONLY figures
 * already in the ledger (paid ratio, presence of past-session dues) — never
 * randomly per-transaction — so a student's several fee-bucket payments read
 * as one coherent household story, and so the archetype classifier, reading
 * this timing back later, re-derives roughly the pattern that produced it.
 *
 * Also seeds a small spread of ContactAttempt / PromiseToPay rows so the CRM
 * screens are alive on first run. Requires guardians to exist — run
 * `link-guardians.ts` first.
 *
 * Usage:
 *   npx tsx prisma/seed-recovery-demo.ts --dry-run
 *   npx tsx prisma/seed-recovery-demo.ts
 *   npx tsx prisma/seed-recovery-demo.ts --undo
 */
import 'dotenv/config'
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '../src/generated/prisma/client'
import { toPaise, toRupees } from '../src/lib/fees/money'

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const DRY_RUN = process.argv.includes('--dry-run')
const UNDO = process.argv.includes('--undo')
const BACKUP_PATH = join(__dirname, '.recovery-demo-backup.json')
const DAY_MS = 86_400_000

/* ══ Undo ═══════════════════════════════════════════════════════════════ */

interface BackupRow {
  receiptNo: string
  studentId: number
  category: string | null
  amount: string
  mode: string
  reference: string | null
  remarks: string | null
  paidAt: string
  createdAt: string
  allocations: { installmentId: number; amount: string }[]
}

async function undo() {
  if (!existsSync(BACKUP_PATH)) {
    console.error('No backup file found — nothing to undo (or it was already undone).')
    process.exit(1)
  }
  const backup: BackupRow[] = JSON.parse(readFileSync(BACKUP_PATH, 'utf-8'))
  console.log(`Restoring ${backup.length} original LEGACY transaction(s)...`)

  const demoIds = await prisma.feeTransaction.findMany({
    where: { receiptNo: { startsWith: 'DEMO-' } },
    select: { id: true },
  })
  console.log(`Deleting ${demoIds.length} synthetic DEMO-* transaction(s)...`)

  if (!DRY_RUN) {
    await prisma.$transaction(async (tx) => {
      await tx.transactionAllocation.deleteMany({
        where: { transactionId: { in: demoIds.map((d) => d.id) } },
      })
      await tx.feeTransaction.deleteMany({ where: { id: { in: demoIds.map((d) => d.id) } } })

      for (const row of backup) {
        await tx.feeTransaction.create({
          data: {
            receiptNo: row.receiptNo,
            studentId: row.studentId,
            category: row.category as never,
            amount: row.amount,
            mode: row.mode as never,
            reference: row.reference,
            remarks: row.remarks,
            paidAt: new Date(row.paidAt),
            createdAt: new Date(row.createdAt),
            allocations: {
              create: row.allocations.map((a) => ({
                installmentId: a.installmentId,
                amount: a.amount,
              })),
            },
          },
        })
      }
    })
    unlinkSync(BACKUP_PATH)
  }
  console.log(DRY_RUN ? 'Dry run — no rows were written.' : 'Restore complete.')
}

/* ══ Pattern generation ═════════════════════════════════════════════════ */

type Pattern = 'early' | 'regular' | 'yearend' | 'yearend_partial' | 'rollover'

/**
 * Pick one storyline for a student from figures already in the ledger. Never
 * random — the point is that the synthetic timing is *consistent* with what
 * the ledger already shows, so the archetype classifier reads back roughly
 * what generated it.
 */
function choosePattern(billed: number, paid: number, hasPastDue: boolean, seed: number): Pattern {
  if (hasPastDue) return 'rollover'
  const ratio = billed > 0 ? paid / billed : 1

  if (ratio >= 0.95) {
    // A student-specific but deterministic 3-way split among the "pays in
    // full" storylines, so the whole population isn't one archetype.
    const bucket = seed % 10
    if (bucket < 3) return 'early'
    if (bucket < 8) return 'regular'
    return 'yearend'
  }
  if (ratio >= 0.5) return 'yearend_partial'
  return 'rollover'
}

/** [minShare, maxShare) of the session length, as an offset from its start. */
const PATTERN_WINDOW: Record<Pattern, [number, number]> = {
  early: [0.02, 0.3],
  regular: [0.05, 0.95],
  yearend: [0.65, 0.98],
  yearend_partial: [0.7, 1.05],
  rollover: [0.85, 1.6],
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

/** K dates within the pattern's window, relative to `session`, clamped to `now`. */
function patternDates(pattern: Pattern, sessionStart: Date, sessionEnd: Date, now: Date, k: number): Date[] {
  const lengthDays = Math.max(1, Math.round((sessionEnd.getTime() - sessionStart.getTime()) / DAY_MS))
  const [lo, hi] = PATTERN_WINDOW[pattern]
  const dates: Date[] = []
  for (let i = 0; i < k; i++) {
    // Evenly spaced within the window, with jitter, rather than fully random,
    // so multiple pieces don't cluster on the same day.
    const slot = k === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (k - 1)
    const jitter = (Math.random() - 0.5) * ((hi - lo) / Math.max(k, 2))
    const share = Math.max(0.01, Math.min(1.65, slot + jitter))
    const candidate = new Date(sessionStart.getTime() + share * lengthDays * DAY_MS)
    dates.push(candidate > now ? now : candidate)
  }
  return dates.sort((a, b) => a.getTime() - b.getTime())
}

/** Split `totalPaise` into `weights.length` integer pieces summing exactly to it. */
function weightedSplit(totalPaise: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const pieces = weights.map((w) => Math.floor((totalPaise * w) / sum))
  const remainder = totalPaise - pieces.reduce((a, b) => a + b, 0)
  pieces[pieces.length - 1] += remainder
  return pieces
}

/* ══ Main seeding pass ══════════════════════════════════════════════════ */

interface LegacyTxn {
  id: number
  receiptNo: string
  studentId: number
  category: string | null
  mode: string
  reference: string | null
  remarks: string | null
  paidAt: Date
  createdAt: Date
  allocations: {
    installmentId: number
    amount: Prisma.Decimal
    installment: { dueDate: Date | null; feeItem: { enrollment: { sessionId: number } } }
  }[]
}

async function seed() {
  if (existsSync(BACKUP_PATH)) {
    console.error(
      'A backup file already exists — the demo timing has already been seeded.\n' +
        'Run with --undo first if you want to regenerate it.'
    )
    process.exit(1)
  }

  const guardianCount = await prisma.guardian.count()
  if (guardianCount === 0) {
    console.error('No guardians found — run `npx tsx prisma/link-guardians.ts` first.')
    process.exit(1)
  }

  const now = new Date()
  const sessions = await prisma.academicSession.findMany({
    select: { id: true, startDate: true, endDate: true },
  })
  const sessionById = new Map(sessions.map((s) => [s.id, s]))

  const legacyTxns = (await prisma.feeTransaction.findMany({
    where: { receiptNo: { startsWith: 'LEGACY-' }, status: 'COMPLETED' },
    select: {
      id: true,
      receiptNo: true,
      studentId: true,
      category: true,
      mode: true,
      reference: true,
      remarks: true,
      paidAt: true,
      createdAt: true,
      allocations: {
        select: {
          installmentId: true,
          amount: true,
          installment: {
            select: {
              dueDate: true,
              feeItem: { select: { enrollment: { select: { sessionId: true } } } },
            },
          },
        },
      },
    },
  })) as LegacyTxn[]

  if (legacyTxns.length === 0) {
    console.log('No LEGACY-* transactions found — nothing to seed.')
    return
  }
  console.log(`Found ${legacyTxns.length} legacy transaction(s) across ${guardianCount} guardian(s).`)

  /* ── Per-student billing summary drives the pattern choice ──────────── */

  const billing = await prisma.$queryRaw<
    { studentId: number; sessionId: number; billed: unknown; paid: unknown; due: unknown; isCurrent: boolean }[]
  >(Prisma.sql`
    SELECT e."studentId", e."sessionId",
           COALESCE(SUM(f."netAmount"), 0)  AS billed,
           COALESCE(SUM(f."paidAmount"), 0) AS paid,
           COALESCE(SUM(f."dueAmount"), 0)  AS due,
           s."isCurrent"
    FROM "StudentEnrollment" e
    JOIN "AcademicSession" s ON s.id = e."sessionId"
    LEFT JOIN "StudentFeeItem" f ON f."enrollmentId" = e.id
    GROUP BY e."studentId", e."sessionId", s."isCurrent"
  `)

  const patternByStudent = new Map<number, Pattern>()
  const billingByStudent = new Map<number, typeof billing>()
  for (const row of billing) {
    const list = billingByStudent.get(row.studentId) ?? []
    list.push(row)
    billingByStudent.set(row.studentId, list)
  }
  for (const [studentId, rows] of billingByStudent) {
    const billed = rows.reduce((s, r) => s + Number(r.billed), 0)
    const paid = rows.reduce((s, r) => s + Number(r.paid), 0)
    const hasPastDue = rows.some((r) => !r.isCurrent && Number(r.due) > 0)
    patternByStudent.set(studentId, choosePattern(billed, paid, hasPastDue, studentId))
  }

  /* ── Back up originals before touching anything ──────────────────────── */

  const backup: BackupRow[] = legacyTxns.map((t) => {
    const totalPaise = t.allocations.reduce((s, a) => s + toPaise(a.amount as never), 0)
    return {
      receiptNo: t.receiptNo,
      studentId: t.studentId,
      category: t.category,
      amount: toRupees(totalPaise).toString(),
      mode: t.mode,
      reference: t.reference,
      remarks: t.remarks,
      paidAt: t.paidAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      allocations: t.allocations.map((a) => ({
        installmentId: a.installmentId,
        amount: toRupees(toPaise(a.amount as never)).toString(),
      })),
    }
  })
  if (!DRY_RUN) writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2))

  /* ── Split each transaction into dated pieces ────────────────────────── */

  let created = 0
  let processed = 0
  const patternCounts: Record<Pattern, number> = {
    early: 0, regular: 0, yearend: 0, yearend_partial: 0, rollover: 0,
  }

  for (const txn of legacyTxns) {
    const pattern = patternByStudent.get(txn.studentId) ?? 'regular'
    patternCounts[pattern]++

    // All allocations on one legacy transaction share a session (each is one
    // fee bucket on one enrollment) — see migrate-v2.ts createLegacyTransaction.
    const sessionId = txn.allocations[0]?.installment.feeItem.enrollment.sessionId
    const session = sessionId ? sessionById.get(sessionId) : null
    if (!session) continue

    const totalPaise = txn.allocations.reduce((s, a) => s + toPaise(a.amount as never), 0)
    if (totalPaise <= 0) continue

    const maxPieces = totalPaise >= 500_000 ? 3 : totalPaise >= 150_000 ? 2 : 1 // ₹5000 / ₹1500
    const k = randomInt(1, maxPieces)
    const dates = patternDates(pattern, session.startDate, session.endDate, now, k)
    const weights = Array.from({ length: k }, () => 0.6 + Math.random())

    // Split each installment's allocation across the k pieces independently,
    // so every piece's per-installment amounts still sum exactly to the
    // original allocation — the invariant the whole script exists to protect.
    const perInstallmentPieces = txn.allocations.map((a) => ({
      installmentId: a.installmentId,
      pieces: weightedSplit(toPaise(a.amount as never), weights),
    }))

    if (!DRY_RUN) {
      await prisma.$transaction(async (tx) => {
        await tx.transactionAllocation.deleteMany({ where: { transactionId: txn.id } })
        await tx.feeTransaction.delete({ where: { id: txn.id } })

        for (let i = 0; i < k; i++) {
          const allocsForPiece = perInstallmentPieces
            .map((p) => ({ installmentId: p.installmentId, amountPaise: p.pieces[i] }))
            .filter((p) => p.amountPaise > 0)
          if (allocsForPiece.length === 0) continue

          await tx.feeTransaction.create({
            data: {
              receiptNo: `DEMO-${txn.id}-${i + 1}`,
              studentId: txn.studentId,
              category: txn.category as never,
              amount: toRupees(allocsForPiece.reduce((s, a) => s + a.amountPaise, 0)),
              mode: txn.mode as never,
              reference: txn.reference,
              remarks: '[demo-timing]',
              paidAt: dates[i],
              allocations: {
                create: allocsForPiece.map((a) => ({
                  installmentId: a.installmentId,
                  amount: toRupees(a.amountPaise),
                })),
              },
            },
          })
        }
      })
    }

    created += k
    processed++
    if (processed % 200 === 0) console.log(`  ...${processed}/${legacyTxns.length} transactions processed`)
  }

  console.log('')
  console.log('── Demo timing seed report ──────────────────────────')
  console.log(`  Legacy transactions processed: ${processed}`)
  console.log(`  Synthetic dated transactions created: ${created}`)
  for (const [pattern, count] of Object.entries(patternCounts)) {
    console.log(`  Pattern "${pattern}": ${count} transaction(s)`)
  }
  if (DRY_RUN) {
    console.log('\n  Dry run — no rows were written, no backup saved.')
  } else {
    console.log(`\n  Backup saved to ${BACKUP_PATH} — run with --undo to restore.`)
    await seedContactsAndPromises(now)
  }
}

/* ══ Contacts + promises, so the CRM screens are alive on first run ═══════ */

const OUTCOMES = [
  'PROMISED', 'PROMISED', 'NEEDS_TIME', 'NO_ANSWER', 'NO_ANSWER',
  'CALL_BACK_LATER', 'REFUSED', 'SWITCHED_OFF', 'PAID_ALREADY',
] as const

async function seedContactsAndPromises(now: Date) {
  const currentSession = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  const superuser = await prisma.user.findFirst({ where: { role: 'SUPERUSER' } })

  const guardians = await prisma.guardian.findMany({
    select: { id: true, students: { where: { isPayer: true }, select: { studentId: true } } },
    take: 60,
  })
  if (guardians.length === 0) return

  const withDues: number[] = []
  for (const g of guardians) {
    const due = await prisma.studentFeeItem.aggregate({
      where: { enrollment: { studentId: { in: g.students.map((s) => s.studentId) } } },
      _sum: { dueAmount: true },
    })
    if (Number(due._sum.dueAmount ?? 0) > 0) withDues.push(g.id)
  }

  const contactTargets = withDues.slice(0, 40)
  let contacts = 0
  for (const guardianId of contactTargets) {
    const outcome = OUTCOMES[randomInt(0, OUTCOMES.length - 1)]
    const daysAgo = randomInt(0, 20)
    await prisma.contactAttempt.create({
      data: {
        guardianId,
        sessionId: currentSession?.id ?? null,
        channel: 'CALL',
        outcome,
        contactedAt: new Date(now.getTime() - daysAgo * DAY_MS),
        loggedById: superuser?.id ?? null,
        loggedByName: superuser?.name ?? 'System (demo)',
        notes: '[demo-timing] sample contact for demonstration',
      },
    })
    contacts++
  }

  const promiseTargets = withDues.slice(0, 15)
  let promises = 0
  if (currentSession) {
    for (const guardianId of promiseTargets) {
      const due = await prisma.studentFeeItem.aggregate({
        where: {
          enrollment: {
            studentId: {
              in: (
                await prisma.guardianStudent.findMany({
                  where: { guardianId, isPayer: true },
                  select: { studentId: true },
                })
              ).map((s) => s.studentId),
            },
          },
        },
        _sum: { dueAmount: true },
      })
      const outstanding = Number(due._sum.dueAmount ?? 0)
      if (outstanding <= 0) continue

      const promisedFor = new Date(now.getTime() + randomInt(-5, 12) * DAY_MS)
      await prisma.promiseToPay.create({
        data: {
          guardianId,
          sessionId: currentSession.id,
          amount: Math.min(outstanding, Math.round(outstanding * (0.3 + Math.random() * 0.5))),
          promisedFor,
          notes: '[demo-timing] sample promise for demonstration',
        },
      })
      promises++
    }
  }

  console.log(`  Seeded ${contacts} sample contact attempt(s) and ${promises} sample promise(s).`)
}

/* ══ Entry point ════════════════════════════════════════════════════════ */

async function main() {
  if (UNDO) await undo()
  else await seed()
}

main()
  .catch((e) => {
    console.error('Demo seeding failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
