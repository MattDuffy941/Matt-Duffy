# Amelia API — Integration Spec

Reference for building against the Amelia booking plugin on `wirralmusicfactory.com`.
Verified live on 2026-07-28 against the running install.

> **Provenance and one caveat.** This spec was produced by a direct
> investigation of the live install and is the authoritative reference for the
> rebuild. Two things to know before relying on §1:
>
> 1. The investigation authenticated via an **admin session cookie**, because the
>    API key was not available in that environment. The `Amelia: <key>` header
>    documented in §1 is Amelia's documented keyed-auth mechanism for this route
>    but was **not exercised**. Confirm the key works against the admin-ajax
>    route before building on it.
> 2. This describes a **different API surface from the one the current portal
>    uses**. See `FINDINGS.md` §11.3 — different base path, different auth header
>    name, different pagination parameters, different response shape. Do not
>    assume code written against one will work against the other.

---

## 0. Read this before writing any code

Nine behaviours that will break naive assumptions. Each is verified, not inferred.

1. **`data.appointments` is an object keyed by date string, NOT an array.** You must walk the keys to flatten.
2. **`appointment.bookings` is always an array**, even with one element. Never treat it as a single object.
3. **The customer ID is only on the booking** (`bookings[n].customerId`). There is no customer ID on the appointment.
4. **Datetimes carry no timezone information.** Format `"2026-07-20 14:30:00"` — no `T`, no `Z`, no offset. They are wall-clock `Europe/London`. Do not parse as UTC.
5. **`customFields` and `info` are JSON strings, not objects.** You must `JSON.parse()` them.
6. **List endpoints do not expand relations; single-resource endpoints do.** `/users/providers` returns `serviceList: []` for everyone. `/users/providers/1` returns the real list.
7. **No default page size.** Omitting `limit` on `/appointments` returns all 1,216 records as a 5.4 MB response.
8. **`total` / `totalCount` / `filteredCount` ignore `page` and `limit`.** Measure the returned array; don't trust the counts for pagination maths.
9. **`bookingId` sometimes equals `appointmentId` by coincidence** of the data migration (533/533, 334/334). It is not a rule — the second booking on appointment 334 is booking 1231. Never rely on it.

---

## 1. Connection

```
Base URL:  https://wirralmusicfactory.com/wp-admin/admin-ajax.php?action=wpamelia_api&call=/api/v1<path>
Auth:      HTTP header literally named  Amelia: <api-key>
Method:    GET for all read operations
Format:    JSON
```

Amelia version **9.7**, licence tier **Elite** (REST API is Elite-gated). Currency **GBP**. Host: Hostinger / LiteSpeed.

Every response is wrapped:

```json
{ "message": "Successfully retrieved appointments", "data": { ... } }
```

Errors return the same envelope with an error message and an appropriate HTTP status (`401`/`403` for auth, `404` unknown endpoint, `405` wrong verb).

> **Scope note:** only GET endpoints were exercised during verification. Write-side behaviour (POST to `/bookings`, `/stash`, `/packages/customers`) is **untested** — treat any write integration as unverified and test it in isolation first.

---

## 2. Endpoint map

### Available (GET)

| Path | Returns | Unfiltered size |
|---|---|---|
| `/appointments` | `appointments`, `occupied`, `total`, `totalApproved`, `totalPending`, `totalCount`, `filteredCount`, `currentUser` | 5.4 MB |
| `/payments` | `payments`, `filteredCount`, `totalCount` | 1.35 MB |
| `/users/customers` | `users`, `filteredCount`, `totalCount` | 164 KB |
| `/users/providers` | `users`, `countFiltered`, `countTotal` | 8.7 KB |
| `/users/providers/{id}` | `user` — **expands `serviceList`** | small |
| `/services` | `services`, `countFiltered`, `countTotal` | 71 KB |
| `/services/{id}` | `service` — **expands `providers[]`** | small |
| `/categories` | `categories` | 61 KB |
| `/coupons` | `coupons`, `filteredCount`, `totalCount` | 74 KB |
| `/fields` | `customFields`, `totalCount`, `filteredCount` | 4.7 KB |
| `/settings` | `settings`, `additionalData` — **contains `webHooks`** | 47 KB |
| `/notifications` | `notifications`, `whatsAppTemplates` | 72 KB |
| `/packages` | `packages`, `totalCount`, `filteredCount` | empty |
| `/resources`, `/extras`, `/locations`, `/events` | as named | empty |
| `/stats` | period / employee / service / location / customer stats | 5 KB |
| `/entities` | `customers`, `appointments` | 110 B |

