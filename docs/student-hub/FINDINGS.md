# Student Hub — findings from the Replit technical dump

Analysis of the read-only technical dump taken from the live Replit app on
28 July 2026, ahead of a rebuild. This records what the code and data actually
show, as distinct from what the earlier architecture report described.

**Status:** Amelia-side investigation still outstanding (see §7).

---

## 1. Headline: the Amelia integration is thinner than documented

The architecture report describes a system where an Amelia webhook keeps lesson
attendance in sync and status overrides layer on top of live booking data. The
data says otherwise:

| Evidence | Value | Meaning |
|---|---|---|
| `lessons.amelia_appointment_id` non-null | **0 of 205** | No lesson has ever been linked to an Amelia appointment |
| `appointment_statuses` rows | **0** | No status override has ever persisted |

The webhook's second job — `getLessonByAmeliaAppointmentId()` → set attendance —
**cannot fire**, because the linking column is empty across every lesson in the
database. Lessons are created through the admin UI, n8n and GitHub sync, and
none of those paths populate the Amelia ID.

So of the webhook's two effects, one is structurally dead and the other has left
no trace. The live-fetch-and-normalise half of the Amelia integration works
fine; the write-back half is aspirational.

**Rebuild implication:** unifying lesson creation behind one service that
populates `amelia_appointment_id` is a prerequisite for attendance sync, not a
nice-to-have. Until that exists, the webhook is only useful for SSE cache
invalidation.

---

## 2. Confirmed: group bookings are silently dropped

`server/amelia.ts`, in `normaliseAppointment()`:

```ts
const firstBooking = raw.bookings?.[0];
const customer = firstBooking?.customer;
```

The raw type declares `bookings: AmeliaRawBooking[]` — an array, because an
Amelia appointment can hold several participant bookings. Customer name, email,
phone **and price** are all read from index 0 only.

Consequences, in order of severity:

1. **A student who is the 2nd+ booking on an appointment never sees that lesson
   in their portal.** `filterAppointmentsForStudent()` matches on the single
   normalised email, so everyone but the first participant is invisible.
2. **`/api/admin/weekly-income` undercounts.** Income is summed from the
   normalised `price`, which is booking[0]'s price alone. A group session of six
   reports the revenue of one.
3. The iCal feed inherits both faults, since it is built from the same
   normalised objects.

This matters most for schools work — the codebase has a dedicated `isSchools`
flag and a schools provider ID, and school sessions are the likeliest place for
multi-participant appointments.

**Still to confirm:** whether multi-booking appointments actually exist in this
Amelia install. That is question 2a/2b of the outstanding Amelia investigation.
If they do, this is a live bug affecting real students today, not just a rebuild
consideration.

**Rebuild fix:** model *bookings*, not appointments — one row per participant,
keyed `(appointmentId, bookingId)`.

---

## 3. Multi-profile accounts are broken for bookings

`filterAppointmentsForStudent()` builds an email set from the student's own
email *and* the parent email, then:

```ts
if (aptEmail) { return emails.has(aptEmail); }
```

For a parent with two children, both student profiles carry the same
`parentEmail`, and both children's Amelia bookings are made under that one
parent customer. Every booking therefore matches **both** profiles.

Switching the active profile changes nothing on the bookings page — each child
shows the other's lessons too. The multi-profile feature works for lessons and
practice (which key on `studentId`) but not for bookings.

Scale: 1 user currently has multiple profiles, so this is live but contained.

**Rebuild fix:** link students to Amelia by **customer ID**, not by email
matching. This is exactly the improvement already on the list, and this is the
concrete bug it fixes.

---

## 4. Security items to verify against the live app

These come from the route table, which lists auth middleware but not in-handler
checks. **Each needs confirming against the actual handler before being treated
as real** — but each would be serious if the table reflects reality.

