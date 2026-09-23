import { NextRequest } from 'next/server'
import { err, handleError, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { normalizePhone } from '@/lib/auth/phone'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { recomputeRecovery } from '@/lib/recovery/recompute'

const VERIFICATIONS = new Set(['UNVERIFIED', 'VERIFIED', 'WRONG_NUMBER', 'UNREACHABLE'])

interface PatchBody {
  phone?: string
  name?: string | null
  isPrimary?: boolean
  verification?: string
  notes?: string | null
}

/**
 * Correct a number, promote it to primary, or mark it as not working.
 *
 * Marking a number WRONG_NUMBER or UNREACHABLE keeps the record rather than
 * deleting it — otherwise the same wrong number gets re-entered from the same
 * stale admission form a month later.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const { id: rawId, contactId: rawContactId } = await params
  const id = parseId(rawId)
  const contactId = parseId(rawContactId)
  if (!id || !contactId) return err('invalid id', 400)

  const body = await readJson<PatchBody>(request)
  if (!body) return err('invalid JSON body')

  const data: Record<string, unknown> = {}

  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone)
    if (!phone) return err('that does not look like a valid phone number (10–15 digits)')
    data.phone = phone
    data.rawPhone = body.phone.trim()
    // A corrected number has not been proven to work yet.
    data.verification = 'UNVERIFIED'
  }
  if (body.name !== undefined) data.name = body.name?.trim() || null
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null
  if (body.verification !== undefined) {
    if (!VERIFICATIONS.has(body.verification)) {
      return err(`verification must be one of: ${[...VERIFICATIONS].join(', ')}`)
    }
    data.verification = body.verification
  }

  if (Object.keys(data).length === 0 && body.isPrimary === undefined) {
    return err('nothing to update')
  }

  try {
    const existing = await prisma.householdContact.findFirst({
      where: { id: contactId, householdId: id },
      select: { id: true },
    })
    // 404 rather than 403 when it belongs to another household: which
    // households exist is not something this endpoint should confirm.
    if (!existing) return err('contact not found', 404)

    const contact = await prisma.$transaction(async (tx) => {
      if (body.isPrimary) {
        await tx.householdContact.updateMany({
          where: { householdId: id },
          data: { isPrimary: false },
        })
        data.isPrimary = true
      } else if (body.isPrimary === false) {
        data.isPrimary = false
      }
      return tx.householdContact.update({ where: { id: contactId }, data })
    })

    await recomputeRecovery({ householdIds: [id] }).catch(() => {})
    invalidateTags(TAGS.recovery)

    return ok({ data: contact })
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const { id: rawId, contactId: rawContactId } = await params
  const id = parseId(rawId)
  const contactId = parseId(rawContactId)
  if (!id || !contactId) return err('invalid id', 400)

  try {
    const existing = await prisma.householdContact.findFirst({
      where: { id: contactId, householdId: id },
      select: { id: true },
    })
    if (!existing) return err('contact not found', 404)

    await prisma.householdContact.delete({ where: { id: contactId } })
    await recomputeRecovery({ householdIds: [id] }).catch(() => {})
    invalidateTags(TAGS.recovery)

    return ok({ data: { id: contactId, deleted: true } })
  } catch (e) {
    return handleError(e)
  }
}
