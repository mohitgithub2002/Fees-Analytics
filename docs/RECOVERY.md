# Fees Intelligence & Recovery

Sits on top of the [v2 fees ledger](./FEES_V2.md); reads it, never writes to it
except through the existing allocation engine during a payment-history import.
The ledger stays the only source of truth for money — everything here is either
**derived and recomputable**, or a **record of human contact**.

The ledger answers *"how much is due?"*. This module answers the questions that
actually drive collection:

- Which installment underperforms, and by how much?
- Which months does money actually arrive in?
- Within a class, who pays most, about average, or almost nothing?
- How much will arrive next month, and **from whom**?
- **Who do I call today, and what do I say to them?**

## The core idea: two axes, not one

Everything hangs off separating two things that get constantly conflated when
chasing fees:

| Axis | Question | Source |
|---|---|---|
| **`PaymentArchetype`** | *When/whether* they pay | Derived from the ledger |
| **`EconomicTier`** | *Whether they can* pay | Human-tagged, system-suggested |

```
                 ABLE (Affluent/Comfortable)      UNABLE (Poor/Severe)
  BAD TIMING     ► CALL FIRST — highest ERV       ► Payment plan, not calls
  (rollover,       "they have it, they're just      "calling harder won't
   year-end)        slow"                             create money"
  GOOD TIMING    ► DON'T CALL — wasted effort     ► Protect: small, on-time
  (regular,        they'll pay on schedule           payers; never chase
   early full)
```

Ranking on outstanding balance alone cannot tell those quadrants apart, which is
why a naive "biggest debtor first" list burns a day of calls on families who
have nothing to give.

### The two axes become available at different times

This is the constraint the engine is built around, and it is why confidence is
reported **per axis** rather than as one number.

| Axis | Built from | Available |
|---|---|---|
| **Carry** — how much rolls into next year | `pastSessionsDue`, `sessionsWithOpenDues`, `currentPaidRatio` | **Now.** A present fact in the ledger; needs no payment dates. |
| **Timing** — when in the year money arrives | `onTimeInstallmentRate`, `clearanceDay`, `daysToFirstPayment`, `monthHistogram` | Only after installment **due dates** exist and real **payment dates** have been imported. |

So `CHRONIC_DEFAULTER`, `NEXT_YEAR_PAYER` and `HEAVY_ROLLOVER` classify today;
`EARLY_FULL`, `INSTALLMENT_REGULAR`, `YEAR_END_FULL` and `YEAR_END_PARTIAL` stay
dark until the import runs.

**One year of history is a sample of one.** `historyCap()` clamps every verdict
to ≤ 0.6 confidence while `sessionsTracked < 2`, and each profile carries the
line *"Based on a single year of history — treat this as a first read, not a
settled pattern"* for the UI to render verbatim.

## Data model

```
Household (the payer — a family, not a student)
   ├── HouseholdMember ──── Student   (one call covers all their children)
   ├── HouseholdContact              the numbers you can actually dial
   ├── HouseholdProfile              DERIVED — archetype, scores, evidence
   ├── RecoveryCase                  MUTABLE workflow state, per session
   ├── ContactAttempt                every logged call
   └── PromiseToPay                  "₹5,000 by the 12th" — self-settling

FeeStructureInstallment  due-date schedule per structure item
CollectionForecast       dated snapshots, scored against actuals
RecoveryConfig           single row: the tunable targeting rules
PaymentImportBatch/Row   auditable, reversible import runs
```

Three kinds of state, deliberately kept apart:

- **`HouseholdProfile`** is rebuilt wholesale on every recompute (same contract
  as `SyllabusPacing`: never human-written, always recomputable, idempotent).
- **`RecoveryCase`** holds decisions a *person* made — stage, snoozed, parked,
  pinned, assigned — which a recompute must never trample. It doubles as the
  worklist row, so ranking, filtering and pagination all happen in SQL.
- **The ledger** is read-only from here.

### `HouseholdContact` — why reachability is its own table

