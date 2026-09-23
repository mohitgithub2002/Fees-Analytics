/**
 * Group students into households — the unit fees are actually chased in.
 *
 *   npm run recovery:link-households -- --dry-run   # report, change nothing
 *   npm run recovery:link-households                # create households
 *   npm run recovery:link-households -- --force     # wipe and rebuild ALL
 *
 * One father with three children is one phone call and one behavioural
 * profile, not three. Getting that grouping right is the foundation of
 * everything above it.
 *
 * A FALSE MERGE IS FAR WORSE THAN A MISSED ONE. A wrong merge invents a
 * household owing several families' fees, corrupts its payment profile and
 * floats a phantom family to the top of the call list — where it wastes the
 * owner's best hour and costs them confidence in the whole system. A missed
 * merge costs one extra phone call. Every rule below is tuned to that
 * asymmetry, and anything the rules cannot settle goes to the review queue at
 * /recovery/households instead of being guessed at.
 *
 * Evidence, strongest first:
 *
 *  1. THE SCHOOL'S OWN SIBLING REFERENCES. feesdata.csv carries a `Siblings`
 *     column on 319 of 578 rows ("Play Latika Soni", "IV Purvi Saini") — the
 *     office writing down who is related to whom. That beats any inference,
 *     so it is used first. It is also free text, so it is parsed
 *     conservatively and anything ambiguous is reported rather than resolved.
 *
 *  2. FATHER'S NAME *AND* THE CHILD'S SURNAME. Father's name alone is not safe
 *     in this data: "<FirstName> Kumar" is extremely common and collapses
 *     unrelated families into one. Requiring the children's surname to agree
 *     as well is what keeps that from happening.
 *
 *  3. Everyone else is a household of one.
 *
 * Re-running is safe: students already in a household are left completely
 * alone, so manual merges and splits made in the app survive. Only --force
 * discards them, and it says so first.
 */
import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import csv from 'csv-parser'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const pool = new Pool({ connectionString: `${process.env.DATABASE_URL}` })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')

/** Above this many children, a group is linked but sent for confirmation. */
const OVERSIZED_GROUP = 4

// --- Text helpers ------------------------------------------------------

