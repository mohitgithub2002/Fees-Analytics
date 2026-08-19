/**
 * One-time (re-runnable) migration: link every Student to a paying Guardian.
 *
 * The v2 schema has no parent entity — `fatherName` + `phone` live directly on
 * Student. Recovery is a per-household activity (one father, several
 * children, one phone call), so this script groups students into Guardian
 * rows before any recovery feature can run.
 *
 * MATCHING IS DELIBERATELY CONSERVATIVE. Father's name alone is not enough:
 * in this data `<FirstName> Kumar` is extremely common, and grouping on it
 * produced a single "MUKESH KUMAR" household of 14 children spanning four
 * different surnames — four or five unrelated families fused into one. A false
 * merge is far worse than a missed one: it invents a household owing everyone's
 * fees, corrupts its behavioural profile, and floats a phantom family to the
 * top of the call list. A missed merge merely costs a second phone call.
 *
 * So siblings must agree on BOTH the father's name and their own surname:
 *
 *   1. Same father name + same child surname + agreeing phones (≤4 children)
 *                                          → auto-link (high confidence)
 *   2. As above but phones disagree        → split by phone, each part linked
 *   3. Same father name + same surname, but an implausibly large group
 *                                          → linked and flagged for review
 *   4. Child has no recorded surname       → solo guardian; there is nothing
 *                                            to confirm a sibling link with
 *   5. No match                            → solo guardian
 *
 * Flagged households surface at /recovery/households, where a human can merge
 * the ones the surname rule kept apart (families where children were recorded
 * under different surnames) or split the ones it wrongly joined.
 *
 * Every student ends up linked to exactly one payer guardian. Re-running is
 * safe: existing GuardianStudent links are left untouched, and only
 * newly-appearing/unlinked students are processed.
 *
 * Usage:
 *   npx tsx prisma/link-guardians.ts --dry-run
 *   npx tsx prisma/link-guardians.ts
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const DRY_RUN = process.argv.includes('--dry-run')

const TITLE_PREFIX = /^(MR|MRS|SH|SHRI|SMT|DR|LATE)\.?\s+/i
const SO_INFIX = /\s+S\/O\s+.*/i

function normalizeName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(SO_INFIX, '')
    .replace(TITLE_PREFIX, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

/**
 * The child's surname — the last word of their name, when there is one worth
 * trusting. Single-word names ("BHAVESH") and trailing initials give nothing
 * to match on, so they return null and the student stays a solo household
 * rather than being lumped in with strangers who share a father's name.
 */
function childSurname(studentName: string): string | null {
  const parts = studentName
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length < 2) return null
  const last = parts[parts.length - 1]
  return last.length >= 3 ? last : null
}

/** Above this, "siblings" is less likely than a name collision. */
const PLAUSIBLE_SIBLINGS = 4

interface Group {
  key: string
  displayName: string
  /** Null when the students share no usable surname (solo-only group). */
  surname: string | null
  students: { id: number; name: string; phone: string | null }[]
}

async function main() {
  const students = await prisma.student.findMany({
    where: { guardians: { none: {} } },
    select: { id: true, name: true, fatherName: true, phone: true },
  })

  if (students.length === 0) {
    console.log('Every student already has a guardian link. Nothing to do.')
    return
  }
  console.log(`${students.length} student(s) with no guardian link found.`)

  // Key on father's name AND the child's surname. Father alone over-merges
  // badly on common `<FirstName> Kumar` names; a child with no surname to
  // corroborate gets a key unique to them, so they stay solo.
  const groups = new Map<string, Group>()
  for (const s of students) {
    const father = normalizeName(s.fatherName)
    const surname = childSurname(s.name)
    const key = surname ? `${father}|${surname}` : `${father}|~unmatchable:${s.id}`
    const group = groups.get(key) ?? {
      key,
      displayName: s.fatherName.trim(),
      surname,
      students: [],
    }
    group.students.push({ id: s.id, name: s.name, phone: normalizePhone(s.phone) })
    groups.set(key, group)
  }

  const stats = { autoLinked: 0, splitByPhone: 0, largeFlagged: 0, soloNoSurname: 0, soloUnique: 0 }
  let linkedStudents = 0

  for (const group of groups.values()) {
    if (group.students.length === 1) {
      if (group.surname) stats.soloUnique++
      else stats.soloNoSurname++
      linkedStudents += 1
      if (!DRY_RUN) {
        await createGuardian(group.displayName, group.students, group.surname ? 'solo' : 'solo:no-surname')
      }
      continue
    }

    // Where phones exist and disagree, they outrank the name match — split the
    // group into one household per number.
    const phones = new Set(group.students.map((s) => s.phone).filter((p): p is string => !!p))
    if (phones.size > 1) {
      const byPhone = new Map<string, typeof group.students>()
      for (const s of group.students) {
        const k = s.phone ?? '~none'
        byPhone.set(k, [...(byPhone.get(k) ?? []), s])
      }
      stats.splitByPhone++
      for (const part of byPhone.values()) {
        linkedStudents += part.length
        if (!DRY_RUN) await createGuardian(group.displayName, part, 'auto:name+surname+phone')
      }
      continue
    }

    linkedStudents += group.students.length
    if (group.students.length > PLAUSIBLE_SIBLINGS) {
      // Same father name and surname, but too many children to take on faith.
      stats.largeFlagged++
      if (!DRY_RUN) await createGuardian(group.displayName, group.students, 'needs-review:large-group')
      continue
    }

    stats.autoLinked++
    if (!DRY_RUN) await createGuardian(group.displayName, group.students, 'auto:name+surname')
  }

  const households =
    stats.autoLinked + stats.largeFlagged + stats.soloNoSurname + stats.soloUnique + stats.splitByPhone

  console.log('')
  console.log('── Guardian linking report ──────────────────────────')
  console.log(`  Auto-linked siblings (father + surname):  ${stats.autoLinked} household(s)`)
  console.log(`  Split by differing phone:                 ${stats.splitByPhone} group(s)`)
  console.log(`  Flagged — more than ${PLAUSIBLE_SIBLINGS} children:          ${stats.largeFlagged} household(s)`)
  console.log(`  Solo — only child of that father:         ${stats.soloUnique} household(s)`)
  console.log(`  Solo — no surname to match siblings on:   ${stats.soloNoSurname} household(s)`)
  console.log(`  ─────────────────────────────────────────`)
  console.log(`  Households: ~${households}   Students covered: ${linkedStudents}/${students.length}`)
  if (DRY_RUN) console.log('\n  Dry run — no rows were written.')
  else console.log('\n  Review flagged households at /recovery/households.')
}

async function createGuardian(
  displayName: string,
  students: { id: number; phone: string | null }[],
  linkSource: string
) {
  const phone = students.find((s) => s.phone)?.phone ?? null
  const guardian = await prisma.guardian.create({
    data: {
      name: titleCase(displayName),
      normalizedName: normalizeName(displayName),
      phone,
      relation: 'FATHER',
      notes:
        linkSource === 'needs-review:large-group'
          ? `${students.length} children share this father's name and surname — more than a household usually has. Confirm they are really one family, or split the ones that are not.`
          : null,
    },
  })
  await prisma.guardianStudent.createMany({
    data: students.map((s) => ({
      guardianId: guardian.id,
      studentId: s.id,
      relation: 'FATHER' as const,
      isPayer: true,
      linkSource,
    })),
  })
}

function titleCase(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

main()
  .catch((e) => {
    console.error('Guardian linking failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
