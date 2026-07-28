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

## 4. Security — verified against the handlers

Handler-level answers received 28 July 2026. Recalibrated below.

### 4.1 Unauthenticated object storage — real, in production

Confirmed by reading `server/replit_integrations/object_storage/routes.ts`.
The file's own comments acknowledge it is example code where auth and ACL were
meant to be added and never were.

**`POST /api/uploads/request-url`** issues a presigned GCS upload URL with:

- no authentication
- no file-size limit (`size` is echoed back, not validated)
- no content-type restriction
- no rate limiting

`enforceSameOrigin` does apply, but it only requires `Origin`/`Referer` to match
`Host` — which any scripted client sets trivially. It is not a meaningful
barrier to a non-browser caller. Treat the endpoint as anonymous write access to
a bucket currently holding 412 MB of student material.

**`GET /objects/{*objectPath}`** streams any object whose path resolves, with no
ACL, no expiry and no ownership check. Security rests entirely on UUID paths
being unguessable.

**The two compose into a plausible stored-XSS chain**, which is why this is the
priority item rather than merely a storage-abuse concern:

1. An anonymous caller obtains an upload URL and uploads HTML with a
   `text/html` content type (nothing validates it).
2. The same origin serves it back via `GET /objects/<path>`.
3. `helmet` is configured with `contentSecurityPolicy: false`, so no CSP
   intervenes.
4. Script executing on the hub's own origin can issue authenticated `fetch`
   calls — session cookies ride along, and `enforceSameOrigin` passes because
   the origin genuinely matches.

Session cookies are `httpOnly`, so the cookie itself cannot be read, but that
does not prevent same-origin authenticated requests being made on an admin's
behalf if an admin can be induced to open the URL.

*Unverified:* whether the upload response exposes the resulting object path
directly, and whether GCS preserves an attacker-supplied content type through to
the streaming handler. Both are likely; both should be checked before judging
severity final.

**Remediation** (small, worth doing on the live app rather than waiting for the
rebuild): require authentication on `request-url`; validate size and
content-type against an allowlist; rate-limit it; serve downloads through
short-lived signed URLs with an ownership check instead of a permanent public
path.

### 4.2 Dev routes — gated, but the gate's value depends on one unknown

`GET /api/dev/students` and `POST /api/dev/link-student` sit inside
`if (process.env.NODE_ENV !== "production")` and are **not registered in the
deployed app**. Downgraded accordingly.

The routes themselves are as bad as feared — `isAuthenticated` only, no admin
check, no ownership check, no validation that `studentId` belongs to the caller.
Any logged-in user can enumerate every student ID and link themselves to any of
them, gaining that student's lessons, attachments, bookings and iCal feed.

They are live in the Replit dev workspace, whose URL is publicly reachable while
the workspace runs.

**Open question that decides whether this matters:** does the dev workspace use
the same `DATABASE_URL` as the deployed app? On Replit a single Postgres
instance shared between workspace and deployment is the common default. If it is
shared, the production database is reachable through a publicly-addressable dev
URL by anyone who registers an account. If it is separate, this is a non-issue
in practice.

### 4.3 Lower-priority items (unchanged)

| Route | Auth | Concern |
|---|---|---|
| `POST /api/register-student` | none, **no rate limiter** | A second registration path alongside `/api/public/register`, which *does* have `publicSignupLimiter`. |
| `GET /api/lessons/:lessonId/grooves` | `isAuthenticated` | No `requireVerifiedStudent`, no visible ownership check. Negligible impact today (2 grooves exist). |

### 4.4 For the rebuild

- Object storage behind authentication, with size and content-type validation,
  rate limiting, and signed time-limited download URLs carrying an ownership
  check.
- No `/api/dev/*` routes at all. If equivalent tooling is needed, it requires an
  admin check *in addition to* the environment gate — an env var is a
  configuration value, not a security boundary.
- Separate databases for development and production, unconditionally.
- Turn `contentSecurityPolicy` back on.

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
