import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, isPositiveAmount, ok, parseId, readJson } from '@/lib/fees/api'
import { invalidateTags, TAGS } from '@/lib/cache'
import { $Enums, Prisma } from '@/generated/prisma/client'
import { allocatePayment } from '@/lib/fees/allocation'
import { recomputeForStudent } from '@/lib/recovery/recompute'

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const studentId = sp.get('studentId') ? parseId(sp.get('studentId')!) : null
  const category = sp.get('category')
  const from = sp.get('from')
  const to = sp.get('to')
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const limit = Math.min(100, Math.max(5, parseInt(sp.get('limit') || '50')))

  const where: Prisma.FeeTransactionWhereInput = {}
  if (studentId) where.studentId = studentId
  if (category && Object.values($Enums.FeeCategory).includes(category as $Enums.FeeCategory)) {
    where.category = category as $Enums.FeeCategory
  }
  if (from || to) {
    where.paidAt = {}
    if (from && !isNaN(Date.parse(from))) where.paidAt.gte = new Date(from)
    if (to && !isNaN(Date.parse(to))) where.paidAt.lte = new Date(to)
  }

  const [total, transactions] = await Promise.all([
    prisma.feeTransaction.count({ where }),
    prisma.feeTransaction.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { paidAt: 'desc' },
      include: {
        student: { select: { id: true, name: true, fatherName: true } },
        allocations: {
          include: {
            installment: {
              select: {
                id: true,
                label: true,
                feeItem: { select: { name: true, category: true } },
              },
            },
          },
        },
      },
    }),
  ])

  return ok({
    data: transactions,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  })
}

const CATEGORIES = new Set(Object.values($Enums.FeeCategory))
const MODES = new Set(Object.values($Enums.PaymentMode))

/**
 * Record a payment. The amount is distributed across the student's pending
 * installments:
 * - BUS / OTHER payments fill that category's installments (oldest session
 *   first, then installment order).
 * - SCHOOL / general payments settle past-session dues first (all
 *   categories), then the current session's school-fee installments.
 * An amount larger than the reachable outstanding balance is rejected.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { studentId, amount, category, mode, reference, remarks, paidAt } = body as {
    studentId?: number
    amount?: number
    category?: $Enums.FeeCategory | null
    mode?: $Enums.PaymentMode
    reference?: string
    remarks?: string
    paidAt?: string
  }
  if (!Number.isInteger(studentId)) return err('studentId is required')
  if (!isPositiveAmount(amount)) return err('amount must be a positive number')
  if (category != null && !CATEGORIES.has(category)) {
    return err(`category must be one of: ${[...CATEGORIES].join(', ')}`)
  }
  if (mode !== undefined && !MODES.has(mode)) {
    return err(`mode must be one of: ${[...MODES].join(', ')}`)
  }
  if (paidAt !== undefined && isNaN(Date.parse(paidAt))) return err('invalid paidAt')

  const student = await prisma.student.findUnique({ where: { id: studentId! } })
  if (!student) return err('student not found', 404)

  try {
    const transaction = await prisma.$transaction((tx) =>
      allocatePayment(tx, {
        studentId: studentId!,
        amount: amount!,
        category,
        mode,
        reference,
        remarks,
        paidAt,
      })
    )
    invalidateTags(TAGS.fees)
    // Keeps the household's recovery profile and worklist entry in sync with
    // this payment immediately — a household who just paid disappears from
    // today's call list without anyone maintaining it by hand. A failure here
    // must never fail the payment itself, which has already been recorded.
    try {
      await recomputeForStudent(studentId!)
    } catch (e) {
      console.error('recovery recompute after payment failed:', e)
    }
    return ok(transaction, 201)
  } catch (e) {
    return handleError(e)
  }
}
