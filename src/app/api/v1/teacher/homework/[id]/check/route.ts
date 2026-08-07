import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireTeacher } from '@/lib/teaching/guards'
import {
  ok,
  err,
  readJson,
  parseId,
  handleError,
  isSameCalendarDay,
  todayDateOnly,
  parseDateOnly,
} from '@/lib/teaching/http'
import { writeAudit } from '@/lib/teaching/audit'

/**
 * Marking homework as checked. Homework set on Monday is typically checked on
 * Tuesday or Wednesday, so the teacher says *which* day they checked it
 * (`checkedOn`, defaulting to today); `checkedAt` is stamped by the server and
 * is never client-supplied — that is the honest "when did this get recorded"
 * an admin needs when the two disagree.
 *
 * A missing HomeworkCheck row is what "not checked" means, so unchecking is a
 * delete, not a flag flip. Corrections follow the module's same-day rule: fix
 * today's mistake today, don't rewrite last week.
 */

interface CheckBody {
  checkedOn?: string
  remarks?: string | null
}

/** Fetch the homework, collapsing the ownership and type checks into the query. */
async function findOwnHomework(id: number, teacherId: number) {
  return prisma.sessionLog.findFirst({
    where: { id, type: 'HOMEWORK', assignment: { teacherId } },
    include: { homeworkCheck: true },
  })
}

/** Validate a client-supplied checkedOn: a real date, not before the homework, not in the future. */
function resolveCheckedOn(raw: string | undefined, sessionDate: Date): { date: Date } | { error: string } {
  const today = todayDateOnly()
  if (raw === undefined) return { date: today }

  const parsed = parseDateOnly(raw)
  if (!parsed) return { error: 'invalid checkedOn date' }
  if (parsed > today) return { error: 'checkedOn cannot be in the future' }
  if (parsed < sessionDate) return { error: 'checkedOn cannot be before the day the homework was set' }
  return { date: parsed }
}

/** Mark this homework as checked. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error
  const { teacher } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const homework = await findOwnHomework(id, teacher.id)
  if (!homework) return err('homework not found', 404)
  if (homework.homeworkCheck) return err('this homework is already marked as checked', 409)

  const body = (await readJson<CheckBody>(request)) ?? {}
  const resolved = resolveCheckedOn(body.checkedOn, homework.sessionDate)
  if ('error' in resolved) return err(resolved.error)

  try {
    const check = await prisma.$transaction(async (tx) => {
      const created = await tx.homeworkCheck.create({
        data: {
          sessionLogId: id,
          checkedByTeacherId: teacher.id,
          checkedOn: resolved.date,
          remarks: body.remarks?.trim() || null,
        },
      })
      await writeAudit(tx, {
        actorType: 'TEACHER',
        actorId: teacher.id,
        actorName: teacher.name,
        action: 'HOMEWORK_CHECKED',
        entityType: 'HomeworkCheck',
        entityId: created.id,
        newValue: created,
      })
      return created
    })
    return ok(check, 201)
  } catch (e) {
    return handleError(e)
  }
}

/** Correct the recorded check date or remarks. Same day only. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error
  const { teacher } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const homework = await findOwnHomework(id, teacher.id)
  if (!homework) return err('homework not found', 404)
  const existing = homework.homeworkCheck
  if (!existing) return err('this homework has not been marked as checked yet', 404)
  if (!isSameCalendarDay(existing.createdAt, new Date())) {
    return err('a homework check can only be corrected on the day it was recorded', 403)
  }

  const body = await readJson<CheckBody>(request)
  if (!body) return err('invalid JSON body')

  const data: { checkedOn?: Date; remarks?: string | null } = {}
  if (body.checkedOn !== undefined) {
    const resolved = resolveCheckedOn(body.checkedOn, homework.sessionDate)
    if ('error' in resolved) return err(resolved.error)
    data.checkedOn = resolved.date
  }
  if (body.remarks !== undefined) data.remarks = body.remarks?.trim() || null
  if (Object.keys(data).length === 0) return err('nothing to update')

  try {
    const check = await prisma.$transaction(async (tx) => {
      const updated = await tx.homeworkCheck.update({ where: { id: existing.id }, data })
      await writeAudit(tx, {
        actorType: 'TEACHER',
        actorId: teacher.id,
        actorName: teacher.name,
        action: 'HOMEWORK_CHECK_UPDATED',
        entityType: 'HomeworkCheck',
        entityId: existing.id,
        oldValue: existing,
        newValue: updated,
      })
      return updated
    })
    return ok(check)
  } catch (e) {
    return handleError(e)
  }
}

/** Undo a check marked by mistake. Same day only — the log stays honest. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTeacher()
  if ('error' in gate) return gate.error
  const { teacher } = gate

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const homework = await findOwnHomework(id, teacher.id)
  if (!homework) return err('homework not found', 404)
  const existing = homework.homeworkCheck
  if (!existing) return err('this homework has not been marked as checked yet', 404)
  if (!isSameCalendarDay(existing.createdAt, new Date())) {
    return err('a homework check can only be undone on the day it was recorded', 403)
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.homeworkCheck.delete({ where: { id: existing.id } })
      await writeAudit(tx, {
        actorType: 'TEACHER',
        actorId: teacher.id,
        actorName: teacher.name,
        action: 'HOMEWORK_CHECK_REMOVED',
        entityType: 'HomeworkCheck',
        entityId: existing.id,
        oldValue: existing,
      })
    })
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
