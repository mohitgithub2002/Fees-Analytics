/**
 * Import students, their parents, and the family grouping that ties them
 * together.
 *
 * This is the entry point for putting a real school into the system. It is
 * written to work against a COMPLETELY EMPTY database: the academic session,
 * the classes and the classrooms are all created on demand, so a school can go
 * from nothing to a working call list with one file.
 *
 * The family grouping is the part that matters most, and it is explicit here
 * rather than inferred. Fees are chased per family — one father with three
 * children is one phone call, not three — and guessing that grouping from
 * names is how unrelated families get merged into a household that appears to
 * owe three families' fees. So the file carries a `Family ID` column, and any
 * repeated value groups those children. Where it is blank, the parent's phone
 * number does the same job. Where both are blank, the child becomes its own
 * family, which can be merged by hand later.
 *
 * Like the payment import, it always runs as a DRY RUN first.
 */
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/auth/phone'
import { applyStructureToEnrollment } from '@/lib/fees/fee-items'
import { parseCsv, parseImportDate } from '@/lib/recovery/csv'
import { autoMap, STUDENTS_TEMPLATE } from './templates'

/** Used only to order classes that the import has to create from scratch. */
const CLASS_ORDER = [
  'play', 'playgroup', 'nursery', 'nur', 'nc', 'kg', 'lkg', 'ukg', 'prep',
  'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii',
]

function classOrder(name: string): number {
  const key = name.trim().toLowerCase()
  const roman = CLASS_ORDER.indexOf(key)
  if (roman !== -1) return roman
  // "5" sorts with "v"
  const asNumber = Number(key)
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= 12) {
    return CLASS_ORDER.indexOf('i') + asNumber - 1
  }
  return 100
}

function norm(value: string | undefined | null): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export type RowStatus = 'NEW' | 'UPDATE' | 'INVALID'

export interface StagedStudent {
  rowNumber: number
  admissionNo: string | null
  studentName: string
  className: string
  section: string
  familyKey: string
  familyLabel: string
  fatherName: string
  motherName: string | null
  phones: string[]
  address: string | null
  gender: string | null
  dateOfBirth: Date | null
  existingStudentId: number | null
  status: RowStatus
  message: string | null
}

export interface StudentImportResult {
  counts: {
    total: number
    newStudents: number
    updatedStudents: number
    invalid: number
    families: number
    multiChildFamilies: number
    withPhone: number
    withoutPhone: number
    newClasses: number
  }
  session: { id: number | null; name: string }
  newClasses: string[]
  problems: { row: number; name: string; message: string }[]
  families: { label: string; children: string[]; phones: string[] }[]
  committed: boolean
  created?: { students: number; enrollments: number; households: number; contacts: number }
}

export interface ImportStudentsOptions {
  csv: string
  mapping?: Record<string, string>
  commit?: boolean
  sessionName?: string
  /** Apply the class-wise fee structure to each new enrollment. */
  applyFeeStructure?: boolean
}

/**
 * Work out which session these students belong to, creating one if the school
 * has none yet. A school onboarding for the first time should not have to go
 * and set up a session before it can upload its register.
 */
async function resolveSession(tx: Prisma.TransactionClient, sessionName?: string) {
  if (sessionName?.trim()) {
    const existing = await tx.academicSession.findUnique({ where: { name: sessionName.trim() } })
    if (existing) return existing
  }
  const current = await tx.academicSession.findFirst({ where: { isCurrent: true } })
  if (current && !sessionName) return current

  // Indian academic years run April–March.
  const now = new Date()
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const name = sessionName?.trim() || `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`

  const found = await tx.academicSession.findUnique({ where: { name } })
  if (found) return found

  const any = await tx.academicSession.count()
  return tx.academicSession.create({
    data: {
      name,
      startDate: new Date(Date.UTC(startYear, 3, 1)),
      endDate: new Date(Date.UTC(startYear + 1, 2, 31)),
      isCurrent: any === 0,
    },
  })
}

