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

**Severity: latent, not live.** The Amelia investigation (28 July) found the
install currently produces **one real booking per appointment**. The single
multi-booking appointment observed turned out to be a waiting-list entry
(`status: "waiting"`) — and `fetchAllAmeliaAppointments()` already filters
`waiting` out before normalising.

Two corrections to an earlier draft of this document, which overstated the
impact:

- `/api/admin/weekly-income` is **not** currently undercounting. With one
  booking per appointment, `bookings[0].price` is the whole price.
- No student is currently invisible in their own portal for this reason.

The bug is real but dormant. It activates the moment a genuine group or schools
session is booked through Amelia, and it fails silently when it does — the
2nd+ participant simply never sees the lesson, and the income figure quietly
drops.

**Rebuild fix (still worth doing):** model *bookings*, not appointments — one
row per participant, keyed `(appointmentId, bookingId)`. This costs little now
and removes a trap later.

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

### Correction: customer ID does not fix this

An earlier draft proposed linking students to Amelia by customer ID instead of
by email. The Amelia investigation shows that **does not solve the problem**.

Customer identity in Amelia is 1:1 with email — 105 distinct emails, none
mapping to more than one customer ID. So a parent booking for two children under
one email produces **one Amelia customer for both**. Swapping email matching for
customer-ID matching changes the key but not the ambiguity: both children still
resolve to the same customer, and both still see each other's lessons.

Customer ID is still worth storing — it is stable and unambiguous where one
customer means one student, which is the overwhelming majority of cases. But
disambiguating siblings needs something else. Options, roughly in order of
attractiveness:

1. **`bookings[n].info`** — Amelia's per-booking customer info field, which is
   where "booking for someone else" details land. Needs checking against real
   data to see whether it is populated and what it contains.
2. **Service or time slot** — if the two children reliably take different
   services or slots, the appointment can be attributed on that basis. Fragile.
3. **Custom fields** — currently useless (see §12.4), but could be made to work
   if a "student name" field were attached to the lesson services.
4. **Manual attribution** — the admin assigns ambiguous appointments to a
   profile. Always correct, costs a few clicks, and only needed for the handful
   of shared-email families.

For one affected family today, option 4 is defensible. Option 1 is the one to
investigate first, since it would generalise.

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

**RESOLVED (28 July 2026): the databases are separate.** Verified by comparing
Postgres cluster `system_identifier` values, which is conclusive in a way a
hostname compare would not be:

| | Development | Production |
|---|---|---|
| Cluster ID | 7605610823969374230 | 7605690302383968437 |
| Database | `heliumdb` (in-workspace) | `neondb` (Neon-backed) |
| Public tables | 23 | 23 |

Different cluster identifiers mean genuinely distinct clusters, not two names
for one database. Schemas are in sync at 23 tables each.

**So this finding is closed.** The `/api/dev/*` routes are absent from the
deployed app and, even while live in the workspace, operate on a database the
published app never touches. No action needed.

**This does not extend to §4.1.** The object-storage routes are registered in
*all* environments, so they are live on the public deployment at
`hub.wirralmusicfactory.com`. The dev/prod split contains the dev routes; it
does nothing for the upload and object-serving exposure.

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

## 11. Amelia investigation results (28 July 2026)

Findings from a separate direct-API investigation of the live Amelia install.

### 11.1 The webhook to the portal is misconfigured and has never fired

The "Hub Integration" webhook in Amelia points at
`hub.wirralmusicfactory.com/...` — **with no `https:// scheme`**, while the two
other configured webhooks have it. It fires on `bookingStatusUpdated` and
targets the portal.

This is almost certainly why `appointment_statuses` has **0 rows** (§1). Two
independent investigations converged: the hub's write-back path is dead both
because lessons carry no Amelia ID *and* because the webhook never arrives in the
first place.

**This is the highest-value quick fix available.** Adding the scheme is a
one-field edit in Amelia's settings and would activate real-time cancellation
sync that has been built, tested and inert since it was written.

### 11.2 Amelia holds no lesson history before 20 July 2026

The Acuity → Amelia migration date. Amelia is the **forward book only** — zero
appointments exist before it.

This is less alarming than it first appears, because the portal already stores
lesson records in its own `lessons` table (205 rows, sourced via Notion/n8n).
Past lesson *notes* are safe. What Amelia cannot provide is historical
*booking* data, which constrains:

- attendance history before July 2026
- `/api/admin/weekly-income` for any prior period
- any longitudinal reporting built on booking records

If historical booking data matters, it has to come from an Acuity export.
Worth deciding before the rebuild rather than during it.

