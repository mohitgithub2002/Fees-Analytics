import { NextRequest } from 'next/server'
import { err, handleError, ok, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'

/**
 * Clear school data so a different school's can be loaded.
 *
 * Deliberately awkward. It is irreversible, so it requires the caller to type
 * an exact confirmation phrase — a boolean flag is too easy to send by
 * accident from a half-written script, and there is no undo here.
 *
 * Staff logins, classes and academic sessions are always kept: they are
 * reusable scaffolding, not the school's data, and clearing them only creates
 * work.
 */
const CONFIRM_PHRASE = 'DELETE ALL SCHOOL DATA'

interface Body {
  scope?: 'recovery' | 'school'
  confirm?: string
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error
  if (gate.user.role !== 'SUPERUSER') {
    return err('only the superuser can clear school data', 403)
  }

  const body = await readJson<Body>(request)
  if (!body) return err('invalid JSON body')

  const scope = body.scope ?? 'recovery'
  if (scope !== 'recovery' && scope !== 'school') {
    return err("scope must be 'recovery' or 'school'")
  }
  if (body.confirm !== CONFIRM_PHRASE) {
    return err(`to confirm, send confirm: "${CONFIRM_PHRASE}"`)
  }

  try {
    const deleted: Record<string, number> = {}
    const count = async (label: string, fn: () => Promise<{ count: number }>) => {
      deleted[label] = (await fn()).count
    }

    // Order follows the foreign keys: the things that point at other things
    // go first.
    await count('promises', () => prisma.promiseToPay.deleteMany())
    await count('calls', () => prisma.contactAttempt.deleteMany())
    await count('cases', () => prisma.recoveryCase.deleteMany())
    await count('profiles', () => prisma.householdProfile.deleteMany())
    await count('phoneNumbers', () => prisma.householdContact.deleteMany())
    await count('familyMembers', () => prisma.householdMember.deleteMany())
    await count('families', () => prisma.household.deleteMany())
    await count('forecasts', () => prisma.collectionForecast.deleteMany())
    await count('importRows', () => prisma.paymentImportRow.deleteMany())
    await count('importBatches', () => prisma.paymentImportBatch.deleteMany())

    if (scope === 'school') {
      await count('allocations', () => prisma.transactionAllocation.deleteMany())
      await count('payments', () => prisma.feeTransaction.deleteMany())
      await count('discounts', () => prisma.feeDiscount.deleteMany())
      await count('installments', () => prisma.feeInstallment.deleteMany())
      await count('fees', () => prisma.studentFeeItem.deleteMany())
      await count('enrollments', () => prisma.studentEnrollment.deleteMany())
      await count('students', () => prisma.student.deleteMany())
      // The flat legacy table the original dashboard reads from. Left behind,
      // it would keep showing a different school's numbers at `/`.
      await count('legacyRows', () => prisma.studentFee.deleteMany())
    }

    invalidateTags(TAGS.fees, TAGS.recovery, TAGS.classes, TAGS.classrooms, TAGS.sessions)

    return ok({
      data: {
        scope,
        deleted,
        note:
          scope === 'school'
            ? 'School data cleared. Classes, sessions and staff logins were kept. Upload students next.'
            : 'Recovery data cleared. Students and fees were kept — re-run the family linking or upload students again.',
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