No migrated student has a phone number: `migrate-v2.ts` never populates
`Student.phone` and the legacy CSV has no phone column at all. On the real
dataset **349 of 399 households currently cannot be phoned**, which makes
contactability the single largest blocker in the system — larger than any
scoring question.

Modelling numbers as rows rather than a `phone`/`altPhone` column pair makes
*"which households can we not reach?"* a first-class query, lets a number proven
wrong be recorded without being lost (so the same wrong number is not re-entered
from the same stale admission form next month), and feeds the worklist's
**"needs a phone number"** band — work somebody can do, kept separate from
"wait five days".

## The engine (`src/lib/recovery/`)

| Module | Responsibility |
|---|---|
| `features.ts` | The only file with SQL on the scoring path. Turns the ledger into a `HouseholdFeatures` vector per household — seven bulk queries for the whole school, not seven per family |
| `archetype.ts` | Rule cascade → archetype + per-axis confidence + **evidence**. Checked worst-behaviour-first |
| `tier.ts` | Suggests ability to pay from school-side facts (concessions, transport, family size). Suggestion only — the human tag always wins |
| `propensity.ts` | `p = base(archetype) × tier × recency × promises × contact × season × ask-size`, each factor bounded and each emitting one plain-English line |
| `suppression.ts` | Who should *not* be called today, and why |
| `forecast.ts` | Three nested bands, decomposed by source/class/household, plus calibration from past snapshots |
| `cohorts.ts` | The five analytical lenses |
| `promises.ts` | Settles promises from real payments — nobody ticks a box |
| `recompute.ts` | Idempotent refresh of profiles + cases |
| `config.ts` | Loads/saves the tunable rules, clamped to `TUNING_LIMITS` |
| `case-view.ts` | The shape a case takes on screen, shared by the worklist and the parent page |
| `csv.ts` | Import file parsing (day-first dates) |
| `types.ts` | Prisma-free — safe to import from client components |

### Why rule-based, not ML

The output decides who gets phoned. A school owner has to be able to disagree
with it out loud — *"no, they cleared by Diwali last year"* — and see which rule
produced the answer. So every verdict carries the evidence that produced it, and
the UI renders those lines verbatim. Explainability beats a few points of
accuracy when a human has to trust the call order — and with one session of
history there is nothing to train on anyway.

### Expected recovery, not outstanding

The worklist ranks on `priorityScore` — expected recovery nudged by how overdue
a family is — never on the raw balance. Ranking a chronic defaulter's ₹40,000
above a year-end payer's ₹12,000 is how a call list ends up sorted by *how badly
a family is doing* rather than by *what the day will actually collect*.

Where a family has named a figure themselves (an open promise), that figure is
believed over the model, in both the ranking and the committed forecast band.

## Suppression: the half that saves effort

All thresholds live in `RecoveryConfig` and are editable at `/recovery/settings`.

| Rule | Default |
|---|---|
| Fully paid, or below the minimum worth calling | ₹500 |
| Paid anything recently | 7 days |
| Open promise with a future date | until the date + 3 days grace |
| Contacted recently (cooling off) | 5 days |
| Consecutive unanswered calls → slower cadence | 3 calls → 7 days |
| Parked (confirmed hardship) | until reopened |
| **No usable phone number** | routed to the repair queue, not dropped |
| Pays reliably and nothing is **overdue** | always |

Two rules the design rests on:

1. **Suppression is always explained and reversible.** Skipped households appear
   in the worklist's collapsed *"N skipped today"* row with their reason — never
   silently dropped. The owner overrules the system, not the other way round.
2. **The thresholds are settings, not constants.** The person who knows whether
   five days is too soon to call again is the one running the school.

Note the last rule tests **overdue**, not outstanding. A reliable family with
three installments still ahead of them owes money but is not late, and chasing
them for it is how a call list loses the trust of the people who most reliably
answer it.

A household that pays mid-session disappears from the list on the next load,
because both `/api/v2/transactions` endpoints call `recomputeForStudent` on
payment and on cancellation.

