# Student Hub — rebuild plan

Companion to `FINDINGS.md` (what the current app actually does) and
`AMELIA-API-SPEC.md` (what Amelia actually returns). This is the plan for
what gets built.

---

## 1. Decisions taken

| Decision | Choice |
|---|---|
| Purpose | Rebuild and improve, off Replit |
| Scale target | **WMF multi-tutor now, SaaS-capable later** |
| Sequencing | Core first, then extras — runnable early, cut over late |
| Notion | Demoted from primary key to an optional nullable reference |
| Integrations retained | n8n, Todoist, Gmail, GitHub sync |
| Payments | See who has paid · invoicing + QuickBooks · lessons-remaining |
| Parent view | Money and attendance · progress summaries |
| Grooves | Replaced with Groove Builder's engine |

Two consequences of "SaaS later" that shape everything below: **nothing
hardcodes Wirral Music Factory**, and **nothing outside one adapter knows Amelia
exists**.

---

## 2. Architecture

### 2.1 Repo layout — monorepo

```
packages/
  groove-core/        model, URL codec, notation renderer, audio engine
                      (extracted from the existing Groove Builder)
  booking-provider/   the BookingProvider port + AmeliaProvider adapter
  shared/             schema, types, validation
apps/
  hub/                the portal (server + client)
  groove-builder/     the standalone builder
```

pnpm workspaces. The two apps share `groove-core`, so a groove behaves
identically in the builder, the portal and (via `ios/URL_FORMAT.md`) the iOS app.

### 2.2 Stack

Largely unchanged, because it works and you know it:

- **Server** — Node, Express 5, TypeScript
- **Client** — React 18, Vite, Wouter, TanStack Query, shadcn/ui, Tailwind
- **Database** — PostgreSQL via Drizzle, with a **real migrations directory**
- **Storage** — Cloudflare R2 (S3-compatible, free egress) behind signed URLs
- **Sessions** — `express-session` + `connect-pg-simple`

Deliberate changes from the current app:

- `drizzle-kit push` and startup SQL patches → versioned migrations
- Replit object storage → R2
- `sameSite: "none"` → `lax` (single origin)
- CSP back **on**
- `tsc` gates CI from the first commit

### 2.3 Tenancy — multi-tenant schema, single-tenant behaviour

Every table carries `organisation_id`. One row exists in `organisations`
(Wirral Music Factory). All queries are scoped by middleware that resolves the
organisation from the session; no route composes a query without it.

No signup, no billing, no provisioning, no subdomains. Those are a product
decision for later. This is purely so that decision doesn't require rewriting
every table and query against live data.

### 2.4 Roles

Four, replacing the hardcoded `ADMIN_EMAILS = ["md@wirralmusicfactory.com"]`:

| Role | Sees |
|---|---|
| `owner` | Everything in the organisation |
| `tutor` | Their own students, lessons, schedule and income |
| `student` | Their own lessons, practice, grooves, bookings |
| `parent` | Their children's attendance, payments and progress summaries |

A user may hold several roles, and a parent may be linked to several students —
replacing the current "multi-profile" mechanism with something explicit.

### 2.5 The BookingProvider port

```ts
interface BookingProvider {
  listAppointments(range: DateRange): Promise<Appointment[]>
  listCustomers(): Promise<Customer[]>
  getBookingUrl(opts: BookingLinkOptions): string
  verifyWebhook(req: Request): boolean
  parseWebhook(body: unknown): BookingEvent
}
```

`AmeliaProvider` is the first implementation. Nothing above this interface
mentions Amelia, WordPress, `bookingStart`, or a service ID. This is the
existing code's accidental instinct — keeping the Acuity-compatible shape
through the migration — made deliberate.

---

## 3. Data model — the significant changes

### 3.1 Mirror bookings locally (reversing the original design)

The current architecture deliberately does *not* store bookings, fetching them
live instead. **That decision should be reversed**, for four reasons now
established:

1. The unfiltered payload is **5.4 MB** and every call costs **~1.2 s**
   (`AMELIA-API-SPEC.md` §13).
2. There are **no `ETag` or `Last-Modified` headers**, so conditional requests
   are impossible — there is no cheap "has anything changed?".
3. **Amelia holds nothing before 20 July 2026.** Mirroring means the portal
   accumulates history from now on instead of being permanently limited to
   Amelia's forward book.
4. A local mirror gives somewhere to put **one row per participant booking**,
   which is what fixes the group-session gap.

Design: a sync job plus webhook invalidation writes into local tables. Reads
never touch Amelia.

```
appointments          (organisation_id, external_id, provider_id, service_id,
                       starts_at, ends_at, status, raw jsonb)
appointment_bookings  (appointment_id, external_booking_id, customer_id,
                       student_id, price, status, custom_fields jsonb)
```

Keyed on `(appointment_id, external_booking_id)`. Group sessions, waiting-list
entries and per-participant pricing all fall out of this for free.

### 3.2 Keys, constraints, indexes

- UUID primary keys throughout; `notion_page_id` becomes a plain nullable
  reference, addressed by nothing.
- **Real foreign keys**, which the current schema has none of.
- Indexes on every `student_id`, `organisation_id` and `starts_at`.
- `amelia_customer_id` stored on students — stable and unambiguous, though see
  `FINDINGS.md` §3 for why it does not by itself separate siblings.

### 3.3 Payments — own source of truth

Amelia's payment data cannot carry this: 1,024 of 1,217 payments read `pending`
because migrated Acuity records and pay-on-the-day bookings are
indistinguishable (`AMELIA-API-SPEC.md` §6).

