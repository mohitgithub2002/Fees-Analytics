/**
 * Reading the school's own free-text sibling notes.
 *
 * `feesdata.csv` carries a `Siblings` column on 319 of 578 rows — the office
 * writing down who is related to whom ("Play Latika Soni", "IV Purvi Saini").
 * That is better evidence of a family than anything that can be inferred from
 * names, so it is parsed rather than ignored.
 *
 * Shared by the household linker and the demo seeder. Pure, so the parsing
 * rules can be reasoned about on their own.
 */

export function normalizeName(value: string | undefined | null): string {
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
const NOISE_TOKENS = new Set(['class', 'rte', 'in', 'and', 'amp'])

export interface SiblingRef {
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
  // "h" and "m", which then glue themselves onto the next child's name.
  text = text.replace(/\bh\.?\s*m\.?\b/gi, ' ')

  const tokens = normalizeName(text).split(' ').filter(Boolean)
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

/** Union-Find, for merging sibling references into families. */
export class DisjointSet {
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
