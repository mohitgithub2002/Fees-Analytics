# Fees Management V2

A normalized, session-aware fees system that sits alongside the legacy
`StudentFee` table and `/api/fees*` routes (both untouched). It is designed as
the foundation for a broader School ERP: students, sessions, classes and
enrollments are first-class entities that future modules (attendance, exams,
transport) can hang off without schema breakage.

## Data model

```
AcademicSession (2023-24, 2024-25, ...; one isCurrent)
   │
   ├── Classroom ──── SchoolClass (class master: Play … XII)
   │      │
   │      └── StudentEnrollment ──── Student (master data, one row per person)
   │              │
   │              └── StudentFeeItem (SCHOOL | BUS | OTHER, per enrollment)
   │                      ├── FeeInstallment (1..n, payments land here)
   │                      └── FeeDiscount (audit trail)
   │
   └── FeeStructure ── FeeStructureItem (class-wise template per session)

FeeTransaction (payment, receiptNo, category, mode)
   └── TransactionAllocation → FeeInstallment
```

Key invariants (maintained by `src/lib/fees/*`, all writes inside DB
transactions, all arithmetic in integer paise):

- `netAmount = originalAmount − discountAmount`, `dueAmount = netAmount − paidAmount`
  at both the fee-item and installment level.
- For every COMPLETED transaction, `sum(allocations) = transaction.amount`.
- A paid installment is never modified by discounts or amount changes.

## Payment allocation rules

`POST /api/v2/transactions` records which fee type a payment is for and
distributes it installment by installment (an amount larger than one
installment simply flows into the next):

- **SCHOOL or no category** — all past-session dues are settled first
  (oldest session first, any category), then the current session's SCHOOL
  installments in order.
- **BUS / OTHER** — only that category's installments, past sessions first,
  then current, in installment order.
- An amount exceeding the outstanding balance reachable by those rules is
  rejected (`400`, with `outstanding` in the body), so money is never left
  unallocated.

`DELETE /api/v2/transactions/:id` cancels a payment: allocations are reversed
out of the installments and the transaction is marked CANCELLED (allocation
rows are kept for audit).

## Discounts

`POST /api/v2/fee-items/:id/discount` spreads the discount across **unpaid**
installment balances only, starting from the last installment (so the
earliest installments stay collectable). Paid installments are never touched
— if a discount exceeds the unpaid balance it is rejected, so the system
cannot end up owing money back. Every discount is logged in `FeeDiscount`.

The same "never touch the paid portion" rule applies when an admin changes a
fee amount (`PATCH /api/v2/fee-items/:id`): increases extend the last
installment; decreases reduce unpaid balances from the last installment
backward.

## Setting up a student's fees

1. Define the class-wise template once per session:
   `POST /api/v2/fee-structures` `{ sessionId, classId, items: [{ category, name, amount, installmentCount }] }`
   (School fees are typically `installmentCount: 3`; bus/other get their own
   installments.) Editing a structure never touches fees already assigned.
2. Enroll the student: `POST /api/v2/enrollments`
   `{ studentId, classroomId, applyFeeStructure: true }` — the template is
   copied onto the enrollment as editable `StudentFeeItem` rows.
3. Adjust per student as needed:
   - add a fee: `POST /api/v2/enrollments/:id/fees`
     `{ category, name, amount, installments }` (`installments` is a count or
     an explicit `[{ amount, label?, dueDate? }]` plan)
   - change an amount: `PATCH /api/v2/fee-items/:id { amount }`
   - remove a fee: `DELETE /api/v2/fee-items/:id` (refused while payments
     exist against it)

## API summary (`/api/v2`)

| Route | Methods | Purpose |
|---|---|---|
| `/sessions`, `/sessions/:id` | GET, POST, PATCH | academic sessions; `isCurrent` is exclusive |
| `/classes`, `/classes/:id` | GET, POST, PATCH | class master |
| `/classrooms` | GET, POST | class × session (× section) instances |
| `/students`, `/students/:id` | GET, POST, PATCH | student master, search + pagination |
| `/students/:id/dues` | GET | dues by session/category + ordered pending installments |
| `/enrollments`, `/enrollments/:id` | GET, POST, PATCH | enrollment lifecycle (status, section change) |
| `/enrollments/:id/fees` | GET, POST | list/add fees; `{ fromStructure: true }` applies the template |
| `/fee-items/:id` | GET, PATCH, DELETE | inspect/adjust/remove one fee |
| `/fee-items/:id/discount` | POST | apply a discount |
| `/fee-structures`, `/fee-structures/:id` | GET, POST, DELETE | class-wise templates (POST upserts) |
| `/transactions`, `/transactions/:id` | GET, POST, DELETE | record/list/inspect/cancel payments |
| `/analytics` | GET | session-scoped overview, per-class and per-category breakdown, carried-forward dues |

All endpoints return money as plain numbers and errors as `{ "error": "..." }`.

The [recovery module](./RECOVERY.md) layers on top of this ledger — it reads
everything above and writes nothing, except by replaying payments through
`allocatePayment` during a payment-history import.

## Migrating the legacy data

```bash
npm run db:migrate-v2           # refuses to run if v2 data already exists
npm run db:migrate-v2 -- --force  # wipe v2 tables and re-migrate
```

The script (`prisma/migrate-v2.ts`) reads the legacy `StudentFee` table
(read-only) and creates: both sessions (the legacy `academicYear` plus the
year before it), classes/classrooms, one `Student` per row (linked via
`legacyStudentFeeId`), the current-session enrollment with School (3
installments) / Bus / Other fee items, and — where a previous-year balance
exists — a previous-session enrollment holding a single "Previous Session
Balance" item. Legacy deposits become `LEGACY-*` transactions with proper
allocations, and legacy discounts become `FeeDiscount` rows, so every
invariant above holds from day one.

Notes:
- Bucket amounts are reconstructed as `deposit + discount + due` so migrated
  dues match the legacy dues exactly; the script logs any rows whose recorded
  fee total disagrees and prints a legacy-vs-v2 reconciliation at the end.
- The legacy table doesn't say which class a student attended last year, so
  previous-session classrooms reuse the current class name.
- A starting `FeeStructure` per class is seeded from the most common school
  fee in that class — review and adjust via `POST /api/v2/fee-structures`.
