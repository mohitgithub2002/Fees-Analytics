import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, parseId } from '@/lib/fees/api'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const structure = await prisma.feeStructure.findUnique({
    where: { id },
    include: {
      class: true,
      session: { select: { id: true, name: true, isCurrent: true } },
      items: { orderBy: { id: 'asc' } },
    },
  })
  if (!structure) return err('fee structure not found', 404)
  return ok(structure)
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  try {
    // Deleting a structure never touches fees already assigned to students;
    // their StudentFeeItem rows keep the amounts and lose only the template link.
    await prisma.feeStructure.delete({ where: { id } })
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
