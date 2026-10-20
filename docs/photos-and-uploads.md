# Photos and uploads

This module covers how images (customer photos and office screenshots) get from the client into
object storage and get attached to records. It is split into three layers:

- **`src/lib/uploads.ts`** and **`src/lib/upload-image.ts`** — shared constants, key-shape rules,
  and the browser-side pipeline (resize, re-encode, upload).
- **`src/server/uploads.ts`** plus **`src/app/api/uploads/route.ts`** — the `POST /api/uploads`
  endpoint that issues presigned PUT URLs.
- **`src/server/customer-photos.ts`** and **`src/server/driver-photos.ts`** — the server mutations
  that attach an uploaded object to a customer as its current photo of a kind.

The server always chooses the storage key. Callers never pass a storage key into `POST
/api/uploads`; they receive one back and later pass it to the attach mutation.

## Shared upload rules (`src/lib/uploads.ts`)

| Constant / type | Value / meaning |
| --- | --- |
| `ALLOWED_IMAGE_TYPES` | `image/jpeg`, `image/png`, `image/webp`, `image/heic` |
| `MAX_UPLOAD_BYTES` | 15 MiB hard server-side limit per object |
| `MAX_LONG_EDGE` | 1600 px, the longest stored image edge |
| `JPEG_QUALITY` | 0.8, used when re-encoding |
| `UPLOAD_PURPOSES` | `"customer-photo"`, `"screenshot"` |
| `uploadRequestSchema` | strict zod object for the grant request: `purpose`, `contentType`, `size` |

Helper functions:

- `isAllowedImageType(type)` — membership test for `ALLOWED_IMAGE_TYPES`.
- `extensionFor(type)` — maps an allowed type to `jpg` / `png` / `webp` / `heic`.
- `computeTargetSize(width, height, maxEdge = MAX_LONG_EDGE)` — scales down so the longest edge is
  at most `maxEdge`; never upscales.

### Storage key shapes

Keys the server issues are exactly one of two patterns; every mutation that attaches an uploaded
object must validate against them so a client cannot point a record at an arbitrary object (a
different prefix, `../`, a screenshot, an external URL):

- `CUSTOMER_PHOTO_KEY_PATTERN` / `isCustomerPhotoKey` — `customers/<uuid>.(jpg|png|webp|heic)`.
- `SCREENSHOT_KEY_PATTERN` / `isScreenshotKey` — `screenshots/<uuid>.(jpg|png|webp|heic)`.

## Creating an upload (`src/app/api/uploads/route.ts`, `src/server/uploads.ts`)

`src/app/api/uploads/route.ts` exports `POST`, which calls `handleCreateUpload(request, { requireRole,
storage: () => getStorage() })`. `handleCreateUpload` in `src/server/uploads.ts`:

1. Authenticates first via `deps.requireRole("ADMIN", "DRIVER")` so anonymous callers learn nothing
   about validation (401 → `UNAUTHENTICATED`, 403 → `FORBIDDEN`).
2. Rejects cross-origin requests (`rejectCrossOrigin`).
3. Reads the body as JSON, limited to `UPLOAD_REQUEST_MAX_BODY_BYTES` (2 KiB); too large → 413
   `TOO_LARGE_REQUEST`, bad JSON → 400 `INVALID_JSON`, shape mismatch → 400 `INVALID_REQUEST`.
4. Enforces `PURPOSE_ROLES` (per-purpose roles): `"customer-photo"` requires `ADMIN` or `DRIVER`,
   `"screenshot"` requires `ADMIN` only — otherwise 403 `FORBIDDEN`.
5. Rejects `UNSUPPORTED_CONTENT_TYPE` (400) for disallowed types and `TOO_LARGE` (413, with
   `maxBytes`) above `MAX_UPLOAD_BYTES`.
6. Builds the storage key as `KEY_PREFIX[purpose]/<uuid>.<ext>` (`customers/…` or `screenshots/…`),
   asks the `Storage` for a presigned URL via `createUploadUrl`, and returns an `UploadGrant`:
   `storageKey`, `uploadUrl`, `method` (`"PUT"`), `headers`, `expiresAt`.

The response is never cached (`Cache-Control: no-store`).

## Client pipeline (`src/lib/upload-image.ts`)

`uploadImage(file, options)` is the client entry point. It resizes, uploads, and resolves with
`{ storageKey, width, height, bytes }` — the storage key is what a caller persists. It maps HTTP
failures to typed `UploadError` codes: `UNAUTHENTICATED`, `FORBIDDEN`, `TOO_LARGE`,
`REQUEST_FAILED`, `UPLOAD_FAILED`, `ABORTED`, `NOT_AN_IMAGE`, `HEIC_UNSUPPORTED`,
`DECODE_FAILED`.