So the hub keeps its own `invoices` and `payments`, seeded from Amelia where the
data is trustworthy (`gatewayTitle`, parsed `data.source`) and authoritative
thereafter. QuickBooks sync hangs off this, not off Amelia.

**Lessons remaining** is derived per `AMELIA-API-SPEC.md` §10 — count bookings
carrying the block's `couponId`, compare against the coupon `limit`. Once
bookings are mirrored locally this is a single query rather than an API fan-out.

---

## 4. Phase 0 — verify before building

Nothing here is code. All of it can invalidate assumptions in the plan.

1. **Does the API key authenticate against the admin-ajax route?**
   ```sh
   curl -s -H "Amelia: $KEY" \
     "https://wirralmusicfactory.com/wp-admin/admin-ajax.php?action=wpamelia_api&call=/api/v1/appointments&limit=2" \
     | head -c 400
   ```
   Blocks the entire data layer. If the key fails here, revisit §2.5 before
   anything else.
2. **What is `AMELIA_SCHOOLS_PROVIDER_ID` set to?** If `1`, the schools badge is
   mislabelling private lessons today (`FINDINGS.md` §11.3b).
3. **Does the Replit dev workspace share `DATABASE_URL` with production?**
   (`FINDINGS.md` §4.2).

### Operational fixes, independent of the rebuild

1. Add `https://` to the Hub Integration webhook — activates working code that
   has never run.
2. Check the 60-minute drum availability gap (nothing bookable until Jan 2027).
3. Attach custom field 4 to the lesson services — fixes sibling attribution for
   future bookings.
4. Harden the live upload endpoint (`FINDINGS.md` §4.1) — at minimum
   `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` on
   `/objects/*`.
5. Fix service 48's duration; hide service 21 and category 1.

---

## 5. Phase 1 — core

The goal is a portal that runs alongside Replit and can be compared against it,
not one that replaces it on day one.

1. **Foundations** — monorepo, CI with `tsc` and tests gating, Docker, managed
   Postgres, R2 bucket.
2. **Schema and migrations** — the full model with tenancy, roles, FKs and
   indexes. Migrations from the first commit.
3. **Auth** — email/password, sessions, roles, verification gate, password
   reset. Impersonation for owners, with the existing `denyImpersonation`
   discipline on mutations.
4. **Booking provider** — the port, the Amelia adapter, the sync job, webhook
   handling for all six trigger types, per-booking rows. Port
   `ameliaDatetimeToISO()` and its DST tests unchanged; they are correct.
5. **Students, lessons, resources** — CRUD, attachments on R2 with signed URLs
   and ownership checks. **One** lesson-creation service behind admin, n8n and
   GitHub sync, so `amelia_appointment_id` actually gets populated.
6. **Bookings UI** — list, per-booking `.ics`, subscribable iCal feed with
   regenerable token. Realtime simplified: reads hit the local mirror, so
   polling is now cheap and the four-layer SSE redundancy can go.
7. **Practice** — timer, floating widget, wake lock, areas and subcategories,
   to-dos, sessions with attachments and edit history, stats.

**Exit criteria:** a student can log in, see their lessons and bookings, log
practice; you can manage students and lessons; data matches Replit's.

---

## 6. Phase 2 — the rest of the portal

1. **Groove Builder integration** — extract `groove-core`, drop VexFlow and the
   bundled mp3s, one assignment model storing the canonical groove URL. Lazy-load
   sample kits; leave video export out of the hub.
2. **Speed trainer, achievements, songs, leaderboard.**
3. **Parent view** — attendance, payments, lessons remaining, plus weekly
   progress summaries.
4. **Book / reschedule** — deep links into `/book-a-lesson/` with
   `ameliaServiceId` and `ameliaEmployeeId` preselected (verified working), and
   a Customer Panel link for rescheduling. Attribution via
   `booking.info.urlParams`.
5. **Lessons remaining** on blocks.
6. **Multi-tutor** — tutor role, student assignment, scoped views and income.

---

## 7. Phase 3 — integrations and money

1. **n8n** — the 11 machine-to-machine endpoints, API-key auth, same-origin
   exemption. Two of your Amelia webhooks already depend on n8n.
2. **Todoist, Gmail, GitHub sync** — each re-authenticated directly rather than
   through Replit connectors.
3. **Payments and invoicing** — own tables, QuickBooks sync, unpaid-lesson
   chasing.
4. **PWA polish** — the app already ships a manifest and icons; make offline
   practice logging and installation genuinely good.

---

## 8. Risks

| Risk | Handling |
|---|---|
| API key doesn't work on admin-ajax | Phase 0 test before any code |
| Amelia is single-business, blocking true SaaS | BookingProvider port from day one |
| Sibling attribution has no clean automated route | Custom field 4 for new bookings; manual attribution for existing |
| Mirroring drifts from Amelia | Webhook invalidation plus a periodic full reconcile; Amelia stays authoritative on conflict |
| No booking history before July 2026 | Accepted. Mirror accumulates from now; Acuity export only if the history is genuinely needed |
| Scope growth from SaaS ambitions | Multi-tenant schema only. No billing, signup or provisioning until there is a second customer |

---

## 9. Open items

- Phase 0's three verification questions.
- Whether historical Acuity booking data needs importing at all.
- Where the repo lives — monorepo implies a new one; `Matt-Duffy` stays the
  standalone Groove Builder or becomes the monorepo root.
- Whether in-school lessons should be modelled at all, given they never touch
  Amelia (`AMELIA-API-SPEC.md` §9).
