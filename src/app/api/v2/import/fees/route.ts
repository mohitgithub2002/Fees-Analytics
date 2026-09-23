import { NextRequest } from 'next/server'
import { err, handleError, ok, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { requireAdmin } from '@/lib/teaching/guards'
import { importFees } from '@/lib/import/fees'
import { recomputeRecovery } from '@/lib/recovery/recompute'

interface Body {
  csv?: string
  mapping?: Record<string, string>
  commit?: boolean
}

/**
 * Load what each child was billed, including last year's unpaid balance.
 *
 * Always dry-runs unless `commit` is true.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const body = await readJson<Body>(request)
  if (!body) return err('invalid JSON body')
  if (!body.csv?.trim()) return err('csv content is required')

  try {
    const result = await importFees({
      csv: body.csv,
      mapping: body.mapping,
      commit: body.commit,
    })

    if (result.committed) {
      invalidateTags(TAGS.fees, TAGS.recovery)
      await recomputeRecovery().catch((e) =>
        console.error('recompute after fee import failed', e)
      )
    }

    return ok({ data: result })
  } catch (e) {
    if (e instanceof Error && !(e as { code?: string }).code) {
      return err(e.message)
    }
    return handleError(e)
  }
}
