import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, isPositiveAmount, ok, parseId, readJson } from '@/lib/fees/api'
import { cached, invalidateTags, TAGS } from '@/lib/cache'
import { $Enums } from '@/generated/prisma/client'

const CATEGORIES = new Set(Object.values($Enums.FeeCategory))

interface ScheduleInput {
  sequence?: number
  label?: string | null
  dueDate?: string
  amount?: number | null
}

interface StructureItemInput {
  category?: $Enums.FeeCategory
  name?: string
  amount?: number
  installmentCount?: number
  /** Optional due-date schedule, one row per installment. */
  schedule?: ScheduleInput[]
}

/**
 * A schedule is all-or-nothing: it must cover every installment exactly once,
 * because a partial schedule would leave some installments undated and make
 * "paid on time" unanswerable for them.
 */
function validateSchedule(item: StructureItemInput, count: number): string | null {
  const schedule = item.schedule
  if (schedule === undefined || schedule.length === 0) return null
  if (schedule.length !== count) {
    return `"${item.name}": schedule must have exactly ${count} rows (one per installment)`
  }
  const seen = new Set<number>()
  for (const row of schedule) {
    if (!Number.isInteger(row.sequence) || row.sequence! < 1 || row.sequence! > count) {
      return `"${item.name}": each schedule row needs a sequence between 1 and ${count}`
    }
    if (seen.has(row.sequence!)) return `"${item.name}": duplicate schedule sequence ${row.sequence}`
    seen.add(row.sequence!)
    if (!row.dueDate || isNaN(Date.parse(row.dueDate))) {
      return `"${item.name}": schedule row ${row.sequence} needs a valid dueDate`
    }
    if (row.amount !== undefined && row.amount !== null && !isPositiveAmount(row.amount)) {
      return `"${item.name}": schedule row ${row.sequence} amount must be positive`
    }
  }
  const withAmount = schedule.filter((r) => r.amount !== undefined && r.amount !== null)
  if (withAmount.length > 0 && withAmount.length !== schedule.length) {
    return `"${item.name}": set an amount on every schedule row or on none`
  }
  if (withAmount.length === schedule.length) {
    const total = withAmount.reduce((sum, r) => sum + r.amount!, 0)
    if (Math.round(total * 100) !== Math.round(item.amount! * 100)) {
      return `"${item.name}": schedule amounts (${total}) must sum to the item amount (${item.amount})`
    }
  }
  return null
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
    const scheduleError = validateSchedule(item, item.installmentCount ?? 1)
    if (scheduleError) return scheduleError
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
          items: {
            orderBy: { id: 'asc' },
            include: { schedule: { orderBy: { sequence: 'asc' } } },
          },
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
      // Items are replaced wholesale; the schedule cascades with them, so it
      // is created per item rather than in one createMany.
      await tx.feeStructureItem.deleteMany({ where: { feeStructureId: created.id } })
      for (const item of validated) {
        await tx.feeStructureItem.create({
          data: {
            feeStructureId: created.id,
            category: item.category!,
            name: item.name!.trim(),
            amount: item.amount!,
            installmentCount: item.installmentCount ?? 1,
            ...(item.schedule?.length
              ? {
                  schedule: {
                    create: item.schedule.map((row) => ({
                      sequence: row.sequence!,
                      label: row.label?.trim() || null,
                      dueDate: new Date(row.dueDate!),
                      amount: row.amount ?? null,
                    })),
                  },
                }
              : {}),
          },
        })
      }
      return tx.feeStructure.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          class: true,
          session: { select: { id: true, name: true } },
          items: { include: { schedule: { orderBy: { sequence: 'asc' } } } },
        },
      })
    })
    invalidateTags(TAGS.structures, TAGS.classes)
    return ok(structure, 201)
  } catch (e) {
    return handleError(e)
  }
}
