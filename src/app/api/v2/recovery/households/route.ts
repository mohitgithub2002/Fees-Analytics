import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, handleError, ok, readJson } from '@/lib/fees/api'
import { recomputeRecovery } from '@/lib/recovery/recompute'

const REVIEW_MARKER = 'Auto-linked with low confidence'

/**
 * The guardian-linking review queue. prisma/link-guardians.ts auto-links
 * students to a payer by name (and phone, where it agrees) and flags the
 * uncertain groups — same father's name with no corroborating phone, or
 * disagreeing phones — by prefixing Guardian.notes. This endpoint surfaces
 * exactly those for a human to confirm, merge, or split.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const all = sp.get('status') === 'all'

  const guardians = await prisma.guardian.findMany({
    where: all ? {} : { notes: { startsWith: REVIEW_MARKER } },
    include: {
      students: {
        include: {
          student: {
            select: {
              id: true, name: true, phone: true,
              enrollments: {
                where: { session: { isCurrent: true } },
                select: { classroom: { select: { class: { select: { name: true } } } } },
                take: 1,
              },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return ok({
    data: guardians.map((g) => ({
      id: g.id,
      name: g.name,
      phone: g.phone,
      needsReview: g.notes?.startsWith(REVIEW_MARKER) ?? false,
      notes: g.notes,
      students: g.students.map((gs) => ({
        id: gs.student.id,
        name: gs.student.name,
        phone: gs.student.phone,
        class: gs.student.enrollments[0]?.classroom.class.name ?? null,
        linkSource: gs.linkSource,
      })),
    })),
  })
}

type Action =
  | { action: 'confirm'; guardianId: number }
  | { action: 'split'; guardianId: number; studentId: number; targetGuardianId?: number }
  | { action: 'merge'; guardianId: number; targetGuardianId: number }

export async function POST(request: NextRequest) {
  const body = await readJson<Action>(request)
  if (!body) return err('invalid JSON body')

  try {
    if (body.action === 'confirm') return await confirm(body.guardianId)
    if (body.action === 'split') return await split(body.guardianId, body.studentId, body.targetGuardianId)
    if (body.action === 'merge') return await merge(body.guardianId, body.targetGuardianId)
    return err('action must be one of: confirm, split, merge')
  } catch (e) {
    return handleError(e)
  }
}

async function confirm(guardianId: number) {
  if (!Number.isInteger(guardianId)) return err('guardianId is required')
  const guardian = await prisma.guardian.update({
    where: { id: guardianId },
    data: { notes: null },
  })
  return ok(guardian)
}

async function split(guardianId: number, studentId: number, targetGuardianId?: number) {
  if (!Number.isInteger(guardianId) || !Number.isInteger(studentId)) {
    return err('guardianId and studentId are required')
  }
  const link = await prisma.guardianStudent.findUnique({
    where: { guardianId_studentId: { guardianId, studentId } },
  })
  if (!link) return err('that student is not linked to this guardian', 404)

  const result = await prisma.$transaction(async (tx) => {
    await tx.guardianStudent.delete({ where: { id: link.id } })

    if (targetGuardianId) {
      const existing = await tx.guardianStudent.findUnique({
        where: { guardianId_studentId: { guardianId: targetGuardianId, studentId } },
      })
      if (!existing) {
        await tx.guardianStudent.create({
          data: { guardianId: targetGuardianId, studentId, isPayer: true, linkSource: 'manual:split' },
        })
      }
      return { guardianId: targetGuardianId }
    }

    // No target given — the student becomes their own solo guardian, seeded
    // from their own record.
    const student = await tx.student.findUniqueOrThrow({ where: { id: studentId } })
    const newGuardian = await tx.guardian.create({
      data: {
        name: student.fatherName,
        normalizedName: student.fatherName.toUpperCase().trim(),
        phone: student.phone,
        relation: 'FATHER',
      },
    })
    await tx.guardianStudent.create({
      data: { guardianId: newGuardian.id, studentId, isPayer: true, linkSource: 'manual:split' },
    })
    return { guardianId: newGuardian.id }
  })

  await recomputeRecovery([guardianId, result.guardianId])
  return ok(result)
}

/**
 * Fold `guardianId` into `targetGuardianId`. History is preserved, not
 * dropped — contact attempts and promises move with the household rather
 * than being lost to Guardian's cascade delete, since a merge is a data-entry
 * correction, not a request to forget the calls already made.
 */
async function merge(guardianId: number, targetGuardianId: number) {
  if (!Number.isInteger(guardianId) || !Number.isInteger(targetGuardianId)) {
    return err('guardianId and targetGuardianId are required')
  }
  if (guardianId === targetGuardianId) return err('cannot merge a guardian into itself')

  const [source, target] = await Promise.all([
    prisma.guardian.findUnique({ where: { id: guardianId } }),
    prisma.guardian.findUnique({ where: { id: targetGuardianId } }),
  ])
  if (!source) return err('guardian not found', 404)
  if (!target) return err('targetGuardianId not found', 404)

  await prisma.$transaction(async (tx) => {
    const links = await tx.guardianStudent.findMany({ where: { guardianId } })
    for (const link of links) {
      const existing = await tx.guardianStudent.findUnique({
        where: { guardianId_studentId: { guardianId: targetGuardianId, studentId: link.studentId } },
      })
      if (existing) await tx.guardianStudent.delete({ where: { id: link.id } })
      else await tx.guardianStudent.update({ where: { id: link.id }, data: { guardianId: targetGuardianId } })
    }

    await tx.contactAttempt.updateMany({ where: { guardianId }, data: { guardianId: targetGuardianId } })

    // PromiseToPay has a unique sourceContactId; moving guardianId alone is safe.
    await tx.promiseToPay.updateMany({ where: { guardianId }, data: { guardianId: targetGuardianId } })

    // RecoveryCase is unique per (guardian, session) — where the target
    // already has one for the same session, drop the source's; recompute
    // rebuilds it cleanly for the merged household.
    const sourceCases = await tx.recoveryCase.findMany({ where: { guardianId } })
    for (const c of sourceCases) {
      const existing = await tx.recoveryCase.findUnique({
        where: { guardianId_sessionId: { guardianId: targetGuardianId, sessionId: c.sessionId } },
      })
      if (existing) await tx.recoveryCase.delete({ where: { id: c.id } })
      else await tx.recoveryCase.update({ where: { id: c.id }, data: { guardianId: targetGuardianId } })
    }

    await tx.guardianProfile.deleteMany({ where: { guardianId } })
    if (!target.phone && source.phone) {
      await tx.guardian.update({ where: { id: targetGuardianId }, data: { phone: source.phone } })
    }
    await tx.guardian.delete({ where: { id: guardianId } })
  })

  await recomputeRecovery([targetGuardianId])
  return ok({ mergedInto: targetGuardianId })
}
