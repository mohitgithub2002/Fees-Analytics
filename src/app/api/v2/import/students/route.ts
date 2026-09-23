import { NextRequest } from 'next/server'
import { err, handleError, ok, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { requireAdmin } from '@/lib/teaching/guards'
import { importStudents } from '@/lib/import/students'
import { recomputeRecovery } from '@/lib/recovery/recompute'

interface Body {
  csv?: string
  mapping?: Record<string, string>
  commit?: boolean
  sessionName?: string
  applyFeeStructure?: boolean
}

/**
 * Load students, their parents and the family grouping.
 *
 * Works against an empty database: the session, classes and classrooms are
 * created on demand, so a school can go from nothing to a working call list
 * with one file.
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
    const result = await importStudents({
      csv: body.csv,
      mapping: body.mapping,
      commit: body.commit,
      sessionName: body.sessionName,
      applyFeeStructure: body.applyFeeStructure,
    })

    if (result.committed) {
      invalidateTags(TAGS.fees, TAGS.recovery, TAGS.classes, TAGS.classrooms, TAGS.sessions)
      // New families need profiles and cases before they can appear anywhere.
      await recomputeRecovery().catch((e) =>
        console.error('recompute after student import failed', e)
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