### Pins are applied on read, not stored

`recompute.ts` deliberately evaluates suppression with `pinnedForDate: null`, so
what gets stored is the *real* reason a household would be skipped. The worklist
fetches pinned cases separately and unions them into the queue. If a pin cleared
the stored suppression, the household would still look callable tomorrow, after
the pin expired, until a recompute happened to run — and the pinned card would
lose the ability to show *what* it is overriding.

## Forecasting

Three **nested** bands (`committed ≤ likely ≤ stretch`):

- **Committed** — open promises plus installments falling due from households
  that reliably meet due dates. The number to plan salaries against.
- **Likely** — committed plus a propensity- and season-weighted share of the
  rest, multiplied by the calibration factor.
- **Stretch** — what a very good month of follow-up could reach.

**The decomposition is the point, not the total.** "₹4 lakh next month" is not
actionable; "₹1.2 lakh of it is these nine families who already promised, and
another ₹2 lakh is class IX arrears" is. Every band breaks down by source, by
class and by household, and the screen drills through to the names.

Every generation is snapshotted (`CollectionForecast`, one row per month per
generation date) and each elapsed month is scored against what actually arrived,
using the **earliest** snapshot for that month — grading a forecast made on the
30th against that month's takings would flatter the system into uselessness. The
resulting calibration factor (clamped 0.5–1.5×) feeds the next forecast: the
system correcting its own optimism.

## API (`/api/v2/recovery`)

| Route | Methods | Purpose |
|---|---|---|
| `/overview` | GET | Command-centre KPIs, blockers, next month |
| `/worklist` | GET | Today's ranked list, plus skipped-with-reasons and needs-a-number |
| `/households` | GET, POST | Segmentation browser; confirm / merge / split |
| `/households/:id` | GET, PATCH | Parent 360; tier override, rename |
| `/households/:id/calls` | GET, POST | The call log. POST logs outcome + promise + tier in one write |
| `/households/:id/contacts` | GET, POST | Phone numbers |
| `/households/:id/contacts/:contactId` | PATCH, DELETE | Correct, verify or remove a number |
| `/cases/:id` | PATCH | `pin` \| `unpin` \| `snooze` \| `park` \| `reopen` |
| `/promises/:id` | PATCH | Manual resolve/cancel (promises normally self-settle) |
| `/behavior?lens=` | GET | `installments` \| `monthly` \| `classes` \| `segments` \| `effectiveness` |
| `/forecast` | GET | Bands, decomposition, accuracy history |
| `/config` | GET, PATCH | Targeting rules, clamped to `TUNING_LIMITS` |
| `/import/payments` | GET, POST | Import history (dry run + commit); recent runs |
| `/recalculate` | POST | Full refresh + forecast snapshot |

### Response & error conventions

Follows the `/api/v2/*` family: success is `{ "data": ... }` written explicitly
(`ok({ data })` does not auto-wrap), errors are `{ "error": "message" }`, and
`serialize()` converts Decimals to numbers and Dates to ISO strings on the way
out. Status codes: `200` read, `201` create, `400` validation, `401` no session,
`404` not found, `409` conflict.

There is no background job runner in this app, so recompute is **on demand**:
`POST /recalculate`, the Recalculate button on the command centre, or
`npm run recovery:recalculate`. That endpoint is the hook point for a real
scheduler.

## Screens (`/recovery`)

| Route | Purpose |
|---|---|
| `/recovery` | Command Center — today's work first, then money, then what is blocking recovery |
| `/recovery/worklist` | **The daily driver.** Ranked queue + call card with one-tap outcome logging and tier tagging |
| `/recovery/parents` | Segmentation browser |
| `/recovery/parents/[id]` | Parent 360 — profile, evidence, children, phones, promises, calls, payments |
| `/recovery/behavior` | Installments · Months · Classes · Behaviour × Ability · Is Calling Working |
| `/recovery/forecast` | Bands, where the money comes from, accuracy history |
| `/recovery/import` | Payment-history backfill: upload → map → dry run → commit |
| `/recovery/households` | Family-link review queue |
| `/recovery/settings` | The targeting rules |

