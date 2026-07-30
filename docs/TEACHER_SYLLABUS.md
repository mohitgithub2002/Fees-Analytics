# Teacher & Syllabus Module

Teacher management and daily syllabus tracking, layered on top of the fees
schema. Lets a school log **what was taught, to which class/section, on which
day** — and turns that into a per-chapter pacing status (`ON_TRACK` /
`BEHIND` / `AHEAD` / `COMPLETED`) an admin can see for every class at a
glance. `AcademicSession`, `SchoolClass`, `Classroom` and `User` are reused
as-is; everything else below is new.

Branch: `feature/teacher-syllabus-module`. Nothing on `main` was touched.

## The two subsystems

Admins and teachers are two entirely separate systems: separate identity
table, separate password store, separate session cookie, separate route
namespace. A teacher session cookie is structurally incapable of reaching an
admin route, and vice versa.

| | Admin panel | Teacher panel |
|---|---|---|
| Identity table | `User` (existing, unchanged) | `Teacher` (new) |
| Login field | phone | `employeeId` or phone |
| Cookie | `fees_session` (existing) | `teacher_session` (new) |
| Signing secret | `AUTH_SECRET` | `TEACHER_AUTH_SECRET` (falls back to `` `${AUTH_SECRET}::teacher` `` — see below) |
| Session check | stateless (signature + expiry only, no DB hit) | DB-checked every request (`isActive` re-verified) |
| Route prefix | `/api/v1/admin/*` (+ existing `/api/auth/*`) | `/api/v1/teacher/*` |
| Scope of data | everything, all teachers, all classes | only their own assignments |
| Can write to | all master data + corrections | session logs only (same-day edit window) |
| Created by | superuser (CLI, unchanged) | admin, from `/api/v1/admin/teachers` |

**Why not add `TEACHER` to `UserRole` and reuse `User`?** `User` is the
gateway to the fees system — every row in it can, by design, reach financial
data. Folding teachers in means one missed permission check exposes fee
records. Teachers also carry fields admins never need (`employeeId`,
`qualification`) that would sit null on every admin row, and a separate table
lets the two login flows evolve independently.

**Why a distinct signing secret, not just a different cookie name?** Cookie
names are client-controlled — an attacker who has a valid `teacher_session`
value could copy it into the `fees_session` slot. If both cookies were signed
with the same secret and had a compatible payload shape, the admin verifier
could decode it successfully. `getTeacherAuthSecret()`
(`src/lib/auth/teacherConfig.ts`) uses `TEACHER_AUTH_SECRET` if set, otherwise
derives a *different* key from `` `${AUTH_SECRET}::teacher` ``, so a teacher
token fails the admin verifier's HMAC check outright — isolation is
cryptographic, not just an `if (role !== 'ADMIN')` check that's easy to
forget on some future route.

## Data model

```
AcademicSession ──── CalendarEvent (holidays / exams / events)
   │
   └── Classroom ──── SchoolClass
          │                │
          │                └── Chapter ──── Topic ──── Subtopic
          │                       │  (scoped to subject + class:
          │                       │   Class 9 Physics ≠ Class 10 Physics)
          │                       │
Subject ──┴────────────────────────
   │
   └── TeacherAssignment (teacher × classroom × subject)
          ├── teacher: Teacher
          ├── TimetableSlot (weekly grid — reference only, never a FK on SessionLog)
          ├── SessionLog (header: date, type)
          │      └── SessionTopicDetail (body: which subtopic/chapter, status)
          └── SyllabusPacing (one row per (assignment, chapter) — derived, never hand-written)

TeacherAttendance (teacher × date)
TeachingAuditLog (polymorphic actor: ADMIN|TEACHER → User.id | Teacher.id)
```

`User.id` cross-references (`Teacher.createdById`, `TeacherAssignment.assignedById`,
`TeacherAttendance.markedById`) are **soft `Int` columns, not Prisma
relations** — `User` and `Teacher` are unrelated tables on purpose, so nothing
here can accidentally join across the fees/teaching boundary.

### Model reference

