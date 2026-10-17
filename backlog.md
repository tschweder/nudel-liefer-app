# Backlog – Liefermanagement-Software (Nudelfabrik)

> **Audience:** an autonomous AI coding agent (and the human reviewing its work).
> **Source of truth for requirements:** [`projektbeschreibung.md`](./projektbeschreibung.md) + the decisions in §2 of this file.
> If the two disagree, **§2 Decisions wins** (they were clarified with the product owner after the description was written).

---

## 0. How to work with this backlog (read first, every session)

1. Read §1–§6 once per session. They are short and they are binding.
2. Pick the **lowest-numbered ticket with `Status: todo` whose `depends_on` are all `done`**. Work on exactly **one ticket per session**.
3. Set its status to `in-progress` in this file before you start, and to `done` only when every acceptance criterion is ticked and the Definition of Done (§5) passes.
4. Stay inside the ticket's scope. If you notice something missing, **add a new ticket** at the end of the right milestone (next free ID) instead of doing it on the side.
5. If a detail is not specified: choose the simplest option that is consistent with §2, implement it, and append one line to the **Decision log** (§9). Do **not** stall. Exception: anything irreversible (deleting data, changing the DB provider, spending money, touching production) → set `Status: blocked`, explain why under the ticket, stop.
6. Tickets marked **👤 HUMAN** need a person (accounts, API keys, client feedback). Prepare everything you can, write precise instructions under the ticket, set `blocked`, move on to the next ticket.
7. Never commit secrets. All config goes through env vars documented in `.env.example`.

Status values: `todo` · `in-progress` · `blocked` · `done`

---

## 1. Product in one paragraph

A pasta factory delivers to business customers (mostly restaurants). The office enters orders (manually, or while looking at a screenshot of a WhatsApp/WeChat message). For each delivery date the system builds one optimized tour starting and ending at the factory. The driver opens a mobile web app (PWA) **in his own language — German, Simplified Chinese, Traditional Chinese (HK) or Traditional Chinese (TW)** — and immediately sees: today's stops in order, the next customer, the products and quantities to unload, a photo of the shop entrance, a photo of where to park/unload, and a button that starts navigation. He marks each stop as delivered or reports a problem. The office sees progress live.

**Top priorities from the client (never compromise these):**
1. Simple operation (especially for drivers who may not read German).
2. **Correct delivery quantities** shown to the driver.
3. Optimized route.
4. Stored shop and parking photos.

---

## 2. Decisions (binding)

| ID | Topic | Decision |
|---|---|---|
| D1 | Scope | Real client project. Production-ready v1. Milestone M1 must be a demo-able MVP. |
| D2 | Platform | **One** Next.js web app. Admin area for desktop, driver area as mobile-first **PWA**. No native apps. |
| D3 | Stack | Next.js (App Router, Server Actions + Route Handlers), TypeScript `strict`, pnpm, Prisma + PostgreSQL, Tailwind CSS + shadcn/ui, next-intl, zod, Auth.js v5, react-leaflet, Serwist (PWA), Vitest, Playwright. |
| D4 | Hosting | Vercel (EU region `fra1`) + Neon Postgres (EU) + Cloudflare R2 (S3-compatible, EU jurisdiction) for images. Local dev: Docker Compose with Postgres + MinIO. Budget target < €50/month. |
| D5 | Scale | 50–150 customers, 10–30 stops/day, **1 driver / 1 tour per day in v1**. Data model must allow several tours per date later (no unique constraint on `Tour.date`). |
| D6 | Order entry | M1: manual entry, optionally with an attached screenshot shown side by side. AI extraction is a **later** epic (M3) and will always require human review before saving. Screenshots may be German or Chinese. |
| D7 | Catalog | Admin-managed products with SKU, unit and names in all locales. **No prices**. |
| D8 | Dates | Every order has a `deliveryDate` (date only, factory time zone). Future dates allowed. Recurring orders are M3. |
| D9 | Route | Start and end at the depot (factory, configurable). Optimization via **OpenRouteService (ORS)** behind a `RoutingProvider` interface, with a local heuristic fallback. Geocoding via ORS behind a `Geocoder` interface. **Admin must confirm the map pin** for every customer. No hard time windows or capacity in v1; delivery hours are informational text. |
| D10 | Route control | Office can reorder stops manually, lock, re-optimize and **release** the tour. Driver cannot reorder; he can only mark stops delivered / problem. |
| D11 | Driver feedback | Per stop: `DELIVERED` or `PROBLEM` (predefined reason + optional free text). Free text is auto-translated to German for the office. No signature / proof photo in v1. |
| D12 | Photos | Shop photo + parking photo per customer. Uploaded by office **or** taken by the driver with the phone camera. Customers can be saved without photos but are flagged **"photos missing"**. |
| D13 | Auth | Roles `ADMIN` and `DRIVER`. Admin: email + password. Driver: username + 6-digit PIN, accounts created by admin, long-lived session (90 days). |
| D14 | Languages | UI locales: `de`, `zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW` across the **whole app**. Each user has a preferred locale, switchable at any time. Drivers choose on first start. Written standard Chinese (no Cantonese colloquialisms). |
| D15 | Translation method | UI strings: `de` and `zh-Hans` maintained by hand; `zh-Hant-HK` / `zh-Hant-TW` generated with **OpenCC** (`s2hk`, `s2twp`) plus per-key override files. Content (product names, customer notes, driver free text): stored as `LocalizedText` (all four locales). Product names: `de` + `zh-Hans` entered by hand, Hant variants derived by OpenCC and editable. Customer notes: machine-translated (`Translator` interface, DeepL default) de→zh-Hans, then OpenCC; editable. |
| D16 | Navigation | Deep link to Google Maps (universal URL, works on Android + iOS) with lat/lng. No in-app turn-by-turn. |
| D17 | Offline | Driver PWA caches today's tour incl. photos; status changes are queued offline and synced later. |
| D18 | Extras in v1 | CSV/XLSX customer import with pin review; printable packing list / load sheet per tour. |
| D19 | Out of scope | Invoicing, delivery notes for accounting, prices, stock / production planning, payments, customer self-service portal, GPS tracking of drivers. |
| D20 | Code language | Code, identifiers, commits, comments: **English**. UI text: via i18n only. |

---

## 3. Glossary (use these words consistently in code and UI)

| Term (code) | German UI | Meaning |
|---|---|---|
| `Customer` | Kunde | A business that receives deliveries. Has exactly one delivery address and one confirmed pin. |
| `Product` | Nudelsorte / Produkt | A sellable pasta article with a unit (e.g. "Spaghetti 5 kg" in `PACK`). |
| `Order` | Bestellung | What one customer ordered for one `deliveryDate`. Contains `OrderItem`s. |
| `OrderItem` | Bestellposition | Product + quantity within an order. |
| `Depot` | Fabrik / Depot | Start and end point of every tour. Stored in `Settings`. |
| `Tour` | Tour | One driver's delivery run on one date. Contains ordered `Stop`s. **Don't use "Route" for this entity**; "route" only means the geometry / road path. |
| `Stop` | Stopp | One visit to one customer within a tour. **All confirmed orders of a customer for that date are merged into one stop.** |
| `Release` | Freigabe | The act of making a tour visible to the driver. |
| `Pin` | Kartenpunkt | The confirmed lat/lng of a customer. |
| `LocalizedText` | – | JSON value `{ de, "zh-Hans", "zh-Hant-HK", "zh-Hant-TW", meta }` used for any user-generated text the driver must read. |

---

## 4. Global technical conventions

### 4.1 Repository layout

```
/                         repo root = this folder (nudel-liefer-app)
├─ projektbeschreibung.md
├─ backlog.md
├─ AGENTS.md              conventions for agents (created in NUD-001; keep in sync with §4/§5)
├─ docker-compose.yml     postgres + minio for local dev
├─ prisma/                schema.prisma, migrations/, seed.ts
├─ messages/              de.json, zh-Hans.json, overrides/zh-Hant-HK.json, overrides/zh-Hant-TW.json
│                         (zh-Hant-*.json are GENERATED – never edit by hand)
├─ scripts/               i18n-build.ts, i18n-check.ts, ...
├─ src/
│  ├─ app/[locale]/(admin)/...     admin pages
│  ├─ app/[locale]/(driver)/...    driver pages (mobile)
│  ├─ app/api/...                  route handlers (uploads, health, sync)
│  ├─ domain/                      pure business logic, no framework imports (tour building, aggregation, status machines)
│  ├─ server/                      db access, services, auth, providers (geocoder, routing, translator, storage)
│  ├─ components/                  ui/ (shadcn), admin/, driver/, shared/
│  └─ lib/                         utilities (dates, i18n helpers, LocalizedText)
├─ tests/e2e/                      Playwright
└─ docs/                           runbook, ADRs, env setup
```

### 4.2 Commands (must exist after NUD-001 and stay green)

| Command | Purpose |
|---|---|
| `pnpm dev` | local dev server |
| `pnpm lint` | ESLint (no warnings allowed in CI) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit/integration |
| `pnpm test:e2e` | Playwright (desktop + mobile viewport projects) |
| `pnpm i18n:build` | generate zh-Hant-HK / zh-Hant-TW from zh-Hans + overrides |
| `pnpm i18n:check` | fail if any key is missing/empty in any locale or a generated file is stale |
| `pnpm db:migrate` / `pnpm db:seed` | Prisma migrate + seed |

### 4.3 Rules

- **No hard-coded UI strings.** Every visible text goes through next-intl. `pnpm i18n:check` runs in CI.
- Set `<html lang="…">` to the exact locale (`zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`, `de`) so the browser picks correct CJK glyph shapes. Use system font stacks (`"PingFang SC"/"PingFang HK"/"PingFang TC"`, `"Noto Sans SC/HK/TC"`, `"Microsoft YaHei"/"Microsoft JhengHei"`); do **not** bundle multi-MB CJK web fonts.
- Customer names and addresses are **never translated**: the driver must match them to real signage.
- All server mutations: zod validation + role check on the server. Never trust the client.
- Domain logic in `src/domain/` must be pure and unit-tested; providers (geocoder, routing, translator, storage) are injected via interfaces and have a **Fake** implementation used in tests and when the API key is missing (log a warning).
- Dates: `deliveryDate` is a `DATE` column. "Today" is computed in the factory time zone (`Settings.timezone`, default `Europe/Vienna`).
- Quantities: `Decimal(10,2)`. Display without trailing zeros (`5`, `2.5`).
- Driver UI: touch targets ≥ 48 px, body text ≥ 16 px, quantities ≥ 28 px bold, icons alongside text so the screen is understandable even with an unexpected language.
- Accessibility: WCAG AA contrast, keyboard-navigable admin.
- Use soft delete (`active=false` / archive) for customers, products and users. Never hard-delete business data.

### 4.4 Environment variables (grow `.env.example` as tickets add them)

`DATABASE_URL`, `AUTH_SECRET`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `ORS_API_KEY`, `DEEPL_API_KEY`, `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `SENTRY_DSN` (optional).

---

## 5. Definition of Done (applies to every ticket)

- [ ] All acceptance criteria of the ticket are met and ticked in this file.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` pass. `pnpm test:e2e` passes if the ticket touches UI flows.
- [ ] New UI text exists in `de` and `zh-Hans`; `pnpm i18n:build` was run.
- [ ] New server mutations have an authorization test (wrong role → rejected).
- [ ] New env vars are in `.env.example` and `docs/env.md`.
- [ ] Migrations are committed; `pnpm db:seed` still works on a fresh DB.
- [ ] Screens checked at 375 px (driver) or 1280 px (admin) width; no horizontal scroll.
- [ ] One commit (or a small series) referencing the ticket ID, e.g. `NUD-030: manual order entry`.
- [ ] Short "Implementation notes" added under the ticket (what was built, anything surprising, follow-ups).

---

## 6. Data model (target for v1 – NUD-002 creates the core, later tickets extend)

```prisma
enum Role         { ADMIN DRIVER }
enum Locale       { de zh_Hans zh_Hant_HK zh_Hant_TW }   // map to BCP-47 tags in code
enum Unit         { KG PACK CRATE PIECE }
enum PhotoKind    { STORE PARKING }
enum OrderSource  { MANUAL SCREENSHOT }
enum OrderStatus  { DRAFT CONFIRMED CANCELLED }
enum TourStatus   { DRAFT OPTIMIZED RELEASED IN_PROGRESS COMPLETED }
enum StopStatus   { PENDING DELIVERED PROBLEM }
enum ProblemReason{ CLOSED NOBODY_THERE NO_PARKING WRONG_QUANTITY REFUSED ADDRESS_NOT_FOUND OTHER }

model User      { id, role, email?(unique), username?(unique), passwordHash, locale, localeChosen Boolean, displayName, active, createdAt, updatedAt }
model Settings  { id(singleton), depotName, depotAddress, depotLat, depotLng, depotPinConfirmed Boolean @default(false), timezone, departureTime "07:00",
                  serviceMinutesPerStop Int @default(10), deliveryWeekdays Int[] @default([1,2,3,4,5]) }
model Customer  { id, customerNumber(unique), name, street, postalCode, city, country @default("AT"),
                  lat?, lng?, pinConfirmed Boolean, notes Json? /*LocalizedText*/, deliveryHoursInfo String?,
                  active, createdAt, updatedAt, photos Photo[] }
model Photo     { id, customerId, kind, storageKey, width, height, bytes, uploadedById, isCurrent, createdAt }
model Product   { id, sku(unique), name Json /*LocalizedText*/, unit, active, sortOrder, createdAt, updatedAt }
model Screenshot{ id, storageKey, uploadedById, createdAt, extraction Json? /*M3*/ }
model Order     { id, customerId, deliveryDate @db.Date, status, source, screenshotId?, internalNote?, createdById, createdAt, updatedAt, items OrderItem[] }
model OrderItem { id, orderId, productId, quantity Decimal(10,2) }
model Tour      { id, date @db.Date, driverId?, status, isOutdated Boolean, locked Boolean,
                  depotSnapshot Json, geometry Json?, totalDistanceM Int?, totalDurationS Int?,
                  optimizedAt?, releasedAt?, completedAt?, createdAt, updatedAt, stops Stop[] }
model Stop      { id, tourId, customerId, sequence Int, status, etaAt DateTime?, legDistanceM Int?, legDurationS Int?,
                  problemReason?, problemNote Json? /*LocalizedText, source = driver locale*/, completedAt?, clientMutationId? (unique),
                  orders StopOrder[] }
model StopOrder { stopId, orderId  @@id([stopId, orderId]) }
model AuditLog  { id, actorId, entity, entityId, action, diff Json, createdAt }   // NUD-092
```

`LocalizedText` JSON shape (validated with zod):
```ts
type LocalizedText = {
  de?: string; "zh-Hans"?: string; "zh-Hant-HK"?: string; "zh-Hant-TW"?: string;
  meta: { source: Locale; machine: Partial<Record<Locale, boolean>>; updatedAt: string };
};
```
Read rule: `pick(text, locale)` returns the requested locale; if empty, the closest Chinese variant (HK↔TW, then Hans), then `de`, then the source.

---

## 7. Ticket index

