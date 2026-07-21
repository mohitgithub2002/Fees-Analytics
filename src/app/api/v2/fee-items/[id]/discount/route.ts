import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, isPositiveAmount, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { applyDiscount } from '@/lib/fees/fee-items'

/**
 * Apply a discount to a fee item. The reduction is spread across UNPAID
 * installment balances only (last installment first); paid installments are
 * never altered, so recorded payments always stay valid.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { amount, reason, appliedBy } = body as {
    amount?: number
    reason?: string
    appliedBy?: string
  }
  if (!isPositiveAmount(amount)) return err('amount must be a positive number')

  try {
    const feeItem = await prisma.$transaction((tx) =>
      applyDiscount(tx, id, amount, reason, appliedBy)
    )
    invalidateTags(TAGS.fees)
    return ok(feeItem)
  } catch (e) {
    return handleError(e)
  }
}