function norm(value: string | undefined | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Arabic class numbers appear in sibling notes ("H.M. 7 Jeeva"). */
const ARABIC_TO_ROMAN: Record<string, string> = {
  '1': 'i', '2': 'ii', '3': 'iii', '4': 'iv', '5': 'v', '6': 'vi',
  '7': 'vii', '8': 'viii', '9': 'ix', '10': 'x', '11': 'xi', '12': 'xii',
}

/** Tokens that carry no identity — branch markers, scheme names, filler. */
const NOISE_TOKENS = new Set(['hm', 'h m', 'class', 'rte', 'in', 'and', 'amp'])

const RTE_PATTERN = /\br\.?\s*t\.?\s*e\.?\b/i

interface SiblingRef {
  className: string | null
  name: string
}

/**
 * Pull sibling references out of one free-text cell.
 *
 * "Play Latika Soni"            → [{ Play, "latika soni" }]
 * "H.M. 7 Jeeva H.M. 9 Deepesh" → [{ vii, "jeeva" }, { ix, "deepesh" }]
 * "VI Priyanshu / Gordhan"      → [{ vi, "priyanshu" }]   (the tail is the father)
 */
export function parseSiblingRefs(raw: string, classVocab: Set<string>): SiblingRef[] {
  if (!raw) return []

  // Everything after a slash is a father's name or an aside, not a sibling.
  let text = raw.split('/')[0]
  text = text.replace(/["']/g, ' ').replace(/\(([^)]*)\)/g, ' $1 ')
  // "H.M." marks a sibling at the other branch. Stripped as a whole before
  // tokenizing, because normalizing it first turns it into the bare letters
  // "h" and "m", which then glue themselves onto the next child's name
  // ("H.M. 7 Jeeva" → a search for a student called "jeeva h m").
  text = text.replace(/\bh\.?\s*m\.?\b/gi, ' ')

  const tokens = norm(text).split(' ').filter(Boolean)
  const refs: SiblingRef[] = []
  let current: SiblingRef | null = null

  for (const token of tokens) {
    const asClass = ARABIC_TO_ROMAN[token] ?? token
    if (classVocab.has(asClass)) {
      if (current && current.name) refs.push(current)
      current = { className: asClass, name: '' }
      continue
    }
    if (NOISE_TOKENS.has(token)) continue
    if (!current) current = { className: null, name: '' }
    current.name = current.name ? `${current.name} ${token}` : token
  }
  if (current && current.name) refs.push(current)

  return refs.filter((r) => r.name.length >= 3)
}

// --- Union-Find --------------------------------------------------------

class DisjointSet {
  private parent = new Map<number, number>()

  find(x: number): number {
    const p = this.parent.get(x)
    if (p === undefined) {
      this.parent.set(x, x)
      return x
    }
    if (p === x) return x
    const root = this.find(p)
    this.parent.set(x, root)
    return root
  }

  union(a: number, b: number): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) this.parent.set(rootA, rootB)
  }

  groups(members: number[]): Map<number, number[]> {
    const out = new Map<number, number[]>()
    for (const m of members) {
      const root = this.find(m)
      const list = out.get(root)
      if (list) list.push(m)
      else out.set(root, [m])
    }
    return out
  }
}

// --- Main --------------------------------------------------------------

interface CsvRow {
  Class?: string
  'Student Name'?: string
  'Father Name'?: string
  Siblings?: string
  Remarks?: string
}

interface StudentInfo {
  id: number
  name: string
  fatherName: string
  className: string
  legacyStudentFeeId: number | null
}

async function readCsv(): Promise<CsvRow[]> {
  const file = path.join(process.cwd(), 'feesdata.csv')
  if (!fs.existsSync(file)) {
    console.log(`No feesdata.csv at ${file} — skipping sibling references.`)
    return []
  }
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

async function main() {
  if (FORCE && !DRY_RUN) {
    console.log('⚠️  --force: deleting ALL households, including any merged or split by hand.')
    await prisma.householdMember.deleteMany()
    await prisma.household.deleteMany()
  }

  // --- Load students with their current class -------------------------
  const classes = await prisma.schoolClass.findMany({ select: { name: true } })
  const classVocab = new Set(classes.map((c) => norm(c.name)))

  const enrolled = await prisma.student.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      fatherName: true,
      legacyStudentFeeId: true,
      enrollments: {
        orderBy: { session: { startDate: 'desc' } },
        take: 1,
        select: { classroom: { select: { class: { select: { name: true } } } } },
      },
    },
  })

  const students: StudentInfo[] = enrolled.map((s) => ({
    id: s.id,
    name: s.name,
    fatherName: s.fatherName,
    legacyStudentFeeId: s.legacyStudentFeeId,
    className: s.enrollments[0]?.classroom.class.name ?? '',
  }))

  if (students.length === 0) {
    console.log('No active students found. Run the data migration first.')
    return
  }

  // Students already grouped are left completely alone.
  const alreadyLinked = new Set(
    (await prisma.householdMember.findMany({ select: { studentId: true } })).map(
      (m) => m.studentId
    )
  )
  const pending = students.filter((s) => !alreadyLinked.has(s.id))

  console.log(
    `${students.length} active student(s); ${alreadyLinked.size} already in a household, ${pending.length} to group.\n`
  )
  if (pending.length === 0) {
    console.log('Nothing to do.')
    return
  }

  const pendingIds = new Set(pending.map((s) => s.id))
  const byId = new Map(students.map((s) => [s.id, s]))

  // Name indexes for resolving sibling references.
  const byClassAndName = new Map<string, StudentInfo[]>()
  for (const s of students) {
    const key = `${norm(s.className)}|${norm(s.name)}`
    const list = byClassAndName.get(key)
    if (list) list.push(s)
    else byClassAndName.set(key, [s])
  }
  const byClass = new Map<string, StudentInfo[]>()
  for (const s of students) {
    const key = norm(s.className)
    const list = byClass.get(key)
    if (list) list.push(s)
    else byClass.set(key, [s])
  }

  // --- Join CSV rows to students --------------------------------------
  const csvRows = await readCsv()
  const legacyById = new Map(
    (await prisma.studentFee.findMany({ select: { id: true, class: true, studentName: true, fatherName: true } })).map(
      (r) => [`${norm(r.class)}|${norm(r.studentName)}|${norm(r.fatherName)}`, r.id]
    )
  )
  const studentByLegacyId = new Map(
    students.filter((s) => s.legacyStudentFeeId !== null).map((s) => [s.legacyStudentFeeId!, s])
  )

  // --- Stage 1: the school's own sibling references --------------------
  const dsu = new DisjointSet()
  const siblingLinked = new Set<number>()
  const unresolved: { student: string; text: string; why: string }[] = []
  const rteStudents = new Set<number>()

  for (const row of csvRows) {
    const key = `${norm(row.Class)}|${norm(row['Student Name'])}|${norm(row['Father Name'])}`
    const legacyId = legacyById.get(key)
    const self = legacyId !== undefined ? studentByLegacyId.get(legacyId) : undefined
    if (!self) continue

    const siblingsText = row.Siblings ?? ''
    if (RTE_PATTERN.test(siblingsText) || RTE_PATTERN.test(row.Remarks ?? '')) {
      rteStudents.add(self.id)
    }
    if (!siblingsText.trim()) continue

    for (const ref of parseSiblingRefs(siblingsText, classVocab)) {
      const matches = resolveRef(ref, byClassAndName, byClass, students, self.id)

      if (matches.length === 1) {
        dsu.union(self.id, matches[0].id)
        siblingLinked.add(self.id)
        siblingLinked.add(matches[0].id)
      } else {
        unresolved.push({
          student: `${self.className} ${self.name}`,
          text: siblingsText.trim(),
          why:
            matches.length === 0
              ? `no student matches "${ref.name}"${ref.className ? ` in class ${ref.className.toUpperCase()}` : ''}`
              : `"${ref.name}" matches ${matches.length} students`,
        })
      }
    }
  }

  // --- Stage 2: father's name AND the child's surname ------------------
  const surnameGroups = new Map<string, StudentInfo[]>()
  for (const s of pending) {
    if (siblingLinked.has(s.id)) continue
    const surname = norm(s.name).split(' ').slice(1).join(' ')
    const father = norm(s.fatherName)
    // No surname recorded means nothing corroborates a link — solo.
    if (!surname || !father) continue
    const key = `${father}|${surname}`
    const list = surnameGroups.get(key)
    if (list) list.push(s)
    else surnameGroups.set(key, [s])
  }

  for (const group of surnameGroups.values()) {
    if (group.length < 2) continue
    for (let i = 1; i < group.length; i++) dsu.union(group[0].id, group[i].id)
  }

  // --- Assemble households ---------------------------------------------
  const groups = dsu.groups(pending.map((s) => s.id))

  // A sibling reference can point at a student who is already in a household.
  // Those groups are reported rather than merged, because joining an existing
  // household is exactly the kind of decision that deserves a human.
  const toCreate: { members: StudentInfo[]; source: string; oversized: boolean }[] = []
  const crossLinks: string[] = []

  for (const memberIds of groups.values()) {
    const members = memberIds
      .map((id) => byId.get(id))
      .filter((s): s is StudentInfo => s !== undefined && pendingIds.has(s.id))
    if (members.length === 0) continue

    const touchesExisting = memberIds.some((id) => alreadyLinked.has(id))
    if (touchesExisting) {
      crossLinks.push(members.map((m) => `${m.className} ${m.name}`).join(' + '))
    }

    const fromSiblings = members.some((m) => siblingLinked.has(m.id))
    const source =
      members.length === 1 ? 'solo' : fromSiblings ? 'csv:siblings' : 'auto:father+surname'
    toCreate.push({
      members,
      source,
      oversized: members.length > OVERSIZED_GROUP,
    })
  }

  // --- Report -----------------------------------------------------------
  const multi = toCreate.filter((g) => g.members.length > 1)
  const sibling = toCreate.filter((g) => g.source === 'csv:siblings')
  const surnameBased = toCreate.filter((g) => g.source === 'auto:father+surname')
  const solo = toCreate.filter((g) => g.members.length === 1)
  const oversized = toCreate.filter((g) => g.oversized)

  console.log(`Would create ${toCreate.length} household(s):`)
  console.log(`  · ${sibling.length} from the school's sibling notes`)
  console.log(`  · ${surnameBased.length} from father's name + child's surname`)
  console.log(`  · ${solo.length} single-child households`)
  console.log(
    `  · ${multi.length} with siblings, covering ${multi.reduce((n, g) => n + g.members.length, 0)} children`
  )
  if (rteStudents.size > 0) {
    console.log(`  · ${rteStudents.size} student(s) flagged RTE in the school records`)
  }

  if (oversized.length > 0) {
    console.log(
      `\n⚠️  ${oversized.length} group(s) have more than ${OVERSIZED_GROUP} children. They are linked but`
    )
    console.log('   flagged for confirmation at /recovery/households — check these first:')
    for (const g of oversized) {
      console.log(
        `   · ${g.members.length} children, father "${g.members[0].fatherName}": ${g.members.map((m) => `${m.className} ${m.name}`).join(', ')}`
      )
    }
  }

  if (crossLinks.length > 0) {
    console.log(
      `\n${crossLinks.length} group(s) reference a student who is already in a household.`
    )
    console.log('   Left separate — join them by hand at /recovery/households if correct:')
    for (const line of crossLinks.slice(0, 10)) console.log(`   · ${line}`)
    if (crossLinks.length > 10) console.log(`   · ...and ${crossLinks.length - 10} more`)
  }

  if (unresolved.length > 0) {
    console.log(`\n${unresolved.length} sibling reference(s) could not be resolved:`)
    for (const u of unresolved.slice(0, 15)) {
      console.log(`   · ${u.student} — "${u.text}" (${u.why})`)
    }
    if (unresolved.length > 15) console.log(`   · ...and ${unresolved.length - 15} more`)
    console.log('   These are a data-quality worklist, not an error.')
  }

  if (DRY_RUN) {
    console.log('\nDry run — nothing was written. Re-run without --dry-run to apply.')
    return
  }

  // --- Write -------------------------------------------------------------
  let created = 0
  for (const group of toCreate) {
    const payer = group.members[0]
    const hasRte = group.members.some((m) => rteStudents.has(m.id))

    await prisma.household.create({
      data: {
        displayName: payer.fatherName || payer.name,
        normalizedName: norm(payer.fatherName || payer.name),
        linkSource: group.source,
        needsReview: group.oversized,
        reviewNote: group.oversized
          ? `Grouped ${group.members.length} children on father's name and surname — confirm they are one family.`
          : null,
        // RTE is a government free-seat scheme for economically weaker
        // sections, so it says something real about ability to pay. Recorded
        // as a prompt for the call, NOT as a tier: the tag stays the human's.
        tierNote: hasRte
          ? 'School records mark this family RTE (government free seat) — confirm what they can afford on the call.'
          : null,
        members: {
          create: group.members.map((m) => ({
            studentId: m.id,
            linkSource: group.source,
          })),
        },
      },
    })
    created++
  }

  console.log(`\n✅ Created ${created} household(s) covering ${pending.length} student(s).`)
  console.log('   Next: npm run recovery:recalculate')
}

