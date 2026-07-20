import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { err, ok, parseId } from '@/lib/fees/api'
import { toPaise, toRupees } from '@/lib/fees/money'

/**
 * Outstanding dues for one student, grouped by session and category, with the
 * ordered list of pending installments — exactly what a fee-collection UI
 * needs before recording a payment.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const student = await prisma.student.findUnique({ where: { id } })
  if (!student) return err('student not found', 404)

  const enrollments = await prisma.studentEnrollment.findMany({
    where: { studentId: id },
    orderBy: { session: { startDate: 'asc' } },
    include: {
      session: { select: { id: true, name: true, isCurrent: true } },
      classroom: { include: { class: { select: { name: true } } } },
      feeItems: {
        include: {
          installments: {
            where: { status: { not: 'PAID' } },
            orderBy: { sequence: 'asc' },
          },
        },
      },
    },
  })

  let totalDuePaise = 0
  const bySession = enrollments.map((enr) => {
    const byCategory: Record<string, number> = { SCHOOL: 0, BUS: 0, OTHER: 0 }
    const pendingInstallments = []
    for (const item of enr.feeItems) {
      byCategory[item.category] += toPaise(item.dueAmount)
      for (const inst of item.installments) {
        const due = toPaise(inst.netAmount) - toPaise(inst.paidAmount)
        if (due <= 0) continue
        pendingInstallments.push({
          installmentId: inst.id,
          feeItemId: item.id,
          feeName: item.name,
          category: item.category,
          label: inst.label,
          dueDate: inst.dueDate,
          netAmount: Number(inst.netAmount),
          paidAmount: Number(inst.paidAmount),
          dueAmount: toRupees(due),
          status: inst.status,
        })
      }
    }
    const sessionDue = byCategory.SCHOOL + byCategory.BUS + byCategory.OTHER
    totalDuePaise += sessionDue
    return {
      enrollmentId: enr.id,
      session: enr.session,
      class: enr.classroom.class.name,
      section: enr.classroom.section,
      dueByCategory: {
        SCHOOL: toRupees(byCategory.SCHOOL),
        BUS: toRupees(byCategory.BUS),
        OTHER: toRupees(byCategory.OTHER),
      },
      totalDue: toRupees(sessionDue),
      pendingInstallments,
    }
  })

  const pastDuePaise = bySession
    .filter((s) => !s.session.isCurrent)
    .reduce((sum, s) => sum + toPaise(s.totalDue), 0)

  return ok({
    studentId: id,
    studentName: student.name,
    totalDue: toRupees(totalDuePaise),
    pastSessionsDue: toRupees(pastDuePaise),
    bySession,
  })
}
