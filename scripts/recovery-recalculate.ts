/**
 * Rebuild every household profile and recovery case.
 *
 *   npm run recovery:recalculate
 *   npm run recovery:recalculate -- --session "2024-25"
 *
 * Does the same work as POST /api/v2/recovery/recalculate and the Recalculate
 * button on the command centre, but without needing a signed-in session — use
 * it for first-time setup, after a bulk import, or from a scheduled job. This
 * app has no background job runner, so this script (or the endpoint) is the
 * hook point for a real cron.
 *
 * Idempotent: running it twice produces the same rows, and it never touches
 * the decisions a person made — stage, snooze, park, pin.
 */
// dotenv must be imported before anything that pulls in @/lib/prisma, which
// reads DATABASE_URL at module load.
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { recomputeRecovery } from '../src/lib/recovery/recompute'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

function money(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

async function main() {
  const sessionName = arg('--session')
  let sessionId: number | undefined

  if (sessionName) {
    const session = await prisma.academicSession.findUnique({ where: { name: sessionName } })
    if (!session) {
      console.error(`❌ No session named "${sessionName}".`)
      process.exit(1)
    }
    sessionId = session.id
  }

  const householdCount = await prisma.household.count()
  if (householdCount === 0) {
    console.error('❌ No households yet. Run `npm run recovery:link-households` first.')
    process.exit(1)
  }

  console.log(`Recalculating ${householdCount} household(s)...`)
  const result = await recomputeRecovery({ sessionId })

  console.log(`\n✅ ${result.sessionName}: ${result.households} household(s) in ${(result.durationMs / 1000).toFixed(1)}s`)
  console.log(`   ${result.callable} worth calling, ${result.suppressed} skipped today`)
  console.log(`   ${money(result.totalOutstanding)} outstanding`)
  console.log(`   ${money(result.totalExpectedRecovery)} expected from the callable ones`)

  const p = result.promises
  if (p.kept + p.partial + p.broken + p.stillOpen > 0) {
    console.log(
      `   promises: ${p.kept} kept, ${p.partial} part-paid, ${p.broken} broken, ${p.stillOpen} still open`
    )
  }

  // A quick read on what the school actually looks like, so the numbers can be
  // sanity-checked against what the owner already knows about their families.
  const byArchetype = await prisma.householdProfile.groupBy({
    by: ['archetype'],
    _count: { _all: true },
    orderBy: { _count: { archetype: 'desc' } },
  })
  console.log('\n   How these families pay:')
  for (const row of byArchetype) {
    console.log(`     ${String(row.archetype).padEnd(20)} ${row._count._all}`)
  }

  const suppressed = await prisma.recoveryCase.groupBy({
    by: ['suppressionReason'],
    _count: { _all: true },
    where: { suppressionReason: { not: null } },
    orderBy: { _count: { suppressionReason: 'desc' } },
    take: 8,
  })
  if (suppressed.length > 0) {
    console.log('\n   Why households are being skipped:')
    for (const row of suppressed) {
      console.log(`     ${row._count._all.toString().padStart(4)}  ${row.suppressionReason}`)
    }
  }
}

main()
  .catch((e) => {
    console.error('❌ Recalculate failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
