---
covers:
- src/server/driver-*.ts
- src/server/stop-*.ts
- src/domain/driver-*.ts
- src/domain/stop-status.ts
- src/lib/driver-tour-model.ts
stamp: a7f4a01beaec37e4499397c60a866d6d12d381851c3a67873a2f84f9d0bad85b
status: fresh
stale_since: null
---
# Driver tour

The driver tour module is the driver-facing half of tour execution: it serves the driver's "today"
tour to the device (for the online page and the offline copy), applies the status changes the
driver makes at stops (delivered / problem / undo, online or in a queued batch), attaches photos the
driver took at a stop, and stores the driver's own language choice. It sits on the same shared
data model (`src/lib/driver-tour-model.ts`) that the page and the offline shell both render.

## Shared driver data model — `src/lib/driver-tour-model.ts`

This is the one payload of the driver screens (NUD-081): `GET /api/driver/tour/today` returns a
`DriverTourResponse` and the browser keeps exactly that JSON in IndexedDB.

- `DRIVER_TOUR_SCHEMA_VERSION` (`1`): the payload version; responses carry it in `schemaVersion`.
- Zod schemas + inferred types: `payloadPhotoSchema`/`PayloadPhoto`, `payloadItemSchema`,
  `payloadStopSchema`/`PayloadStop`, `driverTourSchema`/`DriverTourData`,
  `driverTourResponseSchema`/`DriverTourResponse`.
- `dayInTimezone(now, timeZone)` → `YYYY-MM-DD` of `now` in the factory IANA time zone ("today").
- Pure view functions derived from a `DriverTourResponse`: `toDriverToday(response, locale)`
  (list screen model `DriverToday`, `null` when there is no tour), `toDriverStopDetail(response,
  stopId, locale, photoUrl?)` (stop detail model `DriverStopDetail`, `null` when the stop is not in
  the tour; `photoUrl` maps a `PayloadPhoto` to the URL the `<img>` loads — the signed storage URL
  online, a same-origin cache URL offline), and `tourPhotos(response)` (every photo once, the set
  to prefetch).
- Language-dependent texts (product names, notes) travel as `LocalizedText` in all four locales
  and are picked per viewer locale (`pickWithSource`). Customer names, addresses and postal codes
  are never translated.

## Pure domain rules — `src/domain/stop-status.ts` and `src/domain/driver-*.ts`

These modules import nothing (no zod, no framework); they are the contract shared by the server,
the page and the service worker.

- `src/domain/stop-status.ts` (NUD-053): `PROBLEM_REASONS` (7 codes), `UNDO_WINDOW_MS` (5 minutes),
  `PROBLEM_NOTE_MAX` (500), `undoDeadline(completedAt)`, `isWithinUndoWindow(completedAt, now)`,
  and `nextPendingAfter(stops, currentId)` (next PENDING stop in tour order, wrapping around).
- `src/domain/driver-stop.ts` (NUD-052): `neighbourStops(stops, stopId)` (1-based position,
  previous/next stop in tour order) and `formatAddress`.
- `src/domain/driver-today.ts` (NUD-051): `UNIT_ORDER`, `nextPendingStop`, `progressOf`,
  `summarizeItems` (distinct products + one total per unit, units never summed across),
  `remainingSeconds` (driving legs + service time for open stops, no way back to the depot),
  `roundedMinutes` (5-minute steps) and `isUnseenChange` (change with `changedInRevision > seenRevision`).
- `src/domain/driver-sync.ts` (NUD-082): `SYNC_MAX_ENTRIES` (50), `SYNC_MAX_BODY_BYTES` (256 KiB),
  `SYNC_MAX_AGE_MS` (24 h), `effectiveMutationTime(createdAt, now)` (the tap time clamped to
  `[now - 24h, now]`), the `SyncEntry` / `SyncResponse` / `SyncTourState` types and the structural
  guard `parseSyncResponse` (`null` for malformed answers).
- `src/domain/driver-photo.ts` (NUD-083): `DRIVER_PHOTO_KINDS` (`STORE`, `PARKING`),
  `PHOTO_REGISTER_MAX_BODY_BYTES` (8 KiB), `PHOTO_TOUR_STATUSES` (`RELEASED`, `IN_PROGRESS`,
  `COMPLETED`), `previousDay`, `isPhotoTourDayAllowed(tourDay, today)`, the `PhotoRegisterRequest` /
  `PhotoRegisterResponse` / `PhotoRegisterError` types, `FINAL_PHOTO_ERRORS` (all errors except
  `object_missing` are final) and the guard `parsePhotoRegisterResponse`.

## Server

### Tour payload and screen queries