| Route | Listed auth | Concern |
|---|---|---|
| `POST /api/dev/link-student` | `isAuthenticated` | If this links the calling user to an arbitrary student ID, any registered account can attach itself to any student's records. Highest-priority check. |
| `POST /api/uploads/request-url` | **none** | Unauthenticated presigned-upload issuance would let anyone write into a bucket currently holding 412 MB of student material. |
| `GET /objects/{*objectPath}` | **none** | Object read by path. `objectAcl.ts` exists, so ACL may be enforced inside the handler — needs checking. |
| `GET /api/dev/students` | `isAuthenticated` | Student list (PII) exposed to any logged-in account, not just admins. |
| `POST /api/register-student` | none, **no rate limiter** | A second registration path alongside `/api/public/register`, which *does* have `publicSignupLimiter`. |
| `GET /api/lessons/:lessonId/grooves` | `isAuthenticated` | No `requireVerifiedStudent`, no visible ownership check. Low impact today (2 grooves exist). |

Replit's own assessment corroborates the storage ones: *"object_storage/routes.ts
contains TODOs for adding authentication middleware and ACL checks for protected
uploads."*

The `/api/dev/*` routes look like development scaffolding that shipped to
production. They should not exist in the rebuild.

---

## 5. Schema debt

**Everything is keyed on Notion.** Admin routes address students by
`:notionId` — `PATCH /api/admin/students/:notionId`, and ~20 others. But
`students.notion_page_id` is nullable. Students created via public registration
or the Amelia backfill have no Notion ID and therefore **cannot be addressed by
most admin routes at all**. `lessons.student_notion_id` and
`resources.student_notion_id` are text references to the same deprecated CRM.

**No foreign keys.** Every relationship in `shared/schema.ts` is a bare
`varchar` with no `.references()`. There is no referential integrity anywhere —
orphaned rows are inevitable, and student merge/delete must cascade by hand
across ~20 tables.

**No indexes.** Nothing is declared beyond primary keys and a few uniques. Every
`studentId` lookup is a sequential scan. Harmless at current scale (84 students,
205 lessons), trivially fixed in a rebuild, and painful to retrofit later.

**Two parallel groove models** — `grooves` + `student_grooves` (library and
assignment) alongside `lesson_grooves` (pattern JSON inlined per lesson).

**Denormalised caches with no constraints** — `speed_exercises.best_bpm` needs a
startup backfill to stay consistent with `speed_logs`;
`practice_sessions` carries both `duration_minutes` and `duration_seconds` with
a startup job normalising seconds into 0–59.

---

## 6. Performance: Amelia is fetched in full, per request

```ts
export async function fetchStudentAppointments(minDate?, maxDate?) {
  return fetchAllAmeliaAppointments(minDate, maxDate);
}
```

`fetchStudentAppointments` and `fetchAdminAppointments` are **byte-identical**.
A student request pulls the entire appointment book — every customer, paginated
100 at a time until exhausted — and only then filters down to that one student
in `filterAppointmentsForStudent()`.

With date bounds omitted, that is the complete history and future of the
business, fetched from WordPress, on every bookings page load, every dashboard
render, and every iCal poll. Calendar clients poll aggressively and
unauthenticated (`/ical/student/:token.ics`).

This is the strongest argument for the caching work, and it also means students
are sending far more data across the wire than `sanitizeAppointmentForStudent()`
implies — the sanitisation happens after the full fetch, not instead of it.

---

## 7. What the code does well (keep these)

- **`ameliaDatetimeToISO()`** is correct. The five-step approach — parse naive
  as UTC, resolve the London offset, subtract, re-check at the true instant,
  then emit the *original local digits* with the resolved offset — handles BST/GMT
  properly. Verified by hand against both June and January cases. Port it as-is.
- **Test coverage sits exactly on the fiddly parts**: `amelia.test.ts`,
  `sse-reconnect.test.ts`, `webhook-sse.test.ts`,
  `webhook-routes-production.test.ts`, `use-bookings-sse.test.ts`, plus
  Playwright coverage of the schools badge. These should migrate before the code
  they cover.