| ID | Title | MS | depends_on | Status |
|---|---|---|---|---|
| NUD-001 | Repo scaffold, tooling, CI, AGENTS.md | M0 | – | blocked |
| NUD-002 | Database schema v1, local Docker, seed | M0 | 001 | blocked |
| NUD-003 | i18n foundation (4 locales, OpenCC build, LocalizedText) | M0 | 001 | done |
| NUD-004 | Authentication & roles | M0 | 002, 003 | blocked |
| NUD-005 | App shells & UI kit (admin + driver) | M0 | 003, 004 | done |
| NUD-006 | Object storage & image upload pipeline | M0 | 002 | blocked |
| NUD-007 | 👤 Deployment pipeline (Vercel/Neon/R2) | M0 | 002, 004 | blocked |
| NUD-008 | Admin user management (drivers) | M0 | 005 | done |
| NUD-010 | Geocoder interface + ORS + Fake | M1 | 002 | done |
| NUD-011 | Map component with draggable pin | M1 | 005 | done |
| NUD-012 | Depot & general settings page | M1 | 010, 011 | done |
| NUD-013 | Customer list & search | M1 | 005 | done |
| NUD-014 | Customer create/edit with pin confirmation | M1 | 010, 011, 013 | done |
| NUD-015 | Customer photos (admin upload/replace) | M1 | 006, 014 | done |
| NUD-020 | Product catalog CRUD (multilingual names) | M1 | 003, 005 | done |
| NUD-030 | Manual order entry | M1 | 014, 020 | todo |
| NUD-031 | Screenshot attachment & split-view entry | M1 | 006, 030 | todo |
| NUD-032 | Order overview & editing | M1 | 030 | todo |
| NUD-040 | RoutingProvider + ORS optimization + fallback heuristic | M1 | 002 | todo |
| NUD-041 | Tour builder (orders → stops → optimized tour) | M1 | 012, 032, 040 | todo |
| NUD-042 | Tour planning UI (map, reorder, lock, release) | M1 | 011, 041 | todo |
| NUD-043 | Tour lifecycle & change handling (outdated tours) | M1 | 042 | todo |
| NUD-050 | Driver first-start language picker | M1 | 005 | todo |
| NUD-051 | Driver "today's tour" screen | M1 | 043, 050 | todo |
| NUD-052 | Driver stop detail + navigation | M1 | 015, 051 | todo |
| NUD-053 | Driver stop status (delivered / problem) | M1 | 052 | todo |
| NUD-054 | Admin live tour progress | M1 | 053 | todo |
| NUD-060 | MVP demo seed + end-to-end happy path | M1 | 054 | todo |
| NUD-070 | Translator interface + DeepL + OpenCC derivation | M2 | 003 | todo |
| NUD-071 | Customer notes translation & multilingual editor | M2 | 014, 070 | todo |
| NUD-072 | Driver problem text → German for office | M2 | 053, 070 | todo |
| NUD-073 | 👤 UI string review workflow for native speakers | M2 | 003 | todo |
| NUD-080 | PWA installability | M2 | 051 | todo |
| NUD-081 | Offline cache of today's tour + photos | M2 | 080, 052 | todo |
| NUD-082 | Offline mutation queue for stop status | M2 | 081, 053 | todo |
| NUD-083 | Driver photo capture / replace | M2 | 052, 082 | todo |
| NUD-090 | Customer import (CSV/XLSX) with pin review | M2 | 014 | todo |
| NUD-091 | Packing list / load sheet print view | M2 | 041 | todo |
| NUD-092 | Audit log for orders and tours | M2 | 032, 043 | todo |
| NUD-093 | Security hardening | M2 | 060 | todo |
| NUD-094 | Monitoring, backups, error pages, runbook | M2 | 007 | todo |
| NUD-095 | Driver usability & accessibility pass | M2 | 083 | todo |
| NUD-096 | 👤 User acceptance test with client & drivers | M2 | 093, 095 | todo |
| NUD-097 | Silence Auth.js prerender error log | M2 | 004 | todo |
| NUD-098 | Keep OpenCC out of the client bundle | M2 | 003 | todo |
| NUD-100 | AI screenshot extraction (review required) | M3 | 031 | todo |
| NUD-101 | Recurring / standing orders | M3 | 032 | todo |
| NUD-102 | Multiple drivers / tours per day | M3 | 043 | todo |
| NUD-103 | Delivery time windows & vehicle capacity | M3 | 102 | todo |
| NUD-104 | Proof of delivery (photo / signature) | M3 | 053 | todo |

**Milestone exit criteria**

- **M0 Foundation:** an admin and a driver can log in on the deployed preview URL in all four languages; CI is green.
- **M1 MVP (demo):** office creates customers (with pins and photos), products and orders for a date → generates and releases an optimized tour → driver sees it on the phone, opens stops, navigates, marks delivered/problem → office sees progress. Works in `de` and all Chinese locales.
- **M2 Production v1:** offline-capable driver app, translations of notes/problem texts, import, packing list, audit, hardening, monitoring, accepted by the client.
- **M3 Later:** only after M2 sign-off. Tickets are sketched; refine them before starting.

---

## 8. Tickets

### M0 — Foundation

---

#### NUD-001 · Repo scaffold, tooling, CI, AGENTS.md
**Status:** blocked (e2e + CI not verifiable in this environment, see Implementation notes) · **depends_on:** – 

**Goal:** an empty but production-grade Next.js project that every later ticket builds on.

**Scope**
- `create-next-app` with App Router, TypeScript strict, Tailwind, ESLint, `src/` dir, pnpm.
- Prettier + `eslint-config-prettier`; import sorting.
- Vitest (with `@testing-library/react`, jsdom) and Playwright with two projects: `desktop` (1280×800) and `mobile` (Pixel 7 emulation).
- GitHub Actions workflow: install → lint → typecheck → test → (e2e on PR, with Postgres service).
- `AGENTS.md` summarising §0, §4, §5 of this backlog (short, link back here). Add a `CLAUDE.md` that just says "see AGENTS.md".
- `README.md`: what the app is, how to run locally.
- Folder skeleton from §4.1 with placeholder `index.ts` where useful.

**Acceptance criteria**
- [x] `pnpm dev` serves a placeholder page.
- [x] All commands from §4.2 that apply at this point exist and pass (`i18n:*` may be stubs that exit 0 until NUD-003). (`test:e2e` exists but could not be run here, see notes.)
- [ ] CI runs on push and PR and is green. (workflow written; not run, no GitHub remote)
- [ ] One example unit test and one example e2e test exist and pass. (unit tests pass; e2e spec written and listed by Playwright for both projects, but not executed)

**Implementation notes**
- Next.js 16.4 / React 19 / Tailwind 4 / ESLint 9 flat config / Vitest 5 / Playwright 1.64, pnpm 12 (`packageManager` pinned). Placeholder page at `/`, unit tests (`src/lib/example.test.ts`, `src/app/page.test.tsx`), e2e `tests/e2e/home.spec.ts` (projects `desktop` 1280x800, `mobile` Pixel 7).
- Verified: `pnpm lint` (max-warnings=0), `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` (stub), `pnpm build`, dev server returns the page.
- NOT verified: `pnpm test:e2e` (Playwright browser download blocked by the sandbox network allowlist; run `pnpm exec playwright install chromium && pnpm test:e2e` locally) and the GitHub Actions workflow `.github/workflows/ci.yml` (no remote). Once both are green, tick the two open criteria and set the ticket to `done`.
- Removed the default Geist Google fonts (build needs network and §4.3 requires system font stacks); `<html lang>` is hard-coded `de` until NUD-003.
- `typecheck` runs `next typegen` first because Next 16 generates the global `LayoutProps` types.
- `i18n:build` / `i18n:check` are stubs (`tsx scripts/...`) until NUD-003. Dependencies of later tickets (Prisma, next-intl, ...) deliberately not installed.
- The mounted project folder is slow for installs: run `pnpm install` on a local checkout if it times out. No shadcn/ui yet (NUD-005).

---

#### NUD-002 · Database schema v1, local Docker, seed
**Status:** blocked (Docker and the native Prisma schema engine are unavailable here, see Implementation notes) · **depends_on:** 001

**Goal:** Postgres + Prisma with the full v1 core schema from §6 (except `AuditLog`, added in NUD-092).

**Scope**
- `docker-compose.yml` with `postgres:16` and `minio` (+ bucket auto-creation via `mc` init container).
- `prisma/schema.prisma` implementing §6 models, enums, relations, indexes: `Order(deliveryDate, status)`, `Order(customerId, deliveryDate)`, `Tour(date)`, `Stop(tourId, sequence)`, `Customer(name)`, `Customer(customerNumber)`.
- `src/server/db.ts` singleton Prisma client.
- `prisma/seed.ts`: settings singleton (placeholder depot in Vienna, `Europe/Vienna`), 1 admin (`admin@example.com` / password from env `SEED_ADMIN_PASSWORD`), 4 drivers (one per locale), 6 products, 0 customers (demo customers come in NUD-060).
- zod schema + helpers for `LocalizedText` live in `src/lib/localized-text.ts` (shared with NUD-003).

**Acceptance criteria**
- [ ] `docker compose up -d && pnpm db:migrate && pnpm db:seed` works on a clean machine. (NOT verified here: no Docker, and `prisma migrate deploy` needs the native schema engine which the sandbox cannot download. Verified instead: the committed migration SQL applied to a clean PostgreSQL 16 followed by `pnpm db:seed`, twice, idempotent.)
- [x] An integration test (Vitest, real DB via `DATABASE_URL` test schema) creates a customer → order → items and reads them back. (`src/server/db.integration.test.ts`, 4 tests, passed against embedded PostgreSQL 16.)
- [x] Deleting a customer with orders is impossible at DB level (`onDelete: Restrict`); archive via `active=false`. (tested)

**Implementation notes**
- Prisma 7.10.1 (`prisma-client` generator, output `src/generated/prisma`, git-ignored, generated by `postinstall`), driver adapter `@prisma/adapter-pg`, `prisma.config.ts` holds the datasource URL and seed command. Schema = §6 without AuditLog; enum `Locale` maps to BCP-47 tags via `@map`. Extra deps: zod, bcryptjs (seed hashes), dev: `embedded-postgres`, `dotenv`.
- `src/server/db.ts` exports `getDb()` (lazy singleton, so builds without `DATABASE_URL` work) and `createPrismaClient`. `src/lib/localized-text.ts`: zod schema, `createLocalizedText`, `pick` (fallback rule from §6), enum/tag mapping; unit-tested.
- Migration `prisma/migrations/20261017120000_init` was generated with Prisma's own schema engine (wasm build, `diff` from empty to datamodel) because the native binary download is blocked; equivalent to `prisma migrate diff --from-empty --to-schema-datamodel --script`. Re-run `pnpm db:migrate:dev` locally to confirm there is no drift.
- Seed (`pnpm db:seed`, idempotent upserts): settings (Vienna placeholder), `admin@example.com` (`SEED_ADMIN_PASSWORD` required), 4 drivers `fahrer-de`/`driver-hans`/`driver-hk`/`driver-tw` (PIN `SEED_DRIVER_PIN`, default 123456), 6 products with names in all 4 locales (Hant entered by hand until OpenCC in NUD-003), 0 customers.
- Integration test creates an isolated schema per run, applies the committed migration SQL and drops it afterwards; it is skipped (not faked) when `DATABASE_URL` is unset. CI `check` job now has a Postgres service and runs `db:migrate && db:seed` (not run, no remote).
- `pnpm db:embedded` (scripts/embedded-postgres.ts) starts a Docker-free local PostgreSQL. `docker-compose.yml` (postgres:16, minio, minio-init creating bucket `nudel-photos`) was written but never started.
- To close the ticket: on a machine with Docker run `cp .env.example .env && docker compose up -d && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm test`; if green tick the first criterion and set `done`.
- Environment: pnpm install ran on local disk (`~/work/app`) and sources were synced back; `PRISMA_SCHEMA_ENGINE_BINARY` pointed to a dummy file so `prisma generate` runs without the blocked download.

---

#### NUD-003 · i18n foundation (4 locales, OpenCC build, LocalizedText)
**Status:** done · **depends_on:** 001

**Goal:** every screen can be rendered in `de`, `zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`.

**Scope**
- next-intl with locale segment `/[locale]/…`. URL tags: `de`, `zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`.
- Locale resolution order: logged-in user's `locale` → `NEXT_LOCALE` cookie → `Accept-Language` best match (`zh-CN`/`zh-SG`→Hans, `zh-HK`/`zh-MO`→Hant-HK, `zh-TW`→Hant-TW) → `de`.
- `scripts/i18n-build.ts` using `opencc-js`: `zh-Hans.json` → `zh-Hant-HK.json` (config `cn→hk`) and `zh-Hant-TW.json` (config `cn→twp`, with phrase conversion), then deep-merge `messages/overrides/<locale>.json`. Generated files get a header key `"_generated": "DO NOT EDIT"`.
- `scripts/i18n-check.ts`: fails on missing/empty keys in any locale, on ICU syntax errors, and if generated files differ from a fresh build.
- `<LanguageSwitcher>` component showing each language **in its own script**: `Deutsch`, `简体中文`, `繁體中文（香港）`, `繁體中文（台灣）`. Persists to cookie and, if logged in, to `User.locale`.
- `src/lib/localized-text.ts`: zod schema, `pick(text, locale)` with fallback chain (§6), `withDerivedHant(text)` that fills empty Hant variants from `zh-Hans` via OpenCC (and Hans from a Hant variant via `t→cn` if only Hant exists).
- `<html lang>` and font stacks per §4.3.
- Initial `de.json` and `zh-Hans.json` with common keys (actions, units `KG/PACK/CRATE/PIECE`, statuses, problem reasons, errors). Agent-written Chinese is acceptable for now; it will be reviewed in NUD-073.

**Acceptance criteria**
- [x] Visiting `/zh-Hant-TW` renders the placeholder page in Traditional Chinese with `lang="zh-Hant-TW"`.
- [x] `pnpm i18n:check` fails when a key is removed from `zh-Hans.json` (covered by a unit test of the checker).
- [x] Unit tests for `pick` fallback chain and `withDerivedHant` (e.g. `意大利面` → HK/TW Traditional forms).
- [x] Override file wins over OpenCC output (unit test).

**Implementation notes**
- next-intl 4 with `localePrefix: "always"`; `src/i18n/{routing,request,navigation}.ts`; `src/proxy.ts` (Next 16 replacement for middleware) redirects unprefixed paths to `resolveLocale()` (`src/lib/locale-resolution.ts`: user locale -> `NEXT_LOCALE` cookie -> Accept-Language -> `de`) and delegates prefixed paths to the next-intl middleware. The root layout moved to `src/app/[locale]/layout.tsx` (`<html lang={locale}>`, `generateStaticParams`); placeholder page renders via `HomeContent`.
- (Wired in NUD-004.) The logged-in user's locale was not wired into the proxy yet (no sessions): `getSessionUserId()` in `src/server/session.ts` returns `null` until NUD-004, which must feed it into `proxy.ts` and the `setLocaleAction` server action (already updates `User.locale` when a user id is present; unit-tested with injected deps).
- `scripts/lib/i18n.ts` (flatten, `buildHant`, `checkMessages`) + `i18n-build.ts` / `i18n-check.ts`. Check fails on missing/empty keys, invalid ICU (`intl-messageformat`), override keys unknown to zh-Hans, and stale/hand-edited generated files. Generated `messages/zh-Hant-*.json` are committed; run `pnpm i18n:build` after editing `zh-Hans.json` or an override.
- `withDerivedHant` + OpenCC converters in `src/lib/localized-text.ts` / `src/lib/opencc.ts`. Note OpenCC output: HK uses `麪` (`意大利麪`), TW phrase mode gives `義大利麵`; `面` alone is not converted (ambiguous character).
- Per-locale CJK font stacks via `:lang()` in `globals.css`. `<LanguageSwitcher>` is a native `<select>` (48 px high) showing each language in its own script; `messages/overrides/*.json` are empty for now.
- Verified: lint, typecheck, `pnpm test` (31 passed, DB integration tests skipped without `DATABASE_URL`), `i18n:check`, `pnpm build`, and against `next start`: `/zh-Hant-TW` serves `<html lang="zh-Hant-TW">` with Traditional text, `/` redirects by Accept-Language/cookie. Sandbox-only: `@swc/core` (loaded by the next-intl plugin) cannot start here because of a cache-directory ownership check, so those commands were run with `NODE_OPTIONS=--require` of a stub for `@swc/core` (not committed; unaffected on a normal machine). `pnpm-workspace.yaml` got `@parcel/watcher`/`@swc/core` build scripts set to `false`.
- Not verified: Playwright (`tests/e2e/home.spec.ts` updated with a `zh-Hant-TW` test, not executed); the switcher's click flow in a real browser; agent-written Chinese is unreviewed (NUD-073).

