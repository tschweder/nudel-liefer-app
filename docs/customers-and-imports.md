---
covers:
- src/server/customer*.ts
- src/server/customers.ts
- src/server/import-xlsx.ts
- src/server/geocode-actions.ts
- src/domain/customer*.ts
- src/domain/import-file.ts
- src/lib/customer-list-params.ts
stamp: dd72570c4a7975a6316241e8fb731c5fcaa3c12b1baa56978be18cc61f5ea038
status: fresh
stale_since: null
---
# Customers and imports

This module covers the customer master data: reading and writing customers, the
office actions and queries around them (photos, notes, pins, geocoding), and the
one-shot customer import from a CSV or XLSX file. All of it is admin-only; every
entry point re-checks the caller's role against the database before reading any
input.

## Files

| Area | Files |
| --- | --- |
| Server actions & queries | `src/server/customer-actions.ts`, `customer-queries.ts`, `customer-admin.ts`, `customer-notes.ts`, `customer-photos.ts`, `customer-pins.ts`, `customers.ts` |
| Import | `src/server/customer-import.ts`, `customer-import-actions.ts`, `customer-import-upload.ts`, `import-xlsx.ts` |
| Geocoding | `src/server/geocode-actions.ts`, `customer-pins.ts` (geocoding half) |
| Pure domain rules | `src/domain/customer.ts`, `customer-import.ts`, `import-file.ts` |
| List URL parsing | `src/lib/customer-list-params.ts` |

## Customer master data (`customer-admin.ts`, `customer-actions.ts`)

`customer-admin.ts` holds the role-unchecked database functions;
`customer-actions.ts` is the `"use server"` layer that calls `requireRole("ADMIN")`
first and then delegates with `getDb()`.

- `createCustomer(db, rawInput)` and `updateCustomer(db, id, rawInput)` validate
  with `customerInputSchema`. The customer number is unique, compared
  case-insensitively (`number_taken` on a hit or a `P2002` unique violation). A
  customer is never deleted: `setCustomerActive` only toggles `active` (archive /
  reactivate).
- Address point rules (NUD-141, D22): `lat` and `lng` come as a pair or both `null`; there is no
  confirmation step (`Customer.pinConfirmed` is unused and kept only so no migration drops data).
  When the address is new or changed and the admin did not move the point, `createCustomer` /
  `updateCustomer` geocode it (best effort via `customer-geocode.ts`; a geocoder failure never
  blocks the save). Tours and navigation use the default Parkplatz (`routingPoint`).
- Notes are stored as `LocalizedText` JSON (German source, Chinese translations);
  `prepareNotes` translates on save, see below.
- Reads: `getCustomerDetail` (one customer plus whether a current STORE / PARKING
  photo exists), `nextCustomerNumber` (prefill suggestion), and
  `listUpcomingOrders` (orders from today in the factory time zone, cancelled
  excluded, newest 20).
- `customer-queries.ts` wraps the reads as admin-only queries; each one calls
  `requireRole("ADMIN")` first.

## Customer list (`customers.ts`, `src/lib/customer-list-params.ts`)