### Does not exist (404)

`/customers` · `/employees` · `/custom-fields` · `/webhooks` · `/memberships` · `/tags` · `/users/wordpress` · `/users/managers` · `/users/admins` · `/timeslots` · `/search-timeslots`

### POST-only (405 on GET)

`/bookings` · `/stash` · `/packages/customers`

### Naming traps

- Employees are at `/users/providers`, **not** `/employees`
- Custom fields are at `/fields`, **not** `/custom-fields`
- Webhooks are **not an endpoint** — they live inside `/settings` under `webHooks` (capital H)
- Memberships **do not exist in Amelia as a product feature**, at any tier

---

## 3. Appointment shape

### Response envelope

```jsonc
{
  "message": "Successfully retrieved appointments",
  "data": {
    "appointments": {
      "2026-07-20": { "appointments": [ /* Appointment */ ] },
      "2026-07-21": { "appointments": [ /* Appointment */ ] }
    },
    "occupied": { },
    "total": 1216,
    "totalApproved": 1174,
    "totalPending": 0,
    "totalCount": 1216,
    "filteredCount": 1216,
    "currentUser": { }
  }
}
```

Flattening:

```js
const flat = [];
for (const key of Object.keys(data.appointments)) {
  const v = data.appointments[key];
  if (Array.isArray(v)) flat.push(...v);
  else if (v && Array.isArray(v.appointments)) flat.push(...v.appointments);
}
```

### Complete Appointment object

Every key the API returns. `provider` and `service` are full nested objects — identical in shape to a `/users/providers/{id}` and `/services/{id}` payload — collapsed here for length only.

```jsonc
{
  "id": 533,
  "bookings": [ /* Booking[] — see §4 */ ],
  "notifyParticipants": "0",
  "internalNotes": "Migrated from Acuity 2026-07-19",
  "status": "approved",
  "serviceId": 4,
  "parentId": null,
  "providerId": 2,
  "assignedEmployeeId": null,
  "locationId": null,
  "provider": { /* full provider object */ },
  "service":  { /* full service object */ },
  "location": null,
  "googleCalendarEventId": null,
  "googleMeetUrl": null,
  "outlookCalendarEventId": null,
  "microsoftTeamsUrl": null,
  "appleCalendarEventId": null,
  "zoomMeeting": null,
  "lessonSpace": null,
  "bookingStart": "2026-07-20 14:30:00",
  "bookingEnd": "2026-07-20 15:30:00",
  "type": "appointment",
  "isRescheduled": null,
  "isChangedStatus": null,
  "isFull": null,
  "resources": [],
  "initialAppointmentDateTime": null,
  "createPaymentLinks": null,
  "cancelable": false,
  "reschedulable": false,
  "past": true,
  "isGroup": false
}
```

`googleCalendarEventId` is populated on some records (e.g. `"5812ih1neoqf4ibuqj8grds55s"`) and null on others.

---

## 4. Booking shape

```jsonc
{
  "id": 533,
  "customerId": 75,
  "customer": { /* full Customer object — see §5 */ },
  "status": "approved",
  "couponId": null,
  "price": 30,
  "coupon": null,
  "tax": null,
  "ivyEntryId": null,
  "appointmentId": 533,
  "extras": [],
  "persons": 1,
  "token": null,
  "payments": [ /* Payment[] — see §6 */ ],
  "utcOffset": null,
  "aggregatedPrice": true,
  "isChangedStatus": null,
  "isLastBooking": null,
  "packageCustomerService": null,
  "ticketsData": [],
  "duration": null,
  "created": "2026-07-19 15:33:21",
  "actionsCompleted": null,
  "isNew": null,
  "isUpdated": null,
  "customFields": null,
  "info": null,
  "qrCodes": null,
  "icsFiles": null
}
```

### Notes

- **`duration` is usually `null`.** Where present it is **seconds** (`3600`). Derive lesson length from `service.duration` or `bookingEnd - bookingStart` instead.
- **`utcOffset` is null on every record examined.** Not a usable timezone source.
- **`customFields` is a JSON string** keyed by field ID (38 of 1,217 bookings have one):

```json
  "customFields": "{\"8\":{\"label\":\"Is student Left or Right handed?\",\"type\":\"radio\",\"value\":\"Right Handed\"}}"
```

