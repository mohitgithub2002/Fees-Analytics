import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, isPositiveAmount, ok, parseId, readJson } from '@/lib/fees/api'
import { cached, invalidateTags, TAGS } from '@/lib/cache'
import { $Enums } from '@/generated/prisma/client'

const CATEGORIES = new Set(Object.values($Enums.FeeCategory))

interface ScheduleRowInput {
  label?: string
  dueDate?: string
}

interface StructureItemInput {
  category?: $Enums.FeeCategory
  name?: string
  amount?: number
  installmentCount?: number
  /** Optional due-date schedule — see validateSchedule for the rules. */
  schedule?: ScheduleRowInput[]
}

/**
 * Validate an item's due-date schedule.
 *
 * The schedule is ALL-OR-NOTHING: either every installment of the item is
 * dated or none is. A half-dated item would silently skew the on-time rate,
 * because an undated installment can be judged neither on time nor late.
 * Dates must also advance with the sequence — a schedule that runs backwards
 * is a data-entry slip, not a valid plan.
 */
function validateSchedule(item: StructureItemInput, itemName: string): string | null {
  if (item.schedule === undefined) return null
  if (!Array.isArray(item.schedule)) return `${itemName}: schedule must be an array`
  if (item.schedule.length === 0) return null

  const expected = item.installmentCount ?? 1
  if (item.schedule.length !== expected) {
    return `${itemName}: schedule has ${item.schedule.length} dates but the item has ${expected} installment(s) — date every installment or none`
  }

  let previous = -Infinity
  for (let i = 0; i < item.schedule.length; i++) {
    const raw = item.schedule[i].dueDate
    if (!raw) return `${itemName}: installment ${i + 1} is missing a due date`
    const time = new Date(raw).getTime()
    if (Number.isNaN(time)) return `${itemName}: installment ${i + 1} has an invalid due date`
    if (time <= previous) {
      return `${itemName}: due dates must get later with each installment (installment ${i + 1} is not after the one before it)`
    }
    previous = time
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
    const scheduleError = validateSchedule(item, item.name.trim())
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
      await tx.feeStructureItem.deleteMany({ where: { feeStructureId: created.id } })
      // Created one at a time rather than with createMany so each item's
      // due-date schedule can be written in the same statement.
      for (const item of validated) {
        const count = item.installmentCount ?? 1
        const schedule = item.schedule ?? []
        await tx.feeStructureItem.create({
          data: {
            feeStructureId: created.id,
            category: item.category!,
            name: item.name!.trim(),
            amount: item.amount!,
            installmentCount: count,
            schedule: {
              create: schedule.map((row, i) => ({
                sequence: i + 1,
                label: row.label?.trim() || (count === 1 ? 'Installment' : `Installment ${i + 1}`),
                dueDate: new Date(row.dueDate!),
              })),
            },
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
