# Fee Recovery Module

Sits on top of the [v2 fees ledger](./FEES_V2.md); reads it, never writes to it.
The ledger stays the only source of truth for money — everything here is either
**derived and recomputable**, or a **record of human contact**.

The ledger answers *"how much is due?"*. This module answers the questions that
actually drive collection:

- Which installment underperforms, and by how much?
- Which months does money actually arrive in?
- How much will arrive next month?
- **Who do I call today, and what do I say to them?**

## The core idea: two axes, not one

Everything hangs off separating two things that get constantly conflated when
chasing fees:

| Axis | Question | Source |
|---|---|---|
| **`PaymentArchetype`** | *When/whether* they pay | Derived from payment history |
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
why a naive "biggest debtor first" list burns a day of calls on families who have
nothing to give.

## Data model

```
Guardian (the payer — a household, not a student)
   ├── GuardianStudent ──── Student  (one call covers all their children)
   ├── GuardianProfile      DERIVED — archetype, scores, evidence, seasonality
   ├── RecoveryCase         MUTABLE workflow state, per session
   ├── ContactAttempt       every logged call
   └── PromiseToPay         "₹5,000 by the 12th" — auto-settled from the ledger

CollectionForecast   dated snapshots, scored against actuals
RecoveryConfig       single row: the tunable targeting rules
FeeStructureInstallment  due-date schedule per structure item
```

Two tables, deliberately separate:

- **`GuardianProfile`** is rebuilt wholesale on every recompute (same contract as
  `SyllabusPacing`: never human-written, always recomputable, idempotent).
- **`RecoveryCase`** holds decisions a *person* made — snoozed, parked, pinned,
  stage — which a recompute must never trample. It doubles as the worklist row,
  so ranking, filtering and pagination all happen in SQL.

## The engine (`src/lib/recovery/`)

| Module | Responsibility |
|---|---|
| `features.ts` | The only file with SQL. Turns the ledger into a `GuardianFeatures` vector per household — five bulk queries for the whole school, not five per family |
| `archetype.ts` | Rule cascade → archetype + confidence + **evidence**. Checked worst-behaviour-first |
| `tier.ts` | Suggests ability to pay. Suggestion only — the human tag always wins |
| `propensity.ts` | `p = base(archetype) × tier × recency × promises × contact × season × ask-size`, each factor bounded and each emitting one plain-English line |
| `suppression.ts` | Who should *not* be called today, and why |
| `forecast.ts` | Three nested bands + calibration from past snapshots |
| `cohorts.ts` | The four analytical lenses (installments, months, classes, segments) |
| `promises.ts` | Settles promises from real payments — nobody ticks a box |
| `recompute.ts` | Idempotent refresh of profiles + cases |
| `config.ts` | Loads/saves the tunable rules |
| `types.ts` | Prisma-free — safe to import from client components |

### Why rule-based, not ML

The output decides who gets phoned. A school owner has to be able to disagree
with it out loud — *"no, they cleared by Diwali last year"* — and see which rule
produced the answer. So every verdict carries the evidence that produced it, and
the UI renders those lines verbatim. Explainability beats a few points of
accuracy when a human has to trust the call order.

### Expected recovery, not outstanding

The worklist ranks on `expectedRecoveryValue = probability × expected amount`,
never on the raw balance. Ranking a chronic defaulter's ₹40,000 above a year-end
payer's ₹12,000 is how a call list ends up sorted by *how badly a family is
doing* rather than by *what the day will actually collect*. Where a family has
named a figure themselves (an open promise), that figure is believed over the
model.

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
| Pays reliably and nothing is overdue | always |

Two rules the design rests on:

1. **Suppression is always explained and reversible.** Skipped households appear
   in the worklist's collapsed *"N skipped today"* row with their reason — never
   silently dropped. The owner overrules the system, not the other way round.
2. **The thresholds are settings, not constants.** The person who knows whether
   five days is too soon to call again is the one running the school.

