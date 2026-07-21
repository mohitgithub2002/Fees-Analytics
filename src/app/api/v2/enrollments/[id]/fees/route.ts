import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, isPositiveAmount, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { $Enums } from '@/generated/prisma/client'
import { applyStructureToEnrollment, createFeeItem } from '@/lib/fees/fee-items'
import { InstallmentPlanInput } from '@/lib/fees/installments'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const feeItems = await prisma.studentFeeItem.findMany({
    where: { enrollmentId: id },
    include: {
      installments: { orderBy: { sequence: 'asc' } },
      discounts: { orderBy: { createdAt: 'desc' } },
    },
    orderBy: { id: 'asc' },
  })
  return ok({ data: feeItems })
}

const CATEGORIES = new Set(Object.values($Enums.FeeCategory))

/**
 * Add fees to an enrollment.
 *
 * Two modes:
 * - { fromStructure: true } — copy the class-wise fee structure (skips
 *   fees already assigned, so it is safe to repeat).
 * - { category, name, amount, discount?, installments? } — add a single fee.
 *   `installments` is either a count (amount split evenly) or an explicit
 *   [{ amount, label?, dueDate? }] plan summing to the amount.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  try {
    if ((body as { fromStructure?: boolean }).fromStructure) {
      const created = await prisma.$transaction((tx) => applyStructureToEnrollment(tx, id))
      invalidateTags(TAGS.fees)
      return ok({ data: created }, 201)
    }

    const { category, name, amount, discount, installments } = body as {
      category?: $Enums.FeeCategory
      name?: string
      amount?: number
      discount?: number
      installments?: number | InstallmentPlanInput[]
    }
    if (!category || !CATEGORIES.has(category)) {
      return err(`category must be one of: ${[...CATEGORIES].join(', ')}`)
    }
    if (!name?.trim()) return err('name is required')
    if (!isPositiveAmount(amount)) return err('amount must be a positive number')
    if (discount !== undefined && (typeof discount !== 'number' || discount < 0)) {
      return err('discount must be a non-negative number')
    }

    const feeItem = await prisma.$transaction(async (tx) => {
      const enrollment = await tx.studentEnrollment.findUnique({ where: { id } })
      if (!enrollment) return null
      return createFeeItem(tx, {
        enrollmentId: id,
        category,
        name: name.trim(),
        amount,
        discount,
        installments,
      })
    })
    if (!feeItem) return err('enrollment not found', 404)
    invalidateTags(TAGS.fees)
    return ok(feeItem, 201)
  } catch (e) {
    return handleError(e)
  }
}
