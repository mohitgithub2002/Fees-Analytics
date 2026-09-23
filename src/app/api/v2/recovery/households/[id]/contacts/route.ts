import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { normalizePhone } from '@/lib/auth/phone'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { recomputeRecovery } from '@/lib/recovery/recompute'

/**
 * The phone numbers a household can be reached on.
 *
 * Kept separate from the call log (../calls) because they are different
 * things: one is contact details, the other is history. Conflating them makes
 * "which households can we not phone?" — the single biggest blocker in this
 * data, where no migrated student has a number at all — impossible to ask.
 */
const RELATIONS = new Set(['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER'])

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    const contacts = await prisma.householdContact.findMany({
      where: { householdId: id },
      orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
    })
    return ok({ data: contacts })
  } catch (e) {
    return handleError(e)
  }
}

interface ContactBody {
  phone?: string
  name?: string
  relation?: string
  isPrimary?: boolean
  notes?: string
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson<ContactBody>(request)
  if (!body) return err('invalid JSON body')
  if (!body.phone?.trim()) return err('phone is required')

  // Normalized so the same number typed two ways is stored once; the raw entry
  // is kept alongside it for display and correction.
  const phone = normalizePhone(body.phone)
  if (!phone) return err('that does not look like a valid phone number (10–15 digits)')

  const relation = (body.relation ?? 'FATHER').toUpperCase()
  if (!RELATIONS.has(relation)) {
    return err(`relation must be one of: ${[...RELATIONS].join(', ')}`)
  }

  try {
    const household = await prisma.household.findUnique({ where: { id }, select: { id: true } })
    if (!household) return err('household not found', 404)

    const contact = await prisma.$transaction(async (tx) => {
      if (body.isPrimary) {
        await tx.householdContact.updateMany({
          where: { householdId: id },
          data: { isPrimary: false },
        })
      }
      const existingCount = await tx.householdContact.count({ where: { householdId: id } })
      return tx.householdContact.create({
        data: {
          householdId: id,
          phone,
          rawPhone: body.phone!.trim(),
          name: body.name?.trim() || null,
          relation: relation as 'FATHER',
          // The first number added is the one to try, without anyone having to
          // say so.
          isPrimary: body.isPrimary ?? existingCount === 0,
          notes: body.notes?.trim() || null,
        },
      })
    })

    // A household that was suppressed for having no number is now callable, so
    // refresh it rather than making the owner wait for the nightly run.
    await recomputeRecovery({ householdIds: [id] }).catch(() => {})
    invalidateTags(TAGS.recovery)

    return ok({ data: contact }, 201)
  } catch (e) {
    return handleError(e)
  }
}