A household that pays mid-session disappears from the list on the next load,
because `/api/v2/transactions` triggers `recomputeForStudent` on every payment
and cancellation.

## Forecasting

Three **nested** bands (`committed ≤ likely ≤ stretch`):

- **Committed** — open promises plus installments falling due from households
  that reliably meet due dates. The number to plan salaries against.
- **Likely** — committed plus a propensity- and season-weighted share of the
  rest, multiplied by the calibration factor.
- **Stretch** — what a very good month of follow-up could reach.

Every generation is snapshotted (`CollectionForecast`, one per month per day) and
each elapsed month is scored against what actually arrived, using the *earliest*
snapshot for that month — grading a forecast made on the 30th against that
month's takings would flatter the system into uselessness. The resulting
calibration factor (clamped to 0.5–1.5×) feeds the next forecast: the system
correcting its own optimism.

## API (`/api/v2/recovery`)

Admin-cookie authed via the existing [proxy](../src/proxy.ts) gate.

| Route | Methods | Purpose |
|---|---|---|
| `/overview` | GET | Command-centre KPIs |
| `/worklist` | GET | Today's ranked call list + skipped, with reasons |
| `/guardians` | GET | Segmentation browser (archetype, tier, class, due band, …) |
| `/guardians/:id` | GET, PATCH | Parent 360; tier override and contact edits |
| `/guardians/:id/contacts` | POST | Log a call; creates a promise in the same write |
| `/guardians/:id/pin` | POST | Force onto today's list |
| `/guardians/:id/park` | POST | Park as confirmed hardship |
| `/promises/:id` | PATCH | Manual resolve/cancel (promises normally self-settle) |
| `/cases/:id/snooze` \| `/park` \| `/reopen` | POST | Workflow transitions |
| `/behavior/installments` \| `/monthly` \| `/classes` \| `/segments` | GET | The four lenses |
| `/forecast` | GET | Bands, accuracy history, gap-closers |
| `/config` | GET, PATCH | Targeting rules (clamped to `TUNING_LIMITS`) |
| `/households` | GET, POST | Linking review: confirm / split / merge |
| `/import/payments` | POST | Payment-history backfill (dry run + commit) |
| `/profiles/recalculate` | POST | Full refresh + forecast snapshot |

## Screens (`/recovery`)

| Route | Purpose |
|---|---|
| `/recovery` | Command Center — money band, action band, the archetype × tier matrix, top households |
| `/recovery/worklist` | **The daily driver.** Split pane: ranked queue + call card with one-tap outcome logging |
| `/recovery/parents` | Segmentation browser; bulk-pin to today's list |
| `/recovery/parents/[id]` | Parent 360 — profile, evidence, children, payment timeline, contact/promise history |
| `/recovery/behavior` | Installments · Months · Classes · Behaviour Types |
| `/recovery/forecast` | Cash-flow bands, forecast accuracy, "close the gap" |
| `/recovery/import` | Payment-history backfill: upload → map → dry run → commit |
| `/recovery/households` | Guardian-linking review queue |
| `/recovery/settings` | The targeting rules |

## Setting it up

```bash
npm run db:push                        # apply the schema
npm run db:generate

npm run recovery:link-guardians -- --dry-run   # review the grouping report
npm run recovery:link-guardians                # create Guardian rows

npm run recovery:backfill-due-dates -- --dry-run
npm run recovery:backfill-due-dates            # needs schedules on fee structures first

npm run recovery:verify                        # fixture check on the engine
npm run recovery:recalculate                   # populate profiles, cases, forecast
```

`recovery:recalculate` does the same work as
`POST /api/v2/recovery/profiles/recalculate` and the **Recalculate** button on
the Command Center, but without needing a signed-in session — use it for
first-time setup, after a bulk import, or from a scheduled job. On ~530
households against a remote database it takes a couple of minutes.

### How students get grouped into households

`link-guardians.ts` is deliberately conservative, because a **false merge is far
worse than a missed one**: it invents a household owing several families' fees,
corrupts its behavioural profile, and floats a phantom family to the top of the
call list. A missed merge only costs a second phone call.

