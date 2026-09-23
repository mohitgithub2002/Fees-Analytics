# Loading a school

Everything in this app — the [fees ledger](./FEES_V2.md) and the
[recovery module](./RECOVERY.md) — runs on whatever data is put in. This
describes how to put a school in, whether by uploading files or by typing.

The screen is **School Data** (`/manage/import`). It opens on a checklist that
says what is loaded, what is missing, and — the part that matters — what each
missing piece *blocks*.

## Three files, in order

| # | File | Why the order matters |
|---|---|---|
| 1 | **Students & parents** | Everything else is matched against students, so nothing can be loaded before them. |
| 2 | **Fees charged** | What each child owes. Skip it entirely if you define class-wise fee structures instead. |
| 3 | **Payments received** | When money actually arrived. Without this, the system can say how much is owed but not *when* families pay. |

Every upload runs as a **dry run** first, always. Each of these writes real
records, and the only honest way to let somebody commit is to show them exactly
what will happen — which rows matched, which did not, and what the totals come
to — before anything is saved.

Templates download pre-filled with worked example rows, because a header-only
file leaves people guessing what a Family ID looks like or whether dates are
day-first, and that guess is where bad uploads come from.

**You do not have to use the templates.** Columns are matched automatically
against a list of aliases (`Adm No`, `Scholar No`, `Father's Name`, `Mobile`,
`Receipt Date`…), so a school's own export usually drops straight in. The
guesses are always shown and always editable — a silently mis-matched column is
worse than one somebody had to pick.

## 1 · Students & parents

One row per child, with the parent's details on the same row — that is how
school registers are actually kept, and asking for a separate parent list
guarantees the upload never happens.

| Column | Required | Notes |
|---|---|---|
| Admission No | — | Strongly recommended. It is what lets you re-upload the same file to **update** records instead of creating duplicates. |
| Student Name | ✓ | |
| Class | ✓ | Classes that do not exist are created, in the right order. |
| Section | — | Defaults to A. |
| **Family ID** | — | **The important one.** See below. |
| Father Name | — | Becomes the family's name on the call list. |
| Mother Name | — | |
| Parent Phone | — | A family with no number cannot be chased at all. |
| Alternate Phone | — | Often the mother's. |
| Address, Gender, Date of Birth | — | Day-first dates. |

### Family ID: why siblings must be grouped

Fees are chased **per family, not per child**. One father with three children
is one phone call and one behavioural profile, not three — and if the system
does not know they are related, it will ring him three times about three
separate debts and get the pattern wrong on all of them.

Grouping is explicit rather than guessed, in this order:

1. **Family ID** — any code you like (`F001`, a house number, the father's
   phone). Rows sharing a value become one family.
2. **Parent phone** — where Family ID is blank, children sharing a normalized
   phone number are grouped. `+91 98765 43210`, `098765 43210` and
   `9876543210` are all the same number.
3. **Solo** — where both are blank, each child becomes its own family. These
   can be merged by hand afterwards.

Names are deliberately *not* used. `<FirstName> Kumar` is common enough that
name-matching merges unrelated families into a household that appears to owe
two families' fees, which then floats to the top of the call list.

## 2 · Fees charged

| Column | Required | Notes |
|---|---|---|
| Admission No / Student Name / Class | — | How the row finds its student. Admission number is the reliable one. |
| **Session** | — | Blank means the current session. Put **last year's** name here to load an old balance. |
| Category | — | SCHOOL, BUS or OTHER. Blank means SCHOOL. |
| Fee Name | ✓ | Re-uploading the same name for the same child is skipped, so the file is safe to run twice. |
| Amount | ✓ | Before discount. |
| Discount | — | Concession given. |
| **Already Paid** | — | An opening balance. See the warning below. |
| Installments | — | Blank means 1. School fees are commonly 3. |

### Load last year's balance

This is the single most valuable optional thing in the whole import. *"Owes for
more than one year"* and *"always a year behind"* are read off dues sitting open
in **two sessions at once**. A school that loads only this year's fees will see
every family classified as a first-year unknown, and the carry axis — the half
of the engine that works without any payment dates at all — stays dark.

Put the old balance in under last session's name and those patterns are visible
on day one.

### "Already Paid" vs the payments file

They describe the same money two different ways, and you should use **one or
the other** for a given payment:

- **Already Paid** when you have the totals but not the individual receipts.
  The import records this as an `OPENING-*` transaction so the ledger's
  invariants still hold — but it carries no date, so it cannot tell the system
  *when* the family pays.
- **The payments file** when you have dated receipts. Richer, and the only
  thing that unlocks behaviour patterns, seasonality and the forecast.

You can safely do both: the payment import **cancels** a student's `OPENING-*`
and `LEGACY-*` transactions before replaying the real ones, so importing
payment history *supersedes* an opening balance rather than stacking on top of
it. Their total owed does not change.

## 3 · Payments received

| Column | Required | Notes |
|---|---|---|
| Admission No / Student Name / Class | — | How the row finds its student. |
| Amount | ✓ | |
| **Payment Date** | ✓ | The day money actually arrived. `13/07/2026` is read day-first. |
| Mode | — | CASH, ONLINE, CHEQUE, BANK_TRANSFER, CARD, OTHER. |
| Receipt No | — | Your own reference. |