## Setting it up

To load a school from files or by hand — students, parents, fees and payments —
see **[Loading a school](./SCHOOL_DATA.md)**. The steps below are for the
original legacy dataset, which was migrated rather than uploaded.

```bash
npm run db:push
npm run db:generate

npm run recovery:link-households -- --dry-run   # review the grouping report
npm run recovery:link-households                # create Household rows

# Needs a due-date schedule on fee structures first (Setup → Fee Structures)
npm run recovery:backfill-due-dates -- --dry-run
npm run recovery:backfill-due-dates

npm run recovery:verify                         # 120 fixture checks on the engine
npm run recovery:recalculate                    # populate profiles, cases, forecast
```

### How students get grouped into families

`link-households.ts` is deliberately conservative, because a **false merge is far
worse than a missed one**: it invents a household owing several families' fees,
corrupts its behavioural profile, and floats a phantom family to the top of the
call list. A missed merge only costs a second phone call.

Evidence, strongest first:

1. **The school's own sibling notes.** `feesdata.csv` carries a `Siblings`
   column on **319 of 578 rows** (`"Play Latika Soni"`, `"IV Purvi Saini"`) —
   the office writing down who is related to whom. That beats any inference, so
   it is used first. It is free text, so it is parsed conservatively: `H.M.`
   (the other branch) is stripped, anything after a `/` is treated as the
   father's name, and a reference resolves only when **exactly one** student
   matches.
2. **Father's name *and* the child's surname.** Father's name alone is not safe
   here — `<FirstName> Kumar` is extremely common and collapses unrelated
   families into one.
3. Everyone else is a household of one.

On the 578-student dataset this yields **399 households: 140 sibling groups
covering 325 children**, with 65 sibling references left unresolved (ambiguous
first names, or siblings at the other branch) and reported as a data-quality
worklist rather than guessed at. Groups larger than four children are linked but
flagged for confirmation at `/recovery/households`.

The script also detects **RTE** (the government free-seat scheme for
economically weaker sections) in the sibling and remarks columns — 51 students —
and records it as a prompt on the household, *not* as a tier. Written as
`R. T. E.` as often as `RTE`, so a literal substring search misses most of them.

### Installment due dates

Without due dates, *"installment 2 collects late"* is unanswerable. Add a
schedule per fee-structure item at **Setup → Fee Structures**. The schedule is
**all-or-nothing** — every installment or none — because a half-dated item would
silently skew the on-time rate. New enrollments pick the schedule up
automatically via `applyStructureToEnrollment`; existing installments are filled
by `recovery:backfill-due-dates`. Items with no schedule keep producing undated
installments exactly as before, and analysis falls back to session-relative
timing for them.

## Payment-date history

Two kinds of transaction exist without a genuine date behind them, and
`src/lib/recovery/provenance.ts` defines both in one place because the rule is
applied in five, across TypeScript and SQL:

- **`LEGACY-*`** — from the one-time migration of the flat `StudentFee` table.
  Every one carries the timestamp of the migration run (`migrate-v2.ts` uses
  `row.createdAt`), not the day money changed hands.
- **`OPENING-*`** — from the fee import, backing an "already paid" opening
  balance a school types in when it has the total but not the receipts.

Both are real money and both keep the ledger's invariants, but neither can say
*when* a family pays, so both are excluded from the month histogram, from
seasonality, from the monthly chart and from forecast calibration. Including
them would stack a school's whole history onto one or two days and invent a
seasonal spike that never happened.

On the original legacy dataset that means **no genuine payment-timing history
at all** — 178 `LEGACY-*` transactions and nothing else — until real history is
imported.

### Importing the real history

`/recovery/import` → upload CSV → map columns → **dry run** → commit.

The dry run reports matched / unmatched / ambiguous / invalid rows and
reconciles each student's import total against their recorded paid amount
(compared in paise — two rupee totals built from floats will not be equal).
A student whose totals disagree is **skipped** unless *"import students whose
totals disagree anyway"* is ticked.