- **`info` is a JSON string** holding what the customer typed into the booking form (23 of 1,217 bookings):

```json
  "info": "{\"firstName\":\"Jane\",\"lastName\":\"Doe\",\"phone\":null,\"locale\":\"en_US\",\"timeZone\":\"Europe/London\",\"urlParams\":null}"
```

  `urlParams` captures the query string the booking arrived with — usable for attributing bookings to a deep link.

### Multiple bookings on one appointment

An appointment can hold more than one booking. **In this install that means a waiting-list entry, not a group session** — every service is `minCapacity: 1 / maxCapacity: 1`, and the waiting-list feature is enabled.

Current data: 1,215 appointments with one booking, 1 with two. The second has `status: "waiting"`, `amount: 0`, `gatewayTitle: ""`.

**Filter on `booking.status` or waiting-list entries will render as confirmed lessons.**

---

## 5. Customer shape

`GET /users/customers` → `data.users[]`. 255 customers, **all returned in one response** — no default pagination.

```jsonc
{
  "id": 75,
  "firstName": "Jane",
  "lastName": "Doe",
  "birthday": null,
  "email": "jane@example.com",
  "phone": "+44...",
  "type": "customer",
  "status": "visible",
  "note": null,
  "zoomUserId": null,
  "countryPhoneIso": null,
  "externalId": null,
  "pictureFullPath": null,
  "pictureThumbPath": null,
  "translations": null,
  "customFields": null,
  "appleCalendarId": null,
  "googleCalendarId": null,
  "outlookCalendarId": null,
  "gender": null,
  "stripeConnect": null
}
```

### Identity and joins

- **`customerId` is stable.** 105 distinct emails across 1,217 bookings, **zero** emails mapping to more than one customer ID. Safe as a join key.
- **No duplicate emails exist** (0 duplicate groups across 255 records, 0 blank emails). Amelia matches on email during front-end booking, so the normal path won't create duplicates — but it is **not a database unique constraint**. Admin creation and CSV import can produce them. Join on `customerId`, not email.
- **WordPress user linkage is NOT populated.** The field is `externalId` and it is `""` on all 255 records. You **cannot** resolve "which Amelia customer is this logged-in WP user" from Amelia's data. Match on email, or start populating `externalId`.

---

## 6. Payment shape

```jsonc
{
  "id": 531,
  "customerBookingId": 533,
  "packageCustomerId": null,
  "parentId": null,
  "amount": 30,
  "gateway": "onSite",
  "gatewayTitle": "Acuity (migrated)",
  "dateTime": "2026-07-20 14:30:00",
  "status": "paid",
  "data": "{\"source\":\"acuity\",\"acuity_status\":\"paid\",\"method\":\"package\",\"migrated\":\"2026-07-19\"}",
  "entity": null,
  "created": "2026-07-19 14:33:21",
  "actionsCompleted": null,
  "triggeredActions": null,
  "wcOrderId": null,
  "wcOrderItemId": null,
  "wcOrderUrl": null,
  "wcItemCouponValue": null,
  "wcItemTaxValue": null,
  "transactionId": "acuity-migrated",
  "transfers": null,
  "invoiceNumber": null,
  "paymentLinks": null
}
```

`data` is a **JSON string**. Parse it.

**Payment IDs are a separate sequence from appointment IDs and run ~2 apart** (appointment 533 → payment 531; appointment 334 → payment 332). Easy to confuse — always be explicit about which you mean.

⚠️ **`payment.status` is close to useless as a "has this been paid" signal on this dataset.** 1,024 of 1,217 payments are `pending` and 1,206 of 1,217 use the `onSite` gateway, because Acuity-migrated records and legitimate pay-on-the-day bookings both produce that shape. Cross-check `gatewayTitle` and parsed `data.source` before drawing conclusions.

---

## 7. Enumerations

### Appointment status (`appointment.status`)
Observed: `approved` (1,174), `canceled` (42).

### Booking status (`bookings[n].status`)
Observed: `approved` (1,174), `canceled` (42), `waiting` (1).

**Full Amelia enum — handle all six:**

```
pending | approved | canceled | rejected | waiting | no-show
```

`pending` and `no-show` don't appear in current data but will the moment the default appointment status changes or the no-show tag is used.

> Spelling: **`canceled`, one L** (American).