| Model | Key fields | Notes |
|---|---|---|
| `Teacher` | `employeeId` (unique), `phone` (unique), `email?` (unique), `passwordHash`, `qualification?`, `isActive` | Login by `employeeId` **or** `phone` |
| `Subject` | `name` (unique), `code?`, `displayOrder` | e.g. Physics, Mathematics |
| `Chapter` | `subjectId`, `classId`, `displayOrder`, `periodsRequired?` | `@@unique([subjectId, classId, name])`. `periodsRequired` weights the pacing split |
| `Topic` | `chapterId`, `displayOrder` | intermediate grouping: a chapter contains topics, a topic contains subtopics |
| `Subtopic` | `topicId`, `displayOrder` | the level completion is marked at; belongs to a topic (not the chapter directly) |
| `TeacherAssignment` | `teacherId`, `classroomId`, `subjectId` | `@@unique([teacherId, classroomId, subjectId])`. Classroom already encodes class+section+session, so no separate year column is needed and it can't drift |
| `TimetableSlot` | `assignmentId`, `dayOfWeek` (1=Mon..6=Sat), `periodNumber`, `startTime`, `endTime` | `@@unique([assignmentId, dayOfWeek, periodNumber])`; clash-checked against the same teacher/classroom on create |
| `CalendarEvent` | `sessionId`, `type` (`HOLIDAY`\|`EXAM`\|`EVENT`), `startDate`, `endDate` | feeds working-day counting |
| `SessionLog` | `assignmentId`, `sessionDate` (`@db.Date`), `type` (`TEACHING`\|`REVISION`\|`QA`\|`TEST`), `notes?` | **no timetable FK** — a teacher who arrived late, swapped periods, or covered another class must still be able to log it |
| `SessionTopicDetail` | `sessionLogId`, `subtopicId?`, `chapterId?`, `status` (`PARTIAL`\|`COMPLETE`) | `TEACHING`/`REVISION` rows use `subtopicId`; `QA`/`TEST` rows use `chapterId` (coarser — a test spans a chapter, not one subtopic) |
| `SyllabusPacing` | `assignmentId`, `chapterId`, `expectedStartDate`, `expectedEndDate`, `status`, `daysBehind`, `completionPercent` | `@@unique([assignmentId, chapterId])`. Recomputed, never hand-edited |
| `TeacherAttendance` | `teacherId`, `date` (`@db.Date`), `status` (`PRESENT`\|`ABSENT`\|`HALF_DAY`\|`ON_LEAVE`) | `@@unique([teacherId, date])`; `ABSENT` days are excluded from pacing's working-day count |
| `TeachingAuditLog` | `actorType` (`ADMIN`\|`TEACHER`), `actorId`, `actorName`, `action`, `entityType`, `entityId?`, `oldValue?`, `newValue?` (Json) | `actorName` is a denormalised snapshot — the log stays readable even after the account is deleted |

Soft deletes (`isActive = false`) are used throughout the syllabus master
data (`Subject`, `Chapter`, `Topic`, `Subtopic`, `TeacherAssignment`) so a
chapter being retired never breaks a historical `SessionLog`.

## Authentication mechanics

`src/lib/auth/teacher.ts` mirrors `src/lib/auth/session.ts` but is a fully
separate module:

