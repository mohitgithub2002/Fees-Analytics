import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId } from '@/lib/fees/api'
import { cached, TAGS } from '@/lib/cache'
import { requireAdmin } from '@/lib/teaching/guards'
import {
  classCohorts,
  contactEffectiveness,
  installmentBehaviour,
  monthlyCollection,
  segmentMatrix,
} from '@/lib/recovery/cohorts'
import { $Enums } from '@/generated/prisma/client'

/**
 * The five behaviour lenses, served from one endpoint.
 *
 * One route rather than five because the screen is a set of tabs over the same
 * question — "how do these families actually pay?" — and a single `?lens=`
 * keeps the client, the cache keys and the docs from fanning out five ways for
 * no benefit.
 *
 *   installments  which installment underperforms, and by how much
 *   monthly       which months money actually arrives in
 *   classes       within a class, who pays most, about average, or little
 *   segments      how they pay crossed with whether they can
 *   effectiveness whether calling these people actually produced money
 */
const LENSES = ['installments', 'monthly', 'classes', 'segments', 'effectiveness'] as const
type Lens = (typeof LENSES)[number]

const CATEGORIES = new Set(Object.values($Enums.FeeCategory))

export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const lens = (sp.get('lens') ?? 'installments') as Lens
  if (!LENSES.includes(lens)) {
    return err(`lens must be one of: ${LENSES.join(', ')}`)
  }

  const rawSession = sp.get('sessionId')
  const sessionId = rawSession ? parseId(rawSession) : null
  if (rawSession && !sessionId) return err('invalid sessionId')

  const rawCategory = sp.get('category')
  if (rawCategory && !CATEGORIES.has(rawCategory as $Enums.FeeCategory)) {
    return err(`category must be one of: ${[...CATEGORIES].join(', ')}`)
  }
  const category = (rawCategory as $Enums.FeeCategory | null) ?? undefined

  try {
    const data = await cached(
      `recovery:behavior:${lens}:${sessionId ?? 'current'}:${category ?? 'SCHOOL'}`,
      { tags: [TAGS.recovery, TAGS.fees], ttlMs: 120_000 },
      async () => {
        switch (lens) {
          case 'installments':
            return installmentBehaviour({ sessionId: sessionId ?? undefined, category })
          case 'monthly':
            return monthlyCollection({ sessionId: sessionId ?? undefined })
          case 'classes':
            return classCohorts({ sessionId: sessionId ?? undefined })
          case 'segments':
            return segmentMatrix()
          case 'effectiveness':
            return contactEffectiveness()
        }
      }
    )
    return ok({ lens, data })
  } catch (e) {
    return handleError(e)
  }
}