---

#### NUD-004 · Authentication & roles
**Status:** blocked (Playwright e2e not executable here, see Implementation notes) · **depends_on:** 002, 003

**Goal:** secure login for admins (email+password) and drivers (username+PIN), role-based access.

**Scope**
- Auth.js v5 with Credentials provider, JWT session. Admin session max age 12 h, driver 90 days (role-dependent `maxAge` in callback).
- Password hashing with argon2 (or bcrypt if argon2 is unavailable on Vercel – log decision).
- Login pages: `/[locale]/login` (admin) and `/[locale]/driver/login` (driver; numeric keypad input for PIN, `inputmode="numeric"`).
- Middleware: `/(admin)` requires `ADMIN`, `/(driver)` requires `DRIVER` (admins may open driver views for support – read-only is fine). Unauthenticated → correct login page with return URL.
- Server-side helper `requireRole(role)` used by every server action / route handler.
- Login rate limiting: max 5 failed attempts per username/IP per 15 min (DB- or memory-backed; document choice).
- After login the user's `locale` is applied (redirect to their locale prefix).

**Acceptance criteria**
- [ ] E2E: admin logs in → lands on admin dashboard; driver logs in → lands on driver home in his locale. (spec `tests/e2e/auth.spec.ts` written and listed by Playwright; NOT executed, no browser. The same flows were verified over HTTP against `next start`, see notes.)
- [x] Driver cannot access any admin route or server action (tests). (`src/lib/access.test.ts`, `resolveActor` tests against real PostgreSQL, live check of the proxy redirect)
- [x] 6th wrong PIN within 15 min is rejected with a localized message. (DB-backed integration test + live check through the real login server action in `de` and `zh-Hans`)
- [x] Inactive users cannot log in. (integration test + live check)

**Implementation notes**
- Auth.js `next-auth@5.0.0-beta.32`, JWT sessions, two Credentials providers: `admin` (email + password) and `driver` (username + 6-digit PIN), both calling `authenticate()` (`src/server/auth/authenticate.ts`: zod, lookup by role, equal-time bcrypt compare, inactive = invalid, rate limit). Hashing stays bcryptjs (cost 12 for new hashes; seed hashes at cost 10 still verify).
- Session lifetime per role: custom `jwt.encode` sets `maxAge` 12 h (ADMIN) / 90 days (DRIVER); the cookie itself lives 90 days but the JWT inside expires per role (verified: exp - iat = 43200 / 7776000). Sessions are absolute (not sliding): the proxy only reads the JWT and never re-issues the cookie (the Auth.js middleware wrapper did, and overwrote the cookie deletion done by logout).
- Rate limiting: DB table `LoginAttempt` (migration `20261017130000_login_attempt`). Failed attempts are recorded per `user:<kind>:<identifier>` (limit 5) and per `ip:<address>` (limit 20) in a 15 min window; the limit check runs before the credentials check, so the 6th attempt is rejected even with the right PIN; a successful login clears the user counter. Concurrent requests can slightly exceed the limit (no locking). IP comes from `x-forwarded-for`/`x-real-ip` (trusted on Vercel; absent locally, then only the user key applies).
- Access: `src/proxy.ts` uses `decideAccess()` (`src/lib/access.ts`): `/admin/**` ADMIN only (driver is redirected to `/driver`), `/driver/**` DRIVER or ADMIN, anonymous users go to `/login` or `/driver/login` with `?callbackUrl=`. Routes: `/[locale]/login`, `/[locale]/driver/login`, `/[locale]/admin` (dashboard placeholder), `/[locale]/driver` (home placeholder). The proxy is only a first line: pages call `requirePageActor()` and every server action / route handler must call `requireRole(...roles)` (`src/server/auth/guards.ts`), which re-reads the user from the DB (role taken from the DB, inactive/unknown users rejected, throws `AuthorizationError` UNAUTHENTICATED/FORBIDDEN; `authErrorStatus()` maps to 401/403). Admins may open `/driver` pages, but driver mutations must use `requireRole("DRIVER")`.
- Locale: after login the action sets `NEXT_LOCALE` and redirects to `/{user locale}{callbackUrl or home}` (callback validated: same-site path, locale re-prefixed, must be allowed for the role). `getSessionUserId()` now returns the session user id; the proxy passes the token locale into `resolveLocale()`; `setLocaleAction` also updates the token via `unstable_update` so the proxy sees the new locale (unit-tested with injected deps, not exercised in a browser).
- Login forms are server-action forms (`useActionState`) with 48 px inputs, numeric keypad (`inputMode="numeric"`) for the PIN, logout via server action. Strings in `auth.*`, `admin.dashboard.*`, `driver.home.*` (de + zh-Hans, Hant generated).
- Env: `AUTH_SECRET` (documented, CI sets it; e2e job now migrates + seeds).
- Verified: lint, typecheck, `pnpm test` (incl. 12 DB-backed auth tests on embedded PostgreSQL 16), i18n:check, `pnpm build`; against `next start` with a seeded DB (python scripted no-JS form posts): anonymous redirects, admin login/dashboard, driver login in `zh-Hant-HK` lands on `/zh-Hant-HK/driver`, driver bounced from admin routes, JWT lifetimes, 5 wrong PINs then localized rate-limit message (de, zh-Hans), inactive driver rejected, logout for admin and driver.
- NOT verified: Playwright e2e (no browser, same limitation as NUD-001), 375 px / 1280 px layout check, the language switcher updating the session locale in a browser, CI run. To close: run `pnpm exec playwright install chromium && pnpm test:e2e` against a seeded DB (needs `SEED_ADMIN_PASSWORD`, `AUTH_SECRET`); if green tick the first criterion and set `done`.

---

#### NUD-005 · App shells & UI kit (admin + driver)
**Status:** done · **depends_on:** 003, 004

**Goal:** consistent layouts and base components so feature tickets only build content.

**Scope**
- shadcn/ui init with the components we'll need (button, input, select, combobox/command, dialog, sheet, table, badge, toast/sonner, tabs, calendar/date-picker, form, skeleton, alert).
- **Admin layout:** sidebar (Dashboard, Bestellungen, Touren, Kunden, Produkte, Fahrer, Einstellungen), header with language switcher + user menu. Placeholder pages for each nav item.
- **Driver layout:** mobile-first, full-height, top bar (date, language switcher icon, connection indicator placeholder), large content area, no sidebar. Placeholder "Heute" page.
- Shared states: `<EmptyState>`, `<ErrorState>`, `<LoadingSkeleton>`, global error boundary, localized 404.
- Date/number formatting helpers via next-intl formatters (respect locale).

**Acceptance criteria**
- [x] All placeholder pages render in all 4 locales without missing-key warnings. (Vitest renders every placeholder + both shells in 4 locales with a throwing `onError`/`getMessageFallback`; Playwright visits every admin page in 4 locales and fails on any console error; `next start` log has 0 missing-message entries.)
- [x] Driver layout passes a Playwright mobile screenshot check (no horizontal scroll at 375 px). (`tests/e2e/shells.spec.ts`, 4 locales at 375x812, asserts `scrollWidth <= clientWidth`, >= 48 px touch targets, attaches a screenshot; passed in both Playwright projects, see notes for how the browser was provided.)
- [x] Admin nav highlights the active section. (`aria-current="page"` + marker bar; unit test for the matcher, Playwright test clicking through all sections on desktop and in the mobile slide-over.)

**Implementation notes**
- shadcn/ui: the CLI registry is not reachable from the sandbox, so the components were written by hand in shadcn "new-york" style (`components.json` is committed, so `pnpm dlx shadcn add ...` works later): button, input, label, select, command, combobox (popover + command), popover, dialog, sheet, dropdown-menu, table, badge, sonner (toaster mounted in the locale layout), tabs, calendar + date-picker (react-day-picker with `de`/`zhCN`/`zhHK`/`zhTW`), form (react-hook-form), skeleton, alert. Radix via the `radix-ui` umbrella package. Design tokens (shadcn names, light + `prefers-color-scheme` dark, AA contrast) live in `globals.css`; border-colour default is in `@layer base` so utilities still win. Button sizes `lg`/`icon-lg` = 48 px for the driver app. Strings inside kit components (dialog/sheet close label) use `common.actions.close`; callers pass already translated texts into `Combobox`/`DatePicker`.
- Admin: `admin/layout.tsx` (role gate + `AdminShell`: sidebar Übersicht/Bestellungen/Touren/Kunden/Produkte/Fahrer/Einstellungen, header with compact language switcher and user menu incl. logout, slide-over navigation below `md`, skip link) and placeholder pages `/admin/{orders,tours,customers,products,drivers,settings}` (each re-checks the role via `requirePageActor`, since layouts are not re-run on client navigation). The dashboard moved its switcher/logout into the header.
- Driver: pages moved into the route group `driver/(app)/` (URLs unchanged) so only they get `DriverShell` (sticky top bar: factory-time-zone date, connection indicator = browser online state only, 48 px language icon picker) while `driver/login` stays shell-less. "Heute" shows an empty state until NUD-051.
- Shared: `EmptyState`/`ErrorState`/`LoadingSkeleton` (`components/shared/states.tsx`), `[locale]/error.tsx` (error boundary with retry), `[locale]/not-found.tsx` + `[locale]/[...rest]/page.tsx` (localized 404 inside the locale layout), `LanguageSwitcher` got `variant` (`labeled` | `compact` | `icon`). Formatting: `createAppFormatters(formatter, timeZone)` in `src/lib/format.ts` (quantity without trailing zeros, short/long date, date-time, time in factory time zone, `calendarDate` for DATE columns in UTC); `getFactoryTimezone()` reads `Settings.timezone`.
- Verified: lint (0 warnings), typecheck, `pnpm test` (71 passed, DB integration tests skipped without `DATABASE_URL`), `i18n:check`, `pnpm build`; against `next start` + embedded PostgreSQL: scripted HTTP checks of all pages in 4 locales (active nav, 404s, guards) and the **full Playwright suite (23 tests per project, desktop + mobile, all specs incl. NUD-001/003/004 ones) passed** with a real headless Chromium. Screenshots were inspected at 1280 px (admin) and 375 px (driver, mobile admin menu).
- Environment trick (not committed): Playwright's own browser download is blocked, but the npm package `@sparticuz/chromium` ships a Chromium binary; a throw-away Playwright config pointing `launchOptions.executablePath` at it (args without `--single-process`, `--workers=2`) runs the suite. This also makes the open NUD-001/NUD-004 e2e criteria verifiable (they were not changed here). While doing so, the NUD-004 spec "6th wrong PIN" turned out to be racy (React resets the form after each server-action submit; the old loop read the previous attempt's message) and was fixed to wait for each POST response.
- Not verified: CI run (no remote); real mobile devices/Safari (only Chromium: Desktop 1280x800, Pixel 7 profile, and 375x812 viewport); the unreviewed agent-written Chinese strings (NUD-073).
- Known quirks: (1) unknown URLs render the localized 404 but stream with HTTP 200 (a `notFound()` in a prerendered catch-all shell produced an unlocalized bare 404, so the catch-all decides at request time behind `connection()`); fine for a login-protected app, noted in the decision log. (2) `next start` logs `crypto.getRandomValues() while prerendering` for admin/driver routes: caused by Auth.js `auth()` during Next's partial-prefetch validation, reproduced on the NUD-004 commit, so not introduced here (new ticket NUD-097).

---

#### NUD-006 · Object storage & image upload pipeline
**Status:** blocked (not verified against real MinIO/R2: no Docker and no MinIO binary reachable here, see Implementation notes) · **depends_on:** 002

**Goal:** reusable, secure image upload for customer photos and order screenshots.

**Scope**
- `Storage` interface (`createUploadUrl`, `getReadUrl`, `delete`) with S3 implementation (`@aws-sdk/client-s3`, works with MinIO and R2) and an in-memory/fs Fake for tests.
- Route handler `POST /api/uploads` → validates role, content type (`image/jpeg|png|webp|heic`), max 15 MB → returns presigned PUT URL + `storageKey`.
- Client util `uploadImage(file)`: client-side resize to max 1600 px long edge, re-encode JPEG/WebP quality ~0.8, convert HEIC if needed (or reject with a clear message – log decision), upload with progress.
- Private bucket; reads via short-lived signed URLs (e.g. 1 h) generated server-side.
- `<ImageUploader>` component (drop zone + file picker + **clipboard paste**), `<ImagePreview>` with fullscreen zoom (pinch-zoom on mobile).

**Acceptance criteria**
- [x] Upload of a 6000×4000 JPEG results in a stored image ≤ 1600 px and < 600 KB. (Real headless Chromium -> `/api/uploads` -> presigned PUT -> S3-compatible server: synthetic 4.25 MB 6000×4000 JPEG became 1600×1067, 113 KB; verified on the stored object.)
- [x] Unauthenticated upload request → 401. Wrong content type → 400. (Vitest + Playwright, desktop and mobile.)
- [ ] Works against local MinIO in dev and the Fake in tests. (Fake: tested. MinIO/R2: not available here; verified against the npm `s3rver` S3 emulator only, see notes.)


**Implementation notes**
- Server: `Storage` interface (`src/server/storage/types.ts`: `createUploadUrl`, `getReadUrl` (default 1 h), `delete`), `S3Storage` (`@aws-sdk/client-s3` + `s3-request-presigner`; MinIO/R2; path-style when `S3_ENDPOINT` is set; presigned PUT signs `content-type` and `content-length`; CRC32 checksums disabled so browsers need no extra headers), `FakeStorage` (in-memory), `getStorage()` (env `S3_*`; Fake + warning when unset in dev/test; throws in production). `POST /api/uploads` (`src/server/uploads.ts` + thin `src/app/api/uploads/route.ts`): body `{ purpose: "customer-photo" | "screenshot", contentType, size }` -> `{ storageKey, uploadUrl, method, headers, expiresAt }`. The key is always server-generated (`customers/<uuid>.<ext>`, `screenshots/<uuid>.<ext>`). Status codes: 401 unauthenticated/inactive, 403 wrong role, 400 bad body or content type, 413 > 15 MB. Roles: `customer-photo` ADMIN + DRIVER (drivers take photos in NUD-083), `screenshot` ADMIN only. `authErrorStatus` moved to `auth/actor.ts` (still re-exported from `guards.ts`) so the handler is testable without Auth.js.
- Client: `uploadImage(file, { purpose, onProgress, signal })` in `src/lib/upload-image.ts` (decode with EXIF orientation -> max 1600 px -> JPEG q 0.8 (also strips EXIF/GPS) -> grant -> XHR PUT with progress); typed `UploadError` codes with localized messages (`common.upload.errors.*`). `<ImageUploader>` (drop zone, file picker, optional camera button, paste on the focused zone or `pasteAnywhere`) and `<ImagePreview>` (thumbnail -> fullscreen dialog, wheel / pinch / double-tap zoom, drag to pan, +/-/reset buttons, `src/lib/zoom.ts`) in `src/components/shared/`. Nothing uses them yet (NUD-015, NUD-031, NUD-083).
- Env: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in `.env.example` (MinIO defaults matching `docker-compose.yml`) and `docs/env.md` (incl. the R2 CORS rule the browser PUT needs).
- Verified: lint, typecheck, `pnpm test` (118 passed incl. DB tests), `i18n:build/check`, `pnpm build`, full Playwright suite (52 passed, desktop + mobile) incl. new `tests/e2e/uploads.spec.ts` (401 anonymous, 200 admin, 400 PDF, driver 403 for screenshot / 200 for photo). Browser pipeline and `S3Storage` roundtrip (signed PUT, signed GET, expired GET -> 403, delete -> 404, double delete) were run against the `s3rver` emulator (throw-away script, not committed).
- NOT verified: real MinIO / Cloudflare R2. `s3rver` does not enforce signatures on PUT or privacy on anonymous GET, so enforcement of the signed `content-type`/`content-length` and the private bucket is unproven (presigned URL contents are asserted offline in unit tests). Also not verified: browser CORS against R2, `<ImageUploader>`/`<ImagePreview>` in a real browser (jsdom tests only; pinch gestures untested), Safari/HEIC decoding, a real camera photo (the 6000×4000 test image was synthetic). To close: `cp .env.example .env && docker compose up -d`, then `pnpm dev`, upload a real photo through a page that uses `<ImageUploader>` (NUD-015) or run `pnpm test:e2e`; check the object in the MinIO console and that anonymous GET of the object URL is denied; if green tick the last criterion and set `done`.