The dry run reconciles each student's imported total against what the ledger
already says they paid, **in paise** — two rupee totals built from floating
point will not compare equal. A student whose totals disagree is skipped and
their ledger left untouched, unless you explicitly tick the override: a
mismatch almost always means a missing or duplicated row in the file, not a
ledger error.

Commit runs **per student inside its own transaction** and *replays* payments
through the normal allocation engine rather than editing dates in place.
Rewriting `paidAt` would be far less code and would quietly break the ledger:
allocations would still point at installments settled in a different order, and
`sum(allocations) = amount` would drift. Replaying means installment statuses,
fee totals and receipts all come out consistent, because the same code produces
them as in normal use.

## Doing it by hand instead

The uploads are a shortcut, not a requirement. Everything can be typed in:

| Task | Where |
|---|---|
| Add a student | `/manage/students` |
| **Create a parent and attach their children** | `/recovery/households` |
| Move a child between families, or split siblings apart | `/recovery/households` |
| Add or correct a phone number | `/recovery/households` → a family, or the call card |
| Class-wise fees and due dates | `/manage/setup` |
| Record a payment | `/manage/transactions` — these carry a real date automatically |

`/recovery/households` leads with **students who have no parent attached**,
because a student with no payer never reaches the call list however much they
owe. Creating a parent and attaching children is two clicks; a child already
attached elsewhere is *moved*, never duplicated.

## Starting from scratch

**School Data → Start from scratch** clears a school's data so another can be
loaded. It is irreversible, so it requires typing `DELETE ALL SCHOOL DATA` and
is restricted to the superuser. Two scopes:

- **Families & call history only** — clears households, profiles, cases, calls
  and promises. Students and fees are kept.
- **Everything** — the above plus students, enrollments, fees, installments and
  payments, including the flat legacy table the original dashboard reads from.

Staff logins, classes and academic sessions are always kept: they are reusable
scaffolding, not the school's data, and clearing them only creates work.

## After loading

```bash
npm run recovery:recalculate     # or the Recalculate button on /recovery
```

The imports trigger this themselves, so it is only needed after manual edits or
a scripted load. Then:

1. `/recovery/households` — confirm any groupings the system was unsure about.
2. `/manage/setup` — add installment due dates, so "on time" and "late" become
   answerable.
3. `/recovery` — the command centre lists whatever is still blocking recovery.

## Seeing it work first: the demo school

```bash
npm run demo:seed -- --dry-run   # report the plan, change nothing
npm run demo:seed                # clear school data and rebuild it
```

Before real data exists, every screen correctly renders as "not enough data" —
which is honest but makes it impossible to tell whether the system works, or to
find the places where it would break on real input. `prisma/seed-demo-school.ts`
builds a school that exercises every feature.

**Real names, invented money.** Students, parents and classes come from
`feesdata.csv`, and the school's own sibling notes decide which children share a
payer. Only the amounts and the dates are generated. Deterministic, so two runs
produce the same school and a bug can be reproduced.

What it produces, on the 578-student register:

| | |
|---|---|
| Families | 436, of which 33 deliberately have **no phone number** |
| Sessions | 3 (2024-25, 2025-26, 2026-27) — two finished, so multi-year patterns are real |
| Ledger | 1,568 enrollments · 2,033 fees · 5,169 dated installments · 2,798 dated payments |
| Contact | 465 calls with outcomes and notes · 77 promises (kept, part-paid, broken, open) |
| Workflow | parked, snoozed and pinned cases, so those paths are visible |

### The storyline contract

Each family is assigned a payment *storyline*, and payments are generated that
would produce it — the archetype itself is **never written anywhere**. The
engine has to read it back out of the dates. That makes the demo a test of the
classifier rather than a picture of it, and it is how two real bugs were found:
a rule that branded any family with a small residue in two years a chronic
defaulter, and an ordering bug where "pays every installment on time" swallowed
"pays everything up front".

On the current seed the engine recovers the generating pattern for about 96% of
families:

| Pattern | Generated | Re-derived |
|---|---|---|
| Pays everything up front | 35 | 35 |
| Pays each installment on time | 74 | 69 |
| Pays in full, but at year end | 62 | 60 |
| Pays late, leaves a balance | 61 | 57 |
| Leaves most of it unpaid | 68 | 67 |
| Always a year behind | 55 | 52 |
| Owes for more than one year | 48 | 45 |
| Not enough history | 33 | 51 |

The shortfall lands in "not enough history", which is the right place for it: a
family whose generated payments fall in a genuinely ambiguous band should be
reported as ambiguous, not forced into a bucket.

### Ledger invariants

The demo is not exempt from the ledger's arithmetic — the whole point is to
exercise it. After every seed:

```
transactions where sum(allocations) != amount   0
fee items violating net/due arithmetic          0
fee items whose paid != sum(installments)       0
```

### Replacing it with real data

The demo occupies the same tables real data would, so switching over is just
**School Data → Start from scratch → Everything**, then the three uploads.
Nothing about the demo is special-cased anywhere in the engine.

## What the system does with thin data

It degrades honestly rather than inventing confidence. With no payment dates,
the timing half of the behavioural engine reports zero confidence and says so;
with one year of history, every verdict is capped and labelled *"a first read,
not a settled pattern"*; with no due dates, the installment chart says on-time
cannot be worked out instead of drawing a plausible-looking zero.

A chart drawn from missing data looks exactly as confident as a real one, and
quietly teaches the owner something false. Every lens carries a coverage note
for that reason.