export async function importStudents(
  opts: ImportStudentsOptions
): Promise<StudentImportResult> {
  const { headers, rows } = parseCsv(opts.csv)
  if (rows.length === 0) throw new Error('no data rows found in the file')

  const mapping = { ...autoMap(STUDENTS_TEMPLATE, headers), ...(opts.mapping ?? {}) }
  const get = (row: Record<string, string>, key: string): string => {
    const column = mapping[key]
    return column ? (row[column] ?? '').trim() : ''
  }

  if (!mapping.studentName) throw new Error('mapping.studentName is required')
  if (!mapping.className) throw new Error('mapping.className is required')

  // --- Existing data, read once ---------------------------------------
  const [existingStudents, existingClasses] = await Promise.all([
    prisma.student.findMany({
      select: { id: true, name: true, fatherName: true, admissionNo: true },
    }),
    prisma.schoolClass.findMany({ select: { id: true, name: true } }),
  ])

  const byAdmission = new Map(
    existingStudents.filter((s) => s.admissionNo).map((s) => [norm(s.admissionNo), s.id])
  )
  const byNameFather = new Map<string, number[]>()
  for (const s of existingStudents) {
    const key = `${norm(s.name)}|${norm(s.fatherName)}`
    const list = byNameFather.get(key)
    if (list) list.push(s.id)
    else byNameFather.set(key, [s.id])
  }
  const classByName = new Map(existingClasses.map((c) => [norm(c.name), c.id]))

  // --- Stage every row --------------------------------------------------
  const staged: StagedStudent[] = []
  const newClassNames = new Set<string>()

  rows.forEach((row, index) => {
    const rowNumber = index + 2 // +1 header, +1 one-based
    const studentName = get(row, 'studentName')
    const className = get(row, 'className')
    const admissionNo = get(row, 'admissionNo') || null
    const fatherName = get(row, 'fatherName')

    const base = {
      rowNumber,
      admissionNo,
      studentName,
      className,
      section: get(row, 'section') || 'A',
      fatherName,
      motherName: get(row, 'motherName') || null,
      address: get(row, 'address') || null,
      gender: get(row, 'gender') || null,
      dateOfBirth: parseImportDate(get(row, 'dateOfBirth')),
    }

    if (!studentName) {
      staged.push({
        ...base,
        familyKey: '',
        familyLabel: '',
        phones: [],
        existingStudentId: null,
        status: 'INVALID',
        message: 'no student name on this row',
      })
      return
    }
    if (!className) {
      staged.push({
        ...base,
        familyKey: '',
        familyLabel: '',
        phones: [],
        existingStudentId: null,
        status: 'INVALID',
        message: 'no class on this row',
      })
      return
    }

    if (!classByName.has(norm(className))) newClassNames.add(className.trim())

    // Phones, normalized so the same number entered two ways is one number.
    const phones = [get(row, 'parentPhone'), get(row, 'altPhone')]
      .map((p) => normalizePhone(p))
      .filter((p): p is string => Boolean(p))
    const uniquePhones = [...new Set(phones)]

    // The grouping key, in order of how much we trust it.
    const familyId = get(row, 'familyId')
    const familyKey = familyId
      ? `id:${norm(familyId)}`
      : uniquePhones.length > 0
        ? `phone:${uniquePhones[0]}`
        : `solo:${rowNumber}`

    // Match an existing student so re-uploading updates rather than duplicates.
    let existingStudentId: number | null = null
    let message: string | null = null
    if (admissionNo) {
      existingStudentId = byAdmission.get(norm(admissionNo)) ?? null
    }
    if (!existingStudentId && fatherName) {
      const hits = byNameFather.get(`${norm(studentName)}|${norm(fatherName)}`) ?? []
      if (hits.length === 1) existingStudentId = hits[0]
      else if (hits.length > 1) {
        message = `${hits.length} existing students share this name and father — add an admission number to be sure`
      }
    }

    staged.push({
      ...base,
      familyKey,
      familyLabel: fatherName || studentName,
      phones: uniquePhones,
      existingStudentId,
      status: existingStudentId ? 'UPDATE' : 'NEW',
      message,
    })
  })

  // --- Group into families ----------------------------------------------
  const familyMap = new Map<string, StagedStudent[]>()
  for (const row of staged) {
    if (row.status === 'INVALID') continue
    const list = familyMap.get(row.familyKey)
    if (list) list.push(row)
    else familyMap.set(row.familyKey, [row])
  }

  const valid = staged.filter((r) => r.status !== 'INVALID')
  const counts = {
    total: staged.length,
    newStudents: valid.filter((r) => r.status === 'NEW').length,
    updatedStudents: valid.filter((r) => r.status === 'UPDATE').length,
    invalid: staged.filter((r) => r.status === 'INVALID').length,
    families: familyMap.size,
    multiChildFamilies: [...familyMap.values()].filter((f) => f.length > 1).length,
    withPhone: [...familyMap.values()].filter((f) => f.some((r) => r.phones.length > 0)).length,
    withoutPhone: [...familyMap.values()].filter((f) => f.every((r) => r.phones.length === 0))
      .length,
    newClasses: newClassNames.size,
  }

  const result: StudentImportResult = {
    counts,
    session: { id: null, name: opts.sessionName ?? '' },
    newClasses: [...newClassNames],
    problems: staged
      .filter((r) => r.status === 'INVALID' || r.message)
      .slice(0, 200)
      .map((r) => ({
        row: r.rowNumber,
        name: r.studentName || '(blank)',
        message: r.message ?? 'row skipped',
      })),
    families: [...familyMap.values()]
      .filter((f) => f.length > 1)
      .slice(0, 50)
      .map((f) => ({
        label: f[0].familyLabel,
        children: f.map((c) => `${c.studentName} (${c.className})`),
        phones: [...new Set(f.flatMap((c) => c.phones))],
      })),
    committed: false,
  }

  if (!opts.commit) {
    const peek = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
    result.session = { id: peek?.id ?? null, name: opts.sessionName || peek?.name || '(will be created)' }
    return result
  }

  // --- Commit -------------------------------------------------------------
  const session = await prisma.$transaction((tx) => resolveSession(tx, opts.sessionName))
  result.session = { id: session.id, name: session.name }

  // Classes and classrooms first, so the per-family writes stay small.
  for (const name of newClassNames) {
    const created = await prisma.schoolClass.upsert({
      where: { name: name.trim() },
      create: { name: name.trim(), displayOrder: classOrder(name) },
      update: {},
    })
    classByName.set(norm(name), created.id)
  }

  const classroomCache = new Map<string, number>()
  async function classroomFor(className: string, section: string): Promise<number> {
    const classId = classByName.get(norm(className))
    if (!classId) throw new Error(`class "${className}" could not be created`)
    const key = `${classId}|${section}`
    const cached = classroomCache.get(key)
    if (cached) return cached
    const classroom = await prisma.classroom.upsert({
      where: {
        classId_sessionId_section: { classId, sessionId: session.id, section },
      },
      create: { classId, sessionId: session.id, section },
      update: {},
    })
    classroomCache.set(key, classroom.id)
    return classroom.id
  }

  let createdStudents = 0
  let createdEnrollments = 0
  let createdHouseholds = 0
  let createdContacts = 0

  // One transaction per family: small enough to stay well inside the
  // transaction timeout over a remote connection, and it keeps a family's
  // children, household and phone numbers consistent with each other.
  for (const members of familyMap.values()) {
    const classroomIds = new Map<number, number>()
    for (const member of members) {
      classroomIds.set(member.rowNumber, await classroomFor(member.className, member.section))
    }

    await prisma.$transaction(async (tx) => {
      const studentIds: number[] = []

      for (const member of members) {
        const data = {
          name: member.studentName,
          fatherName: member.fatherName || member.studentName,
          motherName: member.motherName,
          phone: member.phones[0] ?? null,
          address: member.address,
          gender: member.gender,
          dateOfBirth: member.dateOfBirth,
          admissionNo: member.admissionNo,
        }

        let studentId: number
        if (member.existingStudentId) {
          await tx.student.update({ where: { id: member.existingStudentId }, data })
          studentId = member.existingStudentId
        } else {
          const created = await tx.student.create({ data })
          studentId = created.id
          createdStudents++
        }
        studentIds.push(studentId)

        // Enrol for this session if they are not already.
        const existingEnrollment = await tx.studentEnrollment.findUnique({
          where: { studentId_sessionId: { studentId, sessionId: session.id } },
        })
        if (!existingEnrollment) {
          const enrollment = await tx.studentEnrollment.create({
            data: {
              studentId,
              sessionId: session.id,
              classroomId: classroomIds.get(member.rowNumber)!,
            },
          })
          createdEnrollments++
          if (opts.applyFeeStructure) {
            // Only where a structure exists for that class — a school that has
            // not set one up yet should still get its students loaded.
            await applyStructureToEnrollment(tx, enrollment.id).catch(() => {})
          }
        }
      }

      // --- The family ---------------------------------------------------
      // If any of these children already belongs to a household, keep that
      // one and add the others to it rather than creating a rival family.
      const existingMember = await tx.householdMember.findFirst({
        where: { studentId: { in: studentIds } },
        select: { householdId: true },
      })

      let householdId: number
      if (existingMember) {
        householdId = existingMember.householdId
      } else {
        const household = await tx.household.create({
          data: {
            displayName: members[0].familyLabel,
            normalizedName: norm(members[0].familyLabel),
            linkSource: members[0].familyKey.startsWith('id:')
              ? 'import:familyId'
              : members[0].familyKey.startsWith('phone:')
                ? 'import:phone'
                : 'import:solo',
          },
        })
        householdId = household.id
        createdHouseholds++
      }

      for (const studentId of studentIds) {
        await tx.householdMember.upsert({
          where: { studentId },
          create: { studentId, householdId, linkSource: 'import' },
          update: { householdId },
        })
      }

      // --- Their phone numbers -------------------------------------------
      const phones = [...new Set(members.flatMap((m) => m.phones))]
      for (const [index, phone] of phones.entries()) {
        const existing = await tx.householdContact.findUnique({
          where: { householdId_phone: { householdId, phone } },
        })
        if (existing) continue
        await tx.householdContact.create({
          data: {
            householdId,
            phone,
            rawPhone: phone,
            name: members[0].fatherName || null,
            relation: index === 0 ? 'FATHER' : 'MOTHER',
            isPrimary: index === 0,
          },
        })
        createdContacts++
      }
      // A large family is a lot of statements, and every one is a round trip
      // to a remote database — comfortably past the 5s default.
    }, { timeout: 60_000, maxWait: 15_000 })
  }

  result.committed = true
  result.created = {
    students: createdStudents,
    enrollments: createdEnrollments,
    households: createdHouseholds,
    contacts: createdContacts,
  }
  return result
}