### 11.3 RESOLVED — there are two different Amelia APIs

The apparent contradiction was real, and the explanation is bigger than a shape
difference. **The portal and the investigation were talking to entirely
different API surfaces.**

| | Current portal (`server/amelia.ts`) | Documented in `AMELIA-API-SPEC.md` |
|---|---|---|
| Base path | `/wp-json/amelia/v1` (WP REST) | `/wp-admin/admin-ajax.php?action=wpamelia_api&call=/api/v1` |
| Auth header | `Amelia-Api-Key` | `Amelia` |
| Page size param | `itemsPerPage` | `limit` |
| Date params | `dates[0]` / `dates[1]` | `dates=YYYY-MM-DD,YYYY-MM-DD` |
| `appointments` shape | array | object keyed by date |

Four independent differences. These are not two views of one endpoint.

Corroborating evidence from the portal's own code: `validateSchoolsProvider()`
contains a dedicated fallback for `/users/providers` returning **404**,
commented *"Providers list endpoint not registered in this Amelia version"*. The
spec shows `/users/providers` working fine — on the admin-ajax route. The WP
REST route simply doesn't expose it. The portal has been silently falling back
for its entire life.

**Consequences for the rebuild:**

1. Build against the **admin-ajax `/api/v1` route**. It is the surface that is
   documented in depth, exposes `/users/providers`, `/services`, `/coupons`,
   `/fields` and `/settings`, and supports `customerId` filtering — which the
   caching and per-student fetch designs both depend on.
2. **Verify keyed auth on that route first.** The investigation authenticated
   with an admin session cookie, not the API key. `Amelia: <key>` is Amelia's
   documented mechanism but was not exercised. If the key does not work there,
   the whole plan needs revisiting — so this is the first thing to test, before
   any code.
3. Do **not** port `server/amelia.ts`'s fetch layer. Its parameter names and
   array assumption belong to the other API. The parts worth keeping —
   `ameliaDatetimeToISO()`, `getLondonOffsetMinutes()` — are pure functions with
   no coupling to either surface.

### 11.3b The schools badge cannot be working

Two facts from the spec combine badly with the portal's implementation:

- There is **no schools provider**. The eight providers are Matt, Gary, Robyn,
  Anna, Paul, Tess, Tom and Chris. None has "school" in the name.
- The school services (46, 47, 48) have **zero appointments**. In-school lessons
  are not recorded in Amelia at all.

`detectIsSchools()` matches on `AMELIA_SCHOOLS_PROVIDER_ID`, falling back to a
provider-name substring match on `"school"`. Neither can succeed:

- If the env var points at a provider that no longer exists, the startup
  warning fires and the badge never shows.
- If it points at provider 1 (Matt), **every one of Matt's lessons is badged as
  schools** — including private ones, since Matt teaches both.
- The name fallback matches nothing.

There is also a Playwright test (`schools-badge-pending-state.spec.ts`) and an
admin config endpoint devoted to this feature.

**CONFIRMED (28 July 2026): `AMELIA_SCHOOLS_PROVIDER_ID = 1`.**

Provider 1 is Matt. `detectIsSchools()` returns `providerId === 1`, so **every
lesson Matt teaches is flagged `isSchools: true`** — private studio lessons
included, since he teaches both. The "Schools" badge on the admin schedule is
therefore wrong on every one of his lessons, today, in production.

**The feature is being kept** — school lessons will be booked through Amelia
from now on, so the badge needs to work, not just stop being wrong.

**Correct detection is by service, not provider.** The school services are
46 (WKGGS), 47 (Calday 30-min) and 48 (Calday 15-min), all under category 14
("Schools"), and all taught by provider 1. Provider is the wrong key precisely
because Matt teaches both school and studio lessons; service is unambiguous.

**Live app fix:** replace the provider match with a service-ID match against a
new `AMELIA_SCHOOLS_SERVICE_IDS` (`46,47,48`), and unset
`AMELIA_SCHOOLS_PROVIDER_ID`. Small, contained change to `detectIsSchools()`.

**Rebuild:** same logic, but driven from the mirrored `appointments.service_id`
with category 14 as a fallback, so adding a fourth school service is a data
change rather than a config change. Note the existing Playwright coverage
(`schools-badge-pending-state.spec.ts`) should port across.

### 11.3c Sibling disambiguation — revised again

§3 proposed checking `bookings[n].info` as the automated route. The spec makes
that unattractive: `info` is populated on **23 of 1,217 bookings** (~2%). It
captures what a customer typed into the booking form, not a reliable per-child
identity.