### Payment status (`payments[n].status`)
Observed: `paid` (193), `pending` (1,024). Amelia also uses `refunded` and `partiallyPaid`.

### Payment gateway (`payments[n].gateway`)
Observed: `onSite` (1,206), `stripe` (11). Stripe enabled; PayPal disabled; global on-site payment setting is `false`.

### Datetime format
`YYYY-MM-DD HH:MM:SS`, 24-hour, space-separated. **No timezone data anywhere.** Assume `Europe/London`. Applies to `bookingStart`, `bookingEnd`, `created`, `dateTime`.

---

## 8. Services

50 services, all `visible`, all `minCapacity: 1 / maxCapacity: 1` — **no group services exist**.

### Individual lessons
| ID | Instrument | 30 min | 60 min |
|---|---|---|---|
| 1 / 2 | Drum | £16 | £30 |
| 3 / 4 | Piano | £16 | £30 |
| 5 / 6 | Singing | £16 | £30 |
| 7 / 8 | Guitar | £16 | £30 |
| 9 / 10 | Violin | £16 | £30 |
| 11 / 12 | Saxophone | £16 | £30 |
| 13 / 14 | Flute | £16 | £30 |
| 15 / 16 | Bass | £16 | £30 |
| 17 / 18 | Ukulele | £16 | £30 |
| 19 / 20 | Mandolin | £16 | £30 |
| 42 / 43 | Music Theory | £16 | £30 |

### 5-lesson blocks
30-min blocks £75 — Drum 22, Piano 23, Singing 24, Guitar 25, Violin 26, Sax 27, Flute 28, Bass 29, Ukulele 30, Mandolin 31, Theory 44
60-min blocks £140 — Drum 32, Piano 33, Singing 34, Guitar 35, Violin 36, Sax 37, Flute 38, Bass 39, Ukulele 40, Mandolin 41, Theory 45

### Other
| ID | Name | Duration | Price |
|---|---|---|---|
| 21 | Test Service | 30m | £16 |
| 46 | 30 Minute Drum Lesson (WKGGS) | 30m | £18 |
| 47 | 30 Minute Drum Lesson (Calday) | 30m | £18 |
| 48 | 15 Minute Drum Lesson (Calday) | **30m** ⚠️ | £9 |
| 49 | Online Singing Lesson (30 min) | 30m | £16 |
| 50 | Online Singing Lesson (60 min) | 60m | £30 |

### Categories
1 Default (empty) · 2 Drum · 3 Piano · 4 Singing · 5 Guitar · 6 Violin · 7 Saxophone · 8 Flute · 9 Bass · 10 Ukulele · 11 Mandolin · 12 Testttt · 13 Music Theory · 14 Schools

### Cautions

- **Catalog prices are base prices.** Per-tutor custom pricing is enabled (`customPricing: {enabled:true}`), so `booking.price` legitimately differs from `service.price`. Do not treat a mismatch as an error.
- **Service 48 has a duration/name mismatch** — named "15 Minute" but `duration` is 30 minutes (1800s). Price £9 (half of 46/47) implies 15 is intended. Rendering duration from the service record will show the wrong length.
- **Filter out service 21 (`Test Service`) and category 1 (`Default`)** from any user-facing picker. Both are junk and both are `visible`.

---

## 9. Providers

8 providers. **No ID 8 — the sequence has a gap.**

| ID | Name |
|---|---|
| 1 | Matt Duffy |
| 2 | Gary O'Shea |
| 3 | Robyn H. |
| 4 | Anna C. |
| 5 | Paul C. |
| 6 | Tess O. |
| 7 | Tom L. |
| 9 | Chris Jones |

**Provider 1 (Matt) teaches all in-school services.** `/users/providers/1` returns `serviceList: [1, 2, 22, 32, 46, 47, 48]`; `/services/46` returns `providers: [1]`. No other provider is assigned to 46, 47 or 48.

⚠️ **The school services have zero appointments.** Not one booking exists against 46, 47 or 48 in the entire dataset. In-school lessons are not recorded in Amelia — do not expect to read them from this API.

---

## 10. Packages, blocks and remaining-lesson counts

- **Packages feature is enabled** (`packages: {enabled:true}`) and `/packages` works — but **zero packages are configured** (`totalCount: 0`).
- **Memberships do not exist in Amelia.** `/memberships` 404s.

**There is therefore no native remaining/used lesson count available anywhere in this install.**