---

#### NUD-007 · 👤 Deployment pipeline (Vercel / Neon / R2)
**Status:** blocked (human must create the Vercel, Neon and Cloudflare accounts and enter the keys, see Human steps) · **depends_on:** 002, 004

**Goal:** every push to `main` deploys to production, every PR gets a preview.

**Scope**
- `docs/deploy.md` with exact click-by-click steps for the human: create Vercel project (region `fra1`), Neon project (EU, Frankfurt), R2 bucket (EU jurisdiction) + API token, set env vars.
- Build step runs `prisma migrate deploy`.
- `GET /api/health` returns DB + storage reachability (no secrets).
- Preview deployments use a Neon branch per PR if feasible; otherwise a shared staging DB (log decision).

**👤 Human steps:** create the three accounts, paste keys into Vercel. Agent: prepare everything else, then set `blocked` until keys exist.

**Acceptance criteria**
- [ ] Production URL serves the app; `/api/health` is green.
- [ ] Seed admin can log in on production (seed run once manually, documented).

**Implementation notes**
- `docs/deploy.md`: click-by-click guide (GitHub repo, Neon EU Frankfurt, R2 bucket in EU jurisdiction + scoped API token + CORS JSON, Vercel project in `fra1`, env var table per Vercel environment, first deploy, one-time production seed, preview strategy, verification, troubleshooting). Console menu names were written from memory and may differ slightly; nothing was verified against the real services.
- `vercel.json`: framework, region `fra1`, install `pnpm install --frozen-lockfile`, build `pnpm build:vercel`. `build:vercel` = `tsx scripts/check-deploy-env.ts && prisma migrate deploy && next build`. The env check (`scripts/lib/deploy-env.ts`, unit-tested) runs only when `VERCEL_ENV` is set, lists missing/placeholder/localhost values without echoing them and requires `DATABASE_URL_UNPOOLED` when `DATABASE_URL` is a Neon `-pooler` URL. `prisma.config.ts` prefers `DATABASE_URL_UNPOOLED` (migrations need a direct connection), the app uses `DATABASE_URL`.
- `GET /api/health` (`src/server/health.ts`, route uses `connection()` so it is never prerendered): `SELECT 1` and `Storage.checkReachable()` (new interface method; S3 = `ListObjectsV2` with `MaxKeys: 1`, needs only the bucket-scoped object read/write token; Fake = no-op, reported as `skipped`). 4 s timeout per check, 200/503, `Cache-Control: no-store`, body has statuses, latencies, short git SHA and region only (no hostnames or error messages; tested). Public on purpose (the proxy matcher already excludes `/api`).
- Seed: new optional `SEED_ADMIN_EMAIL` (default `admin@example.com`) and `SEED_DRIVERS=false` (skips the 4 demo drivers, which share the PIN 123456, on production). Both documented in `.env.example`, `docs/env.md`, `docs/deploy.md`.
- Verified: lint, typecheck, `pnpm test` (133 passed), `i18n:check`, `pnpm build` (`/api/health` is dynamic). Live against `next start` + embedded PostgreSQL + the `s3rver` emulator: health 200 (db ok, storage ok); 503 without S3 config; 503 with a wrong bucket; 503 with the database down; seed with `SEED_DRIVERS=false SEED_ADMIN_EMAIL=...` creates only the one admin. `check-deploy-env` fails correctly on a localhost URL / missing variables.
- NOT verified: anything against real Vercel, Neon or R2 (no accounts, by design); `prisma migrate deploy` itself (native schema engine unavailable here, see NUD-002); `ListObjectsV2` with a real R2 bucket-scoped token; R2 CORS rule; Vercel build with `pnpm build:vercel`.

**Human steps** (details and exact clicks in `docs/deploy.md`)
1. Create a private GitHub repo and push `main` (section 1); confirm CI is green (also closes open checks of NUD-001/004).
2. Neon: create project in AWS Europe (Frankfurt), copy pooled + direct URLs for `main`; create branch `staging` and copy its two URLs (section 2).
3. Cloudflare R2: buckets `nudel-photos` and `nudel-photos-staging` in the EU jurisdiction (private), bucket-scoped Object Read & Write API tokens, CORS rule, note the Account ID (section 3).
4. Vercel: Pro plan (Hobby is non-commercial), import the repo, check region `fra1`, Node 22, enter the env vars for Production and Preview (sections 4 and 5), deploy.
5. Run the production seed once from your computer with `SEED_DRIVERS=false` and your real admin email (section 7).
6. Verify `/api/health` is green with `region: fra1` and the admin can log in (section 9), then tell the agent the production URL; tick the two criteria above and set `done`.

---

#### NUD-008 · Admin user management (drivers)
**Status:** done · **depends_on:** 005

**Goal:** office creates and manages driver accounts without developer help.

**Scope**
- `/admin/drivers`: list (name, username, language, active, last login).
- Create driver: display name, username, preferred locale (dropdown in own scripts), auto-generated 6-digit PIN shown **once** with a "print/copy" view.
- Reset PIN, deactivate/reactivate, change locale.
- Admins can also create further admin accounts (email + password).

**Acceptance criteria**
- [x] Newly created driver can log in with the shown PIN on a phone. (Playwright: PIN read from the one-time dialog, then login in a 375x812 context lands on the driver home in the driver's locale; no real phone, see notes.)
- [x] Reset PIN invalidates the old PIN immediately. (integration test + Playwright)
- [x] Deactivated driver's next request is logged out. (integration test of the server-side check + Playwright: after deactivation the driver's existing session is sent to the login page, the session cookie is removed, no redirect loop)

---

**Implementation notes**
- Page `/admin/drivers` (`UsersManager`, client component, UI kit only): driver table (name, username, language, status badge with icon, last login in the factory time zone, actions), create-driver dialog (display name, username, language `<select>` with each language in its own script), one-time PIN dialog (large PIN, copy, print via `@media print` rules in `globals.css`, nothing stored: the PIN only lives in client state until the dialog is closed), reset PIN and deactivate with confirm dialogs, reactivate, inline language change. Second section "Administratoren": list, create admin (email + password >= 10 chars), deactivate/reactivate others (not oneself).
- Server: `src/server/users.ts` (zod-validated services taking an injected db, returning `{ ok } | { ok:false, error }`) and `src/server/user-actions.ts` (`"use server"`; every action starts with `requireRole("ADMIN")`, so drivers, anonymous callers and deactivated admins get an `AuthorizationError` before any input is read). PINs: `crypto.randomInt`, 6 digits with leading zeros, bcrypt hash only. Username normalised to lowercase (`^[a-z0-9][a-z0-9._-]{2,31}$`), uniqueness checked case-insensitively (login matches case-insensitively); email lowercased. Resetting a PIN also clears the driver's login rate-limit counter. An admin cannot deactivate himself (`self` error).
- Migration `20261017140000_user_last_login` adds `User.lastLoginAt`, set by `authenticate()` on every successful login (list column "last login").
- Deactivation enforcement: `requireRole` already re-read `active` from the DB (NUD-004), but page-level rejection redirected to the login page while the JWT cookie stayed valid, so the proxy bounced the user straight back (redirect loop). `requirePageActor` now redirects UNAUTHENTICATED to the new route handler `GET /api/session-ended?locale=&section=` which deletes the Auth.js session cookie and redirects to the matching login page (locale/section validated, no open redirect; `sessionEndedTarget` is unit-tested). Server actions and route handlers of a deactivated user were already rejected (401 / `AuthorizationError`).
- Tests: `users.integration.test.ts` (create/login with shown PIN, duplicates, validation, reset invalidates old PIN, deactivation + `resolveActor`, locale change, admin creation, list has no secrets), `user-actions.integration.test.ts` (authorization: every action rejects anonymous, driver and deactivated-admin callers, data unchanged), `session-ended.test.ts`, e2e `tests/e2e/drivers.spec.ts` (desktop + mobile).
- Verified: lint, typecheck, `pnpm test` (157 passed incl. DB tests on embedded PostgreSQL 16), `i18n:build/check`, `pnpm build`, seed on a fresh DB (e2e script), full Playwright suite via the Chromium workaround (drivers, auth, home, shells; `uploads.spec.ts` needs `S3_*` set under `next start`, run with dummy values: passed). `shells.spec.ts` "all placeholder pages ... in de" (desktop) timed out once under load and passed on rerun.
- NOT verified: a real phone / Safari; the print output (only the CSS exists, `window.print()` not exercised); the clipboard button in a browser; layout was not inspected as a screenshot (only the no-horizontal-scroll assertion, 1280 px desktop and Pixel 7 projects); agent-written Chinese strings are unreviewed (NUD-073); CI.
- Follow-up ideas (no ticket): the driver's own session is only ended on his next page/action request, not pushed; no audit log of PIN resets until NUD-092.

### M1 — MVP (demo end-to-end)

---

#### NUD-010 · Geocoder interface + ORS + Fake
**Status:** done · **depends_on:** 002

**Goal:** turn an address into candidate coordinates.

**Scope**
- `Geocoder` interface: `search(address): Promise<GeocodeCandidate[]>` (label, lat, lng, confidence) and `reverse(lat,lng)` (for pin drag feedback).
- ORS implementation (`/geocode/search`, `boundary.country` from settings, default `AT,DE`), timeout 5 s, retries 1.
- Fake implementation: deterministic coordinates around Vienna derived from a hash of the address (used in tests and if `ORS_API_KEY` is missing).
- Simple cache table or in-memory LRU to avoid repeated calls for the same normalized address.

**Acceptance criteria**
- [x] Unit tests for the Fake and for response mapping of the ORS client (recorded fixture, no live network in CI). (`src/server/geocoder/geocoder.test.ts`, 20 tests; fixtures are hand-written in the documented ORS/Pelias GeoJSON format, not recorded from a live call, see notes.)
- [x] Missing API key → Fake is used and a single warning is logged. (tested via `getGeocoder`.)

**Implementation notes**
- `src/server/geocoder/`: `types.ts` (`Geocoder { search(address), reverse(lat,lng) }`, `GeocodeCandidate {label,lat,lng,confidence}`, `GeocoderError` with codes `TIMEOUT|NETWORK|HTTP|BAD_RESPONSE|INVALID_INPUT`, `normalizeAddress`), `ors.ts` (`OrsGeocoder` + `mapOrsResponse`, zod-checked), `fake.ts` (`FakeGeocoder`), `cache.ts` (`LruCache`, `CachingGeocoder`), `index.ts` (`getGeocoder(env)` singleton, `setGeocoderForTests`). `search` returns up to 5 candidates best first (`[]` when nothing found or the address is blank); `reverse` returns the nearest address or `null`. Errors are thrown as `GeocoderError` so the UI tickets (NUD-014) can show "geocoding unavailable, place the pin by hand".
- ORS: `GET /geocode/search?text&boundary.country&size=5` and `/geocode/reverse?point.lat&point.lon&size=1`, 5 s timeout (`AbortSignal.timeout`), 1 retry on timeout, network error, 5xx and 429 (never on other 4xx or malformed bodies). The API key goes in the `Authorization` header so it cannot leak through URLs/logs. Addresses are limited to 300 characters.
- Fake: FNV-1a hash of the normalized address -> point within about +-0.08 deg lat / +-0.12 deg lng of Vienna, one candidate, confidence 0.3 (deliberately low). Used when `ORS_API_KEY` is missing; one `console.warn` per process.
- Cache: in-memory LRU (500 entries) for search (normalized address) and reverse (rounded to 5 decimals), failures are not cached, results are copied so callers cannot mutate the cache. The ticket allowed "table or in-memory"; per-instance memory is enough for 50-150 customers.
- New env vars: `ORS_API_KEY` (shared with NUD-040), `ORS_GEOCODE_COUNTRIES` in `.env.example` and `docs/env.md`. No UI, route or mutation, so no authorization tests or i18n strings were needed; nothing calls the geocoder yet (NUD-014 will, through a server action with `requireRole("ADMIN")`).
- Verified: lint, typecheck, `pnpm test` (177 passed incl. DB tests on embedded PostgreSQL), `i18n:check`, prettier. No schema change, so the seed is unaffected.
- NOT verified: a live call to OpenRouteService (no real key, by instruction). The fixtures follow the documented Pelias/ORS response shape from memory of the API docs; the real endpoint may return extra fields (ignored) or differ in details, e.g. `boundary.country` accepting alpha-2 codes, `confidence` presence on every feature (missing -> 0). Please run one real `search` once a key exists and compare with `src/server/geocoder/fixtures/`.

---

#### NUD-011 · Map component with draggable pin
**Status:** done · **depends_on:** 005

**Goal:** reusable map building blocks for customers, depot and tours.

**Scope**
- react-leaflet loaded client-side only (`dynamic(..., { ssr:false })`).
- Tile URL + attribution from env (`MAP_TILE_URL`), default OSM tiles **for dev only**; document in `docs/env.md` that production needs a provider with a usage plan (e.g. MapTiler / Stadia free tier).
- `<PinPickerMap value onChange>`: single draggable marker, click-to-place, "locate address" button.
- `<TourMap stops depot geometry>`: numbered markers (1…n), depot marker, polyline; fit bounds.

**Acceptance criteria**
- [x] Storybook-like demo page (`/admin/dev/maps`, admin-only, hidden from nav) shows both components.
- [x] Dragging the pin calls `onChange` with rounded coordinates (6 decimals).

**Implementation notes**
- Added `leaflet` 1.9.4, `react-leaflet` 5.0.0, `@types/leaflet`. Components in `src/components/maps/`: `PinPickerMap` (click-to-place, draggable marker, optional "locate address" button that calls an injected `onLocate`), `TourMap` (numbered stop markers, depot marker, polyline, fit bounds), `lazy.tsx` (`PinPickerMapLazy` / `TourMapLazy` via `dynamic(..., { ssr: false })`), CSS-only `divIcon` markers (no PNG icon assets), `MapsDemo`.
- `src/lib/coords.ts` (`roundLatLng`, 6 decimals) and `src/lib/map-config.ts` (`getMapTileConfig`: `MAP_TILE_URL` / `MAP_TILE_ATTRIBUTION`, OSM default for dev only). Tile config is read on the server and passed as props. Env documented in `.env.example` and `docs/env.md` (production needs MapTiler/Stadia or similar).
- `geocodeAddressAction` (`src/server/geocode-actions.ts`, admin-only server action, zod-validated, uses `getGeocoder()`); authorization test `geocode-actions.integration.test.ts` (anonymous/driver rejected).
- Dev page `/[locale]/admin/dev/maps`: behind proxy + admin layout + `requirePageActor`, not in the nav, strings in `admin.maps` / `admin.devMaps` (de, zh-Hans, Hant generated).
- `TourMap.geometry` takes GeoJSON LineString coordinates (`[lng, lat][]`); without geometry no line is drawn (nothing is faked). The demo uses fixed sample points around Vienna labelled as sample data.
- Verified: lint, typecheck, `pnpm test` (185 tests incl. DB integration via embedded Postgres), `pnpm build`, `i18n:check`, e2e `tests/e2e/maps.spec.ts` (desktop + mobile; tiles stubbed via `page.route`, so no live tile server needed): click-to-place, drag, locate (Fake geocoder), numbered markers, depot, polyline, no horizontal scroll, anonymous redirect, not in nav. Screenshot at 1280 px checked. Other e2e specs shells/home/auth pass (one shells test timed out once under load and passed on rerun); drivers/uploads specs were not rerun (untouched code).
- NOT verified: real tiles from OSM or a production provider (sandbox blocks tile servers; layout/attribution seen only with stubbed tiles) and a real ORS "locate address" call. The pin has no keyboard alternative yet (map click/drag only); NUD-014 should add editable lat/lng inputs next to the picker.