- `createTeacherSessionToken(teacher)` — signs `{ sub, employeeId, name, kind: 'teacher', exp }` with `getTeacherAuthSecret()`. The `kind` claim is a second, belt-and-suspenders check on top of the separate secret.
- `setTeacherSessionCookie(teacher)` / `clearTeacherSessionCookie()` — set/clear the `teacher_session` cookie (`httpOnly`, `sameSite: lax`, `secure` in prod, 12-hour `maxAge`).
- `getTeacherSession()` — verifies the token, **then re-fetches the teacher row** and checks `isActive`. Unlike the admin session (stateless, trusts the token's `role` claim with no DB round-trip), this means deactivating a teacher (`POST /api/v1/admin/teachers/[id]/deactivate`) invalidates their session on their *very next request*, not just their next login.

`src/lib/auth/token.ts`'s `signToken`/`verifyToken` were made generic
(`<T extends { exp: number }>`) so both the admin and teacher session helpers
share the same HMAC sign/verify primitive without either depending on the
other's payload shape.

`src/proxy.ts` (Next 16's renamed `middleware.ts`) adds one branch ahead of
the existing admin gate:

```ts
if (pathname.startsWith('/api/v1/teacher')) {
  if (pathname.startsWith('/api/v1/teacher/auth/')) return NextResponse.next() // login is public
  if (!request.cookies.get(TEACHER_COOKIE_NAME)) return 401
  return NextResponse.next()
}
// ...existing fees_session logic handles everything else, including /api/v1/admin/*
```

This is a **presence check only** — same as the existing admin gate. The
authoritative, DB-aware check is `getTeacherSession()` inside every handler.
Every teacher route starts with:

```ts
const gate = await requireTeacher()   // src/lib/teaching/guards.ts
if ('error' in gate) return gate.error
```

and every admin route with the equivalent `requireAdmin()`. Any authenticated
admin (`SUPERUSER` or `ADMIN`) may use every `/api/v1/admin/*` route — the
existing role split only matters for `/api/auth/users*` account management,
which this module doesn't touch.

## Ownership: no ID from the client is ever trusted

Every teacher-scoped query filters by `teacherId` **inside the same query**
that fetches the row, so an assignment/session/topic that isn't the caller's
simply doesn't exist as far as the query is concerned — there's no separate
`if (owner !== me)` branch to forget:

```ts
// src/app/api/v1/teacher/sessions/route.ts
const assignment = await prisma.teacherAssignment.findFirst({
  where: { id: assignmentId, teacherId: teacher.id, isActive: true },
})
if (!assignment) return err('assignment not found', 404)
```

The same pattern extends one level deeper: when a teacher logs a session, the
`subtopicId`/`chapterId` on every topic row is checked against the set of
chapters/subtopics that actually belong to *that assignment's* subject+class
— so a teacher can't attach a topic from a syllabus they don't teach.

## The pacing engine

`src/lib/teaching/pacing.ts` answers one question per chapter: **given the
working days actually available this session, should this chapter be done by
now?**

1. **Working days** (`src/lib/teaching/working-days.ts`) — count days in
   `[session.startDate, session.endDate]` excluding Sundays, `CalendarEvent`
   ranges (holidays/exams) for that session, and this teacher's `ABSENT`
   `TeacherAttendance` dates. All date math uses UTC getters/setters
   exclusively (`getUTCDay`, `setUTCDate`) so results never shift with server
   timezone — Prisma's `@db.Date` columns come back as UTC-midnight `Date`
   objects.
2. **Split across chapters** — chapters for the assignment's (subject, class)
   are ordered by `displayOrder`; each gets a share of the total working days
   proportional to its `periodsRequired` (defaulting to 1 if unset). A cursor
   walks forward through working days assigning `expectedStartDate` /
   `expectedEndDate` per chapter.
3. **Actual completion** (`src/lib/teaching/progress.ts`) — for each
   subtopic in the chapter (flattened across all its topics), the latest
   `SessionTopicDetail` row logged
   against **this assignment** with `sessionLog.type === 'TEACHING'` gives its
   status. `completionPercent = complete subtopics / total subtopics × 100`.
   (Deliberately `TEACHING`-only — `REVISION` rows are tracked so revision
   coverage can be reported on independently, but don't move the "has this
   been taught" needle.)
4. **Status** — `COMPLETED` at 100%; `BEHIND` if today is past
   `expectedEndDate` and not complete; otherwise `ON_TRACK` vs `AHEAD` by
   comparing actual completion to the percent-of-window-elapsed.
   `daysBehind` is a signed working-day count (positive = behind, negative =
   finished early, 0 = on schedule).

Results are **upserted**, never inserted fresh, keyed on
`(assignmentId, chapterId)` — so re-running the engine is idempotent.

There is no background job runner in this app, so "nightly recompute" from
the original design doc is realized as **on-demand recompute**, called from:

- `POST /api/v1/admin/pacing/recalculate` (all assignments, or scoped via `?assignmentId=` / `?sessionId=`) — this is also the hook point for a real external cron (e.g. a platform scheduler hitting this endpoint nightly)
- Assignment creation (seeds pacing rows immediately)
- Calendar event create/update/delete (recomputes every assignment in that session)
- Attendance record/correct (recomputes every assignment for that teacher)
- Any `TEACHING`-type session/topic write, update, or delete (recomputes that one assignment)

## Response & error conventions

Every route in this module (not the pre-existing `/api/auth/*` or `/api/v2/*`
routes, which have their own established shape) returns:

- **Success**: `{ "data": ... }`
- **Failure**: `{ "error": "message", ...extra }`

Status codes: `200` read, `201` create, `400` validation, `401` no/invalid
session, `403` valid session but the action isn't permitted (e.g. editing a
session after its same-day window), `404` not found *or not owned* (these are
indistinguishable on purpose), `409` conflict (unique constraint / timetable
clash).

`src/lib/teaching/http.ts` centralizes this: `ok()`, `err()`, `readJson()`,
`parseId()`, `parsePagination()` (page/pageSize, default 50, capped 200),
`paginationMeta()`, `isSameCalendarDay()`, and `handleError()` (maps
`P2002`→409, `P2025`→404, `P2003`→400).

`src/lib/teaching/audit.ts`'s `writeAudit()` is always called **inside the
same transaction** as the change it describes, so `TeachingAuditLog` can
never disagree with what actually happened. Every mutating admin/teacher
route follows the same four-step shape: resolve session → validate body →
verify ownership → `prisma.$transaction(write + writeAudit)`.

## Same-day edit window

Teachers can edit a session's `notes`/`sessionDate` and remove a topic row
only on the calendar day they were created (`isSameCalendarDay()`, compared
against the server's local date). Teachers **cannot delete a session at
all** — only an admin can (`DELETE /api/v1/admin/sessions/[id]`), and that
deletion is itself audited. This keeps the log honest: a same-day typo is
fixable immediately, but a teacher can't quietly erase history days later.

## API reference

All routes are `route.ts` files under `src/app/api/v1/`. 🔵 = any
authenticated admin. 🟢 = authenticated teacher. 🟡 = public.

### Admin — teacher management

| Method | Route | Purpose |
|---|---|---|
| GET | `/admin/teachers` | List, filterable by `active`, searchable by `search` (name/employeeId), paginated |
| POST | `/admin/teachers` | Create; returns a generated `temporaryPassword` if none supplied |
| GET | `/admin/teachers/[id]` | Full profile + active assignments |
| PATCH | `/admin/teachers/[id]` | Update name/phone/email/qualification |
| POST | `/admin/teachers/[id]/activate` | Restore access |
| POST | `/admin/teachers/[id]/deactivate` | Block login immediately (next request fails, not just next login) |
| POST | `/admin/teachers/[id]/password` | Force-reset, returns a new `temporaryPassword` |

### Admin — syllabus master

| Method | Route | Purpose |
|---|---|---|
| GET / POST | `/admin/subjects` | List / create |
| PATCH / DELETE | `/admin/subjects/[id]` | Update / soft-delete |
| GET / POST | `/admin/chapters` (`?subjectId&classId`) | List / create |
| PATCH / DELETE | `/admin/chapters/[id]` | Update / soft-delete |
| GET / POST | `/admin/topics` (`?chapterId`) | List / create |
| PATCH / DELETE | `/admin/topics/[id]` | Update / soft-delete |
| GET / POST | `/admin/subtopics` (`?topicId`) | List / create |
| PATCH / DELETE | `/admin/subtopics/[id]` | Update / soft-delete |

### Admin — assignments & timetable

| Method | Route | Purpose |
|---|---|---|
| GET / POST | `/admin/assignments` (`?classroomId&teacherId&sessionId`) | List / create (seeds pacing immediately) |
| DELETE | `/admin/assignments/[id]` | Deactivate; historical logs preserved |
| GET / POST | `/admin/timetable` (`?dayOfWeek&classroomId&teacherId`) | Grid / add a slot (rejects teacher/classroom clashes, `409`) |
| PATCH / DELETE | `/admin/timetable/[id]` | Change time/room / remove |

### Admin — calendar, attendance, pacing

| Method | Route | Purpose |
|---|---|---|
| GET / POST | `/admin/calendar` (`?sessionId&type&from&to`) | List / add (recomputes that session's pacing) |
| PATCH / DELETE | `/admin/calendar/[id]` | Update / delete (recomputes pacing) |
| GET | `/admin/calendar/effective-days` (`?from&to`) | Working-day count between two dates |
| GET / POST | `/admin/attendance` (`?teacherId&from&to`) | List / upsert on `(teacher, date)` (recomputes that teacher's pacing) |
| PATCH | `/admin/attendance/[id]` | Correct an entry |
| GET | `/admin/pacing` (`?classroomId&teacherId&subjectId&status`) | Full pacing table |
| GET | `/admin/pacing/behind` | Only `BEHIND` rows — the alert feed |
| POST | `/admin/pacing/recalculate` (`?assignmentId` \| `?sessionId`) | Force recompute now |

### Admin — oversight, audit, dashboard

| Method | Route | Purpose |
|---|---|---|
| GET | `/admin/sessions` (`?teacherId&classroomId&type&from&to`) | Every session, paginated |
| GET / DELETE | `/admin/sessions/[id]` | Full detail / delete (audited, recomputes pacing) |
| GET | `/admin/audit-logs` (`?actorType&actorId&entityType&entityId&action&from&to`) | Paginated trail |
| GET | `/admin/audit-logs/[id]` | One entry with full `oldValue`/`newValue` |
| GET | `/admin/dashboard/overview` (`?sessionId`) | Headline counts + overall completion + pacing breakdown |
| GET | `/admin/dashboard/progress` (`?sessionId`) | Completion % grouped by classroom × subject |
| GET | `/admin/dashboard/unmarked` (`?classId&subjectId`) | Subtopics never taught **anywhere** |
| GET | `/admin/dashboard/activity` | Last logged session per teacher, staleest first — surfaces inactive teachers |
| GET | `/admin/dashboard/test-coverage` (`?subjectId`) | Test/revision frequency per chapter |

### Teacher — auth

| Method | Route | Guard | Purpose |
|---|---|---|---|
| POST | `/teacher/auth/login` | 🟡 | `{ employeeId \| phone, password }` → sets `teacher_session` |
| POST | `/teacher/auth/logout` | 🟢 | Clear cookie |
| GET | `/teacher/auth/me` | 🟢 | Own profile |
| POST | `/teacher/auth/password` | 🟢 | `{ currentPassword, newPassword }` |

### Teacher — read (own data only; no `teacherId` in any URL to tamper with)

| Method | Route | Purpose |
|---|---|---|
| GET | `/teacher/assignments` | Own assignments, current session only |
| GET | `/teacher/schedule` | Own weekly timetable |
| GET | `/teacher/schedule/today` | Today's periods (empty array on Sunday) |
| GET | `/teacher/syllabus/[assignmentId]` | Chapter→topic→subtopic tree annotated with own completion status |
| GET | `/teacher/pacing` | Own pacing status by chapter |
| GET | `/teacher/dashboard/overview` | Assignment count, today's periods, own completion + pacing breakdown |
| GET | `/teacher/dashboard/pending` | Subtopics still unmarked, per own assignment |

### Teacher — session logging (the write path)

| Method | Route | Purpose |
|---|---|---|
| GET / POST | `/teacher/sessions` (`?assignmentId&type&from&to`) | Own history, paginated / log a session (header + topics, one transaction) |
| GET | `/teacher/sessions/[id]` | One own session with topics |
| PATCH | `/teacher/sessions/[id]` | Edit notes/date — **same day only** |
| POST | `/teacher/sessions/[id]/topics` | Append topic rows |
| PATCH | `/teacher/sessions/[id]/topics/[tid]` | Update status (`PARTIAL`→`COMPLETE`) |
| DELETE | `/teacher/sessions/[id]/topics/[tid]` | Remove a row — **same day only** |

49 routes total (34 admin + 15 teacher).

## Request lifecycle, worked example

This is the exact sequence exercised end-to-end during development
(admin cookie jar vs. teacher cookie jar are two entirely separate curl `-c`
files — they never share state):

1. Admin creates `Subject "Physics"`, `Chapter` (scoped to that subject +
   class), `Topic` (under the chapter), `Subtopic` (under the topic).
2. Admin creates the `Teacher` account → gets back a generated
   `temporaryPassword` (nothing is emailed/SMS'd; the admin relays it
   out-of-band).
3. Admin creates a `TeacherAssignment` (teacher × classroom × subject) →
   `recalculatePacingForAssignment()` runs immediately, seeding one
   `SyllabusPacing` row per chapter with `status: ON_TRACK`,
   `completionPercent: 0`, `expectedStartDate`/`expectedEndDate` spanning the
   session (since one chapter with no siblings claims the whole working-day
   budget).
4. Teacher logs in with `employeeId` + the temporary password →
   `teacher_session` cookie set, `lastLoginAt` stamped.
5. `GET /teacher/syllabus/[assignmentId]` shows the subtopic with
   `status: null` (never taught).
6. `POST /teacher/sessions` `{ assignmentId, sessionDate, type: "TEACHING",
   topics: [{ subtopicId, status: "COMPLETE" }] }` → `SessionLog` +
   `SessionTopicDetail` created in one transaction, audit row written,
   `recalculatePacingForAssignment()` re-runs (since `type === 'TEACHING'`).
7. `GET /teacher/syllabus/[assignmentId]` now shows that subtopic's
   `status: "COMPLETE"`; `GET /admin/dashboard/overview` and
   `/admin/dashboard/activity` reflect it immediately — no polling delay,
   no cache to invalidate (pacing is recomputed synchronously on write, not
   lazily on read).
8. A teacher cookie presented to any `/api/v1/admin/*` route gets `401` —
   there's no cross-subsystem cookie to even attempt; they're stored in
   different jars/keys by the browser because the names differ, and even if
   forced into the same slot, the secret differs.

## Deliberate deviations from the original design doc

The design doc (`node_modules`-adjacent PDF used as the spec) assumed a
green-field build; two calls diverge from it to fit *this* repo:

1. **Admin auth stays at `/api/auth/*`**, not duplicated under
   `/api/v1/admin/auth/*`. It already works, the doc itself says "existing —
   no changes", and duplicating it would mean maintaining two login flows for
   one identity table.
2. **No zod.** The doc's folder plan includes `lib/validation/*.ts` with zod
   schemas; this repo has no zod dependency and validates by hand everywhere
   (`/api/v2/*`, `/api/auth/*`). This module follows the same manual
   `readJson` + field-by-field check style rather than introducing a new
   dependency for one module.

## Setup / environment

- Schema is pushed with `npx prisma db push` (this repo doesn't use
  `prisma migrate` — see `package.json`'s `db:push` script). The 12 new tables
  live alongside the fees tables in the same database. The `Topic` table and
  the repointing of `Subtopic.chapterId` → `Subtopic.topicId` need a fresh
  `db push`; because the old `chapterId` column is dropped and existing
  subtopics have no topic to hang under, that push requires
  `--accept-data-loss` and drops any pre-existing subtopic rows (recreate them
  under topics afterwards).
- **Set `TEACHER_AUTH_SECRET`** in production — a long random string,
  independent from `AUTH_SECRET` (e.g. `openssl rand -hex 32`). Without it,
  the module falls back to a derived secret and logs a warning, same pattern
  as `AUTH_SECRET`'s own dev fallback.
- **No first-teacher bootstrap script** — unlike the superuser, the first
  teacher is created the normal way, by an admin, via
  `POST /api/v1/admin/teachers`.
- **No cron.** `POST /api/v1/admin/pacing/recalculate` needs to be wired to
  an external scheduler for a true nightly refresh; until then, pacing stays
  correct because every mutation that affects it (calendar, attendance,
  session writes, new assignments) triggers a targeted recompute inline.

## What isn't built

- **No UI.** This is the API layer only, mirroring how `docs/FEES_V2.md`'s
  API shipped ahead of `/manage/*` pages.
- **No cron/scheduler** for the nightly pacing sweep (see above).
- **No notifications** (e.g. alerting an admin when an assignment flips to
  `BEHIND`) — `GET /admin/pacing/behind` exists as the pull-based feed for
  that.

## File map

```
prisma/schema.prisma                 # 12 new models, 6 new enums, appended
src/proxy.ts                         # + teacher_session presence-check branch

src/lib/auth/
  token.ts                           # sign/verify made generic (shared primitive)
  password.ts                        # + generateTempPassword()
  teacherConfig.ts                   # NEW — cookie name, TTL, distinct secret
  teacher.ts                         # NEW — teacher session helpers (DB-checked)

src/lib/teaching/
  http.ts                            # ok/err/readJson/parseId/pagination/isSameCalendarDay/handleError
  guards.ts                          # requireAdmin() / requireTeacher()
  audit.ts                           # writeAudit() — always inside the write's transaction
  working-days.ts                    # countWorkingDays() / addWorkingDays() — UTC-safe
  progress.ts                        # subtopic completion aggregation (TEACHING-only)
  pacing.ts                          # the pacing engine + its recompute triggers

src/app/api/v1/admin/                # 34 route.ts files — see API reference above
src/app/api/v1/teacher/              # 15 route.ts files — see API reference above
```
