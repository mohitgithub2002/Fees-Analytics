/**
 * Run the full recovery recompute from the command line.
 *
 * The same work as POST /api/v2/recovery/profiles/recalculate (and the
 * "Recalculate" button on the Command Center), but without needing an
 * authenticated session — for first-time setup, after a bulk import, or from a
 * scheduled job.
 *
 *   npm run recovery:recalculate
 */
import 'dotenv/config'
import { recomputeRecovery } from '../src/lib/recovery/recompute'
import { snapshotForecast } from '../src/lib/recovery/forecast'
import { prisma } from '../src/lib/prisma'

async function main() {
  console.log('Recomputing recovery profiles and cases...')
  const result = await recomputeRecovery()

  console.log('')
  console.log('── Recompute report ─────────────────────────────────')
  console.log(`  Households profiled:  ${result.guardians}`)
  console.log(`  Recovery cases:       ${result.cases}`)
  console.log(`  Promises kept:        ${result.promises.kept}`)
  console.log(`  Promises partial:     ${result.promises.partial}`)
  console.log(`  Promises broken:      ${result.promises.broken}`)
  console.log(`  Promises still open:  ${result.promises.stillOpen}`)
  console.log(`  Took:                 ${(result.durationMs / 1000).toFixed(1)}s`)

  const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (session) {
    const forecast = await snapshotForecast(session.id)
    const next = forecast.months.find((m) => !m.isPast && !m.isCurrent)
    console.log('')
    console.log(`  Forecast snapshot taken for ${forecast.sessionName}`)
    if (next) {
      console.log(`  Next month (${next.label}): committed ₹${Math.round(next.committed).toLocaleString('en-IN')} · likely ₹${Math.round(next.likely).toLocaleString('en-IN')}`)
    }
  }
}

main()
  .catch((e) => {
    console.error('Recompute failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