`listCustomers(db, rawInput)` returns one page of 25 rows by default
(`customerListInputSchema`, up to `pageSize` 100). Filters: free text `q` (every
whitespace-separated term must match number, name, street, postal code or city),
`status` (`active` / `archived` / `all`), `photosMissing` (no current STORE or
PARKING photo), `pinUnconfirmed`. Search is accent-insensitive: both the row and
the term go through the SQL function `nudel_fold`, and the row side uses the
trigger-maintained `Customer.searchText` column (decision log NUD-013) — plain
PostgreSQL, no extension. `escapeLike` escapes `\`, `%` and `_` so input matches
literally. `listCustomers` does no authorization itself; callers go through
`customer-queries.ts`.

`parseCustomerListParams` / `customerListQuery` map between URL search params and
`CustomerListInput`: `status` accepts `archived` / `all` (anything else is
`active`), `photos=missing` and `parking=missing` (customers without an active Parkplatz), and `page` is clamped to
1..100000. The list input type comes from `customers.ts`.

## Customer photos (`customer-photos.ts`, `customer-actions.ts`)

`addCustomerPhoto` (admin, via `addCustomerPhotoAction`) attaches an already
uploaded object as the customer's current STORE or PARKING photo. The shared core
is `attachCustomerPhoto`, also used by the driver capture path. Rules:

- `storageKey` must be a key the upload endpoint issued (`isCustomerPhotoKey`,
  `customers/<uuid>.<ext>`); the object must exist in storage (`head`) and its
  byte size is read from storage, never from the client. Width/height are
  browser-measured and only used for layout.
- The swap runs in one transaction under a row lock on the customer
  (`SELECT ... FOR UPDATE`): the previous current photo of the same kind is set to
  `isCurrent=false` (kept as history, never hard-deleted), so there is never more
  than one current photo per kind. An `auditLog` row records `photo.add` /
  `photo.replace`.
- `clientMutationId` gives idempotency for the driver capture (NUD-083): a second
  call with the same key replays the first photo; a key already used by another
  user is `mutation_conflict`.
- `getCustomerPhotos` returns the current photo per kind with a signed, short-lived
  read URL (bucket stays private) and the uploader's name/role.

## Customer notes (`customer-notes.ts`, `customer-actions.ts`)

Notes are German source plus four translated versions (`en`, `sr-Latn`, `cs`,
`zh-Hans`) stored as `LocalizedText` on the customer row; the pure merge rules
live in `src/domain/note-translations.ts` (not covered here). `freshTranslations`
translates German into the four languages in parallel; a language the provider
cannot do (Serbian before NUD-150) is simply missing, a total failure returns `null`
and the text is never logged.

- `prepareNotes` is used by the customer form: unchanged German keeps the stored
  JSON; changed German re-translates only the machine versions (hand-written ones
  kept and flagged); no stored note produces a fresh `localize()`.
- `prepareNotesWithoutTranslation` is used by the import (hundreds of notes, no
  translator calls): new/changed German is stored with
  `meta.pendingTranslation = true` and the retry job translates it later.
- `saveNoteTranslations` (admin) writes the "Translations" tab. It is guarded by a
  version token (`meta.updatedAt`): the client sends `baseUpdatedAt` and the write
  only succeeds if nobody changed the note since (compare-and-set on
  `meta.updatedAt`, otherwise `conflict`).
- `retranslateNote` overwrites all three Chinese versions with a fresh machine
  translation; nothing is changed if the provider fails.

## Address points, geocoding and the Parkplatz queue (`customer-pins.ts`, `customer-import-actions.ts`, `geocode-actions.ts`)

- `listCustomerIdsWithoutPin` — active customers with no address point (the geocoding work
  list, max `PIN_LIST_LIMIT` 2000). The import wizard starts it by itself after an import.
- `geocodeCustomers(db, geocoder, ids)` — one batch of at most
  `GEOCODE_BATCH_MAX` (5) customers, one geocoder call at a time with a pause
  between calls (`geocodeDelayMs`: `GEOCODE_BATCH_DELAY_MS` wins, otherwise 700 ms
  with a real provider when `ORS_API_KEY` is set, none for the Fake). The best
  hit is stored as the customer's address point (no confirmation); only
  active customers without a point are touched (a point set in the meantime wins). Stops at the first rate limit (429/403) or after three
  failures in a row. Logs a summary, never addresses.
- Parkplatz queue: `listParkingQueue` / `countParkingQueue` return active customers without an
  active Parkplatz (page `/admin/customers/parking`, dashboard to-do). The queue saves a spot with
  `createParkingSpotAction` (audited, becomes the default); "skip" keeps the customer in the queue.
- `geocode-actions.ts`: `geocodeAddressAction` is the admin-only "locate address"
  button of the pin picker, one address to candidate coordinates.

`customer-import-actions.ts` exposes the above as admin-only actions, with
`geocodeCustomersAction` called by the browser in a loop over batches.

## Import from CSV / XLSX

The flow (NUD-090): the browser uploads a file to `POST /api/admin/customers/import/parse`
(`handleParseUpload`, `customer-import-upload.ts`), which parses it server-side
and returns a text table plus a suggested column mapping. The browser then sends
the mapped rows to `previewImport` (dry run) and `commitImport` (writes). Nothing
from the upload is stored; the server re-validates the rows at commit time.

- Limits (`IMPORT_LIMITS`, `src/domain/import-file.ts`): file ≤ 5 MB, ≤ 2000 data
  rows, ≤ 50 columns, ≤ 2000 chars per cell. `readLimited` enforces the file size
  while reading the multipart body (with a 64 KiB framing allowance).
- `parseImportFile` detects CSV vs XLSX by content first (`detectFileKind`, zip
  signature), then extension; `.xls` and mislabeled files are refused. CSV is
  decoded (`decodeText`: UTF-8 with BOM stripped, UTF-16 BOM, else
  windows-1252) and parsed by a small RFC 4180 parser (`parseCsv`); XLSX goes
  through `inspectZip` (zip-bomb check on the directory: entry count and declared
  uncompressed sizes, ZIP64 and encrypted archives refused) and then
  `readXlsx` (`src/server/import-xlsx.ts`), which reads the first non-empty sheet
  as text — numbers keep their zero padding (`00000`-style formats), formulas give
  their cached result, dates become `YYYY-MM-DD`. Errors map to HTTP statuses via
  `ImportFileError` (`too_large` 413, `unsupported_type` 415, `empty` and the
  other parse errors 422).
- Mapping (`src/domain/customer-import.ts`): `suggestMapping` proposes a column
  mapping from the remembered mapping first, then well-known German / English /
  Chinese header synonyms (`normalizeHeader` folds accents, `ß→ss`, letters and
  digits only); a column feeds at most one field. `checkMapping` flags missing
  required fields and duplicate columns. `buildRecords` turns mapped rows into
  `ImportRecord`s, dropping rows with no text.
- Row planning (`planImport`): each row is cleaned (invisible control characters
  removed via `looksLikeFormula` guard against CSV injection, country default
  `AT`, postal code zero-padded) and becomes `create`, `update`, `unchanged` or
  `error`, matched to existing customers by customer number case-insensitively.
- Customer lists without numbers (NUD-136, the factory's own `Kunden.xlsx`): the
  number is optional. A row without one is matched by name (case- and
  whitespace-insensitive; a name two stored customers share is `name_ambiguous`,
  a name twice in the file `duplicate_in_file`); an unknown name is created with
  the next free number after every number in the database and the file
  (`number_assigned` warning). Optional columns: `houseNumber` (appended to the
  street), `companyName`, `vatId` (spaces removed, upper case) and
  `deliveryAddress`. A delivery address cell becomes the routed address
  (`parseDeliveryAddress`: the last 4-digit postal code, 5 for DE/FR/IT/ES/FI,
  followed by the city at the end) and the address columns are stored as the
  billing address (`delivery_address_used`); without a postal code in the cell,
  postal code and city of the billing address are used and the row is flagged
  `delivery_postal_assumed` for the office to check.
  A file whose only name column is "Firma"/"Company" keeps using it as the name.
- `previewImport` (dry run, writes nothing) returns per-row plans and a
  `summarizePlan` summary.
- `commitImport` writes the valid rows in one request: creates unknown customers
  (the address point is looked up afterwards) and updates known ones. Invalid rows are skipped and
  reported; one failing row never stops the others. An update is refused
  (`changed_meanwhile`) when the customer was edited after the import started, and
  an address change drops the stored address point so it is looked up again (NUD-014). Customers are
  never deleted or reactivated. The result reports created / updated / unchanged /
  failed counts plus `withoutPin` (no address point) and `withoutParking` (no Parkplatz) counts for the next workflow
  steps.

## Authorization

Every action and query in this module calls `requireRole("ADMIN")` before reading
its input (the admin actions also check the role before the body is read). The
`"use server"` files — `customer-actions.ts`, `customer-queries.ts`,
`customer-import-actions.ts`, `geocode-actions.ts` — are the only authorized entry
points; the `customer-admin.ts`, `customer-notes.ts`, `customer-photos.ts`,
`customer-pins.ts`, `customers.ts` and `customer-import.ts` functions assume the
caller has checked the role, and `customer-import-upload.ts` checks it itself
inside `handleParseUpload`.
