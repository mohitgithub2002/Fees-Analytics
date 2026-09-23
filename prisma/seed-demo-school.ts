/**
 * Build a complete, realistic demo school.
 *
 *   npm run demo:seed -- --dry-run   # report the plan, change nothing
 *   npm run demo:seed                # clear school data and rebuild it
 *
 * WHY THIS EXISTS. Every screen in this app is downstream of data the real
 * school has not supplied yet: there are no payment dates, no installment due
 * dates and no phone numbers, so the behaviour lenses, the cash forecast and
 * the call list all correctly render as "not enough data". That is honest, but
 * it means nobody can see whether the system actually works — or find the
 * places where it would break on real input.
 *
 * So this generates a school that exercises every feature:
 *
 *   · Real student and parent NAMES from feesdata.csv, with the school's own
 *     sibling notes deciding which children share a payer. Only the money and
 *     the dates are invented.
 *   · THREE academic sessions, two of them finished, so multi-year patterns
 *     ("owes for more than one year", "always a year behind") are genuinely
 *     derivable rather than asserted.
 *   · Installment due dates, so on-time vs late is answerable.
 *   · Dated payments generated from a per-family STORYLINE, so each family
 *     re-derives the archetype that produced it rather than being labelled.
 *   · Phone numbers for most families — and deliberately none for some, so the
 *     "cannot be called at all" path is visible.
 *   · Call history, promises kept and broken, parked and snoozed cases.
 *
 * Determinism: a fixed seed, so two runs produce the same school and a bug can
 * be reproduced.
 *
 * WHAT IS NOT INVENTED: the ledger's own arithmetic. Fee items, installments,
 * transactions and allocations are all computed to be internally consistent
 * before anything is written — `netAmount = originalAmount - discountAmount`,
 * `dueAmount = netAmount - paidAmount`, and `sum(allocations) = amount` for
 * every transaction — so the demo exercises the same invariants real data must
 * satisfy.
 */
import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import csv from 'csv-parser'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { $Enums, PrismaClient } from '../src/generated/prisma/client'
import { DisjointSet, normalizeName, parseSiblingRefs } from '../src/lib/import/sibling-notes'

const pool = new Pool({ connectionString: `${process.env.DATABASE_URL}` })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const DRY_RUN = process.argv.includes('--dry-run')

// ---------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------

let seed = 0x9e3779b9
function rnd(): number {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]
const between = (min: number, max: number) => min + rnd() * (max - min)
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1))
const chance = (p: number) => rnd() < p

// ---------------------------------------------------------------------
// Shape of the school
// ---------------------------------------------------------------------

const CLASS_SEQUENCE = [
  'Play', 'LKG', 'UKG', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
]

/** Sessions, oldest first. The last one is current. */
const SESSIONS = [
  { name: '2024-25', startYear: 2024, hike: 0.86 },
  { name: '2025-26', startYear: 2025, hike: 0.93 },
  { name: '2026-27', startYear: 2026, hike: 1.0 },
]

/** Day-of-session each installment falls due: 15 Apr, 15 Aug, 15 Dec. */
const DUE_DAYS = [14, 136, 258]

type Archetype = $Enums.PaymentArchetype
type Tier = $Enums.EconomicTier

/**
 * How many families follow each pattern, and what they can afford.
 *
 * The tier spread per archetype is the point of the whole two-axis design:
 * year-end payers are mostly ABLE (they have the money, they are just slow —
 * the highest-value calls in the school), while chronic defaulters mostly are
 * not (calling harder will not create money). Deliberately not a clean
 * mapping, because in a real school it never is.
 */
const STORYLINES: {
  archetype: Archetype
  weight: number
  tiers: { tier: Tier; weight: number }[]
}[] = [
  {
    archetype: 'EARLY_FULL',
    weight: 8,
    tiers: [
      { tier: 'AFFLUENT', weight: 6 },
      { tier: 'COMFORTABLE', weight: 4 },
    ],
  },
  {
    archetype: 'INSTALLMENT_REGULAR',
    weight: 16,
    tiers: [
      { tier: 'COMFORTABLE', weight: 6 },
      { tier: 'AFFLUENT', weight: 2 },
      { tier: 'STRAINED', weight: 2 },
    ],
  },
  {
    archetype: 'YEAR_END_FULL',
    weight: 14,
    tiers: [
      { tier: 'AFFLUENT', weight: 4 },
      { tier: 'COMFORTABLE', weight: 5 },
      { tier: 'STRAINED', weight: 1 },
    ],
  },
  {
    archetype: 'YEAR_END_PARTIAL',
    weight: 16,
    tiers: [
      { tier: 'STRAINED', weight: 5 },
      { tier: 'COMFORTABLE', weight: 3 },
      { tier: 'POOR', weight: 2 },
    ],
  },
  {
    archetype: 'HEAVY_ROLLOVER',
    weight: 15,
    tiers: [
      { tier: 'STRAINED', weight: 4 },
      { tier: 'POOR', weight: 4 },
      { tier: 'COMFORTABLE', weight: 2 },
    ],
  },
  {
    archetype: 'NEXT_YEAR_PAYER',
    weight: 11,
    tiers: [
      { tier: 'STRAINED', weight: 4 },
      { tier: 'POOR', weight: 4 },
      { tier: 'COMFORTABLE', weight: 2 },
    ],
  },
  {
    archetype: 'CHRONIC_DEFAULTER',
    weight: 13,
    tiers: [
      { tier: 'POOR', weight: 5 },
      { tier: 'SEVERE', weight: 4 },
      { tier: 'STRAINED', weight: 1 },
    ],
  },
  // New admissions: only the current session, nothing settled yet.
  {
    archetype: 'UNKNOWN',
    weight: 7,
    tiers: [
      { tier: 'COMFORTABLE', weight: 3 },
      { tier: 'STRAINED', weight: 3 },
      { tier: 'POOR', weight: 2 },
    ],
  },
]

function weightedPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((n, i) => n + i.weight, 0)
  let roll = rnd() * total
  for (const item of items) {
    roll -= item.weight
    if (roll <= 0) return item
  }
  return items[items.length - 1]
}

// ---------------------------------------------------------------------
// Types used while building the ledger in memory
// ---------------------------------------------------------------------

interface CsvRow {
  Class?: string
  'Student Name'?: string
  'Father Name'?: string
  Siblings?: string
  Remarks?: string
}

interface DemoStudent {
  index: number
  name: string
  fatherName: string
  className: string
  classIndex: number
  isRte: boolean
  id?: number
}

interface DemoFamily {
  label: string
  students: DemoStudent[]
  archetype: Archetype
  tier: Tier
  /** Blank for the families deliberately left unreachable. */
  phones: string[]
  tagged: boolean
  householdId?: number
}

interface PlannedInstallment {
  sequence: number
  label: string
  dueDate: Date
  net: number
  paid: number
}

interface PlannedFeeItem {
  category: $Enums.FeeCategory
  name: string
  original: number
  discount: number
  installments: PlannedInstallment[]
  id?: number
}

interface PlannedPayment {
  paidAt: Date
  amount: number
  mode: $Enums.PaymentMode
  category: $Enums.FeeCategory
  /** Which installment got how much — keyed by a temporary ref. */
  allocations: { ref: string; amount: number }[]
}

interface PlannedEnrollment {
  student: DemoStudent
  sessionIndex: number
  className: string
  feeItems: PlannedFeeItem[]
  id?: number
}

const money = (n: number) => Math.round(n * 100) / 100
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

function sessionDates(startYear: number) {
  return {
    startDate: new Date(Date.UTC(startYear, 3, 1)),
    endDate: new Date(Date.UTC(startYear + 1, 2, 31)),
  }
}

function dayIn(session: { startYear: number }, day: number): Date {
  const { startDate } = sessionDates(session.startYear)
  return new Date(startDate.getTime() + day * 86_400_000)
}

/** Annual fee for a class, in the given session. */
function tuitionFor(classIndex: number, hike: number): number {
  return Math.round(((9000 + classIndex * 1900) * hike) / 100) * 100
}

// ---------------------------------------------------------------------
// Payment storylines
// ---------------------------------------------------------------------

/**
 * When and how much a family pays of ONE session's bill.
 *
 * Returns fractions of the total billed, with the day of the session each
 * lands on. The archetype is never written down anywhere — it is produced by
 * these payments, and the engine has to read it back out. That is what makes
 * the demo a test of the classifier rather than a picture of it.
 */
