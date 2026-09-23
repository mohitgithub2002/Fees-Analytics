/**
 * Copy fee-structure due-date schedules onto installments that already exist.
 *
 * New enrollments pick their dates up automatically (applyStructureToEnrollment
 * builds a dated plan when the structure item carries a schedule). Fee items
 * created before the schedule was defined — everything migrated from the legacy
 * table — have `dueDate = null`, and an undated installment can be judged
 * neither on time nor late. This script fills them in.
 *
 * Usage:
 *   npm run recovery:backfill-due-dates -- --dry-run   # report, change nothing
 *   npm run recovery:backfill-due-dates                # apply
 *   npm run recovery:backfill-due-dates -- --session "2024-25"
 *
 * Only `FeeInstallment.dueDate` is written. No amount, status or allocation is
 * touched, so every ledger invariant in docs/FEES_V2.md is untouched by design.
 *
 * Re-running is a no-op: an installment whose date already matches the
 * schedule is skipped, so the script is safe to run after every structure edit.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const pool = new Pool({ connectionString: `${process.env.DATABASE_URL}` })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const DRY_RUN = process.argv.includes('--dry-run')
const SESSION_NAME = arg('--session')

function sameDay(a: Date | null, b: Date): boolean {
  return a !== null && a.getTime() === b.getTime()
}

async function main() {
  const sessionFilter = SESSION_NAME
    ? await prisma.academicSession.findUnique({ where: { name: SESSION_NAME } })
    : null
  if (SESSION_NAME && !sessionFilter) {
    console.error(`❌ No session named "${SESSION_NAME}".`)
    process.exit(1)
  }

  const items = await prisma.feeStructureItem.findMany({
    where: sessionFilter ? { feeStructure: { sessionId: sessionFilter.id } } : {},
    include: {
      schedule: { orderBy: { sequence: 'asc' } },
      feeStructure: {
        include: {
          class: { select: { name: true } },
          session: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  })

  if (items.length === 0) {
    console.log('No fee-structure items found. Define a structure first.')
    return
  }

  const scheduled = items.filter((i) => i.schedule.length > 0)
  const unscheduled = items.filter((i) => i.schedule.length === 0)

  console.log(
    `${items.length} structure item(s): ${scheduled.length} with a schedule, ${unscheduled.length} without.\n`
  )

  let wouldUpdate = 0
  let alreadyCorrect = 0
  let sequenceMismatch = 0

  for (const item of scheduled) {
    const label = `${item.feeStructure.session.name} · ${item.feeStructure.class.name} · ${item.name}`
    const dateBySequence = new Map(item.schedule.map((s) => [s.sequence, s.dueDate]))

    const installments = await prisma.feeInstallment.findMany({
      where: { feeItem: { structureItemId: item.id } },
      select: { id: true, sequence: true, dueDate: true },
    })
    if (installments.length === 0) {
      console.log(`  ${label}: no student installments assigned yet`)
      continue
    }

    const pending: { id: number; dueDate: Date }[] = []
    let missing = 0
    for (const inst of installments) {
      const target = dateBySequence.get(inst.sequence)
      if (!target) {
        // A student's item was edited to have more installments than the
        // structure schedules. Reported, never guessed at.
        missing++
        continue
      }
      if (sameDay(inst.dueDate, target)) alreadyCorrect++
      else pending.push({ id: inst.id, dueDate: target })
    }
    sequenceMismatch += missing

    const note = missing > 0 ? `, ${missing} beyond the schedule (left undated)` : ''
    console.log(
      `  ${label}: ${pending.length} to date, ${installments.length - pending.length - missing} already correct${note}`
    )

    if (!DRY_RUN && pending.length > 0) {
      // Grouped by date so the whole item is a handful of statements rather
      // than one per student.
      const byDate = new Map<number, number[]>()
      for (const p of pending) {
        const key = p.dueDate.getTime()
        const list = byDate.get(key)
        if (list) list.push(p.id)
        else byDate.set(key, [p.id])
      }
      for (const [time, ids] of byDate) {
        await prisma.feeInstallment.updateMany({
          where: { id: { in: ids } },
          data: { dueDate: new Date(time) },
        })
      }
    }
    wouldUpdate += pending.length
  }

  if (unscheduled.length > 0) {
    console.log(
      `\n${unscheduled.length} item(s) have no schedule — their installments stay undated and are\n` +
        'judged on session-relative timing instead of on-time/late. Add dates at\n' +
        'Setup → Fee Structures to make them measurable:'
    )
    for (const item of unscheduled) {
      console.log(
        `  · ${item.feeStructure.session.name} · ${item.feeStructure.class.name} · ${item.name}`
      )
    }
  }

  console.log(
    `\n${DRY_RUN ? 'Would update' : 'Updated'} ${wouldUpdate} installment(s); ` +
      `${alreadyCorrect} already correct; ${sequenceMismatch} outside the schedule.`
  )
  if (DRY_RUN) console.log('Dry run — nothing was written. Re-run without --dry-run to apply.')
}

main()
  .catch((e) => {
    console.error('❌ Backfill failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