The better answer is sitting unused in the config. **Custom field 4 is literally
"Student Name (If different to booking name?)"** — and it is attached to zero
services, so it has never rendered or captured anything (§11.7).

Attaching field 4 to the lesson services would solve sibling attribution for all
future bookings, natively, with no heuristics: the parent types the child's name
at booking time and it arrives on `booking.customFields`. Existing bookings
still need manual attribution, but there are few affected families.

That makes the recommendation: **attach custom field 4 to the lesson services
now**, and treat manual attribution as the backfill for what is already booked.

### 11.4 Confirmed data facts

- **`bookings` is always an array**, even for a single booking. Confirms §2's
  structural point.
- **`customerId` lives only on `bookings[n]`**, never on the appointment. Stable
  and 1:1 with email across 105 customers — see §3 for why that does not
  disambiguate siblings.
- **Datetimes carry no timezone information at all** — no `T`, no `Z`, no
  offset, and `utcOffset` is null on every record. Wall-clock Europe/London.
  This vindicates `ameliaDatetimeToISO()` entirely; the existing handling is
  necessary, not defensive over-engineering.
- **Statuses observed:** `approved`, `canceled` (one L), `waiting`. Code also
  references `pending` and `no-show`. The current filter excludes `canceled`,
  `rejected`, `no-show` and `waiting`.

### 11.5 Caching is mandatory, and must be time-based

- **No `ETag`, no `Last-Modified`, `Cache-Control: no-store`.** Conditional
  requests are impossible.
- **~1.2 s per call** regardless of result size.
- **The unfiltered appointments payload is 5.4 MB.**

Combined with §6 — where every student page load and every iCal poll fetches the
entire book — this is the strongest finding in the document. A student opening
their bookings page currently costs 5.4 MB and over a second of WordPress time,
to display a handful of rows.

Since conditional requests are unavailable, the cache must be **time-based with
webhook invalidation**: cache normalised appointments, invalidate on the (now
working, per §11.1) webhook, and fall back to a short TTL.

### 11.6 Packages are enabled but unused

There is no native "lessons remaining" count to read. Deriving it from
`couponId` counts is possible but hacky. Either start using Amelia packages
properly, or track lesson blocks in the portal's own schema — the latter is
probably cleaner given the portal already owns lesson records.

### 11.7 Two operational issues (not code)

- **Four of five custom fields are attached to zero services**, including
  Student Age and previous experience, both marked required. They have never
  captured anything.
- **No 60-minute drum availability until January 2027**, while piano opens
  normally from July 2026. If unintentional, this is silently blocking bookings
  right now — worth checking ahead of anything in this document.

---

## 12. Still outstanding

Resolved since the last revision: response shape (§11.3), sibling
disambiguation route (§11.3c), webhook trigger types (all six are available —
`bookingAdded`, `bookingApproved`, `bookingCanceled`, `bookingRejected`,
`bookingRescheduled`, `bookingStatusUpdated`), and booking-form deep links
(verified — `ameliaServiceId`, `ameliaEmployeeId`, `ameliaCategoryId` on
`/book-a-lesson/`; no customer prefill, use the Customer Panel at `/bookings`).

Still open:

1. **Does the API key authenticate against the admin-ajax route?** Gates the
   entire data layer. Test before writing client code.
2. **What is `AMELIA_SCHOOLS_PROVIDER_ID` set to?** If `1`, the schools badge is
   actively mislabelling Matt's private lessons today (§11.3b).
3. **Does the Replit dev workspace share `DATABASE_URL` with production?**
   (§4.2).
4. **Write-side API behaviour** — the investigation covered GETs only. If the
   portal is ever to create or reschedule bookings, `/bookings` and `/stash`
   are untested. Not needed for the initial rebuild, which links out to the
   booking form instead.

### Operational fixes worth making regardless of the rebuild

In rough order of value per minute spent:

1. **Add `https://` to the Hub Integration webhook URL** (§11.1). Activates
   built-and-tested functionality that has never run.
2. **Check the 60-minute drum availability gap** — nothing bookable with Matt
   until January 2027 (spec §15.6). Possibly costing bookings right now.
3. **Attach custom field 4 ("Student Name if different to booking name") to the
   lesson services** (§11.3c). Fixes sibling attribution for all future
   bookings.
4. **Fix service 48's duration** — named "15 Minute", configured as 30 minutes
   (spec §8).
5. **Hide service 21 (`Test Service`) and category 1 (`Default`)**, both
   currently visible in the public booking form.
6. **Attach or delete custom fields 5, 6 and 7** — two are marked required and
   none has ever rendered.
