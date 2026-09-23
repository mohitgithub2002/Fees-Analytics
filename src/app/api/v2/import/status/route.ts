import { handleError, ok } from '@/lib/fees/api'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { UNDATED_RECEIPT_PREFIXES } from '@/lib/recovery/provenance'

/**
 * What data is loaded, and what is still missing.
 *
 * Drives the setup screen. The point is that each missing piece says what it
 * BLOCKS, not just that it is absent — "0 phone numbers" means nothing on its
 * own, "349 families cannot be called at all" is a reason to go and fix it.
 */
export async function GET() {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  try {
    const [
      sessions,
      currentSession,
      classes,
      students,
      enrollments,
      feeItems,
      installments,
      datedInstallments,
      households,
      contacts,
      householdsWithContact,
      transactions,
      datedTransactions,
      structures,
      calls,
    ] = await Promise.all([
      prisma.academicSession.count(),
      prisma.academicSession.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } }),
      prisma.schoolClass.count(),
      prisma.student.count({ where: { isActive: true } }),
      prisma.studentEnrollment.count(),
      prisma.studentFeeItem.count(),
      prisma.feeInstallment.count(),
      prisma.feeInstallment.count({ where: { dueDate: { not: null } } }),
      prisma.household.count({ where: { isActive: true } }),
      prisma.householdContact.count(),
      prisma.household.count({ where: { isActive: true, contacts: { some: {} } } }),
      prisma.feeTransaction.count({ where: { status: 'COMPLETED' } }),
      prisma.feeTransaction.count({
        // Payments that carry a real date: not from the legacy migration, and
        // not an opening balance typed in without individual receipts.
        where: {
          status: 'COMPLETED',
          NOT: {
            OR: UNDATED_RECEIPT_PREFIXES.map((prefix) => ({
              receiptNo: { startsWith: prefix },
            })),
          },
        },
      }),
      prisma.feeStructure.count(),
      prisma.contactAttempt.count(),
    ])

    const unlinkedStudents = students - (await prisma.householdMember.count())

    const steps = [
      {
        key: 'students',
        label: 'Students & parents',
        done: students > 0,
        count: students,
        detail:
          students === 0
            ? 'Nothing can happen until the students are loaded.'
            : `${students} students in ${classes} classes, grouped into ${households} families.`,
      },
      {
        key: 'families',
        label: 'Families linked',
        done: students > 0 && unlinkedStudents === 0,
        count: households,
        detail:
          unlinkedStudents > 0
            ? `${unlinkedStudents} students are not in a family yet, so they cannot appear on the call list.`
            : `${households} families. Fees are chased per family, so siblings are one call.`,
      },
      {
        key: 'contacts',
        label: 'Phone numbers',
        done: households > 0 && householdsWithContact === households,
        count: contacts,
        detail:
          households === 0
            ? 'Load students first.'
            : householdsWithContact === households
              ? 'Every family has a number.'
              : `${households - householdsWithContact} of ${households} families have no number — they cannot be called at all, whatever they owe.`,
        blocking: households > 0 && householdsWithContact < households,
      },
      {
        key: 'fees',
        label: 'Fees charged',
        done: feeItems > 0,
        count: feeItems,
        detail:
          feeItems === 0
            ? 'Without fees there is nothing owed and nothing to recover. Upload fees, or set up class-wise fee structures.'
            : `${feeItems} fees across ${enrollments} enrollments.${structures > 0 ? ` ${structures} class fee structures defined.` : ''}`,
      },
      {
        key: 'dueDates',
        label: 'Installment due dates',
        done: installments > 0 && datedInstallments === installments,
        count: datedInstallments,
        detail:
          installments === 0
            ? 'Load fees first.'
            : datedInstallments === 0
              ? `None of ${installments} installments has a due date, so "on time" and "late" cannot be worked out. Add a schedule at Setup → Fee Structures.`
              : datedInstallments < installments
                ? `${installments - datedInstallments} of ${installments} installments have no due date.`
                : 'Every installment is dated.',
      },
      {
        key: 'payments',
        label: 'Payment history with real dates',
        done: datedTransactions > 0,
        count: datedTransactions,
        detail:
          transactions === 0
            ? 'No payments recorded yet.'
            : datedTransactions === 0
              ? `All ${transactions} payments carry the migration date rather than the day money arrived, so behaviour patterns and the cash forecast stay blank.`
              : `${datedTransactions} of ${transactions} payments carry a real date.`,
      },
    ]

    return ok({
      data: {
        session: currentSession,
        ready: steps.filter((s) => s.done).length,
        total: steps.length,
        steps,
        raw: {
          sessions,
          classes,
          students,
          enrollments,
          households,
          unlinkedStudents,
          contacts,
          householdsWithContact,
          feeItems,
          installments,
          datedInstallments,
          transactions,
          datedTransactions,
          structures,
          calls,
        },
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
