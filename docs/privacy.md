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

To confirm: Vercel and Cloudflare are US companies. Data stays in the EU regions above, but a
data processing agreement with the standard contractual clauses (or the EU-US Data Privacy Framework
certification) is needed with each provider. Neon, Vercel, Cloudflare, OpenRouteService, DeepL and
the tile provider are processors of the operator.

## 2. What is stored

| Data                                  | Where (table / bucket)                         | Personal data in it                                                                                                                                 | Retention                                                                                  |
| ------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Staff and driver accounts             | `User`                                         | Display name, e-mail (admins) or user name (drivers), language, last login time, **bcrypt hash** of password / PIN (never the PIN itself)           | Until the operator removes the account; accounts are deactivated (soft delete), not erased |
| Customers (businesses)                | `Customer`                                     | Business name, delivery address, map pin, delivery hours, a driver note that may name a contact person                                              | Until archived; archived customers are kept (soft delete)                                  |
| Photos of shop entrance and parking   | `Photo` + bucket `customers/<uuid>.jpg`        | Images taken on the street; may show passers-by, vehicle registration plates or staff. Uploader (user id)                                           | Kept while the customer is served; replaced photos stay as history                         |
| Order screenshots (WhatsApp / WeChat) | `Screenshot` + bucket `screenshots/<uuid>.jpg` | Chat content: names, phone numbers, messages. Uploader (user id). `extraction` stays empty until NUD-100                                            | **180 days** (configurable), then deleted automatically (section 3)                        |
| Orders and order lines                | `Order`, `OrderItem`                           | Customer reference, quantities, delivery date, internal note (free text)                                                                            | No automatic deletion in v1 (section 6)                                                    |
| Tours, stops, delivery status         | `Tour`, `Stop`, `StopOrder`, `StopMutation`    | Assigned driver, completion times, problem reason, **driver problem text** (free text, in the driver's language and machine-translated into German) | No automatic deletion in v1 (section 6)                                                    |
| Audit log                             | `AuditLog`                                     | Actor id, entity ids, quantities, dates, order / problem notes **cut to 200 characters**; no names                                                  | See section 7                                                                              |
| Failed-login counters                 | `LoginAttempt`                                 | User name or e-mail that was typed and the **IP address** of the failed attempt                                                                     | 15 minute rolling window; rows older than 24 h are deleted daily (section 3)               |
| Offline copy on the driver's phone    | Browser IndexedDB and Cache Storage            | Today's tour: customer names, addresses, notes, photos, queued status taps and photos                                                               | Replaced on every sync; removed at the login page; other days are never shown              |
| Cookies                               | Browser                                        | `authjs.session-token` (signed session, HttpOnly, SameSite=Lax, Secure on https; 12 h admin, 90 days driver), `NEXT_LOCALE` (language, 1 year)      | Strictly necessary; no analytics, advertising or tracking cookies                          |

**Not collected:** driver GPS positions or tracking (decision D19), prices, payment data, delivery
signatures or proof photos (D11), analytics or advertising identifiers.

Pins on the map are the coordinates of a customer's business address entered by the office, not the
position of a person.

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

### What the operator must configure

`CRON_SECRET` (required, otherwise the retention job and the translation job never run),
optionally `SCREENSHOT_RETENTION_DAYS`. See `docs/env.md`.

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
- **Sentry** (NUD-094, optional, not yet installed): when added it must run in the EU region, with
  personal data scrubbing, and be listed here.

The browser never loads scripts, fonts or images from third-party sites other than the configured
tile server and the storage host (enforced by the Content-Security-Policy, `docs/deploy.md` section
11).

## 5. Logs

Vercel keeps request and function logs (retention depends on the plan). The application writes
operational messages only (no passwords or PINs; no signed URLs; CSP reports keep origin and path
without query strings). IP addresses appear in Vercel's request logs and in `LoginAttempt` (above).

## 6. Orders, tours and stops: open decision

v1 has **no automatic deletion** of orders, tours, stops and driver problem texts. Business reasons
to keep them (disputes about quantities, history for the office) have to be weighed against data
minimisation. Proposal for the operator to confirm: keep delivered tours and orders for 3 years, or
as long as retention duties of the operator require, then delete or anonymise driver problem texts.
Tracked as NUD-112 in `backlog.md`.

Requests of people about their data (access, rectification, erasure) are handled by the operator
by hand today: customer notes and internal notes can be edited in the admin area; a user account can
be deactivated; erasing a person from photos or screenshots means deleting the object and row (for
screenshots the retention job does it by itself after 180 days).

## 7. Audit log retention (NUD-092)

The audit log is **append-only**: the application has no update or delete path (a test scans the
code) and a PostgreSQL trigger (`AuditLog_append_only`, migration `20261018120000_audit_log`)
rejects `UPDATE` and `DELETE`. Entries contain ids, enum values, dates and quantities; the only free
text is order / problem notes cut to 200 characters, so a note can still contain a name someone typed.

Proposed retention: **24 months**, then deletion of older entries. This is **not implemented**:
a retention job is the one legitimate delete path and would have to lift the trigger deliberately
for its own transaction. The intended design, kept out of v1 on purpose so that nobody can delete
history by accident:

1. a separate cron route (`/api/cron/audit-retention`, `CRON_SECRET`) that runs
   `DELETE FROM "AuditLog" WHERE "createdAt" < now() - interval '24 months'` in a transaction that
   first disables the trigger only for that transaction (`ALTER TABLE ... DISABLE TRIGGER` needs
   table ownership; alternatively replace the trigger function by one that allows the delete when
   `current_setting('app.audit_retention', true) = 'on'` and set it with `SET LOCAL`);
2. a test that proves ordinary `DELETE` still fails and the job still works;
3. an entry in the job's response (count) and the function log.

Until then audit entries stay indefinitely. The operator decides the period; NUD-111 in `backlog.md`
carries the design above.

## 8. Technical protection (summary)

TLS only (HSTS), private storage bucket and short-lived signed URLs (`docs/deploy.md` section 11),
role checks on every server action and route handler (test matrix, `src/server/authz-matrix.test.ts`),
rate-limited login, hashed secrets, Content-Security-Policy and further security headers, origin
check on state-changing API routes, input size limits.