/** Resolve one parsed reference to the students it could mean. */
function resolveRef(
  ref: SiblingRef,
  byClassAndName: Map<string, StudentInfo[]>,
  byClass: Map<string, StudentInfo[]>,
  allStudents: StudentInfo[],
  selfId: number
): StudentInfo[] {
  // Exact class + full name is the only unambiguous case.
  if (ref.className) {
    const exact = byClassAndName.get(`${ref.className}|${ref.name}`)
    if (exact && exact.length === 1) return exact.filter((s) => s.id !== selfId)
  }

  const nameMatches = (s: StudentInfo): boolean => {
    if (s.id === selfId) return false
    const name = norm(s.name)
    if (name === ref.name) return true
    // A note often gives only a first name ("Mishika" for "Mishika Sharma").
    // Require a word boundary so "Anu" cannot match "Anushka".
    return name.startsWith(`${ref.name} `) || ref.name.startsWith(`${name} `)
  }

  const scoped = (ref.className ? (byClass.get(ref.className) ?? []) : allStudents).filter(
    nameMatches
  )
  if (scoped.length > 0 || !ref.className) return scoped

  // The class in a sibling note is often last year's — the note was written
  // once and never updated. Falling back to a school-wide search recovers
  // those, and the "exactly one match" rule still does the safety work: an
  // ambiguous name is reported, never guessed at.
  return allStudents.filter(nameMatches)
}

main()
  .catch((e) => {
    console.error('❌ Household linking failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