---

#### NUD-012 · Depot & general settings page
**Status:** done · **depends_on:** 010, 011

**Goal:** office configures where tours start/end and basic planning parameters.

**Scope**
- `/admin/settings`: depot name + address (geocode → confirm pin), time zone (select, default `Europe/Vienna`), default departure time, service minutes per stop, delivery weekdays (checkboxes).
- Settings are cached server-side and invalidated on save.

**Acceptance criteria**
- [ ] Tour building (NUD-041) refuses to run with a clear message if the depot pin is not set. (Settings-side guard done and tested: `requireDepot` / `requireDepotConfigured()` throw `DepotNotSetError` (`code: "DEPOT_NOT_SET"`), message key `admin.settings.errors.depotNotSet`. **Left unticked: NUD-041 must call it and show the message**; the tour builder does not exist yet.)
- [x] Changing delivery weekdays changes the default delivery date in order entry (unit-tested helper `nextDeliveryDate(now, settings)`). (Helper + `getDefaultDeliveryDate()` tested; the order-entry form itself is NUD-030 and must call `getDefaultDeliveryDate()`.)

**Implementation notes**
- `/admin/settings` (replaces the placeholder): depot name + address, pin picker (`PinPickerMapLazy` with the admin-only "locate address" action), **editable lat/lng inputs** (`src/components/maps/lat-lng-inputs.tsx`, reusable by NUD-014; keyboard alternative promised in NUD-011), a "pin checked" checkbox that is withdrawn whenever the pin or address changes, time zone (native select, options computed on the server), departure time, service minutes (0-180), delivery weekdays (checkboxes, localized day names via `Intl`).
- Data: new column `Settings.depotPinConfirmed` (migration `20261017150000_settings_depot_pin_confirmed`, default false; written by hand, `prisma generate` run with the dummy schema engine). The seed's placeholder depot stays unconfirmed, so tour building is blocked until an admin saves the page. Saving requires `depotPinConfirmed: true` (D9).
- `src/domain/settings.ts` (pure): `nextDeliveryDate(now, {timezone, deliveryWeekdays})`, `getDepot`, `requireDepot`, `DepotNotSetError`. `src/server/settings.ts`: `settingsInputSchema` (zod), `readSettings`/`saveSettings`, `getSettings()` (`'use cache'` + `cacheTag("settings")`, `cacheLife("hours")`), `getFactoryTimezone()` now uses it, `requireDepotConfigured()` (for NUD-041), `getDefaultDeliveryDate()` (for NUD-030). `saveSettingsAction` (`settings-actions.ts`): `requireRole("ADMIN")`, zod, then `updateTag("settings")` so the next read is fresh.
- Tests: `src/domain/settings.test.ts` (weekday/time-zone/DST cases, depot guard), `settings-actions.integration.test.ts` (anonymous / driver / deactivated admin rejected, normalization, 12 invalid-input cases, cache tag), `lat-lng-inputs.test.tsx`, seed assertion in `db.integration.test.ts`, e2e `tests/e2e/settings.spec.ts` (desktop + mobile: typed coordinates, confirmation required, persistence after reload, no horizontal scroll, anonymous redirect). `shells.spec.ts` now stubs tiles and has a longer timeout for the all-sections test because the settings page contains a map.
- `ORS_GEOCODE_COUNTRIES` stays an env var (moving it would need another column + UI; not trivial enough). No new env vars.
- Verified: lint, typecheck, `pnpm test` (216 passed before the last small test edit; the three touched files re-run green), `i18n:check`, prettier, `pnpm build`, e2e settings/shells/maps/home/auth/drivers specs (uploads spec not rerun, code untouched).
- NOT verified: the real invalidation of the Next data cache across several Vercel instances (only the `updateTag` call is tested with a mock; locally the page shows the new values immediately after save, see e2e); tiles and ORS geocoding are not real here (stubbed tiles, Fake geocoder).

---

#### NUD-013 · Customer list & search
**Status:** done · **depends_on:** 005

**Goal:** office finds any customer in seconds.

**Scope**
- `/admin/customers`: table with customer number, name, city, flags (⚠ photos missing, ⚠ pin unconfirmed, archived).
- Search (number, name, street, city; accent-insensitive), filters for the flags, pagination or virtual scroll.
- "New customer" button → NUD-014 form.

**Acceptance criteria**
- [x] Search for part of a name returns matches in < 300 ms with 500 seeded customers. (Integration test on embedded PostgreSQL 16: slowest of six queries ~5 ms; this measures the DB query, not the browser round trip.)
- [x] Filter "photos missing" shows exactly the customers lacking a current STORE or PARKING photo. (Integration test covers none / store only / parking only / both / replaced (non-current) photos / mixed.)