function paymentPlan(
  archetype: Archetype,
  ordered: { ref: string; inst: PlannedInstallment }[],
  billed: number
): { day: number; amount: number }[] {
  const frac = (f: number) => billed * f

  switch (archetype) {
    case 'EARLY_FULL':
      return [{ day: intBetween(1, 22), amount: frac(1) }]

    case 'INSTALLMENT_REGULAR': {
      // One payment per due date, covering exactly what falls due then —
      // including the bus fee, which shares installment one's due date. Paying
      // a flat third each time would leave that bus fee outstanding until
      // December and make the most punctual families in the school look
      // permanently overdue.
      const byDueDay = new Map<number, number>()
      for (const { inst } of ordered) {
        const day = Math.round(
          (inst.dueDate.getTime() - new Date(inst.dueDate.getUTCFullYear(), 3, 1).getTime()) /
            86_400_000
        )
        // Bucket on the scheduled due day rather than a computed offset, so
        // fees sharing a date are paid together.
        const bucket = DUE_DAYS.reduce((best, d) =>
          Math.abs(d - day) < Math.abs(best - day) ? d : best
        )
        byDueDay.set(bucket, (byDueDay.get(bucket) ?? 0) + inst.net)
      }
      return [...byDueDay.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([due, amount]) => ({ day: due + intBetween(-6, 1), amount }))
    }

    case 'YEAR_END_FULL':
      return [
        { day: intBetween(10, 40), amount: frac(0.15) },
        { day: intBetween(280, 320), amount: frac(0.5) },
        { day: intBetween(325, 358), amount: frac(0.35) },
      ]

    case 'YEAR_END_PARTIAL':
      return [
        { day: intBetween(20, 60), amount: frac(0.15) },
        { day: intBetween(250, 300), amount: frac(between(0.25, 0.4)) },
        { day: intBetween(310, 355), amount: frac(between(0.15, 0.3)) },
      ]

    case 'HEAVY_ROLLOVER':
      // A third to a half gets paid — enough to be clearly distinguishable
      // from a family paying almost nothing.
      return [
        { day: intBetween(30, 90), amount: frac(between(0.15, 0.25)) },
        { day: intBetween(240, 340), amount: frac(between(0.16, 0.27)) },
      ]

    case 'CHRONIC_DEFAULTER':
      return chance(0.55)
        ? [{ day: intBetween(90, 330), amount: frac(between(0.02, 0.1)) }]
        : []

    case 'NEXT_YEAR_PAYER':
      // Barely touches the current year — their money goes to last year's
      // bill, which is arranged separately in the ledger builder.
      return [{ day: intBetween(150, 330), amount: frac(between(0.04, 0.12)) }]

    default:
      return [{ day: intBetween(20, 120), amount: frac(between(0.2, 0.6)) }]
  }
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function readCsv(): Promise<CsvRow[]> {
  const file = path.join(process.cwd(), 'feesdata.csv')
  if (!fs.existsSync(file)) throw new Error(`feesdata.csv not found at ${file}`)
  const rows: CsvRow[] = []
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .pipe(csv())
      .on('data', (row) => rows.push(row as CsvRow))
      .on('end', resolve)
      .on('error', reject)
  })
  return rows
}

async function clearSchoolData() {
  console.log('Clearing existing school data…')
  await prisma.promiseToPay.deleteMany()
  await prisma.contactAttempt.deleteMany()
  await prisma.recoveryCase.deleteMany()
  await prisma.householdProfile.deleteMany()
  await prisma.householdContact.deleteMany()
  await prisma.householdMember.deleteMany()
  await prisma.household.deleteMany()
  await prisma.collectionForecast.deleteMany()
  await prisma.paymentImportRow.deleteMany()
  await prisma.paymentImportBatch.deleteMany()
  await prisma.transactionAllocation.deleteMany()
  await prisma.feeTransaction.deleteMany()
  await prisma.feeDiscount.deleteMany()
  await prisma.feeInstallment.deleteMany()
  await prisma.studentFeeItem.deleteMany()
  await prisma.studentEnrollment.deleteMany()
  await prisma.feeStructureInstallment.deleteMany()
  await prisma.feeStructureItem.deleteMany()
  await prisma.feeStructure.deleteMany()
  await prisma.student.deleteMany()
  await prisma.studentFee.deleteMany()
  // Classrooms, classes and sessions are deliberately kept and reused. They
  // are scaffolding rather than school data, and the teacher module's
  // assignments point at classrooms — deleting them would break a module that
  // has nothing to do with fees.
  console.log('  cleared.')
}

