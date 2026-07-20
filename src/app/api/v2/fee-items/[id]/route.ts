import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, isPositiveAmount, ok, parseId, readJson } from '@/lib/fees/api'
import { changeFeeItemAmount, deleteFeeItem } from '@/lib/fees/fee-items'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const feeItem = await prisma.studentFeeItem.findUnique({
    where: { id },
    include: {
      installments: { orderBy: { sequence: 'asc' }, include: { allocations: true } },
      discounts: { orderBy: { createdAt: 'desc' } },
      enrollment: {
        include: {
          student: { select: { id: true, name: true } },
          session: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!feeItem) return err('fee item not found', 404)
  return ok(feeItem)
}

/** Change the fee amount (admin correction) and/or rename the fee. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { amount, name } = body as { amount?: number; name?: string }
  if (amount === undefined && name === undefined) return err('nothing to update')
  if (amount !== undefined && !isPositiveAmount(amount)) {
    return err('amount must be a positive number')
  }
  if (name !== undefined && !name.trim()) return err('name cannot be empty')

  try {
    const feeItem = await prisma.$transaction(async (tx) => {
      if (name !== undefined) {
        await tx.studentFeeItem.update({ where: { id }, data: { name: name.trim() } })
      }
      if (amount !== undefined) {
        return changeFeeItemAmount(tx, id, amount)
      }
      return tx.studentFeeItem.findUniqueOrThrow({
        where: { id },
        include: { installments: { orderBy: { sequence: 'asc' } } },
      })
    })
    return ok(feeItem)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    await prisma.$transaction((tx) => deleteFeeItem(tx, id))
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
