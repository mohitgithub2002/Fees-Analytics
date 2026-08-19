import { err, handleError, ok } from '@/lib/fees/api'
import { recomputeRecovery } from '@/lib/recovery/recompute'
import { snapshotForecast } from '@/lib/recovery/forecast'
import { prisma } from '@/lib/prisma'

/**
 * Manual full refresh — mirrors /api/v1/admin/pacing/recalculate. Runs the
 * whole recovery module (promise resolution, profiles, cases, a forecast
 * snapshot) for every guardian. Also runs automatically after any payment or
 * logged contact for the affected household; this is for "recompute
 * everything now" after a bulk import or a tuning change.
 */
export async function POST() {
  try {
    const result = await recomputeRecovery()

    const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    if (session) await snapshotForecast(session.id)

    return ok(result)
  } catch (e) {
    return handleError(e)
  }
}

export async function GET() {
  return err('use POST to trigger a recalculation', 405)
}