- `resizeImage(file, maxEdge = MAX_LONG_EDGE)` — decodes via `createImageBitmap` honouring EXIF
  orientation, scales so the longest edge is at most `MAX_LONG_EDGE`, and re-encodes as JPEG
  (quality 0.8), painting white under transparent areas. Re-encoding drops EXIF/GPS data. HEIC is
  decoded only where the browser supports it; elsewhere `isHeic` / `classifyDecodeFailure` throw
  `HEIC_UNSUPPORTED`.
- `requestUploadGrant(purpose, blob, signal)` — `POST /api/uploads` with the declared type and size.
- `putWithProgress(grant, blob, { onProgress, signal })` — PUTs the blob to the presigned URL using
  XHR (fetch has no upload progress), sending the grant headers unchanged and reporting 0..1.

`uploadImage` throws `TOO_LARGE` if the resized JPEG exceeds `MAX_UPLOAD_BYTES` or its type is no
longer allowed.

## Attaching a photo to a customer (`src/server/customer-photos.ts`)

`attachCustomerPhoto(db, storage, input)` is the shared core of "this object is now the customer's
current photo of `kind`", used by both the office and driver flows. Invariants it enforces:

- The object must exist in storage (`storage.head`); its byte size comes from the stored object,
  never from the client, and must be in `(0, MAX_UPLOAD_BYTES]`.
- Runs in one transaction under a `FOR UPDATE` row lock on the customer, so there is never more
  than one current photo per kind. A previous current photo of the same kind is kept with
  `isCurrent = false` (history, never hard-deleted).
- `storageKey` must match `isCustomerPhotoKey`; a key already used by any photo is `key_in_use`.
- Idempotency: with `clientMutationId`, a retry returns the first photo (`replayed: true`); a key
  that belongs to another user's photo is `mutation_conflict`. Both are checked under the lock.
- Writes an `auditLog` row (`photo.add` or `photo.replace`) with the kind, photo ids, and — when a
  driver took it — `via: "driver"`, `stopId`, `tourId`.

Result is `{ ok: true, photoId, replayed }` or one of `invalid | not_found | object_missing |
key_in_use | mutation_conflict`.

`addCustomerPhoto(db, storage, uploadedById, raw)` is the office wrapper: validates
`addCustomerPhotoSchema` (`customerId`, `kind`, `storageKey`, `width`, `height`) and calls
`attachCustomerPhoto`. Width/height come from the browser resize and are used only for layout; the
office sends no idempotency key.

`getCustomerPhotos(db, storage, rawCustomerId)` returns the current photo of each `PHOTO_KINDS`
kind (`STORE`, `PARKING`) as `CustomerPhotos` (kind → `CustomerPhotoView | null`), each with a
short-lived signed read URL via `storage.getReadUrl` (the bucket stays private) and the uploader's
display name and role.

## Driver photo registration (`src/server/driver-photos.ts`)

`registerDriverPhoto(db, actor, raw, deps, now)` registers a photo a driver took at a stop (NUD-083)
as the customer's current photo of that kind. The image is already in storage; this only attaches it.

- DRIVER only — any non-DRIVER role is answered `not_found`.
- `registerDriverPhotoSchema` is strict (unknown fields rejected): `clientMutationId` (uuid),
  `stopId`, `kind`, `storageKey` (must be `isCustomerPhotoKey`), `width`, `height`.
- The customer is never a parameter: it is derived from the stop, and the stop must belong to a
  tour assigned to the acting driver. A foreign or unknown stop is `not_found` (same answer for
  both, so nothing leaks).
- The tour must be released (`PHOTO_TOUR_STATUSES`) and its day must be today or yesterday in the
  factory time zone (`isPhotoTourDayAllowed`), for the offline queue; otherwise `tour_not_active`.
  A retry is answered even once the tour has closed, because it was accepted once.
- Idempotent by `clientMutationId` (unique on `Photo`), under the customer row lock — concurrent
  retries cannot create two photos.
- Reuses `attachCustomerPhoto`; any of its failures are returned as a `PhotoRegisterError`.
- On success returns `applied` (or `replayed`) with the photo id, kind, customer id, and a signed
  read URL with `DRIVER_PHOTO_URL_TTL_SECONDS` lifetime.

`driverPhotoResponse(request, now)` is the `POST /api/driver/photos` handler. `requireRole("DRIVER")`
comes first (anonymous → 401, other roles → 403); then cross-origin rejection, a JSON content-type
check (415 otherwise), a body limited to `PHOTO_REGISTER_MAX_BODY_BYTES` (8 KiB, 413 if over), and
strict JSON parsing (400 `invalid`). Business rejections still return HTTP 200, like the status
sync; responses are never cached.