- **`enforceSameOrigin`** with explicit exemptions for `/api/integrations/` and
  `/api/webhooks/` is a sound design, clearly reasoned in comments.
- **iCal generation** is correct: proper line folding, text escaping, UTC
  stamps, stable `amelia-<id>@...` UIDs.

---

## 8. Groove Builder integration: the path is clear

The existing groove feature is **built but unadopted**:

| Table | Rows |
|---|---|
| `grooves` | 2 |
| `groove_folders` | 1 |
| `student_grooves` | **0** |
| `lesson_grooves` | **0** |

A complete feature — `admin-groove-builder.tsx`, `groove-grid.tsx`,
`groove-notation.tsx`, `lesson-groove-section.tsx`, `groove-engine.ts`,
`groove-playback.ts`, bundled 808 and acoustic mp3 samples, VexFlow 5 — with
**zero assignments to students, ever**.

This removes the only real risk from the integration plan. There is no adoption
to preserve and no migration to write: two groove rows, hand-portable if they
are worth keeping at all.

**Plan:** replace the entire feature with `groove-core` extracted from Groove
Builder. Drop `vexflow`, the bundled mp3 samples, `groove-engine.ts`,
`groove-playback.ts` and `drum-sounds.ts`. Collapse the two parallel assignment
models (`student_grooves` and `lesson_grooves`) into one that stores the
canonical groove URL, making it interchangeable with the standalone builder and
the iOS app via the format in `ios/URL_FORMAT.md`.

---

## 9. Replit coupling (what must be replaced)

- **Object storage** — `server/replit_integrations/object_storage/` talks to a
  sidecar at a hardcoded `http://127.0.0.1:1106` for credential and URL signing.
  Replace with S3-compatible storage and signed URLs. 148 files / 412 MB to
  migrate — small.
- **Connector-based integrations** — Todoist, Gmail, Notion and GitHub all
  authenticate through `REPLIT_CONNECTORS_HOSTNAME` + `REPL_IDENTITY`. Each
  needs direct OAuth or an API key elsewhere.
- **Env vars** — `REPL_ID`, `REPL_IDENTITY`, `WEB_REPL_RENEWAL`,
  `REPLIT_CONNECTORS_HOSTNAME`, `PRIVATE_OBJECT_DIR`,
  `PUBLIC_OBJECT_SEARCH_PATHS`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`.
- **Undocumented tunables worth keeping** — `ALLOWED_ORIGIN_HOSTS`,
  `SSE_MAX_AGE_MS`.
- **Dead dependencies from the Replit auth era** — `passport`,
  `passport-local`, `openid-client`, `memorystore` (alongside the
  `connect-pg-simple` actually in use).

Everything else — Express, Postgres/Drizzle, sessions, SSE, the Amelia client —
is portable as-is.

---

## 10. Build hygiene

`npm run check` **does not pass**. Roughly six pre-existing TypeScript errors in
`server/routes.ts` (around lines 926, 1430 and 3156), mostly Zod-inferred types
not aligning with storage-layer signatures.

The rebuild should gate on `tsc` in CI from the first commit. Retrofitting type
correctness onto a 3000-line route file is the expensive version of this.

---

## 11. Still outstanding

The Amelia-side investigation has not come back yet. Open questions that change
the design:

1. **Do multi-booking appointments exist in this install?** Decides whether §2 is
   a live bug or only a rebuild concern.
2. **Is there a stable Amelia customer ID on the appointment payload?** Required
   for §3's fix.
3. **Does the API support date-range and per-customer filtering, and does it
   return ETag/Last-Modified?** Determines how sharp the §6 caching can be.
4. **Which webhook trigger types does this Amelia version expose?** Decides
   whether booking-added and rescheduled events are available.
5. **Booking-form URL parameters** for the prefilled reschedule deep link.