- `src/server/driver-tour-payload.ts`: `DRIVER_PHOTO_URL_TTL_SECONDS` (12 h, the validity of the
  signed photo URLs) and `getDriverTourResponse(db, actor, options)` — builds the `DriverTourResponse`.
  Only an actual `DRIVER` gets a tour (`tour: null` otherwise, so an admin in the support view sees
  none). The driver id is always the authenticated actor, never a request parameter. Quantities are
  the released snapshot from `getDriverTour` (see `server/tour-driver.ts`, NUD-043). Customers come
  from `customer`, the newest current photo per customer and kind from `photo` (signed URLs only
  when `options.photos.storage` is given; `onlyStopId` limits them to one stop's customer).
- `src/server/driver-tour-api.ts`: `driverTourTodayResponse(now)` — `GET /api/driver/tour/today`.
  `requireRole("DRIVER")` first; the answer is personal data and is never cached (`Cache-Control:
  private, no-store`).
- `src/server/driver-today.ts`: `todayInTimezone`, `getDriverToday` and the page query
  `driverTodayQuery(locale)` (allows `requireRole("ADMIN", "DRIVER")`; timezone and
  `serviceMinutesPerStop` come from `getSettings`, defaulting to `Europe/Vienna` / 10).
- `src/server/driver-stop.ts`: `getDriverStopDetail` (the stop detail derived from the same tour
  payload, with photos limited to that stop) and the page query `driverStopQuery(locale, stopId)`.
  A stop that is not in the actor's own released tour of today yields `null` — same answer for a
  foreign stop, another day or an unreleased tour.

### Stop status — `src/server/stop-status.ts`, `src/server/stop-status-actions.ts`

`applyStopMutation(db, actor, rawInput, now, options)` applies one "delivered", "problem" (reason +
optional note) or "undo" mutation (NUD-053). `stopStatusAction` (a server action) calls it after
`requireRole("DRIVER")`, schedules the German translation of a free-text problem note, and
revalidates the router cache. The batch sync (`POST /api/driver/sync`) calls `applyStopMutation`
once per queued entry. Rules:

- The stop must belong to a `RELEASED` / `IN_PROGRESS` tour assigned to the acting driver, else
  `not_found` — the identical answer for foreign and unknown stops. Not limited to today, so a
  queued mutation that syncs after midnight still lands.
- Everything runs in one transaction behind the per-date advisory lock `tour:<YYYY-MM-DD>` that
  release and re-release also use; tour status follows via `syncTourProgress`.
- Idempotent by `clientMutationId` (unique, recorded as a `StopMutation` row in the same
  transaction): an accepted id replayed returns the stored result with `replayed: true`; the same
  id used for a different stop / driver / kind is `mutation_conflict`. Rejected mutations are not
  recorded.
- Undo is allowed for 5 minutes after completion (server clock, `isWithinUndoWindow`). A
  `COMPLETED` tour is final (`tour_completed`); the tour never moves back from `IN_PROGRESS`.
- Offline queue (NUD-082): pass `options.clientCreatedAt` = the moment of the tap on the device.
  Then a stop the office changed (`adminChangedAt`) after that moment is not changed —
  `changed_by_office`, server state wins.
- Each accepted mutation writes an `AuditLog` entry (`stop.delivered`, `stop.problem` or
  `stop.undo`) with `via: "online" | "sync"` in the same transaction.

### Offline sync — `src/server/driver-sync.ts`

`driverSyncResponse(request, now)` — `POST /api/driver/sync` (NUD-082). `requireRole("DRIVER")`,
strict zod body (`1..50` entries, ≤ 256 KiB), never cached. `applySyncBatch` sorts entries by
effective tap time (then request order), applies each through `applyStopMutation`, and answers with
one `SyncEntryResult` per entry (`applied` / `replayed` / `rejected` / `retry`) plus the
authoritative state of every stop of the touched tours from `touchedTours`. A business rejection
does not stop the batch; an unexpected error marks that entry (and later entries for the same stop,
to preserve order) `retry` and the batch continues.

### Driver photos — `src/server/driver-photos.ts`

`driverPhotoResponse(request, now)` — `POST /api/driver/photos` (NUD-083). `requireRole("DRIVER")`,
strict zod body (`registerDriverPhotoSchema`, ≤ 8 KiB), never cached, HTTP 200 also for business
rejections. The image itself is already in storage (presigned PUT via `POST /api/uploads`); this
endpoint only attaches it as the customer's current photo of that kind through the shared
`attachCustomerPhoto` (same as the office flow). Checks: the stop belongs to the driver's own
released tour whose day is today or yesterday in the factory time zone (`isPhotoTourDayAllowed`,
decided by `deps.timezone` from `getFactoryTimezone`), the `storageKey` matches
`isCustomerPhotoKey`, and the object exists. Idempotent by `clientMutationId` under the customer
row lock (`replayed` on retry). A successful answer carries a signed read URL valid for 12 h.

### Locale choice — `src/server/driver-locale.ts`, `src/server/driver-locale-actions.ts`

`chooseDriverLocaleAction(locale)` (server action, `requireRole("DRIVER")` first) calls
`chooseDriverLocale(db, userId, input)`, which validates the locale, writes `User.locale` +
`localeChosen = true`, then sets the `LOCALE_COOKIE` (1 year) and redirects to `/{chosen}/driver`.

## Database and storage footprint

Reads: `tour`, `stop`, `customer`, `product` (through the tour payload), `photo`, `stopMutation`,
`settings`. Writes: `user.locale`/`localeChosen`, `stop.status`/`completedAt`/`problemReason`,
tour status via `syncTourProgress`, a `StopMutation` row per accepted mutation, `Photo`/`AuditLog`
via `attachCustomerPhoto` / `recordAudit`. Object storage: photo objects (written elsewhere), read
via signed URLs valid 12 h.

## Rules a caller must respect

- The driver's identity always comes from the authenticated session (`requireRole`), never from a
  request parameter; anonymous → 401, other roles → 403.
- Never distinguish a foreign stop from an unknown one: both answer `not_found`.
- Treat `replayed` (idempotent retry) as success everywhere; the id is the idempotency key and is
  unique per accepted mutation.
- Do not apply a stop mutation for a `COMPLETED` tour and do not move a tour back from
  `IN_PROGRESS`.
- Deliver tour/sync/photo responses with `Cache-Control: private, no-store`: they are personal
  data and must not be cached by browsers, proxies or the service worker.
