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
model Settings  { id(singleton), depotName, depotAddress, depotLat, depotLng, timezone, departureTime "07:00",
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
| NUD-006 | Object storage & image upload pipeline | M0 | 002 | todo |
| NUD-007 | 👤 Deployment pipeline (Vercel/Neon/R2) | M0 | 002, 004 | todo |
| NUD-008 | Admin user management (drivers) | M0 | 005 | todo |
| NUD-010 | Geocoder interface + ORS + Fake | M1 | 002 | todo |
| NUD-011 | Map component with draggable pin | M1 | 005 | todo |
| NUD-012 | Depot & general settings page | M1 | 010, 011 | todo |
| NUD-013 | Customer list & search | M1 | 005 | todo |
| NUD-014 | Customer create/edit with pin confirmation | M1 | 010, 011, 013 | todo |
| NUD-015 | Customer photos (admin upload/replace) | M1 | 006, 014 | todo |
| NUD-020 | Product catalog CRUD (multilingual names) | M1 | 003, 005 | todo |
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
**Status:** todo · **depends_on:** 002

**Goal:** reusable, secure image upload for customer photos and order screenshots.

**Scope**
- `Storage` interface (`createUploadUrl`, `getReadUrl`, `delete`) with S3 implementation (`@aws-sdk/client-s3`, works with MinIO and R2) and an in-memory/fs Fake for tests.
- Route handler `POST /api/uploads` → validates role, content type (`image/jpeg|png|webp|heic`), max 15 MB → returns presigned PUT URL + `storageKey`.
- Client util `uploadImage(file)`: client-side resize to max 1600 px long edge, re-encode JPEG/WebP quality ~0.8, convert HEIC if needed (or reject with a clear message – log decision), upload with progress.
- Private bucket; reads via short-lived signed URLs (e.g. 1 h) generated server-side.
- `<ImageUploader>` component (drop zone + file picker + **clipboard paste**), `<ImagePreview>` with fullscreen zoom (pinch-zoom on mobile).

**Acceptance criteria**
- [ ] Upload of a 6000×4000 JPEG results in a stored image ≤ 1600 px and < 600 KB.
- [ ] Unauthenticated upload request → 401. Wrong content type → 400.
- [ ] Works against local MinIO in dev and the Fake in tests.

---

#### NUD-007 · 👤 Deployment pipeline (Vercel / Neon / R2)
**Status:** todo · **depends_on:** 002, 004

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

---

#### NUD-008 · Admin user management (drivers)
**Status:** todo · **depends_on:** 005

**Goal:** office creates and manages driver accounts without developer help.

**Scope**
- `/admin/drivers`: list (name, username, language, active, last login).
- Create driver: display name, username, preferred locale (dropdown in own scripts), auto-generated 6-digit PIN shown **once** with a "print/copy" view.
- Reset PIN, deactivate/reactivate, change locale.
- Admins can also create further admin accounts (email + password).

**Acceptance criteria**
- [ ] Newly created driver can log in with the shown PIN on a phone.
- [ ] Reset PIN invalidates the old PIN immediately.
- [ ] Deactivated driver's next request is logged out.

---

### M1 — MVP (demo end-to-end)

---

#### NUD-010 · Geocoder interface + ORS + Fake
**Status:** todo · **depends_on:** 002

**Goal:** turn an address into candidate coordinates.

**Scope**
- `Geocoder` interface: `search(address): Promise<GeocodeCandidate[]>` (label, lat, lng, confidence) and `reverse(lat,lng)` (for pin drag feedback).
- ORS implementation (`/geocode/search`, `boundary.country` from settings, default `AT,DE`), timeout 5 s, retries 1.
- Fake implementation: deterministic coordinates around Vienna derived from a hash of the address (used in tests and if `ORS_API_KEY` is missing).
- Simple cache table or in-memory LRU to avoid repeated calls for the same normalized address.

**Acceptance criteria**
- [ ] Unit tests for the Fake and for response mapping of the ORS client (recorded fixture, no live network in CI).
- [ ] Missing API key → Fake is used and a single warning is logged.

---

#### NUD-011 · Map component with draggable pin
**Status:** todo · **depends_on:** 005

**Goal:** reusable map building blocks for customers, depot and tours.

**Scope**
- react-leaflet loaded client-side only (`dynamic(..., { ssr:false })`).
- Tile URL + attribution from env (`MAP_TILE_URL`), default OSM tiles **for dev only**; document in `docs/env.md` that production needs a provider with a usage plan (e.g. MapTiler / Stadia free tier).
- `<PinPickerMap value onChange>`: single draggable marker, click-to-place, "locate address" button.
- `<TourMap stops depot geometry>`: numbered markers (1…n), depot marker, polyline; fit bounds.

**Acceptance criteria**
- [ ] Storybook-like demo page (`/admin/dev/maps`, admin-only, hidden from nav) shows both components.
- [ ] Dragging the pin calls `onChange` with rounded coordinates (6 decimals).

---

#### NUD-012 · Depot & general settings page
**Status:** todo · **depends_on:** 010, 011

**Goal:** office configures where tours start/end and basic planning parameters.

**Scope**
- `/admin/settings`: depot name + address (geocode → confirm pin), time zone (select, default `Europe/Vienna`), default departure time, service minutes per stop, delivery weekdays (checkboxes).
- Settings are cached server-side and invalidated on save.

**Acceptance criteria**
- [ ] Tour building (NUD-041) refuses to run with a clear message if the depot pin is not set.
- [ ] Changing delivery weekdays changes the default delivery date in order entry (unit-tested helper `nextDeliveryDate(now, settings)`).

---

#### NUD-013 · Customer list & search
**Status:** todo · **depends_on:** 005

**Goal:** office finds any customer in seconds.

**Scope**
- `/admin/customers`: table with customer number, name, city, flags (⚠ photos missing, ⚠ pin unconfirmed, archived).
- Search (number, name, street, city; accent-insensitive), filters for the flags, pagination or virtual scroll.
- "New customer" button → NUD-014 form.

**Acceptance criteria**
- [ ] Search for part of a name returns matches in < 300 ms with 500 seeded customers.
- [ ] Filter "photos missing" shows exactly the customers lacking a current STORE or PARKING photo.

---

#### NUD-014 · Customer create/edit with pin confirmation
**Status:** todo · **depends_on:** 010, 011, 013

**Goal:** complete customer master data, with a pin the office has verified.

**Scope**
- Form fields per projektbeschreibung §2: name*, customer number* (unique; suggest next free number), street*, postal code*, city*, country, delivery hours info (free text), notes for driver (German textarea for now; multilingual editor in NUD-071).
- "Find on map" → geocoder candidates list → choose one → pin shown → admin may drag → **"Pin confirmed" checkbox required** to set `pinConfirmed=true`. Changing the address resets `pinConfirmed`.
- Archive / reactivate.
- Customer detail page summarising data, photos (placeholder until NUD-015), upcoming orders.

**Acceptance criteria**
- [ ] Customer cannot be saved with a duplicate customer number (validation message, localized).
- [ ] Editing the street sets `pinConfirmed=false` and shows the ⚠ flag.
- [ ] E2E: create customer with confirmed pin, find it via search.

---

#### NUD-015 · Customer photos (admin upload/replace)
**Status:** todo · **depends_on:** 006, 014

**Goal:** office stores the shop photo and parking/unloading photo per customer.

**Scope**
- On customer detail/edit: two slots "Geschäft / Eingang" (STORE) and "Parken / Entladen" (PARKING), each with upload, replace, fullscreen view.
- Replacing keeps the old photo row with `isCurrent=false` (history, no hard delete).
- "Photos missing" flag derived from absence of current STORE or PARKING photo.

**Acceptance criteria**
- [ ] Upload → photo visible on customer detail after reload.
- [ ] Replace → new photo current, old one still in DB with `isCurrent=false`.
- [ ] Flag disappears when both photos exist.

---

#### NUD-020 · Product catalog CRUD (multilingual names)
**Status:** todo · **depends_on:** 003, 005

**Goal:** the list of pasta products, readable by every driver.

**Scope**
- `/admin/products`: list (SKU, German name, Simplified Chinese name, unit, active), sortable by `sortOrder` (drag or up/down).
- Form: SKU*, unit* (select with localized labels), `name.de`*, `name.zh-Hans`*, `name.zh-Hant-HK` and `name.zh-Hant-TW` **pre-filled live via OpenCC** from zh-Hans and editable (mark as "auto" until edited).
- Deactivate instead of delete; inactive products are hidden in order entry but kept on old orders.

**Acceptance criteria**
- [ ] Saving without `zh-Hans` name is rejected.
- [ ] Typing `螺旋意面` in zh-Hans pre-fills both Traditional fields with OpenCC output.
- [ ] Inactive products don't appear in the order entry product picker.

---

#### NUD-030 · Manual order entry
**Status:** todo · **depends_on:** 014, 020

**Goal:** office records an order in under 30 seconds.

**Scope**
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

---

## 10. Open questions for the client (do not block on these – use placeholders)

- Exact depot (factory) address → set in Settings (NUD-012).
- Real product list with units and Chinese names → seed / product admin (NUD-020).
- Existing customer list file → import (NUD-090).
- Which Chinese variant(s) the drivers actually read → collected in UAT (NUD-096); all four locales ship regardless.
- Vehicle type (car vs. van/truck profile for routing) → ORS profile setting (NUD-040).
- Map tile provider account for production (NUD-011) and DeepL API account (NUD-070).