The 5-lesson blocks are modelled as ordinary services (IDs 22–41, 44–45) plus 100%-off coupons scoped to the matching single-lesson service. Critically:

> **Coupon "used" count is derived, not stored.** Amelia counts bookings carrying that `couponId`. There is no `used` column to read.

To compute "lessons remaining on this block" you must count bookings where `booking.couponId` matches, and compare against the coupon's `limit` from `/coupons`. Relevant fields: `booking.couponId`, `booking.coupon`, and on the coupon record `limit`, `discount`, `deduction`, `expirationDate`, `serviceList`.

Typical block coupon limits: **4** for an online block purchase (first lesson paid as the block itself), **5** for a tutor-issued voucher.

---

## 11. Custom fields

`GET /fields` → 5 fields.

| ID | Label | Type | Required | Attached to |
|---|---|---|---|---|
| 4 | Student Name (If different to booking name?) | text | no | **nothing** |
| 5 | Student Age | text | **yes** | **nothing** |
| 6 | Does the student have any past experience? | text | **yes** | **nothing** |
| 7 | Does the student have something they want to learn? | text | no | **nothing** |
| 8 | Is student Left or Right handed? | radio | no | services 1, 2, 22, 32 |

⚠️ **Fields 4, 5, 6, 7 have both `allServices: false` and `services: []`** — attached to nothing, so they never render and have never captured a value, despite two being marked required. **Only field 8 produces data.** Do not build intake features expecting the other four to contain anything.

Field object keys: `id`, `label`, `type`, `required`, `position`, `options`, `services`, `events`, `translations`, `allServices`, `allEvents`, `useAsLocation`, `width`, `saveType`, `saveFirstChoice`, `includeInInvoice`.

---

## 12. Webhooks

Not an endpoint. Read from `GET /settings` → `data.settings.webHooks` (capital H).

| # | Name | Trigger | URL |
|---|---|---|---|
| 0 | *(unnamed)* | `bookingAdded` | `https://n8n.srv917822.hstgr.cloud/webhook/wmf-block-coupon-issue` |
| 1 | *(unnamed)* | `bookingCanceled` | `https://n8n.srv917822.hstgr.cloud/webhook/wmf-block-cancel` |
| 2 | Hub Integration | `bookingStatusUpdated` | `hub.wirralmusicfactory.com/webhook/xyjpaw-Xisnys-1kufdy` |

All three are `type: "appointment"`.

⚠️ **Webhook #2 has no URL scheme** — no `https://`, unlike the other two. A schemeless URL will not resolve as an outbound HTTP target, so **this webhook is almost certainly not firing**. It targets the student portal on `bookingStatusUpdated`. Verify whether the portal has ever received a call on it before assuming this integration works.

Available trigger types (Amelia standard): `bookingAdded`, `bookingApproved`, `bookingCanceled`, `bookingRejected`, `bookingRescheduled`, `bookingStatusUpdated`, plus `package` and `event` equivalents. `type` selects the entity (`appointment` / `event` / `package`).

---

## 13. Pagination, filtering, caching

### Pagination

| Request | Rows | Bytes |
|---|---|---|
| no params | 1,216 | 5,441,511 |
| `page=1&limit=5` | 5 | 23,577 |
| `dates=2026-08-01,2026-08-07` | 68 | 311,582 |
| `dates=...&page=1&limit=2` | 2 | 10,341 |

**Always send `limit`.** There is no default page size.

**`total` / `totalCount` / `filteredCount` do not respect `page`/`limit`** — with `limit=5` they still report 1,216. `filteredCount` *does* respect `dates` and `customerId`.

### Filters

| Filter | Parameter | Status |
|---|---|---|
| Date range | `dates=YYYY-MM-DD,YYYY-MM-DD` (comma-separated, inclusive) | ✅ verified |
| Customer | `customerId=<int>` | ✅ verified |
| Flatten hint | `asArray=true` | in use by existing tooling |
| Service / provider / location / status / search | `services`, `providers`, `locations`, `status`, `search`, `skipServices`, `skipProviders` | documented, **unverified** |

### Rate limiting

**None observed** — 12 rapid consecutive requests all returned 200, no throttling, no 429.

⚠️ **Latency is the real constraint: ~1.17 s per request regardless of size** (12 requests at `limit=1` took 14.0 s). Combined with §0.6 — relation expansion needs one call per record — avoid designs that fan out into many sequential calls.

### Caching headers

