/**
 * Backfill FeeInstallment.dueDate from each structure item's schedule
 * (FeeStructureInstallment), for installments created before a schedule
 * existed on their structure.
 *
 * Matched on (feeItem.structureItemId, installment.sequence) — the same pair
 * `applyStructureToEnrollment` now uses going forward. An installment whose
 * fee item has no structureItemId (a manually-added fee) or whose structure
 * has no schedule is left untouched; recovery analytics fall back to
 * session-relative timing for those, exactly as before this script exists.
 *
 * Idempotent: only installments with a NULL dueDate are touched, so re-running
 * after adding a new schedule only fills the newly-coverable rows.
 *
 * Usage:
 *   npx tsx prisma/backfill-due-dates.ts --dry-run
 *   npx tsx prisma/backfill-due-dates.ts
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const installments = await prisma.feeInstallment.findMany({
    where: { dueDate: null, feeItem: { structureItemId: { not: null } } },
    select: {
      id: true,
      sequence: true,
      feeItem: { select: { structureItemId: true, name: true } },
    },
  })

  if (installments.length === 0) {
    console.log('No undated installments with a linked structure item. Nothing to do.')
    return
  }

  const structureItemIds = [
    ...new Set(installments.map((i) => i.feeItem.structureItemId!).filter(Boolean)),
  ]
  const schedules = await prisma.feeStructureInstallment.findMany({
    where: { structureItemId: { in: structureItemIds } },
  })
  const scheduleByItem = new Map<number, Map<number, Date>>()
  for (const row of schedules) {
    const bySeq = scheduleByItem.get(row.structureItemId) ?? new Map<number, Date>()
    bySeq.set(row.sequence, row.dueDate)
    scheduleByItem.set(row.structureItemId, bySeq)
  }

  let updated = 0
  let skippedNoSchedule = 0
  const perItem: Record<string, number> = {}

  for (const inst of installments) {
    const bySeq = scheduleByItem.get(inst.feeItem.structureItemId!)
    const dueDate = bySeq?.get(inst.sequence)
    if (!dueDate) {
      skippedNoSchedule++
      continue
    }
    perItem[inst.feeItem.name] = (perItem[inst.feeItem.name] ?? 0) + 1
    if (!DRY_RUN) {
      await prisma.feeInstallment.update({ where: { id: inst.id }, data: { dueDate } })
    }
    updated++
  }

  console.log('')
  console.log('── Due-date backfill report ─────────────────────────')
  for (const [name, count] of Object.entries(perItem)) {
    console.log(`  ${name}: ${count} installment(s)`)
  }
  console.log(`  Updated: ${updated}`)
  console.log(`  Skipped (structure has no matching schedule row): ${skippedNoSchedule}`)
  if (DRY_RUN) console.log('\n  Dry run — no rows were written.')
}

main()
  .catch((e) => {
    console.error('Due-date backfill failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