Commit runs **per student inside its own transaction**: existing `LEGACY-*`
transactions are cancelled via `cancelTransaction`, then each real payment is
replayed through `allocatePayment`. It replays rather than editing `paidAt` in
place, because rewriting the dates would leave allocations pointing at
installments settled in a different order and break `sum(allocations) =
transaction.amount`. Going through the real engine means installment statuses,
fee-item totals and receipts all come out consistent. One student's bad data
never abandons the rest of the import.

## Verification

```bash
npm run recovery:verify   # 120 fixture checks: classification, scoring, suppression
npx tsc --noEmit
npm run lint
npm run build
```

The repo has no test runner and this is not the place to introduce one for a
single module — but the scoring engine decides who gets phoned, so the
behaviours that matter are pinned in `scripts/recovery-verify.ts`. Everything
under test is pure, which is the point of keeping archetype/tier/propensity/
suppression free of Prisma: the fixtures are plain objects and the checks run in
milliseconds with no database.

It pins down one case per archetype, confidence rising with history and capped
at one session, the timing axis staying dark without payment dates, year-end
rules not firing early in the session, an on-time payer never being labelled a
late one, an open promise being believed over the model, ability moving the
score the right way, expected recovery never exceeding the balance, a pin
overriding every suppression rule, every suppression stating a reason, settings
being clamped, and the evidence never contradicting itself.

Two bugs it caught during development, both of which would have put the wrong
families on the call list: a household paying 90% of installments on time being
classified *"pays late, leaves a balance"*, and a household with **nothing
billed** being classified *"leaves most of it unpaid"* (zero paid out of zero
billed is a ratio of zero).

## Deliberate deviations

- **In-handler `requireAdmin()` on `/api/v2/*` routes.** The rest of the v2
  family relies on the `proxy.ts` cookie gate alone. These routes call the guard
  as well — partly defence in depth, but mainly because `ContactAttempt` and
  tier changes must record *who* did them, which needs the session user.
- **No zod.** Manual `readJson<T>()` + field-by-field checks, matching the
  documented house style.
- **`/households/:id/calls` is separate from `/households/:id/contacts`.** The
  original design put call logging on `/contacts`. They are different things —
  history versus contact details — and conflating them makes "which households
  can we not phone?" impossible to ask.
- **One `/behavior?lens=` route rather than five.** The screen is tabs over one
  question; five routes would fan out the client, cache keys and docs for no
  benefit.
- **Set-based writes in `recompute.ts`.** Profiles are replaced with
  `deleteMany` + `createMany`; cases go through one `INSERT … ON CONFLICT` per
  chunk. Per-row upserts inside transactions exceeded the 5s transaction timeout
  against a remote pooler, and running the chunks concurrently exhausted the
  connection pool instead.

## What isn't built

- **WhatsApp / SMS / IVR sending.** `ContactChannel` records the channel, but
  there is no gateway integration.
- **Multi-user call assignment.** Owner-only for now.
  `RecoveryCase.assignedToId` and `ContactAttempt.loggedById` are recorded from
  day one, so per-caller lists and performance drop in without a migration.
- **ML scoring.** See *Why rule-based* above.
- **Import reversal.** `PaymentImportBatch` records every run and
  `PaymentImportRow.transactionId` links each row to what it created, so a
  one-click rollback is possible — but it is not wired up.

## File map

```
prisma/
  schema.prisma              + 11 models, 9 enums (see Data model)
  link-households.ts         family grouping from sibling notes
  backfill-due-dates.ts      copy structure schedules onto existing installments
scripts/
  recovery-verify.ts         120 fixture checks on the pure engine
  recovery-recalculate.ts    unattended full recompute
src/lib/recovery/            the engine (see table above)
src/app/api/v2/recovery/     13 route files
src/app/recovery/            9 screens
src/components/recovery/chips.tsx   shared vocabulary: chips, evidence, coverage notes
```