```
cache-control: no-cache, must-revalidate, max-age=0, no-store, private
expires: Wed, 11 Jan 1984 05:00:00 GMT
```

**No `ETag`. No `Last-Modified`.** Conditional requests (`If-None-Match`, `If-Modified-Since`) are **not possible**. Cache must be time-based or diffed client-side.

The nearest change signal is `booking.created` / `payment.created`, which detects **new** records but **not edits** to existing ones.

---

## 14. Booking form deep links

Booking page: **`https://wirralmusicfactory.com/book-a-lesson/`** (`/book-now/` and `/lesson-booking/` are 404).

Verified working:

```
https://wirralmusicfactory.com/book-a-lesson/?ameliaServiceId=2&ameliaEmployeeId=1&ameliaCategoryId=2
```

Confirmed effect: the form **skips the Service Selection step entirely** and opens on *Date & Time*, leaving `Date & Time → Your Information → Payments`. Verified with a second combination (`ameliaServiceId=4&ameliaEmployeeId=2`).

| Parameter | Purpose | Status |
|---|---|---|
| `ameliaServiceId` | pre-select service | ✅ verified |
| `ameliaEmployeeId` | pre-select tutor | ✅ verified |
| `ameliaCategoryId` | pre-select category | ✅ verified |
| `ameliaLocationId` | pre-select location | documented, untested (no locations configured) |
| `ameliaEventId`, `ameliaEventTag`, `ameliaEventPopup` | events | documented, untested (no events configured) |

**Customer detail prefill is not available via URL parameters.** No such parameter is documented or present in the frontend bundle. The supported route for a known customer is the Customer Panel shortcode `[ameliacustomerpanel]` (page slug `bookings`).

The query string is captured into `booking.info.urlParams`, enabling attribution of bookings to a portal link.

---

## 15. Data-state constraints

Facts about the *current contents* that shape what the portal can do.

1. **There is no lesson history in Amelia.** Earliest `bookingStart` is **2026-07-20**; latest is 2026-12-31. Querying `dates=2020-01-01,2026-07-19` returns **zero** rows. Every record carries `internalNotes: "Migrated from Acuity 2026-07-19"`. Amelia holds the **forward book only** — historical lessons live in Acuity and the local SQLite database. **Amelia cannot be the source for a student's past lessons.**
2. **255 customers · 1,216 appointments · 1,217 bookings · 105 distinct booking emails.**
3. **No WordPress user linkage** (`externalId` empty on all customers) — see §5.
4. **Locations, extras, resources and events are all empty.** No location filtering, no add-ons, no room constraints, no workshops. Don't build UI for them.
5. **Cart disabled. WhatsApp disabled.** Invoices, tax, custom pricing, no-show tag, e-tickets, waiting list all enabled.
6. **No bookable availability for 60-minute drum lessons with provider 1 (Matt) until January 2027** — the deep-link calendar opens on Jan 2027 for service 2 + employee 1, while service 4 + employee 2 opens normally on Jul 2026. Whether intentional or a working-hours misconfiguration is unresolved; it will affect anything that surfaces availability.

---

## 16. Cheat sheet

```
Base:             https://wirralmusicfactory.com/wp-admin/admin-ajax.php?action=wpamelia_api&call=/api/v1<path>
Auth header:      Amelia: <key>

Lessons:          /appointments?dates=YYYY-MM-DD,YYYY-MM-DD&limit=200
One student:      /appointments?customerId=<id>
Students:         /users/customers                (255, unpaginated)
Tutors:           /users/providers                (list — relations NOT expanded)
Tutor detail:     /users/providers/<id>           (expands serviceList)
Lesson types:     /services  ·  /services/<id>    (single expands providers[])
Intake fields:    /fields
Blocks/coupons:   /coupons
Webhooks:         /settings -> data.settings.webHooks

Flatten:          data.appointments is an OBJECT KEYED BY DATE
Customer FK:      bookings[n].customerId          (never on the appointment)
Times:            "YYYY-MM-DD HH:MM:SS" — no timezone — assume Europe/London
Statuses:         pending|approved|canceled|rejected|waiting|no-show   ("canceled", one L)
JSON strings:     bookings[n].customFields · bookings[n].info · payments[n].data
Caching:          no ETag, no Last-Modified, no-store — time-based only
Latency:          ~1.2 s per call regardless of size — cache hard, avoid fan-out
History:          NONE before 2026-07-20
```
