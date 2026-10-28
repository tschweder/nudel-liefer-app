# Parking-spot import from `2026-10/` — plan and orchestrator prompt

## Facts found

- `2026-10/` holds 103 JPGs, nothing else: 52 `Screenshot_20261027_HHMMSS.jpg` (Google Maps, 1080x2400) and 51 `IMG_20261027_HHMMSS.jpg` (parking photos, 6-10 MB).
- 5 shots appear twice as `name.jpg` + `name(1).jpg` (identical byte size, same timestamp: 102121, 110644, 111423, 113805 for IMG and 102105, 111413, 113706 for Screenshot). Dedupe by hash.
- 52 screenshots vs 51 photos: one screenshot has no photo (or a photo is missing). Candidates: the close pairs `Screenshot_073400`/`073509`, `091546`/`091648`, and `IMG_063654`/`063712`, `073828`/`073831`.
- Each screenshot shows the pin coordinates as text in the search bar (e.g. `48.271953,16.446999`) plus street/POI names on the map. The filename timestamp is the capture time. A screenshot is taken ~15-90 s BEFORE its photo (e.g. `Screenshot_042238` -> `IMG_042253`).
- Data model: `Customer` (street, postalCode, city, lat/lng = Adresspunkt), `ParkingSpot` (customerId, lat, lng, label, note, sortOrder, createdById; max `PARKING_MAX_ACTIVE`), `Photo` (kind `STORE` | `PARKING`, one `isCurrent` per kind, storageKey `customers/<uuid>.jpg`).
- Existing building blocks: `src/server/parking-spots.ts` (office create, audit), `src/server/customer-photos.ts` (`attachCustomerPhoto`), `src/server/storage/` (`getStorage()`, S3 or Fake), `src/lib/uploads.ts` (long edge 1600 px, JPEG q 0.8, key pattern), `scripts/seed-test-customers.ts` (pattern for a Prisma CLI script with `createPrismaClient`).
- No exiftool, no Pillow, no sharp installed. Python 3.12 is available (`pip install pillow`), or use `exifr`/`sharp` via pnpm (dev dependency, ask first).

## Pipeline (deterministic where possible, subagents only for judgment)

### Phase 0 — Manifest (script, no AI)
`scripts/parking-import/build-manifest.py` -> `.parking-import/manifest.json`
- For every file: sha256, kind (screenshot/photo), EXIF DateTimeOriginal + GPS (photos usually have GPS), filename timestamp, file mtime, size.
- Drop hash duplicates (keep the name without `(1)`).
- Pair screenshot -> photo: sort by time, each photo takes the nearest earlier unused screenshot within 5 min; if the photo has EXIF GPS, cross-check against the screenshot coordinates (< 150 m). Report unpaired files and low-confidence pairs. Output ~48-52 pairs.

### Phase 1 — Customer snapshot (script)
`scripts/parking-import/export-customers.ts` -> `.parking-import/customers.json`: active customers with id, customerNumber, name, street, postalCode, city, lat, lng, existing active parkingSpots, current STORE/PARKING photos. Plus `address-groups.json`: customers grouped by normalized address (lowercase, accent-folded, `str.`->`strasse`, whitespace/house-number normalized, postal code). Customers in one group share the parking spot and photos.

### Phase 2 — Per-pair matching (one subagent per pair, orchestrator)
Each subagent gets one pair from the manifest and writes `.parking-import/results/<pairId>.json`:
1. Read the screenshot as an image; transcribe lat/lng from the search bar (6 decimals) and the street/POI labels visible. Sanity check: coordinates inside Austria/DE, same value format.
2. Compute haversine distance to every customer (Adresspunkt); take the top 5 within ~400 m. Prefer candidates whose street name appears on the map screenshot.
3. Read the parking photo: signs, house numbers, shop names, street plates. Confirm or reject each candidate.
4. Decide: `matched` (customerIds incl. all customers of the same address group), `ambiguous` (list candidates with reasons), or `no_match`. Never guess: ambiguity goes to the human review list.
5. Output: `{pairId, screenshot, photo, spot:{lat,lng}, customerIds[], addressGroup, distanceM, confidence, evidence[], status}`.

### Phase 3 — Storefront photos (separate, serial, optional)
Browser sessions are shared, so this is NOT parallel. One agent (or the user) per matched address group opens the address in Google Maps / Street View and saves a storefront image. Caveats to decide with the user:
- Scraping/screenshotting Google imagery is against Google's ToS for storage in an app. Cleaner: Street View Static API with a key (billed, still ToS-restricted for storing), or the user's own photos. Default: produce a `storefront-candidates/` folder for human approval, do NOT auto-attach.
- Skip groups that already have a current STORE photo.

### Phase 4 — Import script (code, I write after review)
`scripts/import-parking.ts` (pattern of `seed-test-customers.ts`), input = `results/*.json` with `status: matched` after human review.
- Dry-run by default, `--apply` to write; prints a table customer -> spot -> photo.
- Per customer in each group: create ParkingSpot via the existing service (actor = first ADMIN, `via: "office"`, label e.g. "Imported 2026-10") unless an active spot within 5 m exists; respect `PARKING_MAX_ACTIVE`.
- Photo: resize to long edge 1600, JPEG q80, upload with `getStorage()` under `customers/<uuid>.jpg`, then `attachCustomerPhoto(kind: PARKING)`. Upload once per group, one storage object per customer is fine if the schema requires unique keys (check `storageKey` uniqueness in `attachCustomerPhoto`).
- Idempotent (re-run safe): skip customers that already have the spot/photo with the same sha256 (log it in the audit diff).
- No DB deletes, soft state only. Writes go through audit (`recordAudit`).
- Test: integration test with Fake storage (see `parking-spots.integration.test.ts`).