Grouping on the father's name alone is not safe in this data — `<FirstName>
Kumar` is extremely common, and it produced a single "MUKESH KUMAR" household of
14 children spanning four different surnames. So siblings must agree on **both
the father's name and their own surname**:

| Case | Result |
|---|---|
| Father + child surname agree, ≤4 children | auto-linked |
| …but phones disagree | split into one household per number |
| Father + surname agree, >4 children | linked, flagged for review |
| Child has no surname recorded | solo household — nothing to confirm a link with |
| No match | solo household |

On the 578-student legacy dataset this yields ~533 households: 38 confident
sibling groups, no implausible merges, every student covered. Households the
surname rule kept apart (siblings recorded under different surnames) can be
joined by hand at `/recovery/households`, which is also where flagged groups are
confirmed or split.

### Installment due dates

Without due dates, *"installment 2 collects late"* is unanswerable. Add a
schedule per fee-structure item at **Setup → Fee Structures** (a date row under
each item). The schedule is **all-or-nothing** — every installment or none —
because an undated installment cannot be judged on time or late.

New enrollments pick the schedule up automatically via
`applyStructureToEnrollment`; existing installments are filled by
`recovery:backfill-due-dates`. Items with no schedule keep producing undated
installments exactly as before, and analysis falls back to session-relative
timing for them.

## Payment-date history

Every migrated payment carries the timestamp of the CSV import run
(`migrate-v2.ts` uses `row.createdAt`), and only 38 of 578 legacy rows had a real
date — so there is **no genuine payment-timing history** until it is imported.

### Demo timing (for evaluating the module now)

```bash
npm run recovery:seed-demo -- --dry-run
npm run recovery:seed-demo
npm run recovery:seed-demo -- --undo    # full restore from the backup file
```

**The contract: amounts and allocations are never invented — only `paidAt` is
synthesised.** Each `LEGACY-*` transaction is split into 1–4 dated pieces whose
amounts sum exactly to the original, and whose per-installment allocations sum
exactly to the original per-installment allocation. `FeeInstallment.paidAmount`
and `StudentFeeItem.paidAmount/dueAmount` are never touched, so every ledger
invariant that held before still holds after.

Dates come from a storyline chosen per student using only figures already in the
ledger (paid ratio, presence of past-session dues) — never randomly per
transaction — so a household reads as one coherent story, and the classifier
re-derives roughly the pattern that generated it.

Synthetic rows are tagged `DEMO-*` / `[demo-timing]`, and **every screen built on
synthesised timing shows an "Estimated timing" badge** (driven by
`timingProvenance()`). The owner must never mistake seeded data for real history.

### Real backfill

`/recovery/import` → upload CSV → map columns → **dry run** → commit.

The dry run reports matched / unmatched / ambiguous / invalid rows and reconciles
each student's import total against their recorded paid amount. Commit runs per
student inside its own transaction: existing `DEMO-*`/`LEGACY-*` transactions are
cancelled via `cancelTransaction`, then each real payment is replayed through
`allocatePayment`, so allocations and installment statuses are recomputed by the
real engine. A student whose totals disagree is skipped unless *"commit
mismatched students anyway"* is ticked.

## Verification

```bash
npm run recovery:verify   # 30 fixture checks: classification, scoring, suppression
npx tsc --noEmit
npm run lint
npm run build
```

The fixture check pins down the behaviours that matter most: one case per
archetype, confidence rising with history, an open promise raising propensity, a
just-paid household ranking lower, ability moving the score the right way,
expected recovery never exceeding the balance, a pin overriding every suppression
rule, and every suppression stating a reason.

## Deliberately out of scope

- **WhatsApp / SMS / IVR sending** — `ContactChannel` records the channel, but
  there is no gateway integration.
- **Multi-user call assignment** — owner-only for now. `ContactAttempt.loggedById`
  is already recorded, so per-caller performance can be added without a migration.
- **ML scoring** — see *Why rule-based* above.
