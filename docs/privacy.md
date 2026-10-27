# Privacy and personal data (NUD-093)

Working document for the operator (the pasta factory) and its data protection advisor. It lists what
the app stores, where it lives, who else receives data, and how long it is kept. It is **not legal
advice**; points marked "to confirm" need a decision or a contract check by the operator.

The app is an internal tool: users are the office staff (admins) and the drivers. Customers are
**businesses** (mostly restaurants); they have no login and no self-service. Personal data therefore
concerns (a) the staff and drivers, and (b) people who appear in business data (contact names in
notes, people in a photo or chat screenshot).

## 1. Where data lives (hosting)

| Component                            | Provider and region                                                         | What it holds                                                            |
| ------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Application (server functions, cron) | Vercel, region `fra1` (Frankfurt), see `vercel.json`                        | Processes requests; logs (see section 5); no data store of its own       |
| Database (PostgreSQL)                | Neon, EU (Frankfurt) project, see `docs/deploy.md` section 2                | All tables of section 2                                                  |
| Object storage (photos, screenshots) | Cloudflare R2, **EU jurisdiction**, private bucket, `docs/deploy.md` sec. 3 | Customer photos and order screenshots                                    |
| Routing and geocoding                | OpenRouteService (HeiGIT, Germany), only when `ORS_API_KEY` is set          | Addresses of customers and the depot, stop coordinates (section 4)       |
| Machine translation                  | DeepL API, only when `DEEPL_API_KEY` is set                                 | Texts of notes and driver problem reports (section 4)                    |
| Map tiles                            | Provider chosen with `MAP_TILE_URL` (production: MapTiler or Stadia Maps)   | The browser requests tiles directly: IP address and map area (section 4) |
| Error reports (optional)             | Sentry, EU data region (project setting), only when `SENTRY_DSN` is set     | Scrubbed error events: no personal data by design (section 4)            |
| Database backups                     | Cloudflare R2, **EU jurisdiction**, separate private bucket `nudel-backups` | A full copy of the database, weekly, 8 weeks (section 3, "Backups")      |

To confirm: Vercel and Cloudflare are US companies. Data stays in the EU regions above, but a
data processing agreement with the standard contractual clauses (or the EU-US Data Privacy Framework
certification) is needed with each provider. Neon, Vercel, Cloudflare, OpenRouteService, DeepL and
the tile provider are processors of the operator.

## 2. What is stored

