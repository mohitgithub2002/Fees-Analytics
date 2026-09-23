import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { cancelTransaction } from '@/lib/fees/allocation'
import { recomputeForStudent } from '@/lib/recovery/recompute'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const transaction = await prisma.feeTransaction.findUnique({
    where: { id },
    include: {
      student: { select: { id: true, name: true, fatherName: true } },
      allocations: {
        include: {
          installment: {
            include: {
              feeItem: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  enrollment: {
                    select: { session: { select: { id: true, name: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!transaction) return err('transaction not found', 404)
  return ok(transaction)
}

/**
 * Cancel (reverse) a transaction: every allocated amount is subtracted back
 * from its installment and fee item. Allocation rows are kept for audit.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    const transaction = await prisma.$transaction((tx) => cancelTransaction(tx, id))
    invalidateTags(TAGS.fees, TAGS.recovery)
    // A reversed payment puts the balance back, so the family belongs on the
    // call list again. Non-fatal for the same reason as on the payment path.
    await recomputeForStudent(transaction.studentId).catch((e) =>
      console.error('recovery refresh after cancellation failed', e)
    )
    return ok(transaction)
  } catch (e) {
    return handleError(e)
  }
}