async function main() {
  const now = new Date()

  // --- 1. People, from the real register ------------------------------
  const rows = await readCsv()
  const classVocab = new Set(CLASS_SEQUENCE.map((c) => normalizeName(c)))

  const students: DemoStudent[] = []
  rows.forEach((row, index) => {
    const name = (row['Student Name'] ?? '').trim()
    const className = (row.Class ?? '').trim()
    const classIndex = CLASS_SEQUENCE.findIndex(
      (c) => normalizeName(c) === normalizeName(className)
    )
    if (!name || classIndex === -1) return
    students.push({
      index,
      name,
      fatherName: (row['Father Name'] ?? '').trim() || name,
      className,
      classIndex,
      isRte: /\br\.?\s*t\.?\s*e\.?\b/i.test(`${row.Siblings ?? ''} ${row.Remarks ?? ''}`),
    })
  })

  // --- 2. Families, from the school's own sibling notes ----------------
  const byIndex = new Map(students.map((s) => [s.index, s]))
  const byClassAndName = new Map<string, DemoStudent[]>()
  for (const s of students) {
    const key = `${normalizeName(s.className)}|${normalizeName(s.name)}`
    const list = byClassAndName.get(key)
    if (list) list.push(s)
    else byClassAndName.set(key, [s])
  }

  const dsu = new DisjointSet()
  for (const row of rows) {
    const self = students.find(
      (s) =>
        normalizeName(s.name) === normalizeName(row['Student Name']) &&
        normalizeName(s.className) === normalizeName(row.Class)
    )
    if (!self || !row.Siblings?.trim()) continue
    for (const ref of parseSiblingRefs(row.Siblings, classVocab)) {
      const key = `${ref.className}|${ref.name}`
      const matches = byClassAndName.get(key) ?? []
      if (matches.length === 1 && matches[0].index !== self.index) {
        dsu.union(self.index, matches[0].index)
      }
    }
  }

  const families: DemoFamily[] = []
  for (const group of dsu.groups(students.map((s) => s.index)).values()) {
    const members = group.map((i) => byIndex.get(i)!).filter(Boolean)
    if (members.length === 0) continue
    const storyline = weightedPick(STORYLINES)
    const tier = weightedPick(storyline.tiers).tier

    // ~8% of families have no usable number — the single biggest blocker in
    // real school data, and a path the screens must handle.
    const hasPhone = chance(0.92)
    const phones = hasPhone
      ? [`9${intBetween(100000000, 999999999)}`].concat(
          chance(0.42) ? [`8${intBetween(100000000, 999999999)}`] : []
        )
      : []

    families.push({
      label: members[0].fatherName,
      students: members,
      archetype: storyline.archetype,
      tier,
      phones,
      // ~62% tagged, so the "not assessed yet" nudge is visible too.
      tagged: chance(0.62),
    })
  }

  console.log(`${students.length} students → ${families.length} families`)
  const mix = new Map<string, number>()
  for (const f of families) mix.set(f.archetype, (mix.get(f.archetype) ?? 0) + 1)
  for (const [key, count] of [...mix].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(20)} ${count}`)
  }

  if (DRY_RUN) {
    console.log('\nDry run — nothing was written.')
    return
  }

  // --- 3. Wipe and rebuild ---------------------------------------------
  await clearSchoolData()

  // Sessions
  const sessionRows: { id: number; name: string }[] = []
  for (const [i, s] of SESSIONS.entries()) {
    const { startDate, endDate } = sessionDates(s.startYear)
    sessionRows.push(
      await prisma.academicSession.upsert({
        where: { name: s.name },
        create: { name: s.name, startDate, endDate, isCurrent: i === SESSIONS.length - 1 },
        update: { startDate, endDate, isCurrent: i === SESSIONS.length - 1 },
        select: { id: true, name: true },
      })
    )
  }
  await prisma.academicSession.updateMany({
    where: { name: { notIn: SESSIONS.map((s) => s.name) } },
    data: { isCurrent: false },
  })

  // Classes
  const classRows: { id: number; name: string }[] = []
  for (const [i, name] of CLASS_SEQUENCE.entries()) {
    classRows.push(
      await prisma.schoolClass.upsert({
        where: { name },
        create: { name, displayOrder: i },
        update: { displayOrder: i },
        select: { id: true, name: true },
      })
    )
  }

  // Classrooms, one per class per session. Upserted rather than recreated,
  // so any teacher assignments hanging off them survive.
  const classroomByKey = new Map<string, number>()
  for (const [si, session] of sessionRows.entries()) {
    for (const cls of classRows) {
      const room = await prisma.classroom.upsert({
        where: {
          classId_sessionId_section: { classId: cls.id, sessionId: session.id, section: 'A' },
        },
        create: { classId: cls.id, sessionId: session.id, section: 'A' },
        update: {},
        select: { id: true },
      })
      classroomByKey.set(`${si}|${cls.name}`, room.id)
    }
  }
  console.log(`${sessionRows.length} sessions, ${classRows.length} classes, ${classroomByKey.size} classrooms`)

  // Fee structures, with due dates — what makes "on time vs late" answerable
  for (const [si, session] of sessionRows.entries()) {
    for (const [ci, cls] of classRows.entries()) {
      const structure = await prisma.feeStructure.create({
        data: { sessionId: session.id, classId: cls.id },
      })
      await prisma.feeStructureItem.create({
        data: {
          feeStructureId: structure.id,
          category: 'SCHOOL',
          name: 'Tuition Fee',
          amount: tuitionFor(ci, SESSIONS[si].hike),
          installmentCount: 3,
          schedule: {
            create: DUE_DAYS.map((day, index) => ({
              sequence: index + 1,
              label: `Installment ${index + 1}`,
              dueDate: dayIn(SESSIONS[si], day),
            })),
          },
        },
      })
      await prisma.feeStructureItem.create({
        data: {
          feeStructureId: structure.id,
          category: 'BUS',
          name: 'Bus Fee',
          amount: Math.round((5200 * SESSIONS[si].hike) / 100) * 100,
          installmentCount: 1,
          schedule: {
            create: [
              { sequence: 1, label: 'Installment', dueDate: dayIn(SESSIONS[si], DUE_DAYS[0]) },
            ],
          },
        },
      })
    }
  }
  console.log('fee structures created, with due dates')

  // --- 4. Students ------------------------------------------------------
  const createdStudents = await prisma.student.createManyAndReturn({
    data: students.map((s, i) => ({
      admissionNo: `A${String(1000 + i)}`,
      name: s.name,
      fatherName: s.fatherName,
      phone: null,
      remarks: s.isRte ? 'R.T.E.' : null,
    })),
    select: { id: true },
  })
  students.forEach((s, i) => (s.id = createdStudents[i].id))
  console.log(`${createdStudents.length} students`)

  // --- 5. Households ----------------------------------------------------
  for (const family of families) {
    const household = await prisma.household.create({
      data: {
        displayName: family.label,
        normalizedName: normalizeName(family.label),
        linkSource: family.students.length > 1 ? 'csv:siblings' : 'solo',
        economicTier: family.tagged ? family.tier : 'UNKNOWN',
        tierSetByName: family.tagged ? 'Office' : null,
        tierSetAt: family.tagged ? new Date(now.getTime() - intBetween(5, 200) * 86_400_000) : null,
        tierNote: family.students.some((s) => s.isRte)
          ? 'School records mark this family RTE (government free seat) — confirm what they can afford on the call.'
          : null,
        members: {
          create: family.students.map((s) => ({
            studentId: s.id!,
            linkSource: family.students.length > 1 ? 'csv:siblings' : 'solo',
          })),
        },
        contacts: {
          create: family.phones.map((phone, i) => ({
            phone,
            rawPhone: phone,
            name: family.label,
            relation: i === 0 ? ('FATHER' as const) : ('MOTHER' as const),
            isPrimary: i === 0,
            verification: chance(0.35) ? ('VERIFIED' as const) : ('UNVERIFIED' as const),
          })),
        },
      },
      select: { id: true },
    })
    family.householdId = household.id
  }
  console.log(`${families.length} families, ${families.filter((f) => f.phones.length === 0).length} without a phone`)

  // --- 6. The ledger, computed in memory --------------------------------
  const enrollments: PlannedEnrollment[] = []
  const payments: { studentId: number; payment: PlannedPayment }[] = []

  for (const family of families) {
    // A family that only appears in the current session is a new admission.
    const firstSession = family.archetype === 'UNKNOWN' ? SESSIONS.length - 1 : 0

    for (const student of family.students) {
      /** Per session: the installments created, keyed for allocation. */
      const sessionInstallments: { ref: string; inst: PlannedInstallment }[][] = []

      for (let si = firstSession; si < SESSIONS.length; si++) {
        const yearsBack = SESSIONS.length - 1 - si
        const classIndex = student.classIndex - yearsBack
        // Too young to have been enrolled that far back.
        if (classIndex < 0) {
          sessionInstallments[si] = []
          continue
        }
        const className = CLASS_SEQUENCE[classIndex]
        const hike = SESSIONS[si].hike

        const feeItems: PlannedFeeItem[] = []
        const refs: { ref: string; inst: PlannedInstallment }[] = []

        const tuition = tuitionFor(classIndex, hike)
        // Concessions: heavier for RTE children and struggling families.
        const discount = student.isRte
          ? Math.round(tuition * between(0.4, 0.6))
          : family.tier === 'POOR' || family.tier === 'SEVERE'
            ? chance(0.35)
              ? Math.round(tuition * between(0.1, 0.25))
              : 0
            : chance(0.08)
              ? Math.round(tuition * between(0.05, 0.15))
              : 0

        const schoolNet = tuition - discount
        const schoolInstallments: PlannedInstallment[] = DUE_DAYS.map((day, index) => {
          const share =
            index === DUE_DAYS.length - 1
              ? money(schoolNet - Math.floor(schoolNet / 3) * 2)
              : money(Math.floor(schoolNet / 3))
          return {
            sequence: index + 1,
            label: `Installment ${index + 1}`,
            dueDate: dayIn(SESSIONS[si], day),
            net: share,
            paid: 0,
          }
        })
        feeItems.push({
          category: 'SCHOOL',
          name: 'Tuition Fee',
          original: tuition,
          discount,
          installments: schoolInstallments,
        })
        schoolInstallments.forEach((inst, i) =>
          refs.push({ ref: `${student.index}|${si}|S|${i}`, inst })
        )

        // Around a third take the bus, and they keep taking it year to year.
        if ((student.index * 7 + 3) % 10 < 3) {
          const bus = Math.round((5200 * hike) / 100) * 100
          const busInst: PlannedInstallment = {
            sequence: 1,
            label: 'Installment',
            dueDate: dayIn(SESSIONS[si], DUE_DAYS[0]),
            net: bus,
            paid: 0,
          }
          feeItems.push({
            category: 'BUS',
            name: 'Bus Fee',
            original: bus,
            discount: 0,
            installments: [busInst],
          })
          refs.push({ ref: `${student.index}|${si}|B|0`, inst: busInst })
        }

        enrollments.push({ student, sessionIndex: si, className, feeItems })
        sessionInstallments[si] = refs
      }

      // --- Payments, session by session --------------------------------
      for (let si = firstSession; si < SESSIONS.length; si++) {
        const refs = sessionInstallments[si] ?? []
        if (refs.length === 0) continue

        const billed = refs.reduce((n, r) => n + r.inst.net, 0)
        const isCurrent = si === SESSIONS.length - 1
        const sessionStart = sessionDates(SESSIONS[si].startYear).startDate
        const elapsedDays = isCurrent
          ? Math.floor((now.getTime() - sessionStart.getTime()) / 86_400_000)
          : 366

        // A family that pays a year behind clears LAST year's leftovers with
        // money paid during THIS year. That cross-session allocation is what
        // the archetype is, so it is arranged explicitly.
        if (family.archetype === 'NEXT_YEAR_PAYER' && si > firstSession) {
          const previous = sessionInstallments[si - 1] ?? []
          const owed = previous.reduce((n, r) => n + (r.inst.net - r.inst.paid), 0)
          if (owed > 0) {
            const day = intBetween(40, Math.max(60, Math.min(330, elapsedDays)))
            const amount = money(owed * between(0.6, 0.95))
            const alloc = allocate(previous, amount)
            if (alloc.length > 0) {
              payments.push({
                studentId: student.id!,
                payment: {
                  paidAt: dayIn(SESSIONS[si], day),
                  amount: money(alloc.reduce((n, a) => n + a.amount, 0)),
                  mode: pick(['CASH', 'ONLINE', 'CHEQUE'] as const),
                  category: 'SCHOOL',
                  allocations: alloc,
                },
              })
            }
          }
        }

        // Chronological: a family pays off what is due first. The real
        // allocation engine orders by session then category, which is right
        // for a cashier taking money at a counter but would leave a punctual
        // family's April bus fee unpaid until December — and therefore
        // permanently "overdue", which is the opposite of what they are.
        const ordered = [...refs].sort(
          (a, b) => a.inst.dueDate.getTime() - b.inst.dueDate.getTime()
        )

        for (const step of paymentPlan(family.archetype, ordered, billed)) {
          if (step.day > elapsedDays) continue
          const amount = money(step.amount)
          if (amount < 100) continue
          const alloc = allocate(ordered, amount)
          if (alloc.length === 0) continue
          payments.push({
            studentId: student.id!,
            payment: {
              paidAt: dayIn(SESSIONS[si], step.day),
              amount: money(alloc.reduce((n, a) => n + a.amount, 0)),
              mode: pick(['CASH', 'ONLINE', 'CHEQUE', 'BANK_TRANSFER'] as const),
              category: 'SCHOOL',
              allocations: alloc,
            },
          })
        }
      }
    }
  }

  // --- 7. Write the ledger ----------------------------------------------
  console.log(`${enrollments.length} enrollments planned, ${payments.length} payments planned`)

  const createdEnrollments = await prisma.studentEnrollment.createManyAndReturn({
    data: enrollments.map((e) => ({
      studentId: e.student.id!,
      sessionId: sessionRows[e.sessionIndex].id,
      classroomId: classroomByKey.get(`${e.sessionIndex}|${e.className}`)!,
      status: e.sessionIndex === SESSIONS.length - 1 ? 'ACTIVE' : 'PROMOTED',
    })),
    select: { id: true },
  })
  enrollments.forEach((e, i) => (e.id = createdEnrollments[i].id))

  // Fee items, already carrying their final paid/due figures.
  const feeItemPlans = enrollments.flatMap((e) =>
    e.feeItems.map((item) => ({ enrollment: e, item }))
  )
  const createdFeeItems = await prisma.studentFeeItem.createManyAndReturn({
    data: feeItemPlans.map(({ enrollment, item }) => {
      const net = money(item.original - item.discount)
      const paid = money(item.installments.reduce((n, i) => n + i.paid, 0))
      return {
        enrollmentId: enrollment.id!,
        category: item.category,
        name: item.name,
        originalAmount: item.original,
        discountAmount: item.discount,
        netAmount: net,
        paidAmount: paid,
        dueAmount: money(net - paid),
      }
    }),
    select: { id: true },
  })
  feeItemPlans.forEach(({ item }, i) => (item.id = createdFeeItems[i].id))

  // Installments, likewise.
  const installmentPlans = feeItemPlans.flatMap(({ enrollment, item }) =>
    item.installments.map((inst, index) => ({
      enrollment,
      item,
      inst,
      ref:
        `${enrollment.student.index}|${enrollment.sessionIndex}|` +
        `${item.category === 'SCHOOL' ? 'S' : 'B'}|${index}`,
    }))
  )
  const createdInstallments = await prisma.feeInstallment.createManyAndReturn({
    data: installmentPlans.map(({ item, inst }) => ({
      feeItemId: item.id!,
      sequence: inst.sequence,
      label: inst.label,
      dueDate: inst.dueDate,
      originalAmount: inst.net,
      discountAmount: 0,
      netAmount: inst.net,
      paidAmount: money(inst.paid),
      status:
        inst.paid >= inst.net ? 'PAID' : inst.paid > 0 ? 'PARTIAL' : ('PENDING' as const),
    })),
    select: { id: true },
  })
  const installmentIdByRef = new Map<string, number>()
  installmentPlans.forEach(({ ref }, i) => installmentIdByRef.set(ref, createdInstallments[i].id))

  // Transactions, oldest first so receipt numbers run in date order.
  payments.sort((a, b) => a.payment.paidAt.getTime() - b.payment.paidAt.getTime())
  const createdTransactions = await prisma.feeTransaction.createManyAndReturn({
    data: payments.map(({ studentId, payment }, i) => ({
      receiptNo: `RCP-${String(i + 1).padStart(6, '0')}`,
      studentId,
      category: payment.category,
      amount: payment.amount,
      mode: payment.mode,
      status: 'COMPLETED' as const,
      paidAt: payment.paidAt,
    })),
    select: { id: true },
  })

  await prisma.transactionAllocation.createMany({
    data: payments.flatMap(({ payment }, i) =>
      payment.allocations
        .filter((a) => installmentIdByRef.has(a.ref))
        .map((a) => ({
          transactionId: createdTransactions[i].id,
          installmentId: installmentIdByRef.get(a.ref)!,
          amount: money(a.amount),
        }))
    ),
  })
  console.log(`${createdFeeItems.length} fees, ${createdInstallments.length} installments, ${createdTransactions.length} payments`)

  // --- 8. Calls, promises and workflow state ----------------------------
  await seedContactHistory(families, now)

  console.log('\nRecalculating…')
  const { recomputeRecovery } = await import('../src/lib/recovery/recompute')
  const result = await recomputeRecovery()
  console.log(
    `  ${result.households} families · ${result.callable} worth calling · ${result.suppressed} skipped · ${inr(result.totalOutstanding)} outstanding`
  )

  await applyWorkflowState(now)
  await syncStagesFromHistory()

  const after = await recomputeRecovery()
  console.log(`  after workflow state: ${after.callable} worth calling, ${after.suppressed} skipped`)
}

/**
 * Spread `amount` across installments in order, filling each to its balance.
 * Mirrors what the real allocation engine does, so the demo's allocations look
 * like allocations the app itself would have produced.
 */
function allocate(
  refs: { ref: string; inst: PlannedInstallment }[],
  amount: number
): { ref: string; amount: number }[] {
  let remaining = amount
  const out: { ref: string; amount: number }[] = []
  for (const { ref, inst } of refs) {
    if (remaining <= 0.5) break
    const room = money(inst.net - inst.paid)
    if (room <= 0) continue
    const take = money(Math.min(room, remaining))
    inst.paid = money(inst.paid + take)
    remaining = money(remaining - take)
    out.push({ ref, amount: take })
  }
  return out
}

/** Calls that were made, and what was said. */
async function seedContactHistory(families: DemoFamily[], now: Date) {
  const OUTCOMES: $Enums.ContactOutcome[] = [
    'PROMISED', 'PROMISED', 'NEEDS_TIME', 'NEEDS_TIME', 'NO_ANSWER', 'NO_ANSWER',
    'CALL_BACK_LATER', 'PAID_ALREADY', 'SWITCHED_OFF', 'REFUSED', 'DISPUTED',
  ]
  const NOTES: Record<string, string[]> = {
    PROMISED: [
      'Said he will pay after the harvest money comes in.',
      'Asked for two weeks, will pay the first installment then.',
      'Will pay half now and the rest next month.',
    ],
    NEEDS_TIME: [
      'Father is between jobs, asked for time till next month.',
      'Medical expenses at home this month, asked us to wait.',
      'Said the shop has been slow, will try next month.',
    ],
    NO_ANSWER: ['Rang out.', 'No answer, tried twice.'],
    CALL_BACK_LATER: ['Was at work, asked to call in the evening.', 'Asked to call on Sunday.'],
    PAID_ALREADY: ['Says he paid at the office last week — to verify.', 'Claims payment already made.'],
    SWITCHED_OFF: ['Phone switched off.'],
    REFUSED: ['Says the fee is too high and he will not pay more this year.'],
    DISPUTED: ['Disputes the bus fee — says the child stopped using it in July.'],
  }
  const CALLERS = ['Office', 'Principal', 'Accounts']

  const session = await prisma.academicSession.findFirst({ where: { isCurrent: true } })
  if (!session) return

  const reachable = families.filter((f) => f.phones.length > 0 && f.householdId)
  let calls = 0
  let promises = 0

  for (const family of reachable) {
    // Families who are behind get chased; reliable payers rarely do.
    const chasedOdds =
      family.archetype === 'CHRONIC_DEFAULTER' || family.archetype === 'HEAVY_ROLLOVER'
        ? 0.75
        : family.archetype === 'YEAR_END_PARTIAL' || family.archetype === 'NEXT_YEAR_PAYER'
          ? 0.55
          : family.archetype === 'YEAR_END_FULL'
            ? 0.3
            : 0.08
    if (!chance(chasedOdds)) continue

    const attempts = intBetween(1, 4)
    for (let i = 0; i < attempts; i++) {
      const daysAgo = intBetween(4, 150)
      const contactedAt = new Date(now.getTime() - daysAgo * 86_400_000)
      const outcome = pick(OUTCOMES)
      const attempt = await prisma.contactAttempt.create({
        data: {
          householdId: family.householdId!,
          sessionId: session.id,
          channel: chance(0.85) ? 'CALL' : 'WHATSAPP',
          outcome,
          talkedTo: outcome === 'NO_ANSWER' || outcome === 'SWITCHED_OFF' ? null : 'Father',
          notes: NOTES[outcome] ? pick(NOTES[outcome]) : null,
          contactedAt,
          loggedByName: pick(CALLERS),
        },
        select: { id: true },
      })
      calls++

      if (outcome === 'PROMISED') {
        // A promise made long ago has already come due, and its outcome is
        // known; a recent one is still open. Both are needed for the
        // effectiveness lens to have anything to show.
        const dueInDays = intBetween(-40, 25)
        const promisedFor = new Date(now.getTime() + dueInDays * 86_400_000)
        const settled = dueInDays < -3
        const kept = settled ? chance(0.45) : false
        const partial = settled && !kept ? chance(0.3) : false
        const amount = money(intBetween(2000, 15000))

        await prisma.promiseToPay.create({
          data: {
            householdId: family.householdId!,
            sourceContactId: attempt.id,
            amount,
            promisedFor,
            status: settled ? (kept ? 'KEPT' : partial ? 'PARTIAL' : 'BROKEN') : 'OPEN',
            settledAmount: settled ? (kept ? amount : partial ? money(amount * 0.4) : 0) : null,
            settledAt: settled ? new Date(promisedFor.getTime() + 2 * 86_400_000) : null,
            closeReason: settled ? 'Settled automatically from recorded payments.' : null,
          },
        })
        promises++
      }
    }
  }
  console.log(`${calls} calls logged, ${promises} promises recorded`)
}

/**
 * Bring each case's stage into line with the calls actually logged against it.
 *
 * Stage and contact count are human-owned columns, so a recompute never sets
 * them — which means a family with three logged calls would otherwise still
 * read "Not contacted yet" on every screen. In normal use the call-logging
 * endpoint keeps them in step; seeded history has to do it here.
 */
async function syncStagesFromHistory() {
  const grouped = await prisma.contactAttempt.groupBy({
    by: ['householdId'],
    _count: { _all: true },
    _max: { contactedAt: true },
  })
  if (grouped.length === 0) return

  const promised = new Set(
    (
      await prisma.promiseToPay.findMany({
        where: { status: 'OPEN' },
        select: { householdId: true },
      })
    ).map((p) => p.householdId)
  )

  for (const row of grouped) {
    await prisma.recoveryCase.updateMany({
      // Never overwrite a decision a person made.
      where: { householdId: row.householdId, stage: { notIn: ['PARKED', 'SNOOZED', 'RECOVERED'] } },
      data: {
        stage: promised.has(row.householdId) ? 'PROMISED' : 'CONTACTED',
        contactCount: row._count._all,
        lastContactAt: row._max.contactedAt,
      },
    })
  }
  console.log(`${grouped.length} cases marked as contacted`)
}

/** A few cases parked, snoozed or pinned, so those paths are visible. */
async function applyWorkflowState(now: Date) {
  const parkReasons = [
    'Father passed away — school has agreed to hold the balance.',
    'Confirmed hardship, principal has approved a payment plan.',
    'Family has moved out of town, child transferred.',
    'Long-term illness at home, agreed to revisit next term.',
  ]

  const candidates = await prisma.recoveryCase.findMany({
    where: { suppressionRule: null },
    orderBy: { outstanding: 'desc' },
    take: 60,
    select: { id: true },
  })

  let parked = 0
  let snoozed = 0
  let pinned = 0
  for (const [i, c] of candidates.entries()) {
    if (i % 7 === 3) {
      await prisma.recoveryCase.update({
        where: { id: c.id },
        data: { stage: 'PARKED', parkedReason: pick(parkReasons) },
      })
      parked++
    } else if (i % 7 === 5) {
      await prisma.recoveryCase.update({
        where: { id: c.id },
        data: {
          stage: 'SNOOZED',
          snoozedUntil: new Date(now.getTime() + intBetween(5, 40) * 86_400_000),
        },
      })
      snoozed++
    } else if (i % 11 === 2) {
      await prisma.recoveryCase.update({
        where: { id: c.id },
        data: {
          pinnedForDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        },
      })
      pinned++
    }
  }
  console.log(`${parked} parked, ${snoozed} snoozed, ${pinned} pinned for today`)
}

main()
  .catch((e) => {
    console.error('❌ Demo seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