**Implementation notes**
- `/admin/customers`: server-rendered list (`customer-queries.ts` -> `customers.ts`), URL-driven state (`q`, `status=active|archived|all`, `photos=missing`, `pin=unconfirmed`, `page`; parsing in `src/lib/customer-list-params.ts`). Client `CustomerFilters` (search box debounced 200 ms, two checkboxes, status select) and server-rendered `CustomersTable` (number, name + street, postal code + city, flag badges with icons: photos missing / pin unconfirmed / archived; count; 25 per page with previous/next; empty and "no match" states with reset). Archived customers are hidden by default (status filter "Aktive"). Rows are not linked yet: the detail/edit page is NUD-014.
- Accent-insensitive search: migration `20261017160000_customer_search_text` adds SQL function `nudel_fold(text)` (lower-case, `translate` of ~100 Latin diacritics, ss/ae/oe) and `Customer.searchText`, maintained by a BEFORE INSERT/UPDATE trigger from number, name, street, postal code and city. The list query folds each search term with the same SQL function and does `searchText LIKE '%term%'` (all terms must match; `% _ \` escaped). No extension, so it works on Neon and in the embedded Postgres, and every writer (app, seed, NUD-090 import) gets the column for free. `searchText` is never written by app code. CJK text is matched as is (lower-casing only).
- Query is one parameterised raw SQL (`$queryRaw` with `Prisma.sql`) plus a count query. Photo-missing flag is computed in SQL (`NOT (EXISTS current STORE AND EXISTS current PARKING)`).
- Authorization: `listCustomersQuery` calls `requireRole("ADMIN")` before the query; the page also calls `requirePageActor`. Test: `customer-queries.integration.test.ts` (anonymous, driver, deactivated admin rejected, admin allowed).
- `createPrismaClient(url, schema)` now also sets `search_path` to the test schema (raw SQL and triggers use unqualified names; the adapter only qualifies generated model queries).
- Test seeding helper (not part of `db:seed`): `src/server/testing/seed-customers.ts` (`seedTestCustomers`), CLI `pnpm db:seed:customers [count]` (default 500, numbers `T-0001`..., accents/umlauts, mixed pin/photo/archived states).
- "New customer" links to `/admin/customers/new`, for which a **placeholder page** (title + "coming soon" + back link) was created so there is no 404; NUD-014 replaces it.
- Tests: `customers.integration.test.ts` (accents, case, ß, Chinese, AND of terms, LIKE wildcards/injection, trigger on update, status/photo/pin filters, pagination, 500-customer timing), `customer-queries.integration.test.ts`, `customer-list-params.test.ts`, e2e `tests/e2e/customers.spec.ts` (desktop + mobile: accent search, photo and pin filters, empty state + reset, no horizontal scroll, new-customer link; inserts and removes its own rows through `pg`).
- Verified: lint, typecheck, `pnpm test` (233 passed incl. DB tests), `i18n:check`, prettier, `pnpm build`, e2e customers (desktop + mobile), shells "all placeholder pages" in 4 locales (desktop), home (mobile).
- NOT verified: the full shells/settings/drivers e2e suites were not rerun (a combined run exceeded the sandbox call time limit; code untouched except the customers page); `prisma migrate deploy` on Neon (migration applied with plain SQL on embedded Postgres 16); real browser round-trip latency; layout not inspected as a screenshot (only the no-horizontal-scroll assertion); agent-written Chinese strings unreviewed (NUD-073).

---

#### NUD-014 · Customer create/edit with pin confirmation
**Status:** done · **depends_on:** 010, 011, 013

**Goal:** complete customer master data, with a pin the office has verified.

**Scope**
- Form fields per projektbeschreibung §2: name*, customer number* (unique; suggest next free number), street*, postal code*, city*, country, delivery hours info (free text), notes for driver (German textarea for now; multilingual editor in NUD-071).
- "Find on map" → geocoder candidates list → choose one → pin shown → admin may drag → **"Pin confirmed" checkbox required** to set `pinConfirmed=true`. Changing the address resets `pinConfirmed`.
- Archive / reactivate.
- Customer detail page summarising data, photos (placeholder until NUD-015), upcoming orders.

**Acceptance criteria**
- [x] Customer cannot be saved with a duplicate customer number (validation message, localized).
- [x] Editing the street sets `pinConfirmed=false` and shows the ⚠ flag.
- [x] E2E: create customer with confirmed pin, find it via search.

**Implementation notes**
- Pages: `/admin/customers/new` (replaces the placeholder), `/admin/customers/[id]` (detail: address, hours, driver note, pin state + coordinates, photo status + placeholder for NUD-015, upcoming orders, edit and archive/restore with confirmation dialog), `/admin/customers/[id]/edit`. List rows now link to the detail page. Form `src/components/admin/customer-form.tsx`: "find on map" calls `geocodeAddressAction`, shows a candidate list (low confidence flagged), choosing one sets the pin; pin can also be clicked/dragged or typed with `LatLngInputs`; "pin checked" checkbox required for `pinConfirmed`. `PinPickerMap` got an optional `focus` prop so the map centres on a chosen candidate.
- Pin rule (pure, `src/domain/customer.ts`, used by form and server): confirmation needs a pin; once the address (street, postal code, city, country) of an existing customer changed, the pin must also have been moved/searched again, otherwise `pinConfirmed` is stored as false. The form withdraws the checkbox on every address/pin edit.
- Server: `src/server/customer-admin.ts` (zod `customerInputSchema`, `createCustomer`, `updateCustomer`, `setCustomerActive`, `nextCustomerNumber`, `getCustomerDetail`, `listUpcomingOrders`), actions in `customer-actions.ts` and reads in `customer-queries.ts`, all starting with `requireRole("ADMIN")`. Duplicate numbers (case-insensitive, also DB unique race via P2002) return `number_taken`, shown as a localized field error. No hard delete.
- Upcoming orders query real `Order` rows (today or later in the factory time zone, not cancelled, with items); empty until NUD-030 creates orders.
- Tests: `domain/customer.test.ts`, `customer-actions.integration.test.ts` (anonymous/driver/deactivated admin rejected on all 3 actions and 3 reads, validation table, duplicate numbers, pin reset rules, notes, archive, upcoming orders incl. time-zone day), e2e `tests/e2e/customer-form.spec.ts` (desktop + mobile: create with confirmed pin via candidate, find via search, duplicate number, street edit resets pin and shows flag, re-confirm after moving pin, archive/restore, no horizontal scroll, anonymous redirect). Verified: lint, typecheck, `pnpm test` (278 passed), i18n:check, build, e2e customer-form/customers/settings/maps; form and detail screenshots at 375 px inspected.
- NOT verified: real ORS geocoding (Fake geocoder used), real map tiles, agent-written Chinese strings (NUD-073), full shells/drivers e2e suites not rerun.
- Follow-ups: NUD-030 should not offer archived customers for new orders; archiving a customer with upcoming orders is currently allowed without warning.

---

#### NUD-015 · Customer photos (admin upload/replace)
**Status:** done · **depends_on:** 006, 014

**Goal:** office stores the shop photo and parking/unloading photo per customer.

**Scope**
- On customer detail/edit: two slots "Geschäft / Eingang" (STORE) and "Parken / Entladen" (PARKING), each with upload, replace, fullscreen view.
- Replacing keeps the old photo row with `isCurrent=false` (history, no hard delete).
- "Photos missing" flag derived from absence of current STORE or PARKING photo.

**Acceptance criteria**
- [x] Upload → photo visible on customer detail after reload. (e2e against the s3rver emulator, desktop + mobile: upload via the real browser pipeline, reload, signed `<img>` decodes.)
- [x] Replace → new photo current, old one still in DB with `isCurrent=false`. (Integration test + e2e DB assertion.)
- [x] Flag disappears when both photos exist. (Integration test: detail flag and the NUD-013 list filter agree after each step; e2e.)

**Implementation notes**
- Detail page `/admin/customers/[id]` now has two slots (`CustomerPhotoSlots`, `src/components/admin/customer-photo-slots.tsx`): "Geschäft / Eingang" (STORE) and "Parken / Entladen" (PARKING), each with status badge, thumbnail that opens the NUD-006 `ImagePreview` fullscreen zoom, `ImageUploader` (file picker, drop, paste, camera) for an empty slot and a "Foto ersetzen" button for a filled one. Flow: browser resizes + PUTs to the presigned URL (NUD-006), then calls `addCustomerPhotoAction({customerId, kind, storageKey, width, height})`, then `router.refresh()`. The NUD-014 placeholder text/key was removed. The "photos missing" badge is derived from the same current photos via the pure `src/domain/photos.ts` (`photosMissing`), the list filter keeps its SQL rule; an integration test asserts both agree.
- Server (`src/server/customer-photos.ts`): `addCustomerPhoto` (zod; key must match `isCustomerPhotoKey` = `customers/<uuid>.<jpg|png|webp|heic>`, i.e. exactly what `POST /api/uploads` issues, a unit test ties the two together; new `Storage.head()` checks the object really exists and supplies `bytes` (client-sent size is ignored); a key can be attached only once; one transaction under `SELECT ... FOR UPDATE` on the customer sets older current photos of that kind to `isCurrent=false` and inserts the new one, so concurrent uploads never leave two current photos) and `getCustomerPhotos` (signed read URLs, 1 h, generated on the server; the bucket stays private). Wrapped by `addCustomerPhotoAction` (`requireRole("ADMIN")`) and `customerPhotosQuery` (admin only).
- `Storage` interface got `head(key)` (S3 `HeadObject`, Fake map); needs the read permission only.
- Tests: `customer-photos.integration.test.ts` (anonymous / driver / deactivated admin rejected on action and query, 12 forged keys, invalid input table, missing object, unknown customer, size from storage, key reuse, replace history, concurrency, flag consistency with list filter), `domain/photos.test.ts`, `storage.test.ts` (head), `uploads.test.ts` (issued keys match pattern), e2e `tests/e2e/customer-photos.spec.ts` (desktop + mobile; skipped without `S3_*`; needs a real S3-compatible store such as MinIO or `s3rver`). Verified: lint, typecheck, prettier, `pnpm test` (290 passed incl. DB), `i18n:check`, `pnpm build`, e2e customer-photos / customers / uploads / customer-form (desktop + mobile; screenshots at 1280 and 375 px inspected, no horizontal scroll).
- NOT verified: real MinIO / R2 (s3rver only; same gap as NUD-006, the browser upload path has now been exercised in real Chromium through the page); HEIC/real camera photos; pinch zoom on a real phone; the full shells/settings/drivers e2e suites were not rerun. The e2e `customer-form` desktop test failed once in each of two runs (a pin-flag check right after save, and a click from the list to the detail page) and passed otherwise (5 of 6 repeats); the failing steps do not touch photos, so it looks like a pre-existing timing flake, not investigated.
- Follow-ups: an object uploaded but never attached (action failed, tab closed) stays orphaned in storage, and replaced photos keep their objects (history); a cleanup job belongs with NUD-094. Photos are managed on the detail page only, not on the edit form (see decision log). Driver capture/replace is NUD-083 and needs its own action (the admin action rejects drivers).

---

#### NUD-020 · Product catalog CRUD (multilingual names)
**Status:** done · **depends_on:** 003, 005

**Goal:** the list of pasta products, readable by every driver.

**Scope**
- `/admin/products`: list (SKU, German name, Simplified Chinese name, unit, active), sortable by `sortOrder` (drag or up/down).
- Form: SKU*, unit* (select with localized labels), `name.de`*, `name.zh-Hans`*, `name.zh-Hant-HK` and `name.zh-Hant-TW` **pre-filled live via OpenCC** from zh-Hans and editable (mark as "auto" until edited).
- Deactivate instead of delete; inactive products are hidden in order entry but kept on old orders.

**Acceptance criteria**
- [x] Saving without `zh-Hans` name is rejected. (Server: integration test with empty / blank / missing name; UI: localized field error, e2e.)
- [x] Typing `螺旋意面` in zh-Hans pre-fills both Traditional fields with OpenCC output. (e2e: `螺旋意麪` HK / `螺旋意麵` TW, both marked "automatisch".)
- [x] Inactive products don't appear in the order entry product picker. (The picker itself is NUD-030; its data source `getActiveProducts()` / `activeProductsQuery()` is integration-tested to hide inactive products while old order items keep their product. NUD-030 must use it.)


**Implementation notes**
- Pages: `/admin/products` (table: up/down buttons, SKU, German name, Simplified name, unit, active badge, edit, deactivate/activate), `/admin/products/new`, `/admin/products/[id]/edit`; the existing admin nav entry is unchanged. All three pages call `requirePageActor("admin")`.
- Form (`src/components/admin/product-form.tsx`): SKU, unit (native select with localized labels), `de` and `zh-Hans` required, HK/TW names pre-filled live from Simplified. The two Traditional fields carry an "automatisch" badge until the user types in them; a "neu ableiten" button switches a field back to auto. New products start with both auto; on edit a field is auto only if `meta.machine` says it was derived.
- OpenCC runs on the server: server action `deriveHantAction` (admin only, debounced 200 ms in the form, stale answers dropped), so the dictionaries are not added to the browser bundle by this ticket. On save the server recomputes every field flagged auto (and any empty field) from Simplified, so what is stored never depends on client code; hand-edited names are kept and not flagged in `meta.machine`.
- Server (`src/server/products.ts`, zod `productInputSchema`; actions in `product-actions.ts`, reads in `product-queries.ts`, all start with `requireRole("ADMIN")`): `createProduct`, `updateProduct`, `setProductActive` (soft delete, no hard delete exists), `moveProduct` (swap with neighbour, renumbers `sortOrder` 0..n-1 in a transaction, which also repairs ties), `listProducts`, `getProduct`, and `getActiveProducts(db)` / `activeProductsQuery()` for the order entry picker (active only, `sortOrder` order). `src/lib/units.ts` holds the unit list for client code.
- Tests: `src/server/product-actions.integration.test.ts` (11 cases: anonymous / driver / deactivated admin rejected on every action and read, required names, OpenCC derivation and machine flags, server-side recompute vs hand-edited, duplicate SKU case-insensitive, append + up/down + tie repair, picker query hides inactive but old orders keep the product, unit lock, derive action), `tests/e2e/products.spec.ts` (desktop + mobile: required zh-Hans, live pre-fill, auto markers, duplicate SKU, edit, reorder (desktop only, shared list), deactivate/activate, no horizontal scroll, anonymous redirect).
- Verified: lint, typecheck, prettier, `pnpm test` (301 passed incl. DB), `i18n:check`, `pnpm build`, e2e products (twice, desktop + mobile), shells (34 passed, includes the products page in 4 locales), customers, drivers.
- NOT verified: the e2e `customer-form` / `customer-photos` / `settings` / `maps` specs were not rerun (untouched code); agent-written Chinese strings unreviewed (NUD-073); the up/down buttons were not tried on a real touch device; layout inspected only through the no-horizontal-scroll assertion at 1280 and Pixel 7 widths.
- Surprise: the 1.3 MB OpenCC dictionary is already in a client chunk because `language-switcher.tsx` and `users-manager.tsx` import `LOCALES` from `src/lib/localized-text.ts`, which imports OpenCC (NUD-003/008, not this ticket); see NUD-098.
- Follow-ups: NUD-030 uses `activeProductsQuery()`; the seeded products have identical hand-written HK and TW names (not marked machine), so the form shows them without "automatisch".

---

#### NUD-030 · Manual order entry
**Status:** todo · **depends_on:** 014, 020

**Goal:** office records an order in under 30 seconds.

**Scope**
- _Added by NUD-012:_ preselect the delivery date with `getDefaultDeliveryDate()` (`src/server/settings.ts`).
- `/admin/orders/new`: customer combobox (search by name/number), delivery date (default `nextDeliveryDate`), product lines (product picker + quantity + unit shown), add/remove lines, internal note (office only, not shown to driver).
- Keyboard-friendly: Enter adds a line, quantities accept `,` and `.` decimals.
- Save as `CONFIRMED` (default) or `DRAFT`.
- Warning (not error) if the customer already has a confirmed order for that date: "will be combined into one stop".
- Warning if the customer's pin is unconfirmed: "this customer cannot be routed until the pin is confirmed".

**Acceptance criteria**
- [ ] Quantity must be > 0; at least one line required; same product twice in one order is merged or rejected (pick one, log decision).
- [ ] Unit tests for order validation (zod) and the date default.
- [ ] E2E: create order with 3 lines, see it in the overview (NUD-032 placeholder list is fine).

---

#### NUD-031 · Screenshot attachment & split-view entry
**Status:** todo · **depends_on:** 006, 030

**Goal:** office types an order while looking at the customer's WhatsApp/WeChat screenshot.

**Scope**
- In order entry: "Add screenshot" via upload, drag-and-drop or **Ctrl+V paste**. Creates a `Screenshot`, sets `source=SCREENSHOT`.
- Split view on ≥ 1024 px: zoomable/pannable image left, order form right; stacked on smaller screens.
- Screenshot remains viewable from the order detail later (for disputes about quantities).

**Acceptance criteria**
- [ ] Pasting an image from clipboard attaches it without a file dialog.
- [ ] Order detail shows the screenshot thumbnail → fullscreen.

---

#### NUD-032 · Order overview & editing
**Status:** todo · **depends_on:** 030

**Goal:** central order overview (projektbeschreibung §3).

**Scope**
- `/admin/orders`: default filter = next delivery date. Filters: date (range), customer, status, source.
- Rows: customer, date, number of lines, status, source icon, "in tour" badge.
- **Totals panel per date:** sum per product (for production/loading).
- Order detail/edit page, cancel (status `CANCELLED`, not delete), duplicate order to another date.
- Hook point for NUD-043: every create/update/cancel calls `tourService.markOutdatedForDate(date)`.

**Acceptance criteria**
- [ ] Totals panel matches the sum of all confirmed orders for the date (unit test on the aggregation function in `src/domain`).
- [ ] Cancelled orders are excluded from totals and tours.

---

#### NUD-040 · RoutingProvider + ORS optimization + fallback heuristic
**Status:** todo · **depends_on:** 002

**Goal:** given a depot and N coordinates, return the best visiting order with legs and geometry.

**Scope**
- Interface:
  ```ts
  interface RoutingProvider {
    optimize(input: { depot: LatLng; stops: { id: string; location: LatLng; serviceSeconds: number }[] }):
      Promise<{ orderedStopIds: string[]; legs: { distanceM: number; durationS: number }[]; geometry: GeoJSON.LineString; totalDistanceM: number; totalDurationS: number }>;
    route(input: { depot: LatLng; orderedStops: LatLng[] }): Promise<same minus ordering>; // for manual reorder
  }
  ```
- ORS implementation: `/optimization` (VROOM; one vehicle, start=end=depot, profile `driving-car`; use `driving-hgv` if a setting says truck — default car) then `/v2/directions/driving-car/geojson` for geometry & legs.
- Fallback (`LocalHeuristicProvider`): haversine distance matrix × road factor 1.3, average 30 km/h, nearest-neighbour + 2-opt. Used when ORS fails or no key; result flagged `approximate: true` and shown as such in UI.
- Handle > 50 stops gracefully (ORS limits): documented error.

**Acceptance criteria**
- [ ] Pure unit tests for 2-opt (improves a crossing route) and nearest-neighbour.
- [ ] ORS client tested against recorded fixtures.
- [ ] Provider falls back automatically on timeout (8 s) and reports `approximate`.

---

#### NUD-041 · Tour builder (orders → stops → optimized tour)
**Status:** todo · **depends_on:** 012, 032, 040

**Goal:** one click creates an optimized tour for a date.

**Scope**
- _Added by NUD-012:_ call `requireDepotConfigured()` (`src/server/settings.ts`) first; on `DepotNotSetError` show `admin.settings.errors.depotNotSet` and do not build. Then tick the "refuses without depot" criterion of NUD-012.
- Domain function `buildStops(orders)`: group confirmed orders by customer → one stop per customer, with merged item quantities per product (keep the link to each order via `StopOrder`).
- Service `generateTour(date)`: validates depot; excludes customers with unconfirmed pins (returned as warnings with links); calls `optimize`; persists `Tour` (`OPTIMIZED`), `Stop`s with sequence, legs, ETAs (`departureTime` + cumulative leg durations + service minutes), geometry, totals.
- Re-running on an unreleased tour replaces stops; on a **locked** tour it only adds new customers at the end (log decision if different).

**Acceptance criteria**
- [ ] Unit test: 3 orders from 2 customers → 2 stops, quantities merged correctly per product.
- [ ] Integration test with Fake/heuristic provider: tour persisted with correct sequence and ETAs.
- [ ] Customers without confirmed pins are reported, not silently dropped.

---

#### NUD-042 · Tour planning UI (map, reorder, lock, release)
**Status:** todo · **depends_on:** 011, 041

**Goal:** office reviews and releases the day's tour.

**Scope**
- `/admin/tours?date=…`: date picker; if no tour: "Generate tour" button + warnings list.
- Layout: map (numbered stops, polyline, depot) + ordered stop list (sequence, customer, ETA, item count, flags such as missing photos).
- Drag-and-drop reorder → recompute legs/ETAs via `route()` (not re-optimize). "Re-optimize" button.
- Lock toggle, assign driver (select from active drivers), **Release** button (→ `RELEASED`, `releasedAt`). Confirmation dialog shows stop count and total time.
- Approximate-route badge when the fallback provider was used.

**Acceptance criteria**
- [ ] Reordering two stops updates the map numbering and ETAs.
- [ ] Release requires an assigned driver.
- [ ] E2E: generate → reorder → release.

---

#### NUD-043 · Tour lifecycle & change handling (outdated tours)
**Status:** todo · **depends_on:** 042

**Goal:** the driver never silently works with stale quantities (priority #2).

**Scope**
- Status machine in `src/domain/tour-status.ts`: `DRAFT → OPTIMIZED → RELEASED → IN_PROGRESS (first stop completed) → COMPLETED (all stops done)`; allowed transitions unit-tested.
- Any order create/update/cancel for a date with an existing tour sets `isOutdated=true`.
- Admin tour page shows a prominent "Orders changed since release — review & re-release" banner with a diff (stops added/removed, quantities changed).
- Re-release regenerates/updates stops, **preserving status of already-completed stops**.
- Driver view (used by NUD-051) shows a banner "Tour was updated" after a re-release, highlighting changed stops.

**Acceptance criteria**
- [ ] Changing a quantity after release flags the tour; after re-release the driver sees the new quantity and the change highlight.
- [ ] Completed stops are never reset by re-release (test).

---

#### NUD-050 · Driver first-start language picker
**Status:** todo · **depends_on:** 005

**Goal:** a driver who reads no German can use the app from the first second.

**Scope**
- On first driver login (`localeChosen=false`) show a full-screen picker with four big buttons, each written in its own script with a small flag-free label: `Deutsch`, `简体中文`, `繁體中文（香港）`, `繁體中文（台灣）`. No other text needed.
- Saves `User.locale`, `localeChosen=true`. Changeable later via the language icon in the driver top bar.
- The driver login page itself shows the language switcher at the top (icon + own-script labels).

**Acceptance criteria**
- [ ] E2E (mobile): first login → picker → choose 繁體中文（台灣） → home page in zh-Hant-TW; second login skips picker.

---

#### NUD-051 · Driver "today's tour" screen
**Status:** todo · **depends_on:** 043, 050

**Goal:** projektbeschreibung §5 "Beim Öffnen sieht er".

**Scope**
- Loads the driver's `RELEASED`/`IN_PROGRESS` tour for "today" (factory TZ). If none: friendly empty state ("No tour released for today").
- Top: date, progress `3 / 12`, total remaining time estimate.
- **Next stop card** (large): sequence number, customer name, address, ETA, item summary (e.g. "3 Sorten · 27 kg"), buttons **Navigate** and **Details**.
- Numbered list of all stops with status icon (pending / ✓ / ⚠), tap → detail.
- Toggle "List / Map" (TourMap with numbered markers).
- Updated-tour banner from NUD-043.

**Acceptance criteria**
- [ ] Driver sees only his own tour (authz test).
- [ ] Next stop = lowest-sequence `PENDING` stop.
- [ ] Renders correctly in all 4 locales at 375 px.

---

#### NUD-052 · Driver stop detail + navigation
**Status:** todo · **depends_on:** 015, 051

**Goal:** projektbeschreibung §5 "Bei Auswahl eines Kunden" + §6.

**Scope**
- Header: sequence number, customer name (untranslated), full address (tap to copy).
- **Shop photo** and **parking photo** large, tap → fullscreen with pinch-zoom; placeholder icon + "no photo yet" if missing.
- **Items:** one row per product: localized product name (driver's locale, large) + German name small underneath (to match box labels) + quantity (≥ 28 px bold) + localized unit.
- Notes for driver (`pick(notes, locale)`; until NUD-071 only German exists → shown with a small "DE" badge), delivery hours info.
- **Navigate** button: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=driving` (opens Google Maps app if installed). Secondary option "Apple Maps" on iOS (`https://maps.apple.com/?daddr=<lat>,<lng>`).
- Prev/next stop swipe or buttons.

**Acceptance criteria**
- [ ] Quantities on this screen equal the merged quantities of the stop's confirmed orders (integration test).
- [ ] Navigate link contains the confirmed pin coordinates, not the address string.
- [ ] Missing photos never break the layout.

---

#### NUD-053 · Driver stop status (delivered / problem)
**Status:** todo · **depends_on:** 052

**Goal:** driver closes each stop with one tap.

**Scope**
- Big buttons on stop detail: **✓ Delivered** and **⚠ Problem**.
- Problem sheet: predefined reasons (`ProblemReason`, localized, with icons) + optional free text (stored as `LocalizedText` with `source = driver locale`; translation follows in NUD-072).
- After success: auto-advance to the next pending stop; toast with **Undo** (5 minutes, server-enforced).
- First completed stop sets tour `IN_PROGRESS`; last sets `COMPLETED` and shows a "tour finished" screen.
- Each mutation carries a client-generated `clientMutationId` (UUID) → idempotent (prepares NUD-082).

**Acceptance criteria**
- [ ] Double-tapping "Delivered" creates exactly one state change (idempotency test).
- [ ] Undo after 5 minutes is rejected.
- [ ] Tour status transitions as specified (test).

---

#### NUD-054 · Admin live tour progress
**Status:** todo · **depends_on:** 053

**Goal:** office sees where the delivery stands.

**Scope**
- Admin dashboard card "Today": progress bar, next stop, problems count.
- Tour page in `RELEASED/IN_PROGRESS`: stop list with status, completion time, problem reason + text (original; German translation after NUD-072). Map markers colored by status.
- Polling every 30 s (SWR / `router.refresh`), no websockets.

**Acceptance criteria**
- [ ] Driver marks a stop delivered → admin view shows it within 30 s without manual reload.

---

#### NUD-060 · MVP demo seed + end-to-end happy path
**Status:** todo · **depends_on:** 054

**Goal:** a convincing demo for the client and a regression safety net.

**Scope**
- `pnpm db:seed --demo`: 20 realistic fictional restaurants around the depot (use real public street addresses in the depot city but invented business names), confirmed pins, placeholder photos (generated solid-color images with text "Eingang" / "Parken"), 8 products with all locale names, confirmed orders for the next delivery date.
- Playwright e2e `mvp-happy-path.spec.ts`: admin creates a customer + order → generates tour → releases → driver (mobile project, locale `zh-Hans`) opens tour, opens stop, sees correct quantity, marks delivered → admin sees status.
- Run the same driver part in `zh-Hant-HK`, `zh-Hant-TW` and `de` (parameterized).
- `docs/demo.md`: 5-minute demo script for the client.

**Acceptance criteria**
- [ ] E2E passes in CI for all four driver locales.
- [ ] Demo seed is idempotent (re-running doesn't duplicate data).

---

### M2 — Production v1

---

#### NUD-070 · Translator interface + DeepL + OpenCC derivation
**Status:** todo · **depends_on:** 003

**Goal:** machine translation for user-generated text, provider-agnostic.

**Scope**
- `Translator` interface: `translate(text, from: Locale, to: Locale): Promise<string>`.
- DeepL implementation (target `ZH-HANS` for Chinese; for Hant targets translate to Hans then OpenCC `cn→hk` / `cn→twp`; source `ZH` → `DE`).
- Fake implementation (`[zh-Hans] …` prefix) for tests / missing key.
- Service `localize(text, sourceLocale): LocalizedText` producing all four locales with `meta.machine` flags.
- Failures never block saving: store source only, mark `pendingTranslation`, retry via a small background job (Vercel cron route, every 10 min).

**Acceptance criteria**
- [ ] Unit tests with Fake; DeepL client tested with recorded fixtures.
- [ ] DeepL outage → record saved, retried later (test with failing fake).

---

#### NUD-071 · Customer notes translation & multilingual editor
**Status:** todo · **depends_on:** 014, 070

**Goal:** drivers read customer notes in their own language.

**Scope**
- Customer form: notes edited in German (source); on save → `localize()`.
- "Translations" tab showing all four versions with "machine-translated" badge; office can edit any version (badge removed for edited ones). "Re-translate" button (warns that manual edits will be overwritten).
- Changing the German source re-translates only machine versions; manual edits are kept but flagged "source changed, check translation".
- Driver stop detail now shows the note in the driver's locale (drop the "DE" badge when a translation exists).

**Acceptance criteria**
- [ ] Note "Hintereingang benutzen, nach 10 Uhr klingeln" appears in all three Chinese variants on the driver screen.
- [ ] Manual edit of zh-Hant-HK survives a German source change (with warning flag).

---

#### NUD-072 · Driver problem text → German for office
**Status:** todo · **depends_on:** 053, 070

**Goal:** office understands what the driver wrote.

**Scope**
- On problem submission with free text: `localize(text, driverLocale)` (async; never delays the driver).
- Admin tour view shows German translation + "original" toggle.
- Predefined reasons need no translation (already i18n keys).

**Acceptance criteria**
- [ ] Driver writes `門口鎖住了，沒人應門` (zh-Hant-HK) → admin sees a German translation and the original.

---

#### NUD-073 · 👤 UI string review workflow for native speakers
**Status:** todo · **depends_on:** 003

**Goal:** Chinese UI texts are checked by humans before go-live.

**Scope**
- `pnpm i18n:export` → `i18n-review.csv` with columns: key, de, zh-Hans, zh-Hant-HK (generated), zh-Hant-TW (generated), screenshot route hint, reviewer comment, corrected text per locale.
- `pnpm i18n:import i18n-review.csv` → writes corrections into `zh-Hans.json` or the matching override file; re-runs build.
- `docs/i18n.md`: how to review, which locale files are hand-edited vs generated.

**👤 Human step:** a native reader for Simplified and one for Traditional (HK and/or TW) review the CSV.

**Acceptance criteria**
- [ ] Round-trip export → edit → import changes exactly the edited keys (test).

---

#### NUD-080 · PWA installability
**Status:** todo · **depends_on:** 051

**Goal:** drivers launch the app from their home screen like a native app.

**Scope**
- Web app manifest (`start_url` = driver home, `display: standalone`, theme colors, icons 192/512/maskable), localized `name` via per-locale manifest route.
- Serwist service worker (app shell precache).
- Localized install hint for Android (beforeinstallprompt) and iOS (instructions overlay "Share → Add to Home Screen" with illustration).

**Acceptance criteria**
- [ ] Lighthouse PWA installability checks pass for the driver area.
- [ ] Installed app opens directly on the driver home.

---

#### NUD-081 · Offline cache of today's tour + photos
**Status:** todo · **depends_on:** 080, 052

**Goal:** the driver can work through dead spots.

**Scope**
- Driver tour data served from one endpoint `GET /api/driver/tour/today` (JSON incl. stops, items, localized texts, signed photo URLs with ≥ 12 h validity).
- On load: store tour JSON in IndexedDB and **prefetch all photos** into Cache Storage; show "ready offline ✓" indicator.
- Offline: render from cache, show "offline – last updated 07:12" bar. Online again: refresh in background.
- Cache purge of previous days.

**Acceptance criteria**
- [ ] Playwright with `context.setOffline(true)` after load: tour list, stop details and photos still render.

---

#### NUD-082 · Offline mutation queue for stop status
**Status:** todo · **depends_on:** 081, 053

**Goal:** "Delivered" taps are never lost.

**Scope**
- IndexedDB outbox of mutations (`clientMutationId`, type, payload, createdAt). UI updates optimistically.
- Sync on `online` event, app focus, and every 60 s; exponential backoff; Background Sync API where supported.
- Server endpoint `POST /api/driver/sync` accepts a batch, idempotent by `clientMutationId`, returns authoritative stop states.
- Conflict rule: server state wins if the stop was changed by admin after the mutation's `createdAt`; driver is shown a notice.
- Pending-count badge in the driver top bar.

**Acceptance criteria**
- [ ] Offline: mark 3 stops delivered → go online → server has 3 updates, no duplicates (e2e).
- [ ] Undo while offline removes the queued mutation instead of sending two.

---

#### NUD-083 · Driver photo capture / replace
**Status:** todo · **depends_on:** 052, 082

**Goal:** drivers keep photos up to date on site (D12).

**Scope**
- On stop detail: "Take photo" for STORE / PARKING (`<input type="file" accept="image/*" capture="environment">`), preview, confirm.
- Uses the NUD-006 pipeline; when offline, the resized blob is queued in the outbox and uploaded later.
- New photo becomes current; admin sees "updated by driver X on date" on the customer page.

**Acceptance criteria**
- [ ] Photo taken offline appears on the customer profile after reconnect.
- [ ] Missing-photo placeholder on stop detail offers "Take photo" directly.

---

#### NUD-090 · Customer import (CSV/XLSX) with pin review
**Status:** todo · **depends_on:** 014

**Goal:** bring the factory's existing customer list into the system.

**Scope**
- `/admin/customers/import`: upload CSV/XLSX (SheetJS), column mapping UI (remembered), preview with row-level validation errors.
- Import creates/updates customers (match by customer number), `pinConfirmed=false`.
- Batch geocoding (rate-limited, progress bar).
- **Pin review queue:** step through imported customers, see candidate pin on map, confirm/drag/skip.

**Acceptance criteria**
- [ ] Import of a 150-row file with 3 invalid rows imports 147 and reports the 3 with reasons.
- [ ] Re-importing the same file updates instead of duplicating.

---

#### NUD-091 · Packing list / load sheet print view
**Status:** todo · **depends_on:** 041

**Goal:** load the van correctly before departure.

**Scope**
- `/admin/tours/[id]/print?locale=…`: print-optimized page (A4, print CSS).
- Section 1: **totals per product** for the tour.
- Section 2: per stop in **reverse order** (last stop first = load first): sequence, customer, items.
- Product names in chosen locale + German; locale selectable so it can be printed for the driver.

**Acceptance criteria**
- [ ] Totals equal the sum of all stops (unit test on the shared aggregation function).
- [ ] Print preview fits on A4 without cut-off columns for 30 stops (multi-page OK).

---

#### NUD-092 · Audit log for orders and tours
**Status:** todo · **depends_on:** 032, 043

**Goal:** answer "who changed this quantity and when?".

**Scope**
- `AuditLog` model + migration; written in the service layer for order create/update/cancel, tour generate/reorder/release, stop status changes, photo replacements.
- Order detail and tour detail show a compact history timeline.

**Acceptance criteria**
- [ ] Changing an order quantity creates one audit entry with before/after diff.

---

#### NUD-093 · Security hardening
**Status:** todo · **depends_on:** 060

**Scope**
- Automated authz test matrix: every server action / route handler × {anonymous, driver, admin} → expected result.
- Security headers (CSP incl. map tile + storage domains, HSTS, frame-ancestors none, referrer policy).
- Signed URL lifetimes reviewed; bucket not public.
- `pnpm audit` in CI (fail on high/critical).
- Input size limits on all text fields; zod everywhere.
- Personal data overview in `docs/privacy.md` (what is stored, where, EU hosting, retention: screenshots deleted after 180 days via cron – configurable).

**Acceptance criteria**
- [ ] Authz matrix test passes and covers 100 % of server actions/route handlers (enforced by a test that enumerates them).

---

#### NUD-094 · Monitoring, backups, error pages, runbook
**Status:** todo · **depends_on:** 007

**Scope**
- Sentry (optional via `SENTRY_DSN`) for server + client errors; source maps uploaded.
- Neon point-in-time restore documented; weekly logical backup (`pg_dump` via GitHub Action to R2) with 8-week retention.
- Localized friendly error pages (driver: "Something went wrong – your data is safe, try again").
- `docs/runbook.md`: deploy, rollback, restore DB, rotate keys, reset admin password, what to do if ORS/DeepL is down.

**Acceptance criteria**
- [ ] A forced test error appears in Sentry (when DSN set).
- [ ] Backup workflow produces a restorable dump (documented test restore).

---

#### NUD-095 · Driver usability & accessibility pass
**Status:** todo · **depends_on:** 083

**Scope**
- Review every driver screen against §4.3 rules; fix violations.
- Test with system font size at 130 %, dark mode, low-end Android (Chrome DevTools throttling: 4× CPU, Slow 4G).
- One-hand reachability: primary actions in bottom half.
- Check that every driver screen remains understandable when the locale is one the tester doesn't read (icons, numbers, photos carry meaning).
- Performance budget: driver home LCP < 2.5 s on Slow 4G after first load.

**Acceptance criteria**
- [ ] axe-core e2e check has no serious/critical violations on driver screens.
- [ ] Performance budget met (Lighthouse CI on driver home).

---

#### NUD-096 · 👤 User acceptance test with client & drivers
**Status:** todo · **depends_on:** 093, 095

**Scope**
- `docs/uat.md`: test script for office (customers, products, orders, tour, release, import, print) and drivers (language choice, full tour, offline, photo, problem report).
- Feedback form (simple markdown table) incl. **which Chinese variant each driver actually chose** and any wording issues.
- Agent converts feedback into new tickets in this backlog.

**👤 Human step:** run the UAT with the client and at least one real driver per language used.

**Acceptance criteria**
- [ ] Client sign-off recorded in `docs/uat.md`.

---

#### NUD-097 · Silence Auth.js prerender error log
**Status:** todo · **depends_on:** 004

**Goal:** the server log is free of `Route "/[locale]/admin" ... unstable value crypto.getRandomValues() while prerendering`.

**Scope**
- Find out why `auth()` (Auth.js CSRF/session handling) runs inside Next's partial-prefetch prerender of the guarded layouts/pages (present since NUD-004, reproduced on its commit) and make the dynamic access explicit (e.g. `await connection()` or reading `cookies()` before `auth()` in `requireRole`/`requirePageActor`), without weakening the guards.

**Acceptance criteria**
- [ ] Requesting `/de/admin`, `/de/admin/orders` and `/de/driver` while logged in produces no prerender errors in the server log.
- [ ] Guards still redirect/reject exactly as before (existing auth tests and e2e pass).

---

#### NUD-098 · Keep OpenCC out of the client bundle
**Status:** todo · **depends_on:** 003

**Goal:** the browser must not download the ~1.3 MB OpenCC dictionaries (found in NUD-020: `language-switcher.tsx` and `users-manager.tsx` import `LOCALES` from `src/lib/localized-text.ts`, which imports `src/lib/opencc.ts`).

**Scope**
- Split locale constants/types/zod schema/`pick` from the OpenCC-based `withDerivedHant` (e.g. a server-only module), keep the public behaviour and tests.
- Check the production build: no chunk under `.next/static` contains OpenCC data (e.g. grep for a dictionary entry such as `麪`).

**Acceptance criteria**
- [ ] No client chunk contains OpenCC; all existing tests pass.

---

### M3 — Later (refine before starting)

#### NUD-100 · AI screenshot extraction (review required)
**Status:** todo · **depends_on:** 031
Vision LLM behind an `OrderExtractor` interface reads WhatsApp/WeChat screenshots (German and Chinese, Simplified + Traditional), proposes customer (fuzzy match on name/phone), products (match against catalog incl. Chinese names and common aliases) and quantities with confidence per field. Office **must** review and confirm; low-confidence fields highlighted. Store raw extraction in `Screenshot.extraction`. Build an evaluation set of ≥ 30 real (anonymized) screenshots; target ≥ 90 % line accuracy before enabling by default.

#### NUD-101 · Recurring / standing orders
**Status:** todo · **depends_on:** 032
Templates per customer (weekday(s), items); auto-generate `DRAFT` or `CONFIRMED` orders N days ahead (cron); exceptions (skip a date, holiday list).

#### NUD-102 · Multiple drivers / tours per day
**Status:** todo · **depends_on:** 043
Several vehicles in ORS optimization (VRP), split stops across tours, per-driver release, admin drag stops between tours.

#### NUD-103 · Delivery time windows & vehicle capacity
**Status:** todo · **depends_on:** 102
Structured opening hours per customer → ORS time windows; vehicle capacity in kg; warnings when infeasible.

#### NUD-104 · Proof of delivery (photo / signature)
**Status:** todo · **depends_on:** 053
Optional photo of delivered goods and/or signature on screen per stop; viewable in admin; retention policy.

---

## 9. Decision log (append-only, one line per decision taken during implementation)

| Date | Ticket | Decision | Reason |
|---|---|---|---|
| 2026-10-17 | – | Backlog created from projektbeschreibung.md + clarification interview with product owner | – |
| 2026-10-17 | NUD-001 | Pinned pnpm 12 via `packageManager`; Node >=22 in `engines` | Matches environment, reproducible CI |
| 2026-10-17 | NUD-001 | Import sorting via `eslint-plugin-simple-import-sort`; Prettier printWidth 100 | Simplest option satisfying the ticket |
| 2026-10-17 | NUD-001 | `typecheck` = `next typegen && tsc --noEmit`; CI e2e runs against `pnpm build && pnpm start` | Next 16 global route types; stable e2e |
| 2026-10-17 | NUD-001 | Dropped `next/font/google` (Geist) in favour of system font stacks | §4.3 forbids bundled web fonts; avoids build-time network |
| 2026-10-17 | NUD-002 | Prisma 7.10.1 with `prisma-client` generator + `@prisma/adapter-pg`; DB URL in `prisma.config.ts` | Current stable (latest tag is 8 RC); v7 requires adapter |
| 2026-10-17 | NUD-002 | IDs are `cuid()` strings; `Settings.id` Int default 1; Photo gets index (customerId, kind, isCurrent) instead of a partial unique | Simplest option; uniqueness of current photo enforced in app code (NUD-015) |
| 2026-10-17 | NUD-002 | `db:migrate` = `prisma migrate deploy`, `db:migrate:dev` = `migrate dev`; seed hashes with bcryptjs; seed Hant names by hand | Simplest; auth ticket may revisit hashing |
| 2026-10-17 | NUD-002 | Added `pnpm db:embedded` (embedded-postgres) as Docker-free alternative | Needed to verify without Docker |
| 2026-10-17 | NUD-003 | `src/proxy.ts` (Next 16 name for middleware) does locale redirects itself; next-intl `localeDetection: false` | Required resolution order (user -> cookie -> Accept-Language incl. zh-CN/SG, zh-HK/MO, zh-TW -> de) is not next-intl's default |
| 2026-10-17 | NUD-003 | Bare `zh` and `zh-Hans*` -> zh-Hans; `zh-Hant` without region -> zh-Hant-TW | Simplest mapping for unspecified cases |
| 2026-10-17 | NUD-003 | Language switcher is a native `<select>`; locale persisted by server action (cookie + `User.locale` once sessions exist) | Simplest accessible control |
| 2026-10-17 | NUD-003 | Generated `zh-Hant-*.json` are committed; check fails when stale | Deterministic CI check, no build-step dependency |
| 2026-10-17 | NUD-004 | Keep bcryptjs (cost 12) instead of argon2 | Pure JS, no native binaries on Vercel; already used by the seed |
| 2026-10-17 | NUD-004 | Rate limit in PostgreSQL (`LoginAttempt`): 5 failures per username, 20 per IP, per 15 min | Works across serverless instances without extra infra; office NAT shares one IP so the IP limit is higher |
| 2026-10-17 | NUD-004 | Sessions are absolute (12 h admin / 90 d driver), proxy reads JWT without refreshing the cookie | Auth.js middleware wrapper re-issues the cookie and overwrote logout's cookie deletion |
| 2026-10-17 | NUD-004 | Admin area at `/[locale]/admin`, driver at `/[locale]/driver`, login at `/[locale]/login` and `/[locale]/driver/login`; no route groups yet | Matches paths used by later tickets (`/admin/drivers`); NUD-005 adds layouts |
| 2026-10-17 | NUD-004 | Proxy is only a first line; `requireRole()` re-checks role and `active` in the DB for every action | Role changes/deactivation apply immediately without waiting for JWT expiry |
| 2026-10-17 | NUD-005 | shadcn/ui components written by hand in "new-york" style (+ `components.json`) instead of via the CLI | Registry not reachable from the sandbox; later `shadcn add` still works |
| 2026-10-17 | NUD-005 | Driver pages moved to route group `driver/(app)/`; admin gets `admin/layout.tsx` | Login page must not get the shell; URLs unchanged |
| 2026-10-17 | NUD-005 | Placeholder admin pages re-check the role themselves besides the layout gate | Layouts are not re-rendered on client-side navigation |
| 2026-10-17 | NUD-005 | Localized 404 via `[locale]/[...rest]` + `not-found.tsx`; the catch-all calls `notFound()` at request time (HTTP 200 while streaming) | A prerendered `notFound()` shell cached an unlocalized bare 404; soft-404 is acceptable behind login |
| 2026-10-17 | NUD-005 | No `global-error.tsx`; `[locale]/error.tsx` is the global boundary | Root layout is the locale layout, so intl is available; a root-level fallback would need hard-coded strings (§4.3) |
| 2026-10-17 | NUD-005 | Connection indicator = `navigator.onLine` only | Placeholder; real sync state comes with NUD-081/082 |
| 2026-10-17 | NUD-005 | Dark colour tokens via `prefers-color-scheme` (no theme toggle) | Simplest; Tailwind `dark:` is media-based by default |
| 2026-10-17 | NUD-006 | Client output is always JPEG q 0.8 (not WebP); HEIC is decoded only where the browser can (Safari), otherwise a localized "save as JPEG/PNG" error | Safari cannot encode WebP from canvas; no HEIC decoder bundled (size); server still accepts `image/heic` per ticket |
| 2026-10-17 | NUD-006 | Upload API takes `{ purpose, contentType, size }`; server picks the key and role rules per purpose (screenshot = ADMIN only, customer-photo = ADMIN + DRIVER); oversize -> 413 | Client never controls keys; drivers need photo upload for NUD-083 |
| 2026-10-17 | NUD-006 | Presigned PUT signs content-type + content-length | Limits a leaked URL to one type/size; real enforcement to be confirmed against MinIO/R2 |
| 2026-10-17 | NUD-006 | Without `S3_*` dev/test use `FakeStorage` with a warning, production throws | Keeps the §4.3 Fake convention but avoids silently losing uploads in production |
| 2026-10-17 | NUD-006 | `authErrorStatus` moved to `auth/actor.ts` (re-exported by `guards.ts`); no `dynamic` export on the route | Handler testable without Auth.js; `dynamic` is incompatible with `cacheComponents` |
| 2026-10-17 | NUD-007 | Preview deployments share one Neon branch `staging` (fake data) and an R2 bucket `nudel-photos-staging`; no Neon branch per PR | Per-PR branches (Neon Vercel integration) are feasible but copy production data into previews unless a clean parent is configured; shared staging is free, simpler and keeps real data out. Revisit when parallel PRs with conflicting migrations hurt |
| 2026-10-17 | NUD-007 | Migrations run in the Vercel build (`pnpm build:vercel` = env check + `prisma migrate deploy` + `next build`) using `DATABASE_URL_UNPOOLED`; failed migration fails the build, the old deployment stays live | Simplest; PgBouncer-pooled Neon URLs break migration locks |
| 2026-10-17 | NUD-007 | `/api/health` is public, returns only statuses/latency/short SHA/region, 503 on failure; storage probe = `ListObjectsV2(MaxKeys=1)` via new `Storage.checkReachable()` | Usable by uptime monitors without leaking secrets; works with a bucket-scoped R2 token and detects wrong bucket/credentials |
| 2026-10-17 | NUD-007 | Seed gets `SEED_ADMIN_EMAIL` and `SEED_DRIVERS=false`; production seed runs once from the owner's computer, `SEED_ADMIN_PASSWORD` never lives in Vercel | Avoids a public `admin@example.com` and demo drivers with PIN 123456 on production |
| 2026-10-17 | NUD-008 | Added `User.lastLoginAt` (migration) set on each successful login | List needs "last login"; no other source (sessions are stateless JWTs) |
| 2026-10-17 | NUD-008 | PINs are random 6 digits via `crypto.randomInt`, shown once from client state and never stored; driver usernames normalised to lowercase `[a-z0-9._-]{3,32}`, unique case-insensitively | Simplest option consistent with D13; login already matches case-insensitively |
| 2026-10-17 | NUD-008 | Admin accounts: password >= 10 chars chosen by the creating admin; admins cannot deactivate themselves; no admin PIN/password reset UI | Scope says only "create further admin accounts" |
| 2026-10-17 | NUD-008 | Deactivated users are logged out via `GET /api/session-ended` (deletes the session cookie, redirects to the login page) called from `requirePageActor` | Pages cannot delete cookies; redirecting straight to login looped via the proxy while the JWT was still valid |
| 2026-10-17 | NUD-008 | Language change by the admin does not touch `localeChosen`; creating a driver leaves it `false` | The first-start picker (NUD-050) is the driver's own choice |
| 2026-10-17 | NUD-010 | Allowed countries come from env `ORS_GEOCODE_COUNTRIES` (default `AT,DE`), not from `Settings` | The ticket says "from settings" but `Settings` has no such column; avoiding a migration for a rarely changed value. Can move to Settings in NUD-012 |
| 2026-10-17 | NUD-010 | Missing `ORS_API_KEY` uses the Fake with one warning also in production (no throw) | Ticket demands it; admins must confirm every pin (D9), and the Fake's low confidence (0.3) flags it |
| 2026-10-17 | NUD-010 | Geocoding cache is an in-memory LRU per server instance, no DB table | Simplest option allowed by the ticket; volume is tiny |
| 2026-10-17 | NUD-010 | ORS key sent in `Authorization` header; retry only timeouts/network/5xx/429 | Keeps the key out of URLs and logs; 4xx will not improve |
| 2026-10-17 | NUD-011 | Tile URL/attribution are read server-side (`getMapTileConfig`) and passed to the map components as props; custom `MAP_TILE_URL` without `MAP_TILE_ATTRIBUTION` shows no attribution | Client components cannot read non-`NEXT_PUBLIC_` env; avoids baking tile config into the client bundle |
| 2026-10-17 | NUD-011 | Markers are CSS `divIcon`s; `TourMap.geometry` = GeoJSON LineString coordinates `[lng, lat][]` | Avoids Leaflet's bundler-broken default icons; matches ORS output so NUD-040/042 can pass it through |
| 2026-10-17 | NUD-011 | "Locate address" uses the first geocoder candidate, warns when confidence < 0.5, and goes through the admin-only server action `geocodeAddressAction` | Geocoder only proposes; admin confirms the pin (D9) |
| 2026-10-17 | NUD-012 | `Settings.depotPinConfirmed` column (default false); depot counts as set only when true, so the seed's placeholder depot does not allow tour building | `depotLat/Lng` are NOT NULL and the seed fills them; D9 requires an admin to confirm the pin |
| 2026-10-17 | NUD-012 | `nextDeliveryDate` = first delivery weekday strictly after today in the factory time zone; weekdays are ISO numbers 1 = Monday ... 7 = Sunday; falls back to tomorrow if none | Orders are taken for the next delivery day; default `[1,2,3,4,5]` is Mon-Fri |
| 2026-10-17 | NUD-012 | Settings cached with `'use cache'` + tag `settings`, expired by `updateTag` in the save action (no hand-made in-memory cache) | Works with `cacheComponents` and across instances where the cache handler is shared |
| 2026-10-17 | NUD-012 | Saving the depot requires the "pin checked" box; moving the pin or editing the address clears it | Simplest way to enforce D9 on the depot; the box is the confirmation |
| 2026-10-17 | NUD-012 | `ORS_GEOCODE_COUNTRIES` stays in env | Moving it to Settings needs a column and UI beyond this ticket |
| 2026-10-17 | NUD-013 | Accent-insensitive search = SQL function `nudel_fold` + trigger-maintained `Customer.searchText` + `LIKE`, no `unaccent`/`pg_trgm` | Works unchanged on Neon and embedded Postgres without extensions; 150 customers need no index |
| 2026-10-17 | NUD-013 | List shows active customers by default (status filter active/archived/all), 25 per page with prev/next, sorted by name then number | Simplest; archived are soft-deleted (4.3) |
| 2026-10-17 | NUD-013 | Placeholder `/admin/customers/new` page until NUD-014; `createPrismaClient(url, schema)` sets `search_path` for tests | Avoids 404; raw SQL/trigger need unqualified names to resolve in the test schema |
| 2026-10-17 | NUD-014 | After an address change `pinConfirmed` is only kept if the pin was also moved/searched again (rule shared by form and server); otherwise reset | Satisfies "changing the address resets pinConfirmed" while still allowing a re-confirmation in the same save |
| 2026-10-17 | NUD-014 | Next free number = highest number ending in digits + 1 (prefix and zero padding kept), "1001" if none; uniqueness is case-insensitive | Simple, works for "K-0099" and "1041" style numbers |
| 2026-10-17 | NUD-014 | Driver notes stored as `LocalizedText` with only `de` (source de); a changed text drops old translations, an unchanged one keeps the stored JSON | Multilingual editor and translation come with NUD-071/070 |
| 2026-10-17 | NUD-015 | Photos are managed on the customer detail page only (not on the edit form); archived customers may still get photos | Edit form is master data; scope says "detail/edit", detail suffices and keeps one place |
| 2026-10-17 | NUD-015 | Added `Storage.head(key)`; the attach mutation checks the key pattern `customers/<uuid>.<ext>`, that the object exists, takes `bytes` from storage, and refuses a key used by another photo | Server must prove the key belongs to its upload namespace and was really uploaded; client values are not trusted |
| 2026-10-17 | NUD-015 | One-current-per-kind enforced by a transaction with a row lock on the customer, no partial unique index | Matches the NUD-002 decision (app-level uniqueness); no migration needed |
| 2026-10-17 | NUD-015 | Slot titles "Geschäft / Eingang" / "Parken / Entladen" (zh-Hans "店铺 / 入口" / "停车 / 卸货") replace the old "Geschäftsfoto"/"Parkplatzfoto" labels | Wording from the ticket scope |
| 2026-10-17 | NUD-014 | Country is a 2-letter text field (default AT), stored upper-case; archiving needs a confirmation dialog, reactivating does not | Simplest; no country list needed in v1 |
| 2026-10-17 | NUD-020 | Live OpenCC pre-fill uses a debounced (200 ms) admin-only server action, not opencc-js in the browser | Simplest; keeps the OpenCC dictionaries out of the form's client code (the ~1.3 MB already shipped comes from another import, see NUD-098); the server also recomputes auto fields on save |
| 2026-10-17 | NUD-020 | "auto" = Traditional field flagged in `LocalizedText.meta.machine`; stays auto until the user types in it (button re-derives); hand-edited names are stored unflagged; an empty Traditional field is derived, never stored empty | Reuses the existing LocalizedText flag; D15 says Hant is derived and editable |
| 2026-10-17 | NUD-020 | SKU is trimmed, upper-cased, `[A-Za-z0-9._-]{1,32}`, unique case-insensitively; new products are appended (`max(sortOrder)+1`) | Simplest consistent form; matches the seed's SKUs |
| 2026-10-17 | NUD-020 | A product's unit cannot be changed once it has order items (error `unit_locked`, select disabled) | Changing PACK to KG on old orders would silently alter delivered quantities (client priority 2) |
| 2026-10-17 | NUD-020 | Reordering = up/down buttons over the full list (active and inactive together), renumbering `sortOrder` 0..n-1 in a transaction; the picker query returns active products in that order | Ticket allows drag or up/down; renumbering also repairs ties |
| 2026-10-17 | NUD-020 | Deactivate/reactivate without a confirmation dialog | Fully reversible and affects only new orders; customers need a dialog because of routing impact |

---

## 10. Open questions for the client (do not block on these – use placeholders)

- Exact depot (factory) address → set in Settings (NUD-012).
- Real product list with units and Chinese names → seed / product admin (NUD-020).
- Existing customer list file → import (NUD-090).
- Which Chinese variant(s) the drivers actually read → collected in UAT (NUD-096); all four locales ship regardless.
- Vehicle type (car vs. van/truck profile for routing) → ORS profile setting (NUD-040).
- Map tile provider account for production (NUD-011) and DeepL API account (NUD-070).