| Data                                  | Where (table / bucket)                              | Personal data in it                                                                                                                                                                                                                                                                                                                       | Retention                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staff and driver accounts             | `User`                                              | Display name, e-mail (admins) or user name (drivers), language, last login time, **bcrypt hash** of password / PIN (never the PIN itself)                                                                                                                                                                                                 | Until the operator removes the account; accounts are deactivated (soft delete), not erased                                                       |
| Customers (businesses)                | `Customer`                                          | Business name, delivery address and address point, delivery hours, a driver note that may name a contact person; office only (NUD-136): company (may be a sole trader's own name), VAT id, billing address                                                                                                                                | Until archived; archived customers are kept (soft delete)                                                                                        |
| Photos of shop entrance and parking   | `Photo` + bucket `customers/<uuid>.jpg`             | Images taken on the street; may show passers-by, vehicle registration plates or staff. Uploader (user id)                                                                                                                                                                                                                                 | Kept while the customer is served; replaced photos stay as history                                                                               |
| Parking spots of a customer           | `ParkingSpot` (NUD-125)                             | Map position of a parking place, a short name and a **free-text note** typed by the office (drivers add a Parkplatz with coordinates only, no text, NUD-144); shown to the driver on the stop screen and kept in the driver's offline copy of today's tour (NUD-126); the note may name a contact person or a gate code. Author (user id) | Kept while the customer exists; "removed" spots stay with `active=false` (soft delete). Not copied into the audit log (only ids and coordinates) |
| Order screenshots (WhatsApp / WeChat) | `Screenshot` + bucket `screenshots/<uuid>.jpg`      | Chat content: names, phone numbers, messages. Uploader (user id). `extraction` stays empty until NUD-100                                                                                                                                                                                                                                  | **180 days** (configurable), then deleted automatically (section 3)                                                                              |
| Orders and order lines                | `Order`, `OrderItem`                                | Customer reference (a business), quantities, delivery date, creator (user id), internal note (free text, may name a contact person)                                                                                                                                                                                                       | Kept (transactional history, section 6); the internal note is editable in the admin area                                                         |
| Tours, stops, delivery status         | `Tour`, `Stop`, `StopOrder`, `StopMutation`         | Assigned driver (user id), completion times, problem reason (enum). Not personal data on their own: quantities, statuses, ids                                                                                                                                                                                                             | Kept (transactional history, section 6)                                                                                                          |
| Driver problem text                   | `Stop.problemNote` (JSON, driver language + German) | **Free text typed by the driver**, plus its machine translation; may contain names or phone numbers                                                                                                                                                                                                                                       | **365 days** after the stop was completed (configurable), then removed by the daily job (section 6)                                              |
| Audit log                             | `AuditLog`                                          | Actor id, entity ids, quantities, dates, order / problem notes **cut to 200 characters** (this includes a copy of the driver's problem text, see section 6); no names                                                                                                                                                                     | **730 days** (configurable), then deleted by the daily job (section 7)                                                                           |
| Failed-login counters                 | `LoginAttempt`                                      | User name or e-mail that was typed and the **IP address** of the failed attempt                                                                                                                                                                                                                                                           | 15 minute rolling window; rows older than 24 h are deleted daily (section 3)                                                                     |
| Offline copy on the driver's phone    | Browser IndexedDB and Cache Storage                 | Today's tour: customer names, addresses, notes, photos, queued status taps and photos                                                                                                                                                                                                                                                     | Replaced on every sync; removed at the login page; other days are never shown                                                                    |
| Cookies                               | Browser                                             | `authjs.session-token` (signed session, HttpOnly, SameSite=Lax, Secure on https; 12 h admin, 90 days driver), `NEXT_LOCALE` (language, 1 year)                                                                                                                                                                                            | Strictly necessary; no analytics, advertising or tracking cookies                                                                                |

**Not collected:** continuous driver GPS positions or tracking (decision D19), prices, payment data, delivery
signatures or proof photos (D11), analytics or advertising identifiers.

The address point and the Parkplätze on the map are coordinates of a customer's business, not the
position of a person.
The only use of the device position is the one-off fix behind "Parkplatz festlegen" (NUD-144): the
driver taps the button, the browser asks for permission once, and the resulting point is stored as a
Parkplatz of the customer (author = user id, audit entry). The position is not kept otherwise; the
Permissions-Policy allows `geolocation` for our own origin only.

## 3. Retention implemented in the app

### Order screenshots: 180 days

`GET /api/cron/retention` runs daily at 03:17 UTC (`vercel.json`). It is protected by
`Authorization: Bearer $CRON_SECRET` like the translation job (without a configured secret every
call is answered with 401).

- Every `Screenshot` older than `SCREENSHOT_RETENTION_DAYS` (default **180**, allowed 1 to 3650;
  invalid or empty values fall back to 180 so that a typo can never switch the job off or delete
  everything) is deleted: first the **storage object**, then the **database row**. If the process
  dies in between, the row points to a missing object (harmless: the next run removes the row; a
  missing object is not an error). The reverse order could leave an orphaned file that no row refers
  to any more. If the storage delete fails, the row is kept and tried again the next day.
- The order itself stays; `Order.screenshotId` becomes empty (foreign key `ON DELETE SET NULL`) and
  the order detail simply shows no screenshot.
- At most 100 screenshots per run; the response reports `examined`, `deleted`, `failed`, `more`.
  After a long outage the backlog is worked off over several days.
- Objects that were uploaded but never attached to an order (the office abandoned the form) have no
  row and are not found by this job. Add a **lifecycle rule** on the bucket as the backstop:
  delete objects under the prefix `screenshots/` after 190 days (R2 dashboard > bucket > Settings >
  Object lifecycle rules). Customer photos (`customers/`) must not get such a rule.
- The same run deletes `LoginAttempt` rows older than 24 hours.
- The run is not written to the audit log (no user action); the counts are in the cron response and
  the Vercel function log.

### Backups (NUD-094)

A GitHub Action (`.github/workflows/backup.yml`) copies the whole database every Sunday into a
separate private R2 bucket (EU jurisdiction) and deletes copies older than 8 weeks. A backup holds
everything in section 2 that is in the database, including **password hashes** and the personal
data of customers and drivers, **except `LoginAttempt` rows** (user names and IP addresses; the dump
leaves their content out because they are kept 24 hours at most). Consequences to know:

- Data deleted in the app (screenshots after 180 days, archived records, changed texts) can still
  exist in a backup for up to 8 weeks plus the time to the next run. A request to erase personal data
  is answered in the app at once and in the backups by the 8-week expiry; a restore of an old backup
  must be followed by running the retention job again (`docs/runbook.md`, "Restore the database").
- Access is limited to the people who hold the Cloudflare account and the GitHub environment
  `backup` secrets. The bucket is never public. Photos and screenshots are **not** in the backups
  (objects stay in the photo bucket).
- The read-only database role used by the backup (`backup_reader`) can read everything but change
  nothing.

### Orphaned storage objects (NUD-094)

Uploads that never became a photo or screenshot (action failed, tab closed) stay in the bucket. A
weekly job lists the objects, and removes those older than `ORPHAN_CLEANUP_GRACE_DAYS` (default 14)
that no database row refers to, once `ORPHAN_CLEANUP_MODE=delete` is set; by default it only logs
what it would delete. Details and safeguards: `docs/runbook.md`, "Orphaned storage objects".

### What the operator must configure

`CRON_SECRET` (required, otherwise the retention jobs, the orphan job and the translation job never
run), optionally `SCREENSHOT_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS`, `DRIVER_TEXT_RETENTION_DAYS`,
`DATA_RETENTION_MODE` (**set to `delete` to activate the driver text job**), `ORPHAN_CLEANUP_MODE`. See `docs/env.md`.

## 4. Who else receives data

- **DeepL** receives the text of customer notes (German) and of driver problem reports whenever a
  translation is needed (NUD-070 to NUD-072). The text contains no customer number, but it may
  contain names or phone numbers if someone typed them. Use a **DeepL API Pro** key in production:
  according to DeepL's terms Pro does not store or train on submitted text, whereas the free API may
  (to confirm against the current terms and conclude DeepL's data processing agreement). Without
  `DEEPL_API_KEY` nothing is sent.
- **OpenRouteService** receives customer and depot addresses (geocoding) and stop coordinates
  (routing) with the API key in a header. Business addresses, no driver positions.
- **Map tile provider**: the browser of every user who opens a map requests tiles from it and
  thereby reveals the IP address and the viewed area. The `Referer` header is limited to the origin
  (`Referrer-Policy: strict-origin-when-cross-origin`). Use a provider with a data processing
  agreement; the default OpenStreetMap server is for development only.
- **Google Maps / Apple Maps**: the "navigate" button opens the other app with the stop's
  coordinates on the driver's own phone. The app itself sends nothing to Google.
- **Sentry** (NUD-094, optional, `SENTRY_DSN`): receives error events from the server and from the
  browsers (error type, message, stack trace, page path, release, browser / OS name). Before an
  event leaves the app `src/lib/sentry-scrub.ts` removes: request bodies, cookies, all headers but
  the user agent and language, query strings (signed storage URLs, tokens), user records and IP
  addresses (`sendDefaultPii` off), console output, anything stored under keys like password / pin /
  token / cookie / signature, and offline / aborted-request noise. No session replay, tracing or
  profiling. Create the Sentry project with the **EU data region** (`de.sentry.io`), conclude a
  data processing agreement, and keep the retention of events short (30 days is enough). Error
  messages written by the app's own code contain ids, not names; an unexpected library message could
  still contain a fragment of text, which is why the scrubber also redacts URLs and secrets inside
  messages. Without a DSN nothing is sent.

The browser never loads scripts, fonts or images from third-party sites other than the configured
tile server and the storage host (enforced by the Content-Security-Policy, `docs/deploy.md` section
11).

## 5. Logs

Vercel keeps request and function logs (retention depends on the plan). The application writes
operational messages only (no passwords or PINs; no signed URLs; CSP reports keep origin and path
without query strings; the orphan cleanup logs random object keys and counts). IP addresses appear in
Vercel's request logs and in `LoginAttempt` (above). Where to read them: `docs/runbook.md`.

## 6. Orders, tours, stops and driver texts (NUD-112)

### What is personal data here

| Field                                                                                 | Personal data?                                                                                                                                                                                                                                  | Decision                                                                               |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Order` (customer, date, status, source), `OrderItem`                                 | No. Customers are businesses; quantities and dates describe goods. (A sole trader's business name can identify a person, but that is master data of the `Customer`, which is kept while the customer is served, not part of the order history.) | Keep                                                                                   |
| `Order.createdById`, `Tour.driverId`, `StopMutation.driverId`                         | Indirectly: a user id that points to a staff or driver account. The name sits in `User`, which is deactivated, not erased (soft delete).                                                                                                        | Keep (accountability for quantities); erasing needs the account decision               |
| `Order.internalNote`                                                                  | **Possibly**: free text written by the office; may name a contact person.                                                                                                                                                                       | Keep; editable in the order form. Open question for the client below                   |
| `ParkingSpot.label`, `ParkingSpot.note`                                               | **Possibly**: free text written by the office (later by drivers); may name a contact person.                                                                                                                                                    | Keep with the customer; editable in the customer detail. Not copied into the audit log |
| `Customer.keyNumber`, `Customer.hasKey`                                               | No. A number on a key tag (max 20 characters) typed by the office or a driver; master data of the customer, kept with it (NUD-142). The audit entry `customer.key` holds the old and the new number.                                            | Keep; not in the retention jobs                                                        |
| `Tour`, `Stop` (sequence, times, quantities, `problemReason`, status, route geometry) | No. Enum values, ids, times, distances. No driver positions are stored (D19); the route is the planned road path.                                                                                                                               | Keep                                                                                   |
| `Stop.problemNote`                                                                    | **Yes, possibly**: free text typed by the driver, in his language and as German machine translation (DeepL); can contain a person's name or phone number.                                                                                       | **Scrub after 365 days** (implemented)                                                 |
| `AuditLog.diff` of `stop.problem` / order entries                                     | **Possibly**: a copy of the driver problem text and order notes, cut to 200 characters.                                                                                                                                                         | Deleted with the entry after 730 days (section 7); see the gap below                   |

**Conclusion.** Orders, tours and stops carry no personal data of their own beyond user ids and
the two free-text fields. Deleting them is **neither needed for data protection nor safe without a
client decision**: the office may need them for disputes about quantities and for accounting
questions, `backlog.md` section 4.3 forbids hard-deleting business data, and a stop that is missing
from a completed tour would falsify its history (counts, "13 of 13 delivered"). The app therefore
**never deletes orders, tours, stops or their statuses**, and there is no setting that does. The
deletion or anonymisation of whole old orders and tours (proposal in the earlier version of this
section: 3 years) stays an open question for the client (`backlog.md` section 10).

### Driver problem texts: 365 days (implemented)

`GET /api/cron/data-retention` runs daily at 03:47 UTC (`vercel.json`), bearer `CRON_SECRET`
(without a configured secret every call is answered with 401).

- It sets `Stop.problemNote` to empty for every stop **completed more than
  `DRIVER_TEXT_RETENTION_DAYS` days ago** (default **365**, whole days 30 to 3650; empty, invalid
  or out-of-range values fall back to 365, a value below 30 is refused by the code). Nothing else
  on the stop changes: `problemReason`, `status`, `completedAt`, quantities, the tour and the
  orders stay. The office sees such a stop with its reason and without a note, exactly like a
  stop where the driver wrote none.
- The whole text is removed at once: the driver's original, the German translation and the marker
  "translation pending". A text whose translation is still pending is removed too; the translation
  retry job then finds nothing to do, and a late save of a translation does not bring the text back
  (it only writes to a note that is still pending).
- **Default is `DATA_RETENTION_MODE=dry-run`**: the job only counts what it would remove and logs
  `[data-retention] {...}`. Set `DATA_RETENTION_MODE=delete` to remove (`off` does nothing at all).
  Anything else counts as `dry-run`. Removed texts cannot be recovered except from a database backup.
- At most 20 batches of 500 per run (10 000 texts); `more: true` in the answer means the backlog
  continues the next day. The job is idempotent.
- The response and the log line carry counts only (`expired`, `scrubbed`, `batches`, `more`), never
  a text. The run is not written to the audit log (it is a system job without a user, like the
  screenshot job; the exemption is explained in `src/server/audit-coverage.test.ts`).
- **The period is a proposal until the client confirms it**: 365 days because disputes about a
  delivery are raised within months, the structured reason remains afterwards, and a free text
  has no further use for the office. A different value is only the variable.

**Known gap (audit copy).** The audit entry of a problem report (`stop.problem`) contains the note
cut to 200 characters. It is not touched by this job and disappears with the audit retention
(730 days, section 7), i.e. up to a year after the stop's own text. If the client wants the text
gone at 365 days everywhere, the audit entry should stop storing the text (tracked as
NUD-121 in `backlog.md`); until then the audit period is the real upper limit for the text.

### Requests of people (access, rectification, erasure)

Handled by the operator by hand; steps in `docs/runbook.md` ("Access and erasure requests"):
customer and order notes are edited in the admin area, driver texts are scrubbed by the job or
earlier by hand, a user account is deactivated, photos and screenshots are removed in the bucket
and the database. Data in backups expires with the backups (section 3).

## 7. Audit log retention (NUD-092, NUD-111)

The audit log is **append-only**: the application has no update path and exactly one delete path
(a test scans the code), and a PostgreSQL trigger (`AuditLog_append_only`, function
`audit_log_append_only`) rejects `UPDATE` and `DELETE`. Entries contain ids, enum values, dates and
quantities; the only free text is order / problem notes cut to 200 characters, so a note can still
contain a name someone typed.

**Retention: 730 days (24 months)**, configurable with `AUDIT_RETENTION_DAYS` (whole days, 90 to
36500; empty, invalid or below the floor falls back to 730 so a typo can never delete history). The
period is a proposal until the client confirms it; change the variable, no code change needed.

How it is enforced (implemented in NUD-111, migration `20261018130000_audit_log_retention`):

- `GET /api/cron/audit-retention` runs daily at 03:37 UTC (`vercel.json`), bearer `CRON_SECRET`
  (without a configured secret every call is answered with 401).
- The job is the **only delete path**. It deletes in batches of 1000 rows (at most 20 batches =
  20 000 rows per run; a larger backlog is worked off over the following days), each batch in its
  own transaction that first sets the transaction-local switch `nudel.audit_retention = 'on'`.
- The trigger function honours the switch for `DELETE` only, and only for rows **older than 90
  days by the database clock**. Even code that lifts the switch cannot delete recent entries; the
  floor of 90 days is part of the function, not of the application. `UPDATE` is refused always.
  A plain `DELETE` without the switch fails as before.
- The response carries `retentionDays`, `cutoff`, `deleted`, `batches`, `more`, and one sanitized
  line `[audit-retention] {...}` goes to the function log (no entry content). The run is not written
  to the audit log: that entry would be one more row to delete later.
- Deleted entries cannot be recovered except from a database backup (`docs/runbook.md` sections 4
  and 5).

## 8. Technical protection (summary)

TLS only (HSTS), private storage bucket and short-lived signed URLs (`docs/deploy.md` section 11),
role checks on every server action and route handler (test matrix, `src/server/authz-matrix.test.ts`),
rate-limited login, hashed secrets, Content-Security-Policy and further security headers, origin
check on state-changing API routes, input size limits.
