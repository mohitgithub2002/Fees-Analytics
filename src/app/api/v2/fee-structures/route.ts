import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, isPositiveAmount, ok, parseId, readJson } from '@/lib/fees/api'
import { cached, invalidateTags, TAGS } from '@/lib/cache'
import { $Enums } from '@/generated/prisma/client'

const CATEGORIES = new Set(Object.values($Enums.FeeCategory))

interface StructureItemInput {
  category?: $Enums.FeeCategory
  name?: string
  amount?: number
  installmentCount?: number
}

function validateItems(items: unknown): string | StructureItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    return 'items must be a non-empty array'
  }
  const names = new Set<string>()
  for (const item of items as StructureItemInput[]) {
    if (!item.category || !CATEGORIES.has(item.category)) {
      return `each item needs a category (${[...CATEGORIES].join(', ')})`
    }
    if (!item.name?.trim()) return 'each item needs a name'
    if (!isPositiveAmount(item.amount)) return 'each item needs a positive amount'
    if (
      item.installmentCount !== undefined &&
      (!Number.isInteger(item.installmentCount) || item.installmentCount < 1)
    ) {
      return 'installmentCount must be a positive integer'
    }
    const key = item.name.trim().toLowerCase()
    if (names.has(key)) return `duplicate item name: ${item.name}`
    names.add(key)
  }
  return items as StructureItemInput[]
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const sessionId = sp.get('sessionId') ? parseId(sp.get('sessionId')!) : null

  const data = await cached(
    `structures:${sessionId ?? ''}`,
    { tags: [TAGS.structures], ttlMs: 120_000 },
    () =>
      prisma.feeStructure.findMany({
        where: sessionId ? { sessionId } : {},
        include: {
          class: true,
          session: { select: { id: true, name: true, isCurrent: true } },
          items: { orderBy: { id: 'asc' } },
        },
        orderBy: [{ sessionId: 'desc' }, { class: { displayOrder: 'asc' } }],
      }),
  )
  return ok({ data })
}

/**
 * Create (or replace the items of) the fee structure for a class + session.
 * Changing a structure never touches fees already assigned to students —
 * those are edited per student via the fee-items endpoints.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request)
  if (!body) return err('invalid JSON body')

  const { sessionId, classId, items } = body as {
    sessionId?: number
    classId?: number
    items?: unknown
  }
  if (!Number.isInteger(sessionId)) return err('sessionId is required')
  if (!Number.isInteger(classId)) return err('classId is required')

  const validated = validateItems(items)
  if (typeof validated === 'string') return err(validated)

  try {
    const structure = await prisma.$transaction(async (tx) => {
      const created = await tx.feeStructure.upsert({
        where: { sessionId_classId: { sessionId: sessionId!, classId: classId! } },
        create: { sessionId: sessionId!, classId: classId! },
        update: {},
      })
      await tx.feeStructureItem.deleteMany({ where: { feeStructureId: created.id } })
      await tx.feeStructureItem.createMany({
        data: validated.map((item) => ({
          feeStructureId: created.id,
          category: item.category!,
          name: item.name!.trim(),
          amount: item.amount!,
          installmentCount: item.installmentCount ?? 1,
        })),
      })
      return tx.feeStructure.findUniqueOrThrow({
        where: { id: created.id },
        include: { class: true, session: { select: { id: true, name: true } }, items: true },
      })
    })
    invalidateTags(TAGS.structures, TAGS.classes)
    return ok(structure, 201)
  } catch (e) {
    return handleError(e)
  }
}