### Phase 5 — Review report
`.parking-import/REPORT.md` / HTML: per pair thumbnail, screenshot crop, matched customers, distance, confidence; sections for ambiguous / unmatched / duplicate addresses. User approves before `--apply`.

## Decision: target is PRODUCTION
The 48 clients live in production; the user supplies DB and S3 access when needed. Consequences:
- Phases 0 and 2 need no DB access. Phase 1 needs a read-only connection (use `BACKUP_DATABASE_URL`-style read-only credentials if possible).
- Phase 4 `--apply` is the only write. Before it: take a DB backup (`scripts/backup`), run the dry-run against production, and get an explicit yes from the user. Credentials only via env vars, never committed or printed.
- Check bucket privacy (`scripts/check-storage-private.ts`) and that the import creates no more than one spot per customer.

## Decision: storefront photos (Phase 3)
Kept, candidates only. Images go to `.parking-import/storefront-candidates/` and appear in the review report. They are never uploaded or attached (kind STORE) without the user's per-group approval; the import script ignores that folder unless approved files are listed in an approvals file.

## Open questions for the user
1. ~~Target DB~~ answered: production.
2. Is the photo's `PARKING` kind right (not `STORE`)? Assumed yes.
3. Storefront images from Google: accept the ToS risk / API key, or skip Phase 3?
4. OK to add `pillow` (Python) or `sharp` (pnpm) for EXIF + resize?

## Orchestrator prompt (paste into a fresh session in this repo)

```
You are the orchestrator for importing parking spots + parking photos for ~48 customers
of the Nudel-Liefer app. Read AGENTS.md first, then
docs/parking-import/PLAN-AND-ORCHESTRATOR-PROMPT.md (the plan above is the spec).

Input: C:\Users\niko\Desktop\nudel-liefer-app\2026-10 (52 Google-Maps screenshots,
51 parking photos, some "(1)" duplicates). Work dir: .parking-import/ (git-ignored; add it to .gitignore).
Never modify files in 2026-10. Never write to the DB or storage until the user approves the review report.

Steps:
1. Phase 0: write and run scripts/parking-import/build-manifest.py (pip install pillow if the user agreed).
   Output manifest.json with hashes, EXIF time/GPS, filename time, deduped files and screenshot->photo pairs.
   Print unpaired files and low-confidence pairs; resolve the 52-vs-51 mismatch by looking at the images.
2. Phase 1: write and run scripts/parking-import/export-customers.ts (Prisma, like scripts/seed-test-customers.ts)
   -> customers.json and address-groups.json. Stop and ask the user which DB if DATABASE_URL looks ambiguous.
3. Phase 2: for EACH pair spawn one subagent (Agent tool, subagent_type "general-purpose", model sonnet),
   at most 8 in parallel. Give each: the pair entry, the path to customers.json + address-groups.json, and the
   per-pair procedure below. Each writes .parking-import/results/<pairId>.json and returns a one-line summary only.
   Per-pair procedure:
   a. Read the screenshot image; transcribe lat,lng from the search bar to 6 decimals; note visible street names.
   b. Haversine to all customers; candidates = nearest 5 within 400 m; prefer ones whose street is on the map.
   c. Read the parking photo; look for street signs, house numbers, shop names; confirm/reject candidates.
   d. If matched: include EVERY customer in the same normalized-address group (same address = same spot).
      If unsure: status "ambiguous" with candidates + reasons. If none: "no_match". Never guess.
   e. JSON: {pairId, screenshot, photo, spot:{lat,lng}, customerIds[], addressGroup, distanceM,
      confidence (0-1), evidence[], status}.
4. Collect results, check: no customer matched by two different pairs (flag conflicts), every spot within
   ~400 m of its customer(s), all customers with the same address share the same spot. Customers without a
   screenshot are listed as "still missing".
5. Build .parking-import/REPORT.html (thumbnails, coordinates, distance, confidence, groups, ambiguous/unmatched).
   Present it to the user and wait for approval/corrections.
6. Phase 3 (only if the user accepts the Google-imagery caveat): ONE agent, serially, per matched address group:
   open the address in Google Maps/Street View (built-in browser), save a storefront image to
   .parking-import/storefront-candidates/<group>.jpg. Skip groups with an existing STORE photo. Do not auto-attach.
7. Phase 4: write scripts/import-parking.ts (dry-run default, --apply), reuse src/server/parking-spots.ts,
   src/server/customer-photos.ts (attachCustomerPhoto), getStorage(); resize long edge 1600 / JPEG q0.8;
   idempotent; audited; with an integration test using Fake storage. Follow the Definition of Done in AGENTS.md
   (pnpm lint && pnpm typecheck && pnpm test). Run dry-run, show the table, then --apply only on explicit user yes.
Report faithfully: list what failed, what is ambiguous, what was skipped.
```
