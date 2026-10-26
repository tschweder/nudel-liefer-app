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
- Every service-layer write to orders, tours, stops or customer photos records an audit entry in the same transaction (`recordAudit`, NUD-092); the audit log is append-only.

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
| NUD-030 | Manual order entry | M1 | 014, 020 | done |
| NUD-031 | Screenshot attachment & split-view entry | M1 | 006, 030 | done |
| NUD-032 | Order overview & editing | M1 | 030 | done |
| NUD-040 | RoutingProvider + ORS optimization + fallback heuristic | M1 | 002 | done |
| NUD-041 | Tour builder (orders → stops → optimized tour) | M1 | 012, 032, 040 | done |
| NUD-042 | Tour planning UI (map, reorder, lock, release) | M1 | 011, 041 | done |
| NUD-043 | Tour lifecycle & change handling (outdated tours) | M1 | 042 | done |
| NUD-050 | Driver first-start language picker | M1 | 005 | done |
| NUD-051 | Driver "today's tour" screen | M1 | 043, 050 | done |
| NUD-052 | Driver stop detail + navigation | M1 | 015, 051 | done |
| NUD-053 | Driver stop status (delivered / problem) | M1 | 052 | done |
| NUD-054 | Admin live tour progress | M1 | 053 | done |
| NUD-060 | MVP demo seed + end-to-end happy path | M1 | 054 | done |
| NUD-070 | Translator interface + DeepL + OpenCC derivation | M2 | 003 | done |
| NUD-071 | Customer notes translation & multilingual editor | M2 | 014, 070 | done |
| NUD-072 | Driver problem text → German for office | M2 | 053, 070 | done |
| NUD-073 | 👤 UI string review workflow for native speakers | M2 | 003 | blocked |
| NUD-080 | PWA installability | M2 | 051 | done |
| NUD-081 | Offline cache of today's tour + photos | M2 | 080, 052 | done |
| NUD-082 | Offline mutation queue for stop status | M2 | 081, 053 | done |
| NUD-083 | Driver photo capture / replace | M2 | 052, 082 | done |
| NUD-090 | Customer import (CSV/XLSX) with pin review | M2 | 014 | done |
| NUD-091 | Packing list / load sheet print view | M2 | 041 | done |
| NUD-092 | Audit log for orders and tours | M2 | 032, 043 | done |
| NUD-093 | Security hardening | M2 | 060 | done |
| NUD-094 | Monitoring, backups, error pages, runbook | M2 | 007 | done |
| NUD-095 | Driver usability & accessibility pass | M2 | 083 | done |
| NUD-096 | 👤 User acceptance test with client & drivers | M2 | 093, 095 | blocked |
| NUD-097 | Silence Auth.js prerender error log | M2 | 004 | done |
| NUD-098 | Keep OpenCC out of the client bundle | M2 | 003 | done |
| NUD-099 | Late orders for an already completed tour | M2 | 043 | done |
| NUD-105 | 👤 Real-device PWA install check + Lighthouse run | M2 | 080 | todo |
| NUD-106 | Installed app opens in the driver's current language | M2 | 080 | done |
| NUD-107 | 👤 Real-device offline check (dead spot, photos, logout) | M2 | 081 | todo |
| NUD-108 | Map view offline (tiles) | M2 | 081 | done |
| NUD-109 | 👤 Real-device check of the offline mutation queue (Background Sync, logout with unsent taps) | M2 | 082 | todo |
| NUD-110 | Nonce-based script CSP | M2 | 093 | done |
| NUD-111 | Audit log retention job | M2 | 093 | done |
| NUD-112 | Retention for orders, tours, stops and driver texts | M2 | 093 | done |
| NUD-113 | 👤 Verify security configuration on the real deployment | M2 | 007, 093 | todo |
| NUD-114 | 👤 Set up and verify monitoring and backups on the real accounts | M2 | 007, 094 | todo |
| NUD-115 | 👤 Real-device usability check of the driver app (TalkBack, font size, one hand, dark mode, slow network) | M2 | 095 | todo |
| NUD-116 | Warn on the order form when the delivery day's tour is already completed | M2 | 099 | todo |
| NUD-117 | Deliver quantity changes on already delivered stops (correction stop) | M2 | 099 | todo |
| NUD-118 | Driver app with two tours on one day (offline cache, hint, real device) | M2 | 099, 081 | todo |
| NUD-119 | Driver map: tap on a marker opens the stop detail | M2 | 081 | todo |
| NUD-120 | 👤 Roll out the strict script CSP on the real deployment (report-only first) | M2 | 110, 113 | todo |
| NUD-121 | Driver problem text is also copied into the audit log | M2 | 112 | todo |
| NUD-122 | Photo upload works on the office and driver path | M2 | – | done |
| NUD-123 | Add driver / customer / order through the GUI | M2 | – | done |
| NUD-124 | Product list: `PACK` → Beutel, six real products, archive the demo ones | M2 | – | todo |
| NUD-125 | Parking spots: schema + office UI | M2 | – | todo |
| NUD-126 | Parking spots: driver UI, park-first navigation, offline | M2 | 125 | todo |
| NUD-127 | 👤 Deploy to the vServer (handoff doc) | M2 | 122, 123, 124, 125, 126 | todo |
| NUD-128 | Realign the order e2e assertions with the redesign's plural unit labels | M2 | – | todo |
| NUD-129 | Admin order list overflows horizontally at phone width | M2 | – | todo |
| NUD-130 | Give the admin-password test teardown the same timeout as its setup | M2 | – | todo |
| NUD-131 | The dev server serves 127.0.0.1 a page whose buttons do nothing | M2 | – | done |
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
- [x] Tour building (NUD-041) refuses to run with a clear message if the depot pin is not set. (Settings-side guard done and tested: `requireDepot` / `requireDepotConfigured()` throw `DepotNotSetError` (`code: "DEPOT_NOT_SET"`), message key `admin.settings.errors.depotNotSet`. NUD-041 calls it first and returns `error: "depot_not_set"` without writing anything (tested); the message itself is shown by the NUD-042 UI, which does not exist yet.)
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
**Status:** done · **depends_on:** 014, 020

**Goal:** office records an order in under 30 seconds.

**Scope**
- _Added by NUD-012:_ preselect the delivery date with `getDefaultDeliveryDate()` (`src/server/settings.ts`).
- `/admin/orders/new`: customer combobox (search by name/number), delivery date (default `nextDeliveryDate`), product lines (product picker + quantity + unit shown), add/remove lines, internal note (office only, not shown to driver).
- Keyboard-friendly: Enter adds a line, quantities accept `,` and `.` decimals.
- Save as `CONFIRMED` (default) or `DRAFT`.
- Warning (not error) if the customer already has a confirmed order for that date: "will be combined into one stop".
- Warning if the customer's pin is unconfirmed: "this customer cannot be routed until the pin is confirmed".

**Acceptance criteria**
- [x] Quantity must be > 0; at least one line required; same product twice in one order is merged or rejected (pick one, log decision). (Merged; server-side tests for 0, negative, text, 3 decimals, no lines.)
- [x] Unit tests for order validation (zod) and the date default.
- [x] E2E: create order with 3 lines, see it in the overview (NUD-032 placeholder list is fine). (`tests/e2e/orders.spec.ts`, desktop + mobile.)

**Implementation notes**
- Pure rules in `src/domain/order.ts` (zod, no framework imports): `parseQuantity`/`parseQuantityCents` (`,` and `.`, max 2 decimals, > 0, max 99999999.99; a third decimal such as "1.000" is rejected rather than guessed), `mergeOrderLines` (same product -> quantities added), `orderInputSchema` (customer, `YYYY-MM-DD` date, status CONFIRMED|DRAFT, note <= 1000, 1..100 lines), `orderWarnings` (combined stop, unconfirmed pin), date helpers. Tests: `src/domain/order.test.ts` (60), including the default-date path via `nextDeliveryDate`.
- Server: `src/server/orders.ts` (`createOrder`: re-validates, rejects past dates, archived/unknown customers and inactive/unknown products, creates order + items in one statement with source MANUAL; `listOrderableCustomers` = active only; `countConfirmedOrders`; `listOrderOverview`), `order-actions.ts` (`createOrderAction`, `confirmedOrderCountAction`, both `requireRole("ADMIN")`), `order-queries.ts` (`orderableCustomersQuery`, `orderOverviewQuery`; product picker uses `activeProductsQuery()`). `src/server/order-actions.integration.test.ts`: anonymous / driver / deactivated admin rejected on all four, 3-line order with `,`/`.` decimals, draft, merge, invalid-input table, past date, archived customer, inactive product, unconfirmed pin still saves, picker lists, count of CONFIRMED only, overview.
- UI: `/admin/orders/new` (`OrderForm`): customer combobox (number, name, street, city searchable), native date input preselected with `getDefaultDeliveryDate()`, product lines (combobox with names in all locales and SKU searchable, quantity, unit label), Enter in a quantity adds a line and focuses its picker (not when the quantity is invalid), blank lines ignored, internal note, "Bestaetigt speichern" / "Als Entwurf speichern" (buttons only, Enter never submits). Warnings (not errors): existing confirmed orders that day ("combined into one stop", live server check) and unconfirmed pin (link to the customer). `/admin/orders` is now a minimal list of orders from today on (date, customer, items, status, source) with a "new order" button; NUD-032 replaces it. The NUD-043 hook is NOT implemented (NUD-032 owns the hook point: call it in `createOrder`'s callers / `createOrderAction`).
- Verified: lint, typecheck, prettier, `pnpm test` (371 passed incl. DB), `i18n:check`, `pnpm build`, e2e `orders` (desktop + mobile), `customers`, `shells` (desktop, orders page in 4 locales); form screenshots at 1280 and 375 px inspected, no horizontal scroll.
- NOT verified: `customer-form`, `settings`, `maps`, `drivers`, `customer-photos` e2e and the shells mobile project were not rerun (untouched code); Chinese UI strings are agent-written (NUD-073); the customer picker uses cmdk's fuzzy filter (not accent-folded, loose matches may appear); no real touch-device check.
- Follow-ups: archiving a customer with upcoming orders is still allowed without warning; NUD-031 adds `source=SCREENSHOT` to this form; NUD-032 must call the outdated-tour hook after create/update/cancel.

---

#### NUD-031 · Screenshot attachment & split-view entry
**Status:** done · **depends_on:** 006, 030

**Goal:** office types an order while looking at the customer's WhatsApp/WeChat screenshot.

**Scope**
- In order entry: "Add screenshot" via upload, drag-and-drop or **Ctrl+V paste**. Creates a `Screenshot`, sets `source=SCREENSHOT`.
- Split view on ≥ 1024 px: zoomable/pannable image left, order form right; stacked on smaller screens.
- Screenshot remains viewable from the order detail later (for disputes about quantities).

**Acceptance criteria**
- [x] Pasting an image from clipboard attaches it without a file dialog. (e2e dispatches a `ClipboardEvent("paste")` carrying a `File` on `document`; asserts no `filechooser` event, the signed image decodes in the pane; desktop + mobile. A real OS clipboard / Ctrl+V keystroke was not exercised.)
- [x] Order detail shows the screenshot thumbnail → fullscreen. (e2e: `/admin/orders/[id]` thumbnail opens the zoom dialog, image decodes via signed URL; desktop + mobile.)

**Implementation notes**
- Order form (`src/components/admin/order-form.tsx`): new "Screenshot" section with the NUD-006 `ImageUploader` (`purpose="screenshot"`, file picker, drop, `pasteAnywhere` so Ctrl+V works anywhere on the page). After upload the server action `screenshotPreviewUrlAction(key)` (ADMIN, key must match `screenshots/<uuid>.<ext>` and exist) returns a signed URL. With a screenshot the page becomes `data-testid="order-entry" data-split="true"`: from 1024 px (`lg`) a 2-column grid, zoomable/pannable image left (sticky, `ZoomableImage` now exported from `image-preview.tsx`, wheel zoom is a non-passive listener so the page does not scroll, +/-/reset buttons, drag pan, double-click zoom), form right; below 1024 px the image is stacked above the form (50dvh). "Remove screenshot" returns to the uploader. After a successful save the form state is reset (Next keeps the previous route hidden with its state, which would have kept the saved order's screenshot in the next new-order form).
- Server: `orderInputSchema` takes optional `screenshotKey` (`isScreenshotKey`, pattern in `src/lib/uploads.ts`, tied to the keys `/api/uploads` issues by a test). `createOrder(db, actor, input, today, storage)`: key must exist (`Storage.head`, 0 < bytes <= 15 MB), not be used by another `Screenshot` row (`screenshot_missing`, `screenshot_in_use`), then order + `Screenshot` are created in ONE nested create with `source=SCREENSHOT`; a client-sent `source` is ignored. New read `getOrderDetail` / `orderDetailQuery` (ADMIN, signed 1 h URL) and `screenshotPreviewUrlAction` (ADMIN).
- Order detail: new minimal read-only `/admin/orders/[id]` (`OrderDetailView`: customer, date, status, source, lines, internal note, screenshot thumbnail -> fullscreen `ImagePreview` with `fit="contain"`, or "no screenshot"). The date in the order list links to it. NUD-032 extends this page (edit, cancel, duplicate).
- i18n: `admin.orders.form.screenshot.*`, `admin.orders.detail.*`, two new form errors, de + zh-Hans by hand, Hant generated.
- Tests: 8 integration tests in `order-actions.integration.test.ts` (auth on the two new reads/actions, forged keys incl. other prefix / traversal / URL / extension, missing object, empty/oversize object, key reuse, no orphan Screenshot after a rejected order, client `source` ignored, detail incl. signed URL), unit tests for the schema and key pattern, e2e `tests/e2e/order-screenshot.spec.ts` (paste, split layout geometry, wheel zoom without page scroll, pan, save, DB assertions, list -> detail -> fullscreen, file picker, drag-and-drop, remove -> MANUAL, clean form on next order, anonymous redirect, unknown id).
- Verified: lint, typecheck, prettier, `pnpm test` (383 passed incl. DB), `i18n:check`, `pnpm build`, e2e `order-screenshot` + `orders` (desktop + mobile), `customer-photos`, `uploads`, `shells` (desktop) against the s3rver emulator; screenshots inspected at 1280 px (desktop) and Pixel 7 (412 px, mobile project), no horizontal scroll.
- NOT verified: real MinIO / R2 (s3rver only, as NUD-006/015); a real clipboard paste from a chat app (synthetic ClipboardEvent only); pinch zoom / touch panning on a real phone (the pane uses `touch-none`, so touch-dragging on the image does not scroll the page); 375 px exactly (the mobile project is Pixel 7, 412 px); mobile e2e of `customer-photos`/`shells` not rerun; Chinese strings are agent-written (NUD-073).
- Follow-ups: an uploaded but unsaved/removed screenshot stays orphaned in storage (cleanup with NUD-094); uniqueness of `Screenshot.storageKey` is checked in app code only (two concurrent saves with the same key could both pass; a unique index would need a migration); the unsaved form (incl. screenshot) is kept when navigating away and back (Next route retention), there is no "discard changes" prompt.

---

#### NUD-032 · Order overview & editing
**Status:** done · **depends_on:** 030

**Goal:** central order overview (projektbeschreibung §3).

**Scope**
- `/admin/orders`: default filter = next delivery date. Filters: date (range), customer, status, source.
- Rows: customer, date, number of lines, status, source icon, "in tour" badge.
- **Totals panel per date:** sum per product (for production/loading).
- Order detail/edit page, cancel (status `CANCELLED`, not delete), duplicate order to another date.
- Hook point for NUD-043: every create/update/cancel calls `tourService.markOutdatedForDate(date)`.

**Acceptance criteria**
- [x] Totals panel matches the sum of all confirmed orders for the date (unit test on the aggregation function in `src/domain`). (`aggregateTotalsByDate` in `src/domain/order-overview.ts`, 5 unit tests; integration test and e2e compare the panel with the sums of the stored orders.)
- [x] Cancelled orders are excluded from totals and tours. (Totals: unit + integration + e2e. Tours do not exist yet: `listConfirmedOrdersForDate` in `src/server/orders.ts` is the CONFIRMED-only source NUD-041 must use, tested to exclude cancelled and draft orders.)

**Implementation notes**
- Pure rules in `src/domain/order-overview.ts`: `aggregateTotalsByDate` (CONFIRMED only, exact sums in hundredths, no float drift), `parseOrderFilters` / `orderFiltersToQuery` (URL params to filters, never fails: unusable values fall back to the default; range capped at 62 days), `isOrderEditable` (not cancelled and delivery day today or later). Tests: `order-overview.test.ts` (12).
- Server (`src/server/orders.ts`, `order-actions.ts`, `order-queries.ts`): `orderOverviewQuery(params)` returns filters, rows (limit 300, `truncated` flag), totals per date and the customer list (all customers, archived too) for the filter; row = customer, date, line count + quantities, status, source icon, "in tour" badge from `StopOrder -> Stop` (`tour: {tourId, stopId}`; empty until NUD-041). New actions `updateOrderAction(id, input)`, `cancelOrderAction(id)`, `duplicateOrderAction(id, date)`, all `requireRole("ADMIN")`. `updateOrder` re-uses `orderInputSchema` (the same zod validation as order entry: quantities > 0, max 2 decimals, `1.000` rejected, merged duplicates, past date rejected) with the customer taken from the stored order and any client `customerId` / `screenshotKey` / `source` ignored; lines are replaced in one nested write. `confirmedOrderCountAction` got an optional `excludeOrderId` so the "combined into one stop" warning does not count the order being edited.
- Hook point: `src/server/tour-service.ts` (`createTourService(db)`, `getTourService()`); `markOutdatedForDate(date)` sets `Tour.isOutdated=true` for all not COMPLETED tours of that date (column exists in the §6 schema). `createOrder` (NUD-030 path), `updateOrder` (old and new date when the date moved), `cancelOrder` and `duplicateOrder` take a `TourHook` argument and call it after the write; rejected changes call nothing. NUD-043 extends the service (it does not look at order status or what changed, so a draft edit also flags the tour). Tests: `tour-service.integration.test.ts` (3), hook calls in `order-management.integration.test.ts`.
- UI: `/admin/orders` is the overview (filters in the URL: from/to date inputs default to the next delivery date via `getDefaultDeliveryDate()`, customer combobox, status, source, reset; totals panel per date above the rows; `OrderFilters`, `OrderTotals`, `OrdersTable`). `/admin/orders/[id]` shows edit / duplicate / cancel (`OrderActions`: cancel and copy open dialogs; edit and cancel only for open orders); `/admin/orders/[id]/edit` re-uses `OrderForm` in edit mode (customer fixed, attached screenshot shown read-only in the split view, status via the two save buttons). After creating an order the list opens filtered to that order's date. Archive dialog of a customer shows a warning with the number of upcoming not cancelled orders (`CustomerArchiveButton`, count from the existing upcoming-orders query); archiving is still allowed.
- i18n: `admin.orders.filters/totals/detail.*` and form keys, `admin.customers.detail.archiveUpcoming`, de + zh-Hans by hand, Hant generated.
- Tests: 21 integration tests `order-management.integration.test.ts` (authorization of the 3 new mutations and reads for anonymous / driver / deactivated admin without side effects, edit validation table, customer/screenshot immutability, cancel keeps everything, totals, filters, tour link, hook), extended `order-actions.integration.test.ts`, e2e `tests/e2e/order-overview.spec.ts` (default date, filters, totals, in-tour badge, edit with validation error, cancel, duplicate, outdated flag in the DB, archive warning, anonymous redirect; desktop + mobile).
- Verified: lint, typecheck, prettier, `pnpm test` (419 passed incl. DB), `i18n:check`, `pnpm build`, e2e `order-overview`, `orders`, `order-screenshot` (desktop + mobile), `customers`, `shells`, `customer-form` (desktop); screenshots inspected at 1280 px (overview, edit page, archive dialog), no horizontal scroll (also asserted at the mobile project width).
- NOT verified: other e2e specs (settings, maps, drivers, products, customer-photos, uploads, auth, home) were not rerun; the "in tour" badge only with a hand-inserted Tour/Stop/StopOrder (no tour builder yet) and it is not a link until NUD-042 has a tour page; `customer-form` e2e failed once under 2 parallel workers (pin flag, passes alone) and was not investigated further; Chinese strings are agent-written (NUD-073); no real touch-device check.
- Follow-ups: NUD-042 should link the badge (`data-tour-id`) to the tour page; NUD-043 should refine `markOutdatedForDate` (only when a CONFIRMED order is affected, banner, rebuild); NUD-041 must build stops from `listConfirmedOrdersForDate`; the hook is called after the order write without a transaction (a failing hook leaves the order saved and the action throws).

---

#### NUD-040 · RoutingProvider + ORS optimization + fallback heuristic
**Status:** done · **depends_on:** 002

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
- [x] Pure unit tests for 2-opt (improves a crossing route) and nearest-neighbour. (`src/domain/routing.test.ts`)
- [x] ORS client tested against fixtures. (`src/server/routing/routing.test.ts`; fixtures are hand-written from the documented ORS/VROOM shapes, NOT recorded from a live call, see notes.)
- [x] Provider falls back automatically on timeout (8 s) and reports `approximate`. (tested with a stalled fetch and a short test timeout; the 8 s default is `ROUTING_TIMEOUT_MS`, asserted as a constant, not waited for.)

**Implementation notes**
- Pure algorithms in `src/domain/routing.ts` (haversine, road factor 1.3, 30 km/h, distance matrix, `nearestNeighbourOrder`, `twoOpt`, `estimateLegs`, `heuristicOrder`). Providers in `src/server/routing/`: `types.ts` (`RoutingProvider` as in the ticket, `RoutingError` with codes `TIMEOUT|NETWORK|HTTP|BAD_RESPONSE|INVALID_INPUT|TOO_MANY_STOPS|NO_ROUTE`, `MAX_STOPS = 50`), `ors.ts` (`OrsRoutingProvider`, zod-checked `mapOptimizationResponse` / `mapDirectionsResponse`), `heuristic.ts` (`LocalHeuristicProvider`), `fallback.ts` (`FallbackRoutingProvider`), `index.ts` (`getRoutingProvider(env)` singleton, `setRoutingProviderForTests`, `parseProfile`).
- Result type: `{ orderedStopIds, legs, geometry, totalDistanceM, totalDurationS, approximate }`; `route()` returns the same without `orderedStopIds`. `approximate` is a required boolean (`false` for ORS, `true` for the heuristic) for the UI of NUD-042 to show. `legs` has **n + 1** entries (depot -> stop 1 ... stop n -> depot), `totalDurationS` is driving time only (no service time; NUD-041 adds `serviceSeconds`/`serviceMinutesPerStop` for ETAs). `geometry.coordinates` are `[lng, lat]`, directly usable by `TourMap`. Heuristic geometry is straight lines between the points. No stops -> empty result, no request.
- ORS: `POST /optimization` (one vehicle, start = end = depot, job ids `index + 1`, `service` seconds), then `POST /v2/directions/{profile}/geojson`. Profile from env `ORS_ROUTING_PROFILE` (`driving-car` default, `driving-hgv`; invalid -> warning + default). One 8 s deadline covers both requests, no retries (the fallback is the retry). Key goes in the `Authorization` header. Directions requests are split into chunks of at most 50 coordinates that share their boundary point, because ORS limits waypoints per directions request (a 50-stop tour has 52 points).
- Fallback: any `RoutingError` except `INVALID_INPUT` / `TOO_MANY_STOPS` (and any unexpected error) logs one warning and the heuristic answers (`approximate: true`). Missing `ORS_API_KEY` -> heuristic only, one warning per process. More than 50 stops raises `RoutingError` `TOO_MANY_STOPS` in every provider (the message says "at most 50 stops"); the tour builder (NUD-041) should show it to the office.
- New env var `ORS_ROUTING_PROFILE` in `.env.example` and `docs/env.md`; `ORS_API_KEY` is documented there as shared by geocoding and routing. (Prettier re-padded the whole `docs/env.md` table, hence the large diff.)
- Verified: lint, typecheck, `pnpm test` (456 passed incl. 37 new, DB tests on embedded PostgreSQL), `i18n:check`, prettier. No UI, route, mutation or schema change, so no i18n strings, authorization tests, migration or e2e were needed; nothing calls the provider yet (NUD-041 will, from a server action with `requireRole("ADMIN")`). `pnpm build` was not rerun (no app code imports the module yet).
- NOT verified: any live call to OpenRouteService (no key, by instruction). The fixtures in `src/server/routing/fixtures/` are hand-written from the documented ORS/VROOM shapes, not recorded. Please run one real `optimize` and `route` once a key exists and compare: the VROOM `steps[].job` ids, `unassigned`, directions `segments[]` and the 50-waypoint directions limit (chunking assumes it) are from memory of the docs; also the free-tier optimization limits.

---
#### NUD-041 · Tour builder (orders → stops → optimized tour)
**Status:** done · **depends_on:** 012, 032, 040

**Goal:** one click creates an optimized tour for a date.

**Scope**
- _Added by NUD-012:_ call `requireDepotConfigured()` (`src/server/settings.ts`) first; on `DepotNotSetError` show `admin.settings.errors.depotNotSet` and do not build. Then tick the "refuses without depot" criterion of NUD-012.
- Domain function `buildStops(orders)`: group confirmed orders by customer → one stop per customer, with merged item quantities per product (keep the link to each order via `StopOrder`).
- Service `generateTour(date)`: validates depot; excludes customers with unconfirmed pins (returned as warnings with links); calls `optimize`; persists `Tour` (`OPTIMIZED`), `Stop`s with sequence, legs, ETAs (`departureTime` + cumulative leg durations + service minutes), geometry, totals.
- Re-running on an unreleased tour replaces stops; on a **locked** tour it only adds new customers at the end (log decision if different).

**Acceptance criteria**
- [x] Unit test: 3 orders from 2 customers → 2 stops, quantities merged correctly per product. (`src/domain/tour.test.ts`)
- [x] Integration test with Fake/heuristic provider: tour persisted with correct sequence and ETAs. (`src/server/tour-builder.integration.test.ts`, embedded PostgreSQL, `LocalHeuristicProvider`)
- [x] Customers without confirmed pins are reported, not silently dropped. (`warnings[]` in the result, also together with `no_stops`; tested for `pinConfirmed=false` and missing coordinates)

**Implementation notes**
- Pure logic in `src/domain/tour.ts`: `buildStops(orders)` (one stop per customer, exact per-product sums in hundredths, order ids kept for the `StopOrder` links), `partitionByPin`, `mergeLockedOrder`, `departureInstant(date, "HH:MM", timezone)` (DST-safe), `computeSchedule` (ETA = departure + cumulative driving legs + service time of every earlier stop). Service: `src/server/tour-builder.ts` with `generateTourWith(deps, date)` (injectable db / provider / depot guard / settings / clock, used by the tests) and `generateTour(date)` (real `getDb()`, `getRoutingProvider()`, `requireDepotConfigured`, `getSettings`). Server action wrapper `generateTourAction(input)` in `tour-actions.ts` (`requireRole("ADMIN")` first, then zod `{date: "YYYY-MM-DD"}`), no page: NUD-042 builds the UI.
- Result: `{ ok: true, tourId, mode: created|replaced|locked_extended, stopCount, addedCustomerIds, removedCustomerIds, approximate, warnings }` or `{ ok: false, error, warnings, maxStops? }` with `error` one of `invalid_date | date_in_past | depot_not_set | no_stops | tour_not_editable | too_many_stops | conflict`. Warnings are `{code: "PIN_UNCONFIRMED", customerId, customerNumber, name, orderIds}` (UI links to `/admin/customers/<id>`). **NUD-042 maps `depot_not_set` to `admin.settings.errors.depotNotSet`** and needs new i18n keys for the other errors (none were added here: no UI).
- Data: new column `Tour.approximate Boolean @default(false)` (migration `20261017170000_tour_approximate`) so the UI can show the badge without recomputing. Stored per stop: `sequence` (1-based), `etaAt` (arrival), `legDistanceM`/`legDurationS` (the leg that ends at this stop; the return leg is only in the tour totals). Tour: `depotSnapshot {name,address,lat,lng}`, `geometry` (GeoJSON LineString), `totalDistanceM`, `totalDurationS` (= driving incl. return leg **plus service time**), `optimizedAt`, `isOutdated=false`, status `OPTIMIZED`.
- Re-run rules: unreleased (DRAFT/OPTIMIZED) -> re-optimized, stop rows are reused per customer (same ids), missing ones created, others deleted, `driverId`/`locked` kept. Locked -> `route()` over the kept order. RELEASED / IN_PROGRESS / COMPLETED -> `tour_not_editable` (re-release is NUD-043). The write runs in one transaction behind a per-date advisory lock and re-checks the tour and the confirmed orders (id + `updatedAt`) that the plan was based on; if anything changed while routing, nothing is stored and the result is `conflict` (retry).
- Verified: lint, typecheck, i18n:check, prettier, `pnpm test` (485 passed incl. 29 new; DB tests on embedded PostgreSQL), including authorization tests (anonymous and DRIVER rejected by `generateTourAction`, nothing written). The NUD-012 criterion "refuses without depot" is now ticked (test: `depot_not_set`, no tour written).
- NOT verified: `pnpm build` and e2e (no UI/route; the action is not imported by any page yet); behaviour with the real ORS provider (only `LocalHeuristicProvider` was used, as no key exists); concurrency of two simultaneous generate calls beyond the conflict test; the 51-customer TOO_MANY_STOPS test runs the heuristic only.
- Follow-ups for NUD-042/043: show `warnings`, `approximate`, `mode`/`removedCustomerIds` (customers dropped from a locked tour) and the error messages; NUD-043 must handle RELEASED/IN_PROGRESS tours (`tour_not_editable`); the in-place stop reuse already keeps ids stable for a diff.

---

#### NUD-042 · Tour planning UI (map, reorder, lock, release)
**Status:** done · **depends_on:** 011, 041

**Goal:** office reviews and releases the day's tour.

**Scope**
- `/admin/tours?date=…`: date picker; if no tour: "Generate tour" button + warnings list.
- Layout: map (numbered stops, polyline, depot) + ordered stop list (sequence, customer, ETA, item count, flags such as missing photos).
- Drag-and-drop reorder → recompute legs/ETAs via `route()` (not re-optimize). "Re-optimize" button.
- Lock toggle, assign driver (select from active drivers), **Release** button (→ `RELEASED`, `releasedAt`). Confirmation dialog shows stop count and total time.
- Approximate-route badge when the fallback provider was used.

**Acceptance criteria**
- [x] Reordering two stops updates the map numbering and ETAs. (e2e: drag C to the first place and the "down" button; list numbers, ETAs, marker "1" position and the stored `Stop.sequence` follow; integration test checks legs/ETAs/totals recomputed with `route()`.)
- [x] Release requires an assigned driver. (button disabled with a hint, and the server refuses with `driver_required`; also tested: inactive driver, outdated tour, stale version.)
- [x] E2E: generate → reorder → release. (`tests/e2e/tours.spec.ts`, desktop project; also re-optimize, lock, driver, dialog, "in tour" badge link.)

**Implementation notes**
- Domain `src/domain/tour-plan.ts` (+ test): `isTourEditable` (DRAFT/OPTIMIZED), `moveItem`, `isPermutation`, `sameOrder`, `releaseBlocker` (`tour_not_editable` > `no_stops` > `driver_required` > `outdated`), `durationParts`. ETA recomputation reuses `computeSchedule` / `departureInstant` from NUD-041 (no new helper needed).
- Server `src/server/tour-planning.ts`: read model `getTourPlan(db, date, tz)` (latest tour of the day with stops, item count = distinct products, photo flags from current photos, depot, geometry, drivers, `warnings` for unconfirmed pins recomputed from the confirmed orders so they survive a reload, `confirmedOrderCount`) and `reorderStopsWith`, `setTourLockedWith`, `assignDriverWith`, `releaseTourWith`. Actions in `tour-actions.ts` (`reorderStopsAction`, `setTourLockedAction`, `assignDriverAction`, `releaseTourAction`; each `requireRole("ADMIN")` first, then strict zod) and the read `tourPlanQuery(date)` in `tour-queries.ts` (ADMIN, bad/missing date -> next delivery date). Error codes (all mapped to `admin.tours.errors.*`; `depot_not_set` uses `admin.settings.errors.depotNotSet` plus a link to the settings): `invalid not_found tour_not_editable stops_changed pin_missing too_many_stops conflict no_stops driver_required driver_invalid outdated` and the NUD-041 generate errors.
- Reorder: the request must contain exactly the tour's current stop ids (else `stops_changed`, the page reloads); `route()` runs outside the transaction, the write takes the per-date advisory lock and re-checks `Tour.updatedAt`/status (`conflict`). Updates geometry, totals, `approximate`, stop sequence/ETA/legs; the `locked` flag and status are untouched. Release quotes the `version` (= `updatedAt`) the dialog showed.
- UI `/admin/tours?date=`: `TourDateField` (native date input, URL state), `TourPlanner` (client): empty state + "Tour erstellen"; warnings with links to `/admin/customers/<id>`; status / locked / approximate badges; summary (stops, total time incl. service, km); map (`TourMapLazy`, numbering follows the list, line hidden while recalculating) next to the stop list (number, customer, address, ETA, item count, "photo missing" badges for shop and parking, drag handle + up/down buttons); Re-optimize ("Aus Bestellungen aktualisieren" when locked, same action as NUD-041), lock toggle, driver select, release dialog (stop count, total time, driver). Released tours are read-only. Strings in `admin.tours.*` (de, zh-Hans by hand, Hant generated). The NUD-032 "in tour" badge is now a link (`data-tour-id` kept) to the tour page of that day.
- Verified: lint, typecheck, `pnpm build`, `pnpm test` (502 passed, DB tests on embedded PostgreSQL; 17 new incl. authorization tests for anonymous/driver on all four mutations and the read), `i18n:check`, prettier (except the untracked sandbox file `pw.local.config.ts`), e2e `tours` (desktop) and `shells` (desktop + mobile, includes the new page in all locales without console errors) and the first `order-overview` test (in-tour badge). Screenshots at 1280 px inspected (planning page, release dialog), no horizontal scroll asserted at 1280.
- NOT verified: real ORS routing (only the heuristic, so the "approximate" badge was seen but not the non-approximate state, and `route()` with ORS for reorder); mobile/touch use of the page (drag-and-drop is native HTML5 and does not work on touch, the up/down buttons are the touch path; no mobile e2e, the spec is desktop only); real map tiles (stubbed). Two `order-overview` e2e tests (order detail, archive dialog) fail in this sandbox because the e2e script runs without object storage ("Object storage is not configured" on those pages); they do not touch this ticket's code. `tours.spec.ts` temporarily confirms the depot pin and restores it, so it must not run at the same time as `settings.spec.ts`.
- Follow-ups for NUD-043: edits to RELEASED+ tours are all refused here (`tour_not_editable`); `releaseBlocker` already refuses an outdated tour on first release; the outdated alert on the page is minimal (no diff).

---

#### NUD-043 · Tour lifecycle & change handling (outdated tours)
**Status:** done · **depends_on:** 042

**Goal:** the driver never silently works with stale quantities (priority #2).

**Scope**
- Status machine in `src/domain/tour-status.ts`: `DRAFT → OPTIMIZED → RELEASED → IN_PROGRESS (first stop completed) → COMPLETED (all stops done)`; allowed transitions unit-tested.
- Any order create/update/cancel for a date with an existing tour sets `isOutdated=true`.
- Admin tour page shows a prominent "Orders changed since release — review & re-release" banner with a diff (stops added/removed, quantities changed).
- Re-release regenerates/updates stops, **preserving status of already-completed stops**.
- Driver view (used by NUD-051) shows a banner "Tour was updated" after a re-release, highlighting changed stops.

**Acceptance criteria**
- [x] Changing a quantity after release flags the tour; after re-release the driver sees the new quantity and the change highlight. (Data layer: `getDriverTour` returns the new quantity, `change: CHANGED`, `changedInRevision`, `previousItems`, `updated`, tested in `tour-rerelease.integration.test.ts`; e2e `tour-rerelease.spec.ts` covers edit -> banner -> re-release in the admin UI. **The driver screen that renders banner and highlight is NUD-051**, so that part is not visible to a driver yet.)
- [x] Completed stops are never reset by re-release (test). (Integration tests: delivered and problem stops keep id, sequence, status, `completedAt`, problem data, quantities, links and ETA through a re-release in which their orders were edited, cancelled and extended; a stop completed by the driver while the re-release is routing makes it fail with `conflict`; unit tests of `planReRelease`.)

**Implementation notes**
- Pure rules in `src/domain/`: `tour-status.ts` (state machine: `canTransition`, `deriveTourStatus`, `isReReleasable`; a stop counts as done when it is not PENDING; the tour never moves backwards, COMPLETED is final; 9 tests) and `tour-diff.ts` (`planReRelease(stops, orders)` = the diff stops added / removed / quantities changed / completed stops edited afterwards plus the new stop order, `sameItems`, `itemChanges`, and `outdatedTourDates(before, after)` = which delivery days an order change really affects; 18 tests).
- Outdated flag (refines NUD-032): `createOrder` / `updateOrder` / `cancelOrder` / `duplicateOrder` now run the order write and the flag in ONE transaction (`db.$transaction`, the hook gets the transaction client: `markOutdatedForDate(date, tx)`), so an order change can no longer be saved without its flag. Only changes that involve a CONFIRMED order flag (draft edits, copies, cancelling a draft and saves that leave customer, day and quantities as they were flag nothing); a date change flags both days. `markOutdatedForDate` itself still flags every not COMPLETED tour of the day (also unreleased ones: the release refusal from NUD-042 stays). Tests: `order-management.integration.test.ts` (hook cases rewritten, atomicity test: a failing hook rolls back create, update and cancel).
- Data (migration `20261017180000_tour_release_revision`, backfills existing stops): `Stop.items` (JSON `[{productId, quantityCents}]` = the quantities the office released, written by the builder and by re-release), `Stop.previousItems`, `Stop.changeKind` (`StopChange` ADDED | CHANGED), `Stop.changedInRevision`, `Tour.releaseRevision` (0 never released, 1 first release, +1 per re-release that changed something), `Tour.reReleasedAt`, `Tour.lastChange` (JSON of the last re-release incl. names of removed stops). First release now sets `releaseRevision = 1` and checks the transition through the status machine.
- Re-release `reReleaseTourAction({tourId, version})` -> `reReleaseTourWith` in `src/server/tour-rerelease.ts` (`requireRole("ADMIN")`, strict zod, errors `not_released`, `tour_not_editable` (COMPLETED), `driver_required`, `driver_invalid`, `conflict`, `pin_missing`, `too_many_stops`): only RELEASED / IN_PROGRESS tours; compares the stored `Stop.items` with the confirmed orders of routable customers (`loadReleasePlan`), keeps the order of the open stops, appends new customers, removes open stops without orders (reused stop rows keep their ids), recomputes legs / ETAs / geometry / totals with `route()` over the whole sequence and writes timing only to open stops, bumps the revision, sets markers and `lastChange`, clears `isOutdated`, and derives the tour status. Completed stops (DELIVERED / PROBLEM) are frozen: status, completion data, quantities, order links and ETA are never written (their position only shifts if an earlier stop was removed); edits to their orders are reported (`completedChanged`), not re-dispatched; a new order of an already delivered customer becomes a second, open stop at the end. All writes to open stops are guarded by `status = PENDING` and the transaction (per-date advisory lock) re-checks tour version, stop statuses and the confirmed orders; any mismatch rolls back and returns `conflict`. If nothing the driver would see differs (changes cancelled each other out) only the flag is cleared (and the order links refreshed); `changed: false`.
- Admin UI (`TourPlanner`, new `TourDiffList`): for a RELEASED / IN_PROGRESS tour with `isOutdated` a red banner "Bestellungen seit der Freigabe geändert – prüfen und erneut freigeben" with the diff (new stops, removed stops, quantity before -> after per product, edited completed stops) and a "Erneut freigeben" button with a confirmation dialog (counts); afterwards stop rows show their status and a "Menge geändert" / "Neu seit Freigabe" badge, the header "Aktualisiert am … (Version n)". The read model `getTourPlan` returns `releaseRevision`, `reReleasedAt`, `diff`, per stop `status` and `changeKind`. Strings `admin.tours.change.*` (de, zh-Hans by hand, Hant generated).
- Driver data layer for NUD-051: `getDriverTour(db, driverId, date)` in `src/server/tour-driver.ts` (no page, no action). Only released tours of that driver; quantities come from the `Stop.items` snapshot, NOT from the live order lines, so an order edited after release shows up for the driver only through a re-release (never half-updated). Returns `revision`, `updated` (show the "Tour was updated" banner), `removedCustomers`, per stop `change`, `changedInRevision`, `previousQuantityCents` per item. NUD-051 should remember the last revision the driver has seen (client side) and highlight stops with `changedInRevision` above it. `syncTourProgress(tx, tourId)` in `tour-service.ts` moves RELEASED -> IN_PROGRESS -> COMPLETED (`completedAt`) from the stop statuses; the stop-status mutation of NUD-053 must call it inside its transaction and take the same per-date advisory lock (`pg_advisory_xact_lock(hashtext('tour:<YYYY-MM-DD>'))`) as release / re-release.
- Tests: `tour-rerelease.integration.test.ts` (16: first release snapshot, flag -> diff -> driver data before / after, added / removed stops, reverted change, revisions, completed stops frozen (all fields), second visit, completing every open stop, race with a driver completing a stop, refusals, authorization (anonymous and DRIVER rejected, nothing changed), driver read model access, `syncTourProgress`), e2e `tests/e2e/tour-rerelease.spec.ts` (release, delivered stop A, change B 3 -> 5 through the order form, banner and diff in all four locales without console errors, re-release dialog, A still delivered, B marked, DB assertions).
- Verified: lint, typecheck, `pnpm test` (548 passed incl. DB tests on embedded PostgreSQL), `i18n:check`, prettier (except the untracked sandbox file `pw.local.config.ts`), `pnpm build`, e2e `tour-rerelease` (desktop), `tours` (desktop, alone), `order-overview` and `orders` (desktop, one `orders` mobile run failed in `pickProduct` with two open comboboxes and passed on the desktop rerun: timing, code untouched), `shells` (mobile); screenshots at 1280 px inspected (banner with diff, re-release dialog, after re-release), no horizontal scroll asserted.
- NOT verified: the driver screen itself (NUD-051 renders banner / highlight; only the data layer is tested); `route()` of the real ORS provider on re-release (heuristic only, as before); a real driver mutation racing a re-release (simulated by completing a stop while routing; NUD-053 must follow the lock rule above); mobile / touch use; `tours.spec.ts` fails when it runs in the same server session after specs that already loaded the settings (settings are cached by the app and the spec flips `depotPinConfirmed` directly in the DB), it passes alone; Chinese strings are agent-written (NUD-073).
- Follow-ups: a new confirmed order for a day whose tour is already COMPLETED is not flagged and has no way into a tour (NUD-099 added); the "Tour was updated" acknowledgement is client-side only (no server record that the driver saw revision n); archiving a customer or changing a customer's address/pin after release does not flag the tour.

---

#### NUD-050 · Driver first-start language picker
**Status:** done · **depends_on:** 005

**Goal:** a driver who reads no German can use the app from the first second.

**Scope**
- On first driver login (`localeChosen=false`) show a full-screen picker with four big buttons, each written in its own script with a small flag-free label: `Deutsch`, `简体中文`, `繁體中文（香港）`, `繁體中文（台灣）`. No other text needed.
- Saves `User.locale`, `localeChosen=true`. Changeable later via the language icon in the driver top bar.
- The driver login page itself shows the language switcher at the top (icon + own-script labels).

**Acceptance criteria**
- [x] E2E (mobile): first login → picker → choose 繁體中文（台灣） → home page in zh-Hant-TW; second login skips picker. (`tests/e2e/driver-language-picker.spec.ts`, 375x812, desktop + mobile projects, passed.)

**Implementation notes**
- Picker page `/[locale]/driver/start` (outside the `(app)` group, so no shell): `DriverLanguagePicker` with four 96 px buttons in their own script (`lang` set per button), a language icon, no other text. Server action `chooseDriverLocaleAction` (`src/server/driver-locale-actions.ts`): `requireRole("DRIVER")` first, zod-validated locale (`chooseDriverLocale` in `driver-locale.ts`), saves `User.locale` + `localeChosen = true` for the session user only, sets the `NEXT_LOCALE` cookie, refreshes the session token and redirects to `/{locale}/driver` (the original deep link is not restored: simplest, logged).
- Enforcement is guard-level: `requirePageActor("driver", ...)` redirects a DRIVER with `localeChosen=false` to the picker (`Actor` got `localeChosen`; admins in the support view are not affected); only the picker page passes `allowUnchosen`. Every future driver page must use `requirePageActor`, so deep links cannot skip it. The picker redirects chosen drivers / admins to the home.
- Login: `LanguageSwitcher` got `variant="bar"` (language icon + visible 48 px select, own-script options) and a `query` prop that keeps `?callbackUrl` when the locale changes; shown on the driver login page only. Later changes: the existing top-bar icon (unchanged).
- Seed: the four language demo drivers now have `localeChosen=true` (existing e2e logins stay deterministic); new seeded `driver-new` (de, `localeChosen=false`) shows the picker for manual demos. `drivers.spec.ts` was adapted (a freshly created driver now passes the picker). The picker e2e inserts its own driver per run, so it is independent of the seed.
- Tests: `driver-locale.integration.test.ts` (8: saves choice, invalid locales, anonymous / admin / deactivated rejected with nothing changed, cannot touch other users, guard redirects from every driver page, picker page passes, chosen drivers and admins pass), e2e as above.
- Verified: lint, typecheck, prettier, `i18n:check`, `pnpm test` (556 incl. DB tests), `pnpm build`, e2e `driver-language-picker`, `auth`, `drivers`, `shells`, `home`, `uploads` (with fake S3), 375 px screenshots of login and picker inspected, no horizontal scroll asserted.
- NOT verified: real phone / Safari (native select popup of the icon variant); the setting of `localeChosen` is not enforced in the proxy (token has no such claim) nor in future driver mutations (NUD-053 should keep using `requireRole("DRIVER")`; the page guard covers navigation); picker has no heading text by design (screen readers hear the four language names).

---

#### NUD-051 · Driver "today's tour" screen
**Status:** done · **depends_on:** 043, 050

**Goal:** projektbeschreibung §5 "Beim Öffnen sieht er".

**Scope**
- Loads the driver's `RELEASED`/`IN_PROGRESS` tour for "today" (factory TZ). If none: friendly empty state ("No tour released for today").
- Top: date, progress `3 / 12`, total remaining time estimate.
- **Next stop card** (large): sequence number, customer name, address, ETA, item summary (e.g. "3 Sorten · 27 kg"), buttons **Navigate** and **Details**.
- Numbered list of all stops with status icon (pending / ✓ / ⚠), tap → detail.
- Toggle "List / Map" (TourMap with numbered markers).
- Updated-tour banner from NUD-043.
- _Added by NUD-043:_ read the tour with `getDriverTour(db, driverId, date)` (`src/server/tour-driver.ts`): quantities come from the released snapshot (`Stop.items`), never from live order lines. Show the banner while `updated` is true and until the driver has seen `revision` (remember the last seen revision on the device); highlight stops with `changedInRevision` above it (`change` = `ADDED` / `CHANGED`, `previousQuantityCents` per item); list `removedCustomers` in the banner.

**Acceptance criteria**
- [x] Driver sees only his own tour (authz test). (`driver-today.integration.test.ts`: another driver's tour of the same day, an admin, unknown users, other days and unreleased tours yield nothing; page query rejects anonymous and deactivated users and takes the driver id from the session only; e2e: a second driver gets the empty state and no access to the first driver's stop route.)
- [x] Next stop = lowest-sequence `PENDING` stop. (`nextPendingStop` unit tests incl. unordered input and problem stops; component test in 4 locales; e2e: delivering stop 2 moves the card to stop 3.)
- [x] Renders correctly in all 4 locales at 375 px. (`tests/e2e/driver-today.spec.ts`, seeded released tour, mobile project at 375x812: no horizontal scroll, touch targets >= 48 px, quantity >= 28 px bold, body >= 16 px, no console errors; screenshots of list, map and updated state inspected for de and zh-Hant-TW / de.)

**Implementation notes**
- Page `/[locale]/driver` (replaces the placeholder): `requirePageActor("driver")`, then `driverTodayQuery(locale)` (`src/server/driver-today.ts`: `requireRole("ADMIN","DRIVER")`, only a DRIVER gets a tour, the driver id is the session user, "today" = calendar day in `Settings.timezone`) built on `getDriverTour` (snapshot quantities; got `legDurationS`). Product names are picked server-side in the URL locale; customer name/address are untranslated. The client screen is `components/driver/today-tour.tsx`: progress `done / total` + bar + remaining time, big next-stop card (number, name, address, ETA in factory time zone, summary, Navigate = Google Maps link with the pinned lat/lng via `lib/navigation.ts`, Details), List / Map toggle (`TourMapLazy`, numbered markers, depot, geometry), numbered list with status icon + text (Offen / Geliefert / Problem), all-done card, empty state when no tour. Pure rules in `domain/driver-today.ts` (next stop, progress, per-unit summary, remaining time, unseen change).
- Summary "N Sorten · X kg": one total PER UNIT (kg, Packungen, Kisten, Stück), never summed across units; unit words are ICU plurals in `driver.units.*`; quantities are 30 px bold.
- NUD-043 data: banner "Tour wurde aktualisiert" (with removed customers) while `updated` and the device has not acknowledged `revision`; the last acknowledged revision is kept in `localStorage` (`nudel.driver.seenRevision.<tourId>`, `useSyncExternalStore`, storage failures behave as "never seen"); while the tour has not been re-released the current revision is stored silently. Stops with `changedInRevision` above it get an amber highlight: "Neuer Stopp" or "Menge geändert" with old -> new quantity per changed item. "Verstanden" (48 px) acknowledges and removes banner and highlights. The page refreshes its data when the app becomes visible again (`RefreshOnFocus`).
- Details: stop rows and the Details button link to the new placeholder route `/driver/stops/[stopId]` (only the customer name, back button; 404 unless the stop is in the driver's own tour of today); NUD-052 replaces it. The logout button and welcome line stay at the bottom of the page. `TodayPlaceholder` was removed.
- Tests: `domain/driver-today.test.ts` (9), `lib/navigation.test.ts`, `server/driver-today.integration.test.ts` (7), `components/driver/today-tour.test.tsx` (6 x 4 locales, throwing on missing messages), e2e `driver-today.spec.ts` (4 locales + details/authz/next-stop advance + re-release banner/highlight/acknowledge).
- Verified: lint, typecheck, prettier, `i18n:check`, `pnpm test` (598 passed incl. DB tests), `pnpm build`, e2e mobile project: `driver-today`, `shells`, `home`, `driver-language-picker`, `drivers`, `auth`; screenshots at 375 px inspected.
- NOT verified: real phones / Safari / Google Maps app hand-over; the desktop Playwright project for the new spec (phone viewport forced, mobile project run only); real map tiles (stubbed); Chinese strings are agent-written (NUD-073); the remaining-time estimate is only checked arithmetically (planned legs + service time of open stops, rounded up to 5 min, without the way back to the depot); the update banner after a real re-release through the admin UI (data seeded directly, the re-release itself is covered by NUD-043 tests).
- Known limits: a product removed from a stop in a re-release is not listed (the read model only has current items; the stop is still marked "Menge geändert"); the top-bar date truncates on narrow screens in German (pre-existing shell); the 'seen' state is per device/browser (no server record).

---

#### NUD-052 · Driver stop detail + navigation
**Status:** done · **depends_on:** 015, 051

**Goal:** projektbeschreibung §5 "Bei Auswahl eines Kunden" + §6.

**Scope**
- Header: sequence number, customer name (untranslated), full address (tap to copy).
- **Shop photo** and **parking photo** large, tap → fullscreen with pinch-zoom; placeholder icon + "no photo yet" if missing.
- **Items:** one row per product: localized product name (driver's locale, large) + German name small underneath (to match box labels) + quantity (≥ 28 px bold) + localized unit.
- Notes for driver (`pick(notes, locale)`; until NUD-071 only German exists → shown with a small "DE" badge), delivery hours info.
- **Navigate** button: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=driving` (opens Google Maps app if installed). Secondary option "Apple Maps" on iOS (`https://maps.apple.com/?daddr=<lat>,<lng>`).
- Prev/next stop swipe or buttons.

**Acceptance criteria**
- [x] Quantities on this screen equal the merged quantities of the stop's confirmed orders (integration test). (`driver-stop.integration.test.ts`: two confirmed orders of one customer for the day are merged by the real tour builder + release, a DRAFT and a CANCELLED order are excluded; detail shows 15 kg / 3 packs.)
- [x] Navigate link contains the confirmed pin coordinates, not the address string. (Unit + component + e2e assert the exact URL; Apple Maps link likewise.)
- [x] Missing photos never break the layout. (Both photos are in a fixed 4:3 box; e2e compares box size with photos, with one and with no photo; 375 px, 4 locales, no horizontal scroll.)

**Implementation notes**
- Route `/[locale]/driver/stops/[stopId]` now renders `components/driver/stop-detail.tsx` from `driverStopQuery(locale, stopId)` (`src/server/driver-stop.ts`). The query builds on `getDriverToday`, so the ownership rule is unchanged: the stop must be in the session driver's own released tour of today, else `notFound()`; admins and other drivers get nothing. Extra reads only for that stop's customer: `notes`, `deliveryHoursInfo`, current photos via `getCustomerPhotos` (signed URLs, server side). Quantities are the released snapshot (as NUD-051).
- Screen order: back, "Stopp n von N", sequence badge, untranslated name, address (whole row is a 48 px button, copies "street, postal code city", short "Adresse kopiert" confirmation), ETA, Navigate (Google Maps with pin lat/lng; "Apple Karten" additionally when the browser is iOS/iPadOS, detected client-side via `useSyncExternalStore`; "no pin" notice instead when there is no pin), store photo, parking photo, items, notes (+ "DE" badge when the shown text is German and the UI is not German), delivery hours, an empty `data-testid="status-actions-slot"` marked for NUD-053, previous / next buttons (disabled at the ends).
- Photos: `ImagePreview` (NUD-006) in a fixed `aspect-[4/3]` frame with `contain`; missing photo = same frame with icon + "Noch kein Foto". Items: localized name 20 px semibold, German name small below (only if different), quantity 30 px bold + localized unit.
- Helpers: `domain/driver-stop.ts` (`neighbourStops`, `formatAddress`), `pickWithSource` in `lib/localized-text.ts` (which locale a picked text is in), `appleMapsNavigationUrl` in `lib/navigation.ts`; `TodayItem` got `germanName`, `TodayStop` got `customerId`. Removed the `driver.stop.comingSoon` string; new keys under `driver.stop.*` (de, zh-Hans; Hant generated).
- Tests: `domain/driver-stop.test.ts`, `localized-text.test.ts`, `navigation.test.ts`, `components/driver/stop-detail.test.tsx` (4 locales + copy, iOS, no pin), `server/driver-stop.integration.test.ts` (7), e2e `tests/e2e/driver-stop.spec.ts` (4 locales at 375 px with and without photos, one photo missing, fullscreen viewer opens and zooms, copy, prev/next, iOS Apple Maps, other driver sees nothing). Verified: lint, typecheck, prettier, `i18n:check`, `pnpm test` (628 passed incl. DB), `pnpm build`, e2e mobile `driver-stop` + `driver-today`; screenshots (de with photos, zh-Hant-TW without photos) inspected.
- NOT verified: real phone / Safari (iOS detection, Apple Maps and Google Maps app hand-over, real pinch gesture; only the zoom button was exercised), real S3/R2 photos (e2e answers the signed image requests itself), the clipboard on a real phone (HTTP contexts without clipboard API silently do not copy), the desktop Playwright project, Chinese strings are agent-written (NUD-073). Swipe between stops not built (optional; buttons only).
- Notes for later: Next keeps visited routes hidden in the DOM after client navigation, so e2e locators on such pages need `:visible`; the stop page streams, so a foreign stop id still returns HTTP 200 with the not-found UI (nothing of the stop is sent). The change highlight of NUD-051 is not repeated on this screen.


---

#### NUD-053 · Driver stop status (delivered / problem)
**Status:** done · **depends_on:** 052

**Goal:** driver closes each stop with one tap.

**Scope**
- Big buttons on stop detail: **✓ Delivered** and **⚠ Problem**.
- Problem sheet: predefined reasons (`ProblemReason`, localized, with icons) + optional free text (stored as `LocalizedText` with `source = driver locale`; translation follows in NUD-072).
- After success: auto-advance to the next pending stop; toast with **Undo** (5 minutes, server-enforced).
- First completed stop sets tour `IN_PROGRESS`; last sets `COMPLETED` and shows a "tour finished" screen.
- _Added by NUD-043:_ call `syncTourProgress(tx, tourId)` (`src/server/tour-service.ts`) inside the transaction that writes the stop status, and take the per-date advisory lock `pg_advisory_xact_lock(hashtext('tour:<YYYY-MM-DD>'))` first, as release / re-release do. COMPLETED is final in the status machine: decide how "Undo" of the last stop behaves (e.g. no undo once the tour is completed).
- Each mutation carries a client-generated `clientMutationId` (UUID) → idempotent (prepares NUD-082).

**Acceptance criteria**
- [x] Double-tapping "Delivered" creates exactly one state change (idempotency test). (`stop-status.integration.test.ts`: same id twice, also in parallel -> one change, one `StopMutation`, replay returns the stored result; another id on a completed stop -> `already_completed`; component test: three clicks -> one action call; e2e `dblclick` -> one DB mutation.)
- [x] Undo after 5 minutes is rejected. (Integration test: +5 min 1 s -> `undo_expired`, stop unchanged; exactly 5 min is still allowed; server clock.)
- [x] Tour status transitions as specified (test). (Integration test: RELEASED -> IN_PROGRESS on the first completed stop (DELIVERED or PROBLEM) -> COMPLETED with `completedAt` on the last; undo of the only done stop leaves IN_PROGRESS; COMPLETED refuses undo; e2e checks the DB status per locale.)

**Implementation notes**
- Server: `applyStopMutation(db, actor, input, now)` in `src/server/stop-status.ts` is the one function per mutation (NUD-082's `POST /api/driver/sync` can loop over it; each queued entry brings its own `clientMutationId`). Input (strict zod union): `delivered`, `problem` (`reason` = `ProblemReason`, optional `note` <= 500 chars) and `undo`, each with `stopId` + `clientMutationId` (UUID). Result `{ok:true, replayed, kind, status, tourStatus, done, total, nextStopId, completedAt, undoUntil}` or `{ok:false, error}` (`invalid`, `forbidden`, `not_found`, `already_completed`, `not_completed`, `undo_expired`, `tour_completed`, `tour_not_active`, `mutation_conflict`). One transaction: `pg_advisory_xact_lock(hashtext('tour:<date>'))` first, then the id log, then guarded updates (`status = PENDING` / `<> PENDING`), then `syncTourProgress(tx, tourId)`. Server action `stopStatusAction` (`stop-status-actions.ts`): `requireRole("DRIVER")` first, then `applyStopMutation`, `revalidatePath` on success.
- Data: migration `20261017190000_stop_mutation` adds `StopMutation` (id = clientMutationId, stopId, driverId, kind, stored result). It makes undo idempotent too (`Stop.clientMutationId` holds only one id); `Stop.clientMutationId` is still set on completion and cleared on undo. Accepted ids are recorded, rejections are not (a retry may succeed later). The same id for another stop / driver / kind is `mutation_conflict`.
- Ownership: the stop must be in a RELEASED / IN_PROGRESS tour assigned to the acting driver (`not_found` otherwise, also for foreign stops). Not limited to "today", so a queued mutation synced after midnight still works. Free text is stored as `LocalizedText` with `source` = the driver's locale (`User.locale`, which the language switcher keeps in sync); translation is NUD-072.
- Undo: 5 minutes from `completedAt` (server clock), `src/domain/stop-status.ts` (`UNDO_WINDOW_MS`, `isWithinUndoWindow`, `nextPendingAfter`). COMPLETED is final: once the last stop is done nothing can be undone (no undo in the toast, no undo button), and the tour never moves back from IN_PROGRESS.
- UI: `StopStatusActions` (`components/driver/stop-status-actions.tsx`) fills the `status-actions-slot`: 80 px green "Geliefert", 64 px amber "Problem", bottom sheet with the seven reasons (lucide icons, 64 px, localized with `common.problemReasons`) and a free-text area; after success a toast (10 s, Undo button 48 px) and navigation to the next pending stop (next one behind it in tour order, else an earlier open one, else `/driver`). A completed stop shows a result card (status, reason, time) with Undo while inside the window. Buttons lock while a request runs; the `clientMutationId` is kept after a failed request without an answer (retry = same mutation) and renewed after any answer; `newClientMutationId` falls back to `getRandomValues` on plain HTTP. Stale-screen errors (`already_completed`, `not_found`, ...) show a message and refresh. "Tour finished": the all-done card on `/driver` now has a party icon and a summary ("3 geliefert, kein Problem"). Strings `driver.status.*`, `driver.today.finishedSummary` (de, zh-Hans by hand, Hant generated). `getDriverTour` / `TodayStop` got `problemReason` and `completedAt`.
- Tests: `stop-status.integration.test.ts` (17: delivered, problem + LocalizedText source, idempotency incl. parallel, id conflicts, undo window, tour status walk, advance, ownership, lock wait, strict zod, action authorization anonymous / admin / deactivated), `domain/stop-status.test.ts`, `lib/client-id.test.ts`, `stop-status-actions.test.tsx` (7 x 4 locales), e2e `tests/e2e/driver-status.spec.ts` (4 locales at 375 px: buttons, sheet, touch targets, double tap, toast Undo, problem + note, finish, no undo after COMPLETED; stale screen; retry keeps the id).
- Verified: lint, typecheck, prettier, `i18n:check`, all vitest files (incl. DB tests on embedded PostgreSQL, run in groups), `pnpm build`, e2e mobile `driver-status`, `driver-stop`, `driver-today` (fake S3); screenshots at 375 px (buttons de, sheet / toast / finished zh-Hant-TW) inspected, no horizontal scroll asserted.
- NOT verified: real phone / Safari (touch, sheet with keyboard, toast gestures); the 5-minute expiry only with an injected clock, not waited in e2e; a live race with an admin re-release (covered by the shared advisory lock and a lock-wait test); offline behaviour beyond the retry with the same id (NUD-082); Chinese strings are agent-written (NUD-073); the toast overlaps the list on the finished screen for 10 s.
- Follow-ups: NUD-054 should show `problemReason` / `problemNote` (the note is in the driver's language until NUD-072); NUD-082 must add the "server state wins" conflict rule on top of `applyStopMutation` and may need a `completedAt` override for entries queued offline (the undo window currently counts from server receipt).

---

#### NUD-054 · Admin live tour progress
**Status:** done · **depends_on:** 053

**Goal:** office sees where the delivery stands.

**Scope**
- Admin dashboard card "Today": progress bar, next stop, problems count.
- Tour page in `RELEASED/IN_PROGRESS`: stop list with status, completion time, problem reason + text (original; German translation after NUD-072). Map markers colored by status.
- Polling every 30 s (SWR / `router.refresh`), no websockets.

**Acceptance criteria**
- [x] Driver marks a stop delivered → admin view shows it within 30 s without manual reload. (e2e `admin-progress.spec.ts`: the driver delivers in the real driver UI in a second browser context; dashboard and tour page, left open, updated by themselves. Default 30 s interval: 28.3 s measured end to end, i.e. inside the limit; with `LIVE_POLL_INTERVAL_MS=5000` 2.6 s.)

**Implementation notes**
- Dashboard: `TodayCard` (`components/admin/today-card.tsx`) on `/admin`: today's tour in the factory time zone (latest tour of the day), status badge, segmented progress bar (`role=progressbar`, text "3 von 8 Stopps erledigt" next to it), next open stop (name, address, planned ETA) or "all done", problems count with the customer + reason of each problem stop, driver, link to the tour page of the day. No tour / not yet released (DRAFT, OPTIMIZED) shows a hint and a link to planning. Read model `getTodayProgress` / `todayProgressQuery` (`server/tour-progress.ts`, `requireRole("ADMIN")` first); pure rules in `domain/tour-progress.ts` (`summarizeProgress`, next stop = first PENDING by sequence).
- Tour page (`TourPlanner`): for RELEASED / IN_PROGRESS / COMPLETED a progress block (bar + "x von y Stopps erledigt · n Probleme"), per stop a status badge with icon (check / warning / dashed circle), a "Nächster Stopp" badge, "Erledigt um HH:mm" (factory time zone), and for PROBLEM the reason (`common.problemReasons`) and the driver's text exactly as written, with `lang` = the language he wrote it in and the label "Originaltext des Fahrers" (German translation is NUD-072). `PlanStop` got `completedAt`, `problemReason`, `problemNote {text, locale}` (source-locale value of the `LocalizedText`). Problem rows get a red 2 px border, delivered rows a green one.
- Map: `TourMapStop.status` (optional, the driver map and the planning map are unchanged without it). Colour AND shape: open = blue circle with number, delivered = dark green circle with number and a check-mark badge, problem = red diamond with number and a "!" badge; the tooltip names the status. Colours are the darker 700 shades (white text contrast >= 5:1).
- Polling: `LiveRefresh` (`components/shared/live-refresh.tsx`) calls `router.refresh()` every interval while the tab is visible (skips ticks while hidden, refreshes at once when the tab becomes visible again). Active on the dashboard unless the tour is COMPLETED, and on the tour page for RELEASED / IN_PROGRESS tours (not for DRAFT/OPTIMIZED: nothing changes there without an admin action; not for COMPLETED, which is final). Interval comes from the server: `LIVE_POLL_INTERVAL_MS` (default 30000, allowed 1000..300000, else default; `.env.example`, `docs/env.md`); it is meant for tests only.
- Strings: `admin.dashboard.today.*`, `admin.tours.progress.*` (de, zh-Hans by hand; Hant generated).
- Tests: `domain/tour-progress.test.ts`, `live-refresh.test.tsx` (interval, disabled, hidden tab, unmount), `today-card.test.tsx` (4 locales: progress, next stop, problems, all done, no tour, not released), `tour-progress.integration.test.ts` (real DB: the driver's `applyStopMutation` moves the read model through delivered / problem / completed; completion time, reason and original text in the plan; authorization: anonymous, driver and a deactivated admin are rejected on `todayProgressQuery`; `tourPlanQuery` was already covered by NUD-042 tests), e2e `tests/e2e/admin-progress.spec.ts` (dashboard + tour page open at 1280 px, driver in a phone context delivers / reports a problem with text via the UI, both admin pages update without reload within one interval, markers carry `data-status` and the check / "!" badges, zh-Hans / HK / TW render the same data, a driver cannot open `/admin`).
- Verified: lint, typecheck, prettier, `i18n:check`, all 68 vitest files (712 tests, DB tests on embedded PostgreSQL), `pnpm build`, e2e `admin-progress` (desktop) with the default 30 s interval and with 5 s, `tours`, `tour-rerelease`, `shells`, `home`; screenshots at 1280 px of dashboard and tour page (start, finished, zh-Hans / HK / TW) inspected, no horizontal scroll asserted.
- NOT verified: real browsers / tile layer (tiles stubbed), the visual of the markers on a real map tile, background-tab throttling in real Chrome / Safari, a long-running session (hundreds of refreshes), screen-reader announcement of the progress bar; Chinese strings are agent-written (NUD-073). Specs that edit the depot via SQL (`tours`, `tour-rerelease`) fail when run after other specs on the same `next start` because the settings cache is warm; run them first or alone (environment note, unchanged behaviour).
- Follow-ups: German translation of the problem text is NUD-072 (the original text is shown today); the offline-queue case (NUD-082) means the admin sees a stop only after the driver's device syncs.

---

#### NUD-060 · MVP demo seed + end-to-end happy path
**Status:** done · **depends_on:** 054

**Goal:** a convincing demo for the client and a regression safety net.

**Scope**
- `pnpm db:seed --demo`: 20 realistic fictional restaurants around the depot (use real public street addresses in the depot city but invented business names), confirmed pins, placeholder photos (generated solid-color images with text "Eingang" / "Parken"), 8 products with all locale names, confirmed orders for the next delivery date.
- Playwright e2e `mvp-happy-path.spec.ts`: admin creates a customer + order → generates tour → releases → driver (mobile project, locale `zh-Hans`) opens tour, opens stop, sees correct quantity, marks delivered → admin sees status.
- Run the same driver part in `zh-Hant-HK`, `zh-Hant-TW` and `de` (parameterized).
- `docs/demo.md`: 5-minute demo script for the client.

**Acceptance criteria**
- [x] E2E passes in CI for all four driver locales. (Passes locally in all four on a fresh build; the CI workflow was extended but not run, no GitHub remote.)
- [x] Demo seed is idempotent (re-running doesn't duplicate data). (Integration test + two CLI runs against s3rver: second run creates 0 rows.)

**Implementation notes**
- `pnpm db:seed --demo [--no-photos] [--today]` (`prisma/seed.ts` -> `server/demo-seed.ts`, data in `server/demo-data.ts`): runs the base seed, then: depot "Nudelfabrik Wien (Demo)", Absberggasse 27, 1100 Wien with a confirmed pin (only while the depot pin is still unconfirmed; a confirmed depot is never overwritten), 20 customers `D-001..D-020` (invented names, real Vienna street addresses, hand-picked pins, `pinConfirmed`, delivery hours, 5 with a note in all four locales), 2 extra products (`RIGA-5`, `GNOC-2`; Hant names via OpenCC, flagged machine) = 8 products, a STORE and a PARKING photo per customer and one CONFIRMED order (1-3 lines, deterministic quantities, half kilos for KG) per customer for the next delivery day (`--today`: today, for a live demo because the driver only sees today's tour).
- Idempotent through natural keys: customer number, SKU, current photo per kind, demo order marker (`internalNote`) with `deliveryDate >= today`. A rerun adds nothing; on a later day after the demo orders' date has passed it adds a fresh set. Rows that exist are never updated (admin edits survive).
- Photos: `server/testing/placeholder-image.ts` is a dependency-free PNG writer with a 5x7 bitmap font (800x600, "EINGANG" blue / "PARKEN" green plus the customer number). They are uploaded through `Storage.createUploadUrl` (presigned PUT) and attached with the normal `addCustomerPhoto` (deterministic UUID keys `customers/<uuid>.png`, so reruns reuse them). Without `S3_*` the seed stops before writing anything with a message (the Fake store is per process and would lose them); `--no-photos` skips photos and needs no S3.
- E2E `tests/e2e/mvp-happy-path.spec.ts` (desktop project, serial): per driver locale (`zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`, `de`; the seeded demo drivers) the admin creates a customer (Fake geocoder, pin confirmed) and an order for TODAY (SPAG 2,5 + PENN 4), generates the tour, assigns the driver and releases; the driver (Pixel 7 context) logs in, sees the tour, opens the stop, the two quantities are asserted (decimal separator per locale), marks delivered; the admin dashboard and tour page show 1 von 1, COMPLETED, stop DELIVERED. Fifth test: a demo customer's photos load (skipped explicitly with a reason when the demo was seeded with `--no-photos`). The spec never edits Settings: it fails up front with a clear message when the depot pin is unconfirmed or another tour exists for today, and removes its own data (`MVP-` customers) before and after.
- CI: `e2e` job runs the suite with `--grep-invert "MVP happy path|demo data"` on the plain seed, then `db:seed --demo --no-photos` and the happy path (the other specs expect an unconfirmed depot, e.g. `settings.spec.ts`; the server is rebuilt/restarted per `playwright test`, so the Settings cache is fresh).
- `docs/demo.md`: 5-minute script with preparation, seeded logins and what to show per minute; `docs/env.md` and README mention the flags.
- Flake fixes found by the regression run: `customer-form.spec.ts` counted `flag-pin-unconfirmed` among hidden elements (Next keeps the visited customer list in the DOM; rows of other specs' unconfirmed customers matched) -> counted among `:visible` only (root cause, not a retry). `orders.spec.ts` / `order-screenshot.spec.ts` picked the second product while the first picker was still closing (strict-mode violation on the placeholder, seen with `--repeat-each=2`) -> each pick waits until the picker is gone.
- Verified: lint, typecheck, prettier, `i18n:check`, all 70 vitest files (722 tests, DB tests on embedded PostgreSQL; new: placeholder image, demo data, `seedDemo` integration), `pnpm build`, CLI seed against s3rver twice (20 customers / 40 photos / 8 products / 20 orders, second run 0 created; no-S3 message; bad flag usage), the 40 stored photo objects are valid PNGs (one inspected visually), happy path x4 locales + demo photos on a fresh build, regression run of all other e2e specs in groups (desktop + mobile, 2 workers; `tours`/`settings`/`tour-rerelease` with 1 worker): all green; `driver-status` and `admin-progress` desktop only.
- NOT verified: CI run (no remote); MinIO / R2 (only s3rver); a real phone; ORS routing (fallback heuristic); the hand-picked coordinates against a real map (approximate, see decision log); Chinese strings are still agent-written (NUD-073); the demo script was written from the UI, not rehearsed with the client.
- Follow-ups: none new that need a ticket; the demo orders are for the next delivery day, the happy path uses today (the driver only sees today's tour).

---

### M2 — Production v1

---

#### NUD-070 · Translator interface + DeepL + OpenCC derivation
**Status:** done · **depends_on:** 003

**Goal:** machine translation for user-generated text, provider-agnostic.

**Scope**
- `Translator` interface: `translate(text, from: Locale, to: Locale): Promise<string>`.
- DeepL implementation (target `ZH-HANS` for Chinese; for Hant targets translate to Hans then OpenCC `cn→hk` / `cn→twp`; source `ZH` → `DE`).
- Fake implementation (`[zh-Hans] …` prefix) for tests / missing key.
- Service `localize(text, sourceLocale): LocalizedText` producing all four locales with `meta.machine` flags.
- Failures never block saving: store source only, mark `pendingTranslation`, retry via a small background job (Vercel cron route, every 10 min).

**Acceptance criteria**
- [x] Unit tests with Fake; DeepL client tested with recorded fixtures. (`translator/translator.test.ts`, `localize.test.ts`; the fixtures are hand-written from the documented DeepL v2 shape, NOT recorded from a live call, see notes.)
- [x] DeepL outage → record saved, retried later (test with failing fake). (`translation-retry.integration.test.ts` on real PostgreSQL: a failing translator -> `localize` saves the source with `pendingTranslation`, the job keeps it pending while the provider is down, a later run fills it.)

**Implementation notes**
- `src/server/translator/`: `types.ts` (`Translator { kind, translate(text, from, to) }`, `TranslatorError` codes `TIMEOUT|NETWORK|HTTP|QUOTA|BAD_RESPONSE|INVALID_INPUT`), `base.ts` (`ChineseAwareTranslator`: German <-> Simplified goes through one provider call, Hant targets are produced from the Simplified answer with OpenCC `cn->hk` / `cn->twp`, Chinese -> Chinese never leaves the process), `deepl.ts`, `fake.ts`, `index.ts` (`getTranslator(env)` singleton + `setTranslatorForTests`), `localize.ts`.
- DeepL: `POST /v2/translate`, JSON body `{text:[…], source_lang: DE|ZH, target_lang: ZH-HANS|DE}`, key in `Authorization: DeepL-Auth-Key …` only, answer validated with zod, 5 s timeout, 1 retry on timeout / network / 5xx / 429 (not on other 4xx; 456 = quota is reported as `QUOTA`). Endpoint: `DEEPL_API_PLAN=free|pro`, default derived from the `:fx` key suffix. Fake: `[zh-Hans] text` / `[de] text` (Hant targets: same prefix, OpenCC-converted text). Missing `DEEPL_API_KEY` -> Fake and one warning, as for the geocoder.
- `localize(text, sourceLocale, {translator?}) : Promise<LocalizedText>` never throws. German source -> one call to Simplified, Hant via OpenCC; Chinese source (any script) -> one call to German, the other Chinese variants via OpenCC. Translated / derived locales get `meta.machine[locale] = true`, the source never. On a provider failure the result is the source (plus the Chinese variants OpenCC can derive offline) with `meta.pendingTranslation = true`; the text is not logged. `completeTranslation(text, translator)` is the reusable core (also used by the retry job): fills only EMPTY locales, never overwrites a hand-written one (a German note with only a hand-written HK text gets Hans from HK without a provider call), clears the flag. NUD-071/072 call `localize()` on save.
- Pending marker: optional `pendingTranslation: boolean` in `LocalizedText.meta` (zod schema + `createLocalizedText` option); no migration, no table (see decision log). Registry `src/server/translation-pending.ts` lists the columns (`Customer.notes`, `Stop.problemNote`) with `find` (Prisma JSON-path filter on `meta.pendingTranslation`) and a guarded `save` (only if the stored text still has the `meta.updatedAt` that was read and is still pending, so an office edit in between wins). A future column with a `LocalizedText` must be added to `PENDING_SOURCES`.
- Job: `retryPendingTranslations({db, translator, limit = 50 per source, timeBudgetMs = 45 s})` in `translation-retry.ts` returns counts per source. A provider error ends the run (records stay pending, next run retries), a refused text (`INVALID_INPUT`) only counts as failed. Route `GET /api/cron/retry-translations` (`src/app/api/cron/retry-translations/route.ts`, logic in `translation-cron.ts`, `maxDuration = 60`), protected by `Authorization: Bearer $CRON_SECRET` (`cron-auth.ts`, constant-time compare, fails closed when the secret is unset -> 401). With only the Fake translator configured the route answers `skipped` and leaves everything pending (it must not "complete" real records with prefixed fake text). `vercel.json` cron `*/10 * * * *`. New env vars `DEEPL_API_KEY`, `DEEPL_API_PLAN`, `CRON_SECRET` in `.env.example` and `docs/env.md` (+ section "Translation retry job"), `docs/deploy.md`; `checkDeployEnv` warns (production only) when `CRON_SECRET` / `DEEPL_API_KEY` are missing.
- Tests (53 new): Fake, DeepL request/response/retry/error mapping, plan resolution, `getTranslator` single warning, `localize` (all source scripts, outage, empty answer, no text in logs), `completeTranslation` (no overwrite), cron auth (wrong / missing / unset secret, route file wired, Fake skip), retry job on PostgreSQL (both columns, outage then recovery, concurrent edit not overwritten, refused text does not block, invalid JSON skipped, limit, time budget), deploy-env warnings.
- Verified: lint, typecheck, prettier on changed files, `i18n:check`, all 74 vitest files (775 tests, DB tests on embedded PostgreSQL), `pnpm build` (route listed as dynamic), and against `next start`: the cron route answers `401` without header and `200 {"status":"skipped"}` with the bearer secret (no DeepL key). No UI, no new mutation, no new strings, schema unchanged (seed unaffected).
- NOT verified: any live DeepL call (no key, by instruction): the request/response shapes are from the documented API (`/v2/translate`, `translations[].text`, `ZH-HANS` target, status 456 for quota) and may differ in detail; Vercel Cron itself (no deployment; Hobby plans only allow daily crons, so the 10 minute schedule needs Pro); the Prisma JSON-path filter at scale (a full scan of `Stop`, fine for this volume); texts translated by the Fake before a key was added stay as they are (they are not pending; NUD-071's "Re-translate" replaces them).
- Follow-ups for the next tickets: NUD-071/072 call `localize()` on save and may show a "translation pending" hint from `meta.pendingTranslation`; NUD-071's editor must set a fresh `meta.updatedAt` on every save (the retry job's guard relies on it) and should clear `pendingTranslation` itself when the office fills the locales by hand.

---

#### NUD-071 · Customer notes translation & multilingual editor
**Status:** done · **depends_on:** 014, 070

**Goal:** drivers read customer notes in their own language.

**Scope**
- Customer form: notes edited in German (source); on save → `localize()`.
- "Translations" tab showing all four versions with "machine-translated" badge; office can edit any version (badge removed for edited ones). "Re-translate" button (warns that manual edits will be overwritten).
- Changing the German source re-translates only machine versions; manual edits are kept but flagged "source changed, check translation".
- Driver stop detail now shows the note in the driver's locale (drop the "DE" badge when a translation exists).

**Acceptance criteria**
- [x] Note "Hintereingang benutzen, nach 10 Uhr klingeln" appears in all three Chinese variants on the driver screen. (e2e `note-translations.spec.ts` with the FAKE translator, no DeepL key: the driver sees `[zh-Hans] Hintereingang benutzen, nach 10 Uhr klingeln` in zh-Hans / zh-Hant-HK / zh-Hant-TW, `<p lang>` = the driver's locale, no "DE" badge; the German driver sees the original. A real DeepL translation was NOT exercised.)
- [x] Manual edit of zh-Hant-HK survives a German source change (with warning flag). (domain + PostgreSQL integration tests and the same e2e: HK text kept, "Quelle geändert, Übersetzung prüfen" badge on HK only, Simplified / Taiwan follow the new German text, the HK driver still reads the hand-written text.)

**Implementation notes**
- Pure rules in `src/domain/note-translations.ts` (14 unit tests): `describeTranslations` (source / machine / manual / empty per version), `mergeSourceChange` (machine and empty Chinese versions take a fresh translation, hand-written ones are kept and flagged `meta.stale[locale]`; provider failed -> machine versions emptied + `pendingTranslation`), `retranslateAll`, `applyTranslationSave` (edits are detected against the STORED text, so an untouched machine version still follows a changed source; an edited one loses the machine flag and the stale flag; `reviewed` clears a stale flag without a text change; `pendingTranslation` is cleared once all three Chinese versions are filled), `changesSource`. All return a new object with a fresh `meta.updatedAt` (NUD-070's retry-job guard). "Hand-written" = non-empty Chinese version without `meta.machine[locale]`; no new column. `localizedTextSchema.meta` gained the optional `stale` record (no migration).
- Server `src/server/customer-notes.ts`: `freshTranslations` (one provider call de -> zh-Hans, Hant via OpenCC `hk` / `twp`; `null` on any provider failure, text not logged), `prepareNotes` (customer form save: empty -> `null`; German unchanged -> stored JSON untouched; changed -> `mergeSourceChange`; no valid stored note -> `localize()` from NUD-070, which never blocks saving), `getNoteTranslations`, `saveNoteTranslations`, `retranslateNote`. `createCustomer` / `updateCustomer` take an optional `{translator, now}` and use `prepareNotes`. Saves from the tab send `baseUpdatedAt`; the write is guarded on `meta.updatedAt` (JSON-path `updateMany`), so a concurrent retry-job write or second office user gives `conflict` instead of being overwritten. Actions `saveNoteTranslationsAction`, `retranslateNoteAction` (zod input, `requireRole("ADMIN")`) and `noteTranslationsQuery` (admin only); authorization test covers anonymous / driver / deactivated admin and checks nothing was written.
- UI: the customer detail page has tabs "Details" / "Übersetzungen" (`tab-details`, `tab-translations`); the tab (`src/components/admin/note-translations.tsx`) lists German (editable source, badge "Vorlage") and the three Chinese versions with badges "maschinell übersetzt" / "von Hand bearbeitet" / "noch nicht übersetzt" and the warning badge "Quelle geändert, Übersetzung prüfen" with a "Als geprüft markieren" button. Typing into a machine version swaps its badge immediately, saving keeps it. "Neu übersetzen" opens a dialog that warns that hand-written versions are lost; if the provider is down nothing is changed and an error toast shows. A "translation pending" hint appears while `pendingTranslation` is set. The customer form still edits only the German note. Strings in `de` + `zh-Hans` (`admin.customers.translations.*`), Hant generated.
- Driver stop detail needed no code change: NUD-052 already picks the note with `pickWithSource` and shows the "DE" badge only when the picked text is German and the UI is not German, so the badge disappears as soon as a translation exists (asserted in e2e; the existing `driver-stop` spec still asserts the badge for a German-only note).
- Tests: 14 domain unit tests, 8 new PostgreSQL integration tests (create translates, outage -> pending, manual HK survives source change + stale + "checked", German edited in the tab, invalid / conflict / not found / no note, re-translate incl. outage, source change during outage, concurrent change) and the authorization cases in `customer-actions.integration.test.ts`; e2e `tests/e2e/note-translations.spec.ts` (desktop project; creates its own customer through the UI, a driver and a released tour of today). Screenshots: `test-results/nud-071-*.png` (tab with machine versions and with the stale flag at 1280 px, re-translate warning, driver screen at 375 px for zh-Hant-HK and zh-Hant-TW).
- Verified: lint, typecheck, prettier, `i18n:check`, all 75 vitest files (797 tests, DB tests on embedded PostgreSQL), `pnpm build`, e2e `note-translations` (desktop, 5x repeated), `customer-form`, `customer-photos`, `customers`, `driver-stop`, `driver-today` (desktop + mobile), `driver-status`, `driver-language-picker`, `orders`, `admin-progress` (desktop), `mvp-happy-path` (demo seed). No 375 px check of the admin tab (admin screens are 1280 px by the DoD).
- NOT verified: any real DeepL translation (no key, by instruction; every translated text in the tests / e2e comes from the Fake translator and carries its visible `[zh-Hans]` prefix); `tours` / `settings` / `tour-rerelease` / other unrelated e2e specs were not re-run; behaviour under two office users editing the same note at the same time beyond the guarded `conflict` (tested at the database level only).
- Known edge case: if the provider is down while the German source changes AND a hand-written Chinese version exists, the machine versions are emptied and marked pending; the retry job (NUD-070, fills only empty locales) then derives them with OpenCC from the hand-written (possibly outdated, flagged) version instead of translating the new German text. "Re-translate" fixes it by hand.

---

#### NUD-072 · Driver problem text → German for office
**Status:** done · **depends_on:** 053, 070

**Goal:** office understands what the driver wrote.

**Scope**
- On problem submission with free text: `localize(text, driverLocale)` (async; never delays the driver).
- Admin tour view shows German translation + "original" toggle.
- Predefined reasons need no translation (already i18n keys).

**Acceptance criteria**
- [x] Driver writes `門口鎖住了，沒人應門` (zh-Hant-HK) → admin sees a German translation and the original. (e2e `problem-translation.spec.ts` with the FAKE translator, no DeepL key: the German text on the admin tour page is `[de] 門口鎖住了，沒人應門`, marked "maschinell übersetzt", and the original is behind "Original anzeigen". A real DeepL translation was NOT exercised.)

**Implementation notes**
- Where the hook sits: `applyStopMutation` (NUD-053) stays free of the translator. For a non-German free text it stores the `LocalizedText` (source = driver locale) with `meta.pendingTranslation = true` in the same transaction; a German note is stored without the flag (German is already what the office reads, nothing to translate, the Chinese variants of a German note are not needed). The translation runs after the commit and outside the driver's transaction: `src/server/problem-note-translation.ts` has `translateStopProblemNote(db, stopId)` (reads the note, `completeTranslation` = one provider call to German + OpenCC variants, saves through `stopProblemNoteSource.save`, i.e. only if the stored text still has the version that was read; never throws, never logs the text; provider failure -> stays pending) and `scheduleProblemNoteTranslation(db, result)` which runs it inside `after()` (`next/server`), so on Vercel the function is kept alive after the response. It does nothing for replays, delivered stops, undo and rejected mutations, and swallows a scheduling failure. `stopStatusAction` calls it after `applyStopMutation`; NUD-082's batch sync should call the same function for each applied entry (`applyStopMutation` itself is unchanged for it). Safety net: if the translation fails or the function dies, the note stays pending and the existing cron job (`Stop.problemNote` in `PENDING_SOURCES`) completes it. An undo (note removed) or a new report (new `meta.updatedAt`) in between wins over a late translation.
- Read model: `PlanStop.problemNote` is now `{ text, locale, german, germanMachine, pending }` (`readProblemNote` in `tour-planning.ts`): original = source-locale value, `german` = the `de` version of a non-German note, `germanMachine` = `meta.machine.de !== false`, `pending` = no German yet and `meta.pendingTranslation`. Authorization unchanged (`tourPlanQuery` is admin only).
- UI: `ProblemNote` (`components/admin/problem-note.tsx`) replaces the inline original text on the tour page: German translation first (`<q lang="de">`, badge "maschinell übersetzt"), a "Original anzeigen / ausblenden" toggle (`aria-expanded`) for the driver's original (label "Originaltext des Fahrers", `lang` = the driver's locale); while the translation is missing a badge "Übersetzung folgt" and the original is shown; a note written in German is shown as before (no badge, no toggle). Strings `admin.tours.progress.{translatedNote,machineTranslated,translationPending,showOriginal,hideOriginal}` (de, zh-Hans by hand, Hant generated). The dashboard card lists only customer + reason of problem stops (no free text), so it needed no change.
- Tests: `problem-note-translation.integration.test.ts` on PostgreSQL (7: pending marker without any provider call, translation after commit incl. Fake `[de]` prefix and original kept, German note not marked / not translated, provider outage -> mutation result unaffected + stays pending + the retry job completes it later, scheduler skips replay / delivered / undo / rejected and survives a throwing scheduler, the server action still succeeds when `after()` is unavailable, an undone report is not overwritten, the plan read model for translated / German / pending), `problem-note.test.tsx` (3 cases x 4 UI locales), e2e `tests/e2e/problem-translation.spec.ts` (desktop: zh-Hant-HK driver on a phone viewport reports CLOSED with `門口鎖住了，沒人應門`, the stored note gets `de`, admin tour page at 1280 px shows the German text + machine badge, toggle shows / hides the original with `lang="zh-Hant-HK"`, zh-Hans UI shows the same, a hand-set pending note shows "Übersetzung folgt" + original; screenshots `test-results/nud-072-tour-{german,original,pending}.png`, inspected).
- Verified: lint, typecheck, prettier on changed files, `i18n:check`, all 77 vitest files (DB tests on embedded PostgreSQL, run in two groups), `pnpm build`, e2e `problem-translation` (desktop), `admin-progress` (desktop, `LIVE_POLL_INTERVAL_MS=5000`), `driver-status` (mobile, 4 locales), `note-translations` (desktop). Everything translated in tests / e2e comes from the Fake translator (visible `[de] ` prefix); a real DeepL translation was NOT exercised.
- NOT verified: a real DeepL call; `after()` on Vercel itself (works under `next start`; a lost task falls back to the cron job, which needs the 10 minute schedule = Pro plan and a DeepL key, with only the Fake translator it skips); the "translation pending" state under a real outage in e2e (pending state is set up by SQL, the outage itself is covered by integration tests); other e2e specs not rerun; Chinese strings agent-written (NUD-073).
- Follow-ups: NUD-082 must call `scheduleProblemNoteTranslation` per applied entry of the batch sync. In production without `DEEPL_API_KEY` the Fake translator would store prefixed text as a "translation" (same as NUD-071 notes); `checkDeployEnv` already warns.

---

#### NUD-073 · 👤 UI string review workflow for native speakers
**Status:** blocked (tooling done; native-speaker review is a human step) · **depends_on:** 003

**Goal:** Chinese UI texts are checked by humans before go-live.

**Scope**
- `pnpm i18n:export` → `i18n-review.csv` with columns: key, de, zh-Hans, zh-Hant-HK (generated), zh-Hant-TW (generated), screenshot route hint, reviewer comment, corrected text per locale.
- `pnpm i18n:import i18n-review.csv` → writes corrections into `zh-Hans.json` or the matching override file; re-runs build.
- `docs/i18n.md`: how to review, which locale files are hand-edited vs generated.

**👤 Human step:** a native reader for Simplified and one for Traditional (HK and/or TW) review the CSV.

**Acceptance criteria**
- [x] Round-trip export → edit → import changes exactly the edited keys (test).

**Human steps (open)**
1. Developer: `pnpm i18n:export`, send `i18n-review.csv` (plus a test deployment or the demo seed login) to the reviewers. See `docs/i18n.md`.
2. Native reader of **Simplified Chinese** reviews the `zh-Hans` column (fills `corrected_zh-Hans` / `reviewer_comment`). Also confirms or replaces the glossary terms (Tour, Stopp, Einheit, ...) used in the Chinese texts.
3. Native reader of **Traditional Chinese for Hong Kong** and one for **Taiwan** (or one person for both) review the generated `zh-Hant-HK` / `zh-Hant-TW` columns and fill `corrected_zh-Hant-HK` / `-TW` only where the machine conversion reads unnatural.
4. Developer: `pnpm i18n:import <returned.csv> --dry-run`, then without `--dry-run`, `pnpm i18n:check`, commit the changed JSON files (never the CSV). Then set this ticket to `done`.

**Implementation notes**
- `pnpm i18n:export [--out f] [--delimiter ";"]` writes `./i18n-review.csv` (gitignored via `/i18n-review*.csv`): UTF-8 BOM, CRLF, RFC 4180 quoting, 689 rows. Columns: key, de, zh-Hans, zh-Hant-HK, zh-Hant-TW, route_hint, reviewer_comment, corrected_zh-Hans, corrected_zh-Hant-HK, corrected_zh-Hant-TW. Hant columns are computed fresh from zh-Hans + overrides.
- `pnpm i18n:import <csv> [--dry-run] [--force]` is all-or-nothing: refuses unknown/duplicate/empty keys, invalid ICU, placeholder names that differ from the German text, and rows whose exported text no longer matches the repository (stale CSV, `--force` overrides). `corrected_zh-Hans` goes to `zh-Hans.json`; Hant corrections go to `overrides/<locale>.json` (sorted keys; removed again if equal to the OpenCC output). Then the Hant files are rebuilt and the whole result is validated like `i18n:check`. Empty correction cells = no change. `,` `;` and tab separators are accepted (German Excel), BOM optional. Reviewer comments are only counted, not stored.
- Code: `scripts/lib/i18n-review.ts` (CSV, export, import), `scripts/lib/i18n-files.ts` (read/write/build, shared with `i18n-build.ts`), `scripts/lib/i18n-routes.ts` (key prefix -> route map; longest prefix wins; one line per new namespace), CLIs `scripts/i18n-export.ts` / `i18n-import.ts`. Test: `scripts/lib/i18n-review.test.ts` (CSV quoting, round trip on a temp copy of `messages/` asserting exactly the edited keys change in each file, refusals, route-hint coverage and stale entries).
- Surprise: with OpenCC `s2twp`, both `保存` and `储存` become `儲存`, so a Simplified edit does not always change the TW text.
- Verified: eslint (0 warnings), `tsc --noEmit`, prettier, `vitest` without database (56 files / 556 tests passed, 22 DB files skipped; this ticket touches no DB code), `i18n:check`, and a manual CLI run (export, edit, import, check, restore).
- NOT verified: opening the CSV in a real Excel / LibreOffice / Google Sheets (only a Python csv round trip and the parser tests); `pnpm` itself (not runnable here, scripts run through `npx tsx`); DB test groups not rerun. **The Chinese UI texts are still agent-written and have NOT been reviewed by anyone.**

---

#### NUD-080 · PWA installability
**Status:** done · **depends_on:** 051

**Goal:** drivers launch the app from their home screen like a native app.

**Scope**
- Web app manifest (`start_url` = driver home, `display: standalone`, theme colors, icons 192/512/maskable), localized `name` via per-locale manifest route.
- Serwist service worker (app shell precache).
- Localized install hint for Android (beforeinstallprompt) and iOS (instructions overlay "Share → Add to Home Screen" with illustration).

**Acceptance criteria**
- [x] Lighthouse PWA installability checks pass for the driver area. (**Real Lighthouse was NOT run** (not installable here). Replaced by Chromium's own installability check via CDP `Page.getInstallabilityErrors` = no errors, plus manifest/icon/SW assertions in `tests/e2e/pwa.spec.ts`; a real Lighthouse run is NUD-105.)
- [x] Installed app opens directly on the driver home. (Verified only that `start_url` = `/<locale>/driver` for all 4 locales and lies inside `scope`; **real installation was not tried**, see NUD-105.)

---

**Implementation notes**
- Manifest: route handler `src/app/[locale]/manifest.webmanifest/route.ts` (prerendered per locale, builder `src/lib/pwa.ts`): localized `name` / `short_name` / `description` (`pwa.*` messages), `start_url` `/<locale>/driver`, `scope` `/`, `display: standalone`, theme `#9a3412` / background `#fff`, icons 192/512 + maskable 192/512. The path contains a dot, so `proxy.ts` skips it: manifest, `/sw.js`, `/offline.html` and `/icons/*` are reachable without a session (e2e checks with a cookie-less request). `src/app/[locale]/driver/layout.tsx` (all driver pages incl. login) adds `manifest`, icons, `apple-touch-icon`, `appleWebApp`, theme colour and mounts `PwaRuntime`.
- Icons: original pasta-bowl glyph in `scripts/lib/pwa-icons.ts`, rendered to PNG by `pnpm pwa:icons` (Playwright/Chromium; PNGs + `icon.svg` committed in `public/icons`).
- Service worker: source `src/sw/sw.ts` (Serwist 9), built AFTER `next build` by `scripts/build-pwa.ts` (esbuild bundle to `public/sw.js`, `@serwist/build` injects the precache list; `build` and `build:vercel` run it; outputs git-ignored). Precache = hashed `.next/static` assets (53 entries, ~2.7 MiB uncompressed incl. admin chunks), icons, generated `public/offline.html`. Driver page navigations are `NetworkOnly` (never stored); when the network fails the precached `offline.html` (generic, texts of all 4 locales from `messages`, language chosen from the URL prefix, no personal data) is shown. Nothing else is cached: no HTML, RSC or API responses (e2e inspects Cache Storage after visiting authenticated pages: only `/_next/static/`, `/icons/`, `offline.html`). Admin navigations and `/api` are untouched. `skipWaiting` + `clientsClaim`. `next.config.ts` serves `/sw.js` with `no-cache`. Registration only in production builds (`PwaRuntime`); `pnpm typecheck` also type-checks the worker (`src/sw/tsconfig.json`, webworker lib).
- Install hint (`components/driver/install-hint.tsx`, rendered in `DriverShell` above the content, state in `lib/install-prompt.ts`): Android/Chromium shows an "Installieren" button after `beforeinstallprompt` (captured in `PwaRuntime`, `prompt()` on tap); iOS (UA / iPadOS detection, moved to `lib/device.ts`) shows "So geht's" which opens an overlay with a Safari-toolbar illustration and 3 steps (Share -> Add to Home Screen -> Add). Hidden in standalone mode and after "Nicht jetzt"/"Verstanden" (remembered in `localStorage` `nudel.driver.installHint.dismissed`; every storage access in try/catch, in-memory fallback). New keys `driver.install.*`, `pwa.*` (de, zh-Hans; Hant generated), route hints added.
- Tests: unit `lib/pwa.test.ts`, `sw/rules.test.ts`, `lib/install-prompt.test.ts`, `scripts/lib/offline-page.test.ts`, `components/driver/install-hint.test.tsx` (4 locales); e2e `tests/e2e/pwa.spec.ts` (16 tests, mobile project, needs a production build): manifest per locale valid + icons are PNGs of the right size + no session needed, SW registers/controls/activated, `Page.getInstallabilityErrors` empty, Cache Storage content, offline navigation shows the offline page (de and zh-Hans), iOS-UA hint + overlay in 4 locales at 375 px without horizontal scroll, dismissal remembered, localStorage blocked, simulated `beforeinstallprompt`.
- Verified: lint, typecheck, `i18n:check`, `pnpm test` (875 passed incl. DB), `pnpm build` (with the fake S3), e2e mobile `pwa` + `shells` + `driver-today` + `driver-stop` + `driver-status` (52 passed); screenshots at 375 px inspected (iOS hint, overlay de / zh-Hant-TW, offline page).
- NOT verified: real Lighthouse; real installation on Android / iOS (Safari, real `beforeinstallprompt`, Add-to-Home-Screen flow, icon masking on launchers); desktop Playwright project for the new spec; HTTPS deployment (only localhost); service worker update behaviour across two deployments; Chinese strings are agent-written (NUD-073).
- Known limits: `start_url` is fixed to the locale of the installed manifest; after switching language the installed app still opens in the old one (NUD-106). The precache contains admin chunks too (shared build output). The connection indicator still shows only `navigator.onLine`.

---

#### NUD-081 · Offline cache of today's tour + photos
**Status:** done · **depends_on:** 080, 052

**Goal:** the driver can work through dead spots.

**Scope**
- Driver tour data served from one endpoint `GET /api/driver/tour/today` (JSON incl. stops, items, localized texts, signed photo URLs with ≥ 12 h validity).
- On load: store tour JSON in IndexedDB and **prefetch all photos** into Cache Storage; show "ready offline ✓" indicator.
- Offline: render from cache, show "offline – last updated 07:12" bar. Online again: refresh in background.
- Cache purge of previous days.

**Acceptance criteria**
- [x] Playwright with `context.setOffline(true)` after load: tour list, stop details and photos still render. (`tests/e2e/driver-offline.spec.ts`, 375 px, production build, real signed URLs against the fake S3: list, two stops with / without photos, a stop not in the cache, 4 locales; list and detail text identical to the online render; "offline - last updated HH:MM" bar; logout, other user and previous day purge the copy.)

**Implementation notes**
- Shared data model `src/lib/driver-tour-model.ts` (zod `driverTourResponseSchema`, `schemaVersion` 1): the API JSON, the IndexedDB record and the input of the pure view functions `toDriverToday(response, locale)` / `toDriverStopDetail(response, stopId, locale, photoUrl)`. `getDriverToday` / `getDriverStopDetail` (server pages) are now built on `getDriverTourResponse` (`server/driver-tour-payload.ts`) + these functions, and the offline shell uses the same functions and the same components (`TodayTour`, `StopDetail`, new prop `offline`), so online and offline render identically (e2e compares texts). Product names and customer notes travel as `LocalizedText` (all locales) and are picked on the device, so the language of an offline page follows its URL. Customer name / address untranslated as before. Changed-tour data of NUD-043 (`revision`, `updated`, `removedCustomers`, `change`, `changedInRevision`, `previousQuantityCents`) is part of the payload (integration + unit tested); the "seen revision" stays in localStorage.
- Endpoint `GET /api/driver/tour/today` (`server/driver-tour-api.ts`): `requireRole("DRIVER")` first, no parameters (driver = session), 401 / 403 JSON otherwise (admin support view gets 403, no tour), `Cache-Control: private, no-store`. Photo URLs: `DRIVER_PHOTO_URL_TTL_SECONDS` = 12 h. Tests: `driver-tour-api.integration.test.ts` (9).
- Browser side `src/lib/offline/`: `store.ts` (IndexedDB, one record per user, rules: other users and other days removed, damaged / old-schema records dropped; memory store for unit tests), `photos.ts` (Cache Storage; photos keyed by the stable same-origin URL `/api/driver/photo-cache/<photoId>`, only missing ones downloaded, obsolete ones deleted, failures counted), `sync.ts` (fetch -> zod -> store -> photos), `browser.ts` (singletons, status store, serialized sync, `purgeOfflineData`). `OfflineSync` (in `DriverShell` for DRIVER users only) syncs at start, on `online`, when visible again, every 5 min, after each status change (`requestOfflineSync` in `StopStatusActions`); after a reconnect also `router.refresh()`. `OfflineStatusBar`: online + tour + ALL photos stored = "Offline bereit ✓"; some photos missing = "teilweise bereit n von m"; offline = amber "Offline - zuletzt aktualisiert 07:12" (factory time zone).
- Offline navigation: the public prerendered page `/<locale>/driver/offline-shell` (no personal data, allowed in `decideAccess`) is precached per locale (`additionalPrecacheEntries`, build id as revision). The worker answers failed loads (also after 8 s) of `/<locale>/driver` and `/<locale>/driver/stops/<id>` with it (Serwist fallbacks, other driver URLs keep the generic `offline.html`). `OfflineDriverApp` reads the URL + IndexedDB and renders list / stop; links trigger a normal page load (Next falls back from the failed RSC fetch), which the worker answers with the shell again; when the `online` event fires the shell reloads into the live page. Photos offline: `<img src="/api/driver/photo-cache/<id>">` answered by a `CacheOnly` route of the worker from the bucket the page filled.
- Purge: `PurgeOfflineData` on the login pages (a login page = no session: covers logout, ended sessions and another driver signing in), IndexedDB + Cache Storage; previous days on every load / sync.
- Offline the status buttons are disabled with a notice (queue = NUD-082); undo is hidden.
- Docs: `docs/offline.md`. Tests: unit `driver-tour-model`, `offline/*`, `sw/rules`, `offline-status` (4 locales); e2e `driver-offline.spec.ts` (11), `pwa.spec.ts` adapted (shell pages in precache, generic offline page now for login URLs).
- Verified: lint, typecheck, `i18n:check`, `pnpm test` (918 incl. DB), `pnpm build` (fake S3), e2e mobile: `driver-offline`, `pwa`, `driver-today`, `driver-stop`, `driver-status`, `shells`, `auth`, `driver-language-picker`; screenshots at 375 px (offline list de, stop de, stop zh-Hant-TW) inspected.
- NOT verified: real phones / Safari (IndexedDB / Cache Storage eviction under storage pressure, iOS PWA, real Wi-Fi drop -> NUD-107); real R2 CORS for the photo download (only the fake S3 with a GET rule); the desktop Playwright project; map tiles offline (NUD-108: the map view shows no tiles offline); a worker update across deployments. In this sandbox Chromium `navigator.onLine` is permanently false and ignores `setOffline`, so the e2e drive it with a test helper (`tests/e2e/helpers/network.ts`); the app does not gate syncing on `onLine`.
- Known limits: the cached statuses are only as fresh as the last sync (before NUD-082 an offline "delivered" cannot be recorded); anyone holding the unlocked phone can open the cached tour offline (as with any logged-in session); the shell does not offer the language switcher offline.

---

#### NUD-082 · Offline mutation queue for stop status
**Status:** done · **depends_on:** 081, 053

**Goal:** "Delivered" taps are never lost.

**Scope**
- IndexedDB outbox of mutations (`clientMutationId`, type, payload, createdAt). UI updates optimistically.
- Sync on `online` event, app focus, and every 60 s; exponential backoff; Background Sync API where supported.
- Server endpoint `POST /api/driver/sync` accepts a batch, idempotent by `clientMutationId`, returns authoritative stop states.
- Conflict rule: server state wins if the stop was changed by admin after the mutation's `createdAt`; driver is shown a notice.
- Pending-count badge in the driver top bar.

**Acceptance criteria**
- [x] Offline: mark 3 stops delivered → go online → server has 3 updates, no duplicates (e2e). (`tests/e2e/driver-outbox.spec.ts`, 375 px, production build: three taps offline, nothing on the server, badge 3, list shows 3/5; after reconnect exactly 3 DELIVERED stops and 3 `StopMutation` rows, `completedAt` = tap time, a reload changes nothing. Integration: `driver-sync.integration.test.ts`, replay of the same batch -> `replayed`.)
- [x] Undo while offline removes the queued mutation instead of sending two. (e2e: outbox empty after undo, no `/api/driver/sync` request answered, no `StopMutation`; unit `planUndo` / controller. Undo of an already confirmed stop while offline queues one undo (e2e).)
- [x] Conflict rule shows a notice (added): office change after the tap -> `changed_by_office`, stop unchanged on the server, notice with the customer name until acknowledged (e2e + integration).

**Implementation notes**
- Server: `POST /api/driver/sync` (`app/api/driver/sync/route.ts`, `server/driver-sync.ts`): `requireRole("DRIVER")` first (401 / 403), JSON only (415), <= 256 KiB (413), strict zod 1..50 entries (400). `applySyncBatch` sorts by effective tap time and calls `applyStopMutation` once per entry (own transaction, advisory lock, idempotent via `StopMutation`); a business rejection never stops the batch, an unexpected error marks that entry and later entries of the same stop `retry`. `scheduleProblemNoteTranslation` runs per applied entry (replays do nothing). Answer: per entry `applied | replayed | rejected(error) | retry`, plus the authoritative status of every stop of the touched tours (own tours only). Contract and pure rules: `src/domain/driver-sync.ts` (no zod, bundled into the worker).
- `applyStopMutation(db, actor, input, now, { clientCreatedAt })`: `now` = effective tap time; with `clientCreatedAt` a stop whose new column `Stop.adminChangedAt` (migration `20261018100000_stop_admin_changed_at`, set by a re-release that changes / adds a stop) is later than the tap is rejected with new error `changed_by_office`. Removed stop -> `not_found`, inactive tour -> `tour_not_active`, closed stop -> `already_completed`: all final rejections, server wins.
- Client `src/lib/offline/`: `idb.ts` (one DB v2: `tours`, `outbox`, `notices`), `outbox.ts` (pure: ordering, `planUndo`, overlay, `settle`, `patchTourStates`, backoff), `outbox-flush.ts` (chunks of 50, 400 -> entry by entry, notices, patches the stored tour copy), `outbox-controller.ts` (state, enqueue with double-tap guard, undo, flush with backoff and rerun, confirmed-state bridge for 20 s), `outbox-browser.ts` (singleton, `useOutbox`, Background Sync registration), `use-overlay.ts`. `StopStatusActions` no longer calls the server action: it enqueues, the stop counts as done at once, next stop opens; buttons work offline (NUD-081 disable removed; amber hint stays). `TodayTour` / `StopDetail` overlay queued taps (`DriverStopDetail.tourStops` added). UI: `PendingBadge` in the top bar, `SyncNotices` (de, zh-Hans by hand, Hant generated; `driver.sync.*`). `OfflineSync` triggers: start, `online`, visible (skip backoff), 60 s, new tap; worker `sync` event (tag `nudel-outbox`) flushes for the user of the stored tour copy and tells open pages.
- The old server action `stopStatusAction` is no longer used by the UI (kept with its authorization tests).
- Tests: unit `outbox`, `outbox-controller` (14), `driver-sync` domain, component `stop-status-actions` (4 locales); integration `driver-sync.integration.test.ts` (27: 3 stops, idempotent replay, order, undo window from tap time, clamping, conflict cases, foreign tour, translation scheduling, retry, route auth / validation) and `adminChangedAt` in `tour-rerelease`; e2e `driver-outbox.spec.ts` (5), `driver-status` / `driver-offline` adapted.
- Verified: lint, typecheck (incl. worker), `i18n:check`, unit + DB tests (stop / driver / tour groups), `pnpm build`, e2e mobile: `driver-outbox`, `driver-status`, `driver-offline`, `driver-stop`, `driver-today`, `pwa`, `admin-progress` (alone), `problem-translation`, `driver-language-picker`, `shells`; screenshots at 375 px (offline stop, badge, list, conflict notice) inspected.
- NOT verified: Background Sync in a browser (the worker code path is only type-checked and bundled; Chromium-only API, not triggered in e2e); real phones / Safari; desktop Playwright project; `mvp-happy-path` and `tour-rerelease` e2e (need the demo seed, not run); admin-progress fails when run in the same session with other specs (several tours today, pre-existing), passes alone.
- Known limits: unsent taps survive logout and are sent after that driver's next login (another driver's entries are dropped after 3 days); a phone clock far off shifts the tap time (clamped to 24 h / now); two tabs may send the same entry (idempotent); a rejected tap is reported once the phone is online again, not at tap time.

---

#### NUD-083 · Driver photo capture / replace
**Status:** done · **depends_on:** 052, 082

**Goal:** drivers keep photos up to date on site (D12).

**Scope**
- On stop detail: "Take photo" for STORE / PARKING (`<input type="file" accept="image/*" capture="environment">`), preview, confirm.
- Uses the NUD-006 pipeline; when offline, the resized blob is queued in the outbox and uploaded later.
- New photo becomes current; admin sees "updated by driver X on date" on the customer page.

**Acceptance criteria**
- [x] Photo taken offline appears on the customer profile after reconnect. (`tests/e2e/driver-photo.spec.ts`, 375 px, production build, real PUT to the s3rver emulator: taken offline via `setInputFiles`, shown at once from the local blob, kept in IndexedDB, nothing on the server; after reconnect exactly one `Photo` with the capture's `clientMutationId`, current, `uploadedById` = driver; the admin customer page shows the decoded image and "Aktualisiert von Fahrer X am ...".)
- [x] Missing-photo placeholder on stop detail offers "Take photo" directly. (Button inside the placeholder, 48+ px, opens the file input with `capture="environment"`; e2e + component test in 4 locales.)

**Implementation notes**
- Server: `Photo.clientMutationId` (unique, migration `20261018110000_photo_client_mutation_id`). `server/customer-photos.ts` now has the shared `attachCustomerPhoto` (storage `head`, key shape, one transaction under the customer row lock, history with `isCurrent=false`, idempotency check under the lock); the admin `addCustomerPhoto` is a thin wrapper. New `server/driver-photos.ts`: `registerDriverPhoto` (DRIVER only, strict zod, customer derived from the stop, stop must be in the driver's own tour with status RELEASED / IN_PROGRESS / COMPLETED and day = today or yesterday in the factory time zone, replay answered even when the tour has been closed since) and `POST /api/driver/photos` (`requireRole("DRIVER")` first: 401 / 403, JSON only 415, <= 8 KiB 413, invalid 400, business rejections are HTTP 200 `{outcome:"rejected", error}`; `private, no-store`). Contract + pure rules in `domain/driver-photo.ts`. `getCustomerPhotos` now returns `uploadedBy` + `createdAt`; the admin slot shows "Aktualisiert von Fahrer X am <date>" for driver photos.
- Client `src/lib/offline/`: `photo-outbox.ts` (pure: entry, supersede rule, what a slot shows, tour copy patch), `photo-outbox-store.ts` (IndexedDB store `photos`, DB v3, blob inside the row), `photo-outbox-flush.ts` (presign -> PUT -> save `storageKey` -> register -> cache blob under the real photo id + patch the stored tour copy -> remove; every step repeatable), `photo-outbox-controller.ts` / `photo-outbox-browser.ts` (same backoff / triggers as the tap outbox, wired into `OfflineSync`, `OfflineDriverApp` and the worker's Background Sync handler), `use-photo-overlay.ts` (object URL from the local blob, "confirmed" overlay for 20 s). UI: `components/driver/driver-photo-slot.tsx` (placeholder with "Take photo", "Replace photo", preview with Use / Retake / Cancel, badges "Wartet auf Versand" / "Gesendet"); top-bar badge counts taps + photos; notices for dropped photos reuse the notice cards (`driver.sync.photoNotices.*`). `docs/offline.md` updated.
- Tests: unit `domain/driver-photo`, `offline/photo-outbox`, `photo-outbox-controller` (13: offline then reconnect, lost answer = same id and no second upload, refused PUT, 5xx backoff, 401 keeps, rejection notice, object_missing, supersede, order, foreign entries, tour copy patch); component `driver-photo-slot` (4 locales); integration `driver-photos.integration.test.ts` (37: anonymous / admin / deactivated, foreign and unknown stops, non-released / old / future tours, time zone, forged keys, invalid input, missing object, key reuse, replay, concurrent retries, other driver's id, history, `uploadedBy`); e2e `driver-photo.spec.ts` (6, mobile 375 px). Existing `driver-stop` and `pwa` e2e adapted (photo frame compared instead of the whole section; the cache-key regex now accepts a build id with a hyphen, which made `pwa` fail for some builds independent of this ticket).
- Verified: lint, typecheck (incl. worker), `i18n:check`, prettier on changed files, unit + DB tests (~1070 passed), `pnpm build` (fake S3), e2e mobile: `driver-photo`, `driver-offline`, `driver-outbox`, `driver-stop`, `driver-status`, `driver-today`, `pwa`, `customer-photos`; screenshots at 375 px (placeholder, preview, offline pending, sent, zh-Hant-TW preview) and the admin profile at 1280 / 375 px inspected, no horizontal scroll.
- NOT verified: a real phone camera (HEIC / large originals, iOS Safari `capture` behaviour, memory use of a 12 MP decode); real R2 CORS for the browser `PUT` (only s3rver); Background Sync path of photos in a browser (bundled and type-checked only); the desktop Playwright project; Chinese strings are agent-written (NUD-073). `driver-outbox` "undo while offline" failed once when run in the same session as `driver-offline` (waiting for "offline ready" after reconnect) and passed alone and on a repeat; not investigated.
- Known limits / follow-ups: an object uploaded but never registered (photo dropped by a final rejection) stays orphaned in storage (cleanup belongs with NUD-094, as for NUD-015); a photo for a stop the office removed from the tour in the meantime is rejected with a notice (the picture is lost); the preview shows the re-encoded JPEG, there is no crop / rotate; no limit on queued photos besides the device's storage.

---

#### NUD-090 · Customer import (CSV/XLSX) with pin review
**Status:** done · **depends_on:** 014

**Goal:** bring the factory's existing customer list into the system.

**Scope**
- `/admin/customers/import`: upload CSV/XLSX (SheetJS), column mapping UI (remembered), preview with row-level validation errors.
- Import creates/updates customers (match by customer number), `pinConfirmed=false`.
- Batch geocoding (rate-limited, progress bar).
- **Pin review queue:** step through imported customers, see candidate pin on map, confirm/drag/skip.

**Acceptance criteria**
- [x] Import of a 150-row file with 3 invalid rows imports 147 and reports the 3 with reasons. (Domain, integration and e2e tests; reasons carry the file row.)
- [x] Re-importing the same file updates instead of duplicating. (Second import: 147 unchanged, 0 new; a changed file updates the matching rows.)

**Implementation notes**
- Page `/admin/customers/import` (button on the customer list): wizard file -> column mapping -> preview -> result + batch geocoding; `/admin/customers/import/review`: pin review queue. Code: pure rules in `src/domain/import-file.ts` (limits, BOM / UTF-16 / windows-1252 decoding, RFC 4180 parser with `,` `;` TAB detection, zip directory check) and `src/domain/customer-import.ts` (header synonyms DE/EN/ZH, mapping checks, cell cleaning, formula check, country names, DE postal code padding, `planImport` = create / update / unchanged / error per row, reusing `addressChanged` from NUD-014); server `src/server/customer-import-upload.ts` (route `POST /api/admin/customers/import/parse`), `import-xlsx.ts` (exceljs), `customer-import.ts` (preview / commit), `customer-pins.ts` (batch geocoding, review queue, confirm), `customer-import-actions.ts` (server actions), `throttle.ts`.
- Library: SheetJS from its CDN is blocked here and the npm `xlsx` 0.18.5 is the outdated, vulnerable copy, so XLSX is read with `exceljs` 4.4.0 (CSV by own parser, no extra package). `pnpm audit --prod` flagged its transitive `uuid` (<11.1.1), so `pnpm-workspace.yaml` has an override `uuid: >=11.1.1` (audit clean). Only `.xlsx` (no legacy `.xls`); first non-empty sheet; number cells with a `00000` format keep their zeros; formula cells use their cached result, formula text is never imported.
- Security: ADMIN only (route and every action call `requireRole("ADMIN")` first; tests for anonymous / driver / deactivated admin); upload <= 5 MB read with a cap (413), <= 2000 data rows, <= 50 columns, <= 2000 characters per cell, XLSX zip directory checked before inflating (<= 200 entries, <= 50 MB declared, no ZIP64 / encryption). CSV injection: a cell starting with `=` `@` TAB CR, or `+`/`-` followed by something other than a number / phone text / space, makes the row invalid; invisible and control characters are removed. The browser only sends the mapped cells back; the server cleans, validates and plans them again (and runs `customerInputSchema` before every create).
- Matching and updates: by customer number, case-insensitive, stored spelling kept. Updates change only the cells that differ; empty optional cells (country, delivery hours, notes) never erase data. New customers: `pinConfirmed=false`, no pin. Changed address (NUD-014 `addressChanged`): pin and confirmation are dropped; unchanged address keeps both. Updates are guarded by `updatedAt` (an admin edit during the import makes that row fail with a message instead of being overwritten). Archived customers are updated but stay archived. Notes are stored German-only with `pendingTranslation` (the NUD-070 retry job translates), no translator call per row. `searchText` comes from the NUD-013 trigger.
- Batch geocoding: browser loops over batches of 5 ids (progress bar, cancel); the server calls the geocoder one at a time with a process-wide throttle (700 ms with `ORS_API_KEY`, `GEOCODE_BATCH_DELAY_MS`), stops at 429 / 403 (rate or quota) or after 3 failures in a row and logs a summary line (no addresses). The best candidate becomes the stored, unconfirmed pin; never overwrites a pin that exists.
- Pin review: queue = all active customers with `pinConfirmed=false` (not only the last import), ordered by number; confirm (optionally after dragging or typing coordinates), skip (client side, "review skipped" starts another round), search other candidates via `geocodeAddressAction`. Confirming is version-checked (`updatedAt`), so a customer edited meanwhile gives a "reload" message.
- Mapping memory: `localStorage` (header text per field, per browser), proposals fall back to header synonyms.
- Fixtures: `src/domain/testing/import-fixtures.ts` (generated, fictional), `scripts/generate-import-fixtures.ts` -> `tests/fixtures/customers-150.csv` / `.xlsx` (a unit test keeps the committed CSV in sync).
- Tests: `domain/import-file.test.ts`, `domain/customer-import.test.ts` (150 rows -> 147 + 3, re-import, umlauts, Chinese, BOM, `;`, leading zeros), `server/customer-import-upload.test.ts` (route, XLSX, zip bomb), `customer-import.integration.test.ts` (authorization, commit, re-import, pin reset, race, geocoding, review), `throttle.test.ts`, `scripts/generate-import-fixtures.test.ts`, e2e `tests/e2e/customer-import.spec.ts` (150-row upload, mapping, preview, import, geocoding with the Fake, re-import, address change, pin review confirm / type / drag / skip, conflict, 401 for anonymous, mobile layout). Screenshots at 1280 px inspected (preview, review).
- NOT verified: real ORS geocoding / rate limits (Fake only); a file exported by real Excel (XLSX written by exceljs and CSV by hand only; real German Excel `;` CSVs in cp1252 are covered by a unit test); a decompression bomb whose zip directory lies about sizes (only the row / column / cell limits stop it); the 1 MB server-action body limit for very wide 2000-row files (typical 150-2000 rows are well below); Chinese strings are agent-written (NUD-073).
- Follow-ups: a cleanup of old pending uploads is not needed (nothing is stored); the review queue has no "previous" step and no persisted skip list.

---

#### NUD-091 · Packing list / load sheet print view
**Status:** done · **depends_on:** 041

**Goal:** load the van correctly before departure.

**Scope**
- `/admin/tours/[id]/print?locale=…`: print-optimized page (A4, print CSS).
- Section 1: **totals per product** for the tour.
- Section 2: per stop in **reverse order** (last stop first = load first): sequence, customer, items.
- Product names in chosen locale + German; locale selectable so it can be printed for the driver.

**Acceptance criteria**
- [x] Totals equal the sum of all stops (unit test on the shared aggregation function). (`domain/load-sheet.test.ts`: 30 stops, per-product sums, grand total, same result as `sumQuantities` of the order overview, exact hundredths, different units never merged; `server/tour-print.integration.test.ts`: totals of a real 30-stop tour equal the DB sums of the confirmed orders; e2e compares the printed totals with the seeded numbers.)
- [x] Print preview fits on A4 without cut-off columns for 30 stops (multi-page OK). (e2e `load-sheet.spec.ts`: `page.pdf({format:"A4"})` in all four locales = 4 pages (de) / 5 pages (zh), page size A4 per `pdfinfo`, text of first and last stop present in the PDF text layer; in print media at the A4 content width (186 mm) no cell overflows and the document does not scroll horizontally; rendered PDF pages inspected as PNG for de and zh-Hans.)

**Implementation notes**
- Route `src/app/[locale]/admin/(print)/tours/[id]/print/page.tsx`. To keep the admin shell (sidebar, header, user menu) off the sheet the admin section was split into route groups: all existing admin pages and the old `admin/layout.tsx` moved UNCHANGED into `admin/(shell)/` (URLs are the same, pure `git mv`), and the new `admin/(print)/layout.tsx` has the same ADMIN gate (`requirePageActor("admin")`, page repeats it) without `AdminShell`. New admin pages made for paper belong in `(print)`.
- Quantities: the sheet reads the TOUR's own quantities (`Stop.items`, the snapshot written by the builder and by re-release, exactly what the driver sees), never the live order lines. `server/tour-print.ts` `getTourPrint(db, id)` (stops in delivery order, customer, product rows with name `LocalizedText` / SKU / unit / sortOrder, driver name, depot snapshot, `isOutdated`, `releaseRevision`, status); `tourPrintQuery(tourId)` in `tour-queries.ts` = `requireRole("ADMIN")` first, unknown or malformed id -> `null` -> `notFound()` page.
- Outdated warning: if `Tour.isOutdated` (orders changed since the tour was built or released) there is a red alert in the screen toolbar (UI language, tells the office to review and re-release) AND a heavy-bordered banner on the paper in the print language ("do not load before the tour is released again"). The numbers stay the tour's, they are never silently replaced by newer ones. Draft / optimized tours print too and say "not released yet".
- Shared aggregation: `sumQuantities(lines)` added to `domain/order-overview.ts` (exact hundredths per product AND unit); `aggregateTotalsByDate` (NUD-032) now uses it, and `domain/load-sheet.ts` `loadSheetTotals(stops, products)` (section 1, sorted by unit then catalog order) and `loadOrder(stops)` (section 2: reverse sequence, `loadPosition` 1..n) are built on it. Different units are never added; a product that is no longer found keeps its quantity (no unit text) instead of being dropped.
- Locale: `?locale=` is parsed with the zod `localeSchema` (`parsePrintLocale`): anything that is not exactly one of the four locales (missing, empty, `en`, wrong case, repeated) falls back to the locale of the page URL. The sheet renders with `getTranslations({locale})` / `getFormatter({locale})` in that language (`<article lang=…>` so CJK glyphs are right); the toolbar (back, locale links in own script, Print) stays in the admin's UI language. Product names: `productLabel(name, sku, locale)` (`lib/product-label.ts`) = name in the print locale (usual fallback chain, SKU if nothing) plus the German name in small type when the sheet is not German and differs. Customer name / address are never translated. Units from `common.units`.
- Layout: header (title, delivery date, driver or "no driver", depot, number of stops + release version), section 1 table (product, total + unit), section 2 table (load position, original stop number, customer + number + address, one line per product with quantity). Print CSS (`globals.css`, `.load-sheet*`): `@page { size: A4; margin: 12mm }` set by the page only, `thead` repeats on every page (`display: table-header-group`), `tr` / `li` `break-inside: avoid` (no row is split), fixed column widths with word wrap, black on white regardless of dark mode; toolbar `print:hidden`. Button "Ladeliste drucken" (`data-testid="tour-print-link"`) in `TourPlanner` for every tour with stops; "Drucken" calls `window.print()`.
- Pre-existing bug fixed: the NUD-008 print rule `@media print { body * { visibility: hidden } … }` blanked EVERY printed page of the app (the first PDF of the load sheet was empty). It is now scoped with `body:has(.pin-sheet)` so it applies only while the PIN dialog is open; `drivers.spec.ts` got a print-media assertion for it.
- Strings: `admin.tours.print.*` (de, zh-Hans by hand, Hant generated), 25 keys.
- Tests: `domain/load-sheet.test.ts` (8), `domain/order-overview.test.ts` (unchanged, still green), `lib/product-label.test.ts` (4), `server/tour-print.test.ts` (locale / id parsing), `server/tour-print.integration.test.ts` (5: read model, 30-stop totals vs DB, snapshot kept after an order change + `isOutdated`, unknown / malformed ids, authorization: anonymous, driver, deactivated admin rejected), e2e `tests/e2e/load-sheet.spec.ts` (anonymous -> login; link from the tour page; no shell; totals vs seeded numbers; reverse order 30..1; Print button calls `window.print()`; 4 locales incl. German name next to the Chinese one, print-media overflow check at 186 mm, A4 PDF with pdfinfo + pdftotext (not blank); invalid locales fall back; unknown tour -> not-found page; outdated warning on screen and in print media; a driver is redirected away).
- Verified: lint, typecheck, prettier on src / messages / tests, `i18n:check`, `pnpm test` (779 unit + 30 integration files on embedded PostgreSQL, all green), `pnpm build`, e2e (desktop, with the fake S3): `load-sheet`, `drivers`, `tours`, `tour-rerelease`, `shells`, `order-overview`, `products`, `home`, `auth`. PDFs / screenshots in `test-results/nud-091/` (screen at 1280 px for all four locales, outdated state, A4 PDFs); PDF pages for de (4 pages) and zh-Hans (5 pages) rendered with `pdftoppm` and inspected: headers repeat on each page, no row is split, nothing is cut off, Chinese glyphs render (Noto CJK is installed here).
- NOT verified: a real printer / the browser's own print dialog and its margin / scale settings (only Chromium's `page.pdf` and print-media emulation); Safari / Firefox print engines (`break-inside` on table rows and `thead` repeat are standard but untested there); Chinese strings are agent-written (NUD-073); the mobile Playwright project (the sheet is a desktop / paper page); `tour-rerelease` and `shells` failed once when run in parallel with each other (shared depot flag / missing fake S3) and passed alone with the fake S3, as in earlier tickets; `docs/i18n.md` and `pw.local.config.ts` still fail `prettier --check` (not touched here).
- Follow-ups: none needed for the ticket. Possible later: a tick-off box per line for the loader, driver-facing print of the same sheet from the driver app (not asked).

---

#### NUD-092 · Audit log for orders and tours
**Status:** done · **depends_on:** 032, 043

**Goal:** answer "who changed this quantity and when?".

**Scope**
- `AuditLog` model + migration; written in the service layer for order create/update/cancel, tour generate/reorder/release, stop status changes, photo replacements.
- Order detail and tour detail show a compact history timeline.

**Acceptance criteria**
- [x] Changing an order quantity creates one audit entry with before/after diff.

**Implementation notes**
- `AuditLog { id, actorId, entity, action, entityId, diff Json, createdAt }` (migration `20261018120000_audit_log`). `entity` / `action` are plain strings validated in code (`src/domain/audit.ts`: vocabulary, `sanitizeAuditDiff`, `diffOrderUpdate`, pure + unit-tested); a Postgres trigger refuses UPDATE and DELETE, and there is no update/delete path in the code (`src/server/audit-coverage.test.ts` scans for it). `actorId` is deliberately not a foreign key (users are archived, never deleted; history must outlive the row, and e2e fixtures delete their users).
- Writing: `recordAudit(tx, {actorId, entity, entityId, action, diff})` in `src/server/audit.ts`, always called with the transaction client of the change, so entry and change commit or roll back together. Diffs hold ids and values only (quantities in hundredths, enum values, ISO dates); names are resolved when the history is read. `sanitizeAuditDiff` drops keys like password/hash/secret/token/signature/url, truncates text to 200 characters and lists to 200 items. Driver problem notes are stored truncated; no storage keys or URLs for photos (only photo ids).
- Covered: `order.create|update|cancel|duplicate` (an update that changes nothing writes no entry; one entry per save with status / date / note changes and per-product before/after), `tour.generate|reoptimize` (rebuild of an existing tour, incl. locked extension), `tour.reorder|lock|unlock|assign_driver|release|rerelease` (re-release incl. the "only clears the outdated flag" variant, with per-customer quantity before/after), `stop.delivered|problem|undo` (written inside `applyStopMutation`; offline-synced entries carry `via: "sync"` and `clientCreatedAt` = the tap's effective time, tour status changes ride along as `tourStatus`; replays and rejected mutations write nothing), `photo.add|replace` (written inside the shared `attachCustomerPhoto`, so office upload and driver capture are both covered; driver photos carry `stopId` / `tourId`). Signature changes: the `*With` tour functions and `updateOrder` / `cancelOrder` now take the acting admin id (`actorId` in the deps objects of the builder, reorder and re-release).
- Not audited on purpose (listed with reasons in the coverage test): `markOutdatedForDate` and automatic tour progress (always part of an audited order / stop change), the background German translation of problem notes, demo-seed and test helpers. Demo seed photos go through `addCustomerPhoto` and therefore create `photo.add` entries by the seed admin.
- Reading: `src/server/audit-history.ts` builds the timeline entries (names resolved, newest first, max 200), `src/server/audit-queries.ts` exposes `orderHistoryQuery` / `tourHistoryQuery` behind `requireRole("ADMIN")`. UI: `AuditTimeline` (`src/components/admin/audit-timeline.tsx`, strings in `admin.history`, de + zh-Hans, Hant generated) at the bottom of the order detail page and below the planner on `/admin/tours` (the tour's own entries plus every entry whose diff names the tour: stop status changes and driver photos). Each entry: localized action, time, actor name with "Büro / Fahrer", details (quantities as `2,5 → 3,75 Packung` with the product name in the viewer's language). There is no separate tour detail page in v1; the planning page is the tour detail.
- Tests: unit (`audit.test.ts`), integration (`audit.integration.test.ts`: every action above, atomicity with a failing hook, admin-only reads, append-only trigger, scrubbing), coverage scan, e2e (order edit shows exactly one entry `Spaghetti 5 kg: 2,5 → 3,75 Packung`; tour planning page lists generate / lock / reorder / driver / release); both at 1280 px, order spec also at the mobile project. Screenshots: `test-results/nud-092-order-history-1280.png`, `test-results/nud-092-tour-history-1280.png`.
- Follow-ups: customer detail has no history view (photo entries are only visible in the tour timeline of the driver's tour); retention of the audit log is for NUD-093's `docs/privacy.md` (see the note added there). Audit entries of PIN resets / user management (mentioned in NUD-008 notes) are not part of this ticket's scope and are not written.

---

#### NUD-093 · Security hardening
**Status:** done · **depends_on:** 060

**Scope**
- Automated authz test matrix: every server action / route handler × {anonymous, driver, admin} → expected result.
- Security headers (CSP incl. map tile + storage domains, HSTS, frame-ancestors none, referrer policy).
- Signed URL lifetimes reviewed; bucket not public.
- `pnpm audit` in CI (fail on high/critical).
- Input size limits on all text fields; zod everywhere.
- Personal data overview in `docs/privacy.md` (what is stored, where, EU hosting, retention: screenshots deleted after 180 days via cron – configurable); the audit log (NUD-092: ids, quantities and driver problem notes truncated to 200 characters, no names) is append-only, so state a retention period and how it is enforced, e.g. a cron that deletes entries older than N months as the only delete path, which must also lift the append-only trigger deliberately).

**Acceptance criteria**
- [x] Authz matrix test passes and covers 100 % of server actions/route handlers (enforced by a test that enumerates them).


**Implementation notes**
- **Authorization matrix** (`src/server/authz-matrix.test.ts`, plain `pnpm test`, no database): 41 server actions and 13 route handler methods x {anonymous, driver, admin} (+ a deactivated admin, a driver whose DB role changed, the real Auth.js session endpoint, the cron bearer secret). `getDb()` is a stub whose only working call is `user.findUnique`, so "allowed" means "passed `requireRole`". A second test enumerates every export of a `"use server"` module and every `route.ts` method under `src/app` from the source tree and fails for a missing row, a stale row, an inline `"use server"` or an export form it cannot read. Mutation-checked: removing a `requireRole` from one action turns three tests red. `vitest.config.ts` inlines `next-auth` (it imports `next/server` without extension, which Node's ESM loader rejects) so the real Auth.js handlers run in the test.
- **Security headers** (`src/lib/security-headers.ts`, applied to `/:path*` in `next.config.ts`, `poweredByHeader: false`): CSP, HSTS (2 years, `includeSubDomains`, no `preload`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (`camera=(self)`, rest off), COOP `same-origin`. CSP is built from `MAP_TILE_URL` (`{s}` becomes a wildcard) and `S3_ENDPOINT` / AWS host; `CSP_REPORT_ONLY=true` switches to report-only; violations go to the new public `POST /api/csp-report` (size-limited, always 204, one sanitized log line, query strings removed). Scripts keep `'unsafe-inline'` (see decision log); everything else is locked down. Under the enforcing policy the whole desktop e2e suite passes and the server log has no `[csp-violation]`; the only violation found was zod 4's `new Function("")` JIT probe in the client bundle, fixed with `z.config({ jitless: true })` in `src/instrumentation-client.ts`. New e2e `security-headers.spec.ts` (headers on pages, API, static files and the worker; zero CSP violations on login, admin pages, Leaflet maps, driver pages and offline shell; session cookie HttpOnly + SameSite=Lax; foreign Origin refused; open-redirect `callbackUrl`).
- **CSRF / route handlers:** `src/server/csrf.ts` (`rejectCrossOrigin`, after the role check) on `/api/uploads`, `/api/admin/customers/import/parse`, `/api/driver/sync`, `/api/driver/photos`: foreign `Origin` or `Sec-Fetch-Site: cross-site/same-site` -> `403 bad_origin`; requests with neither header (not a browser) pass. Server actions rely on Next.js' own Origin/Host check; Auth.js has its CSRF token (tested without it); `/api/session-ended` (GET, deletes only the caller's cookie) and the cron routes (bearer secret) are not state-changing for a forged browser request.
- **Input limits:** `readTextLimited` (`src/server/http-body.ts`) reads JSON bodies by bytes while streaming (uploads 2 KiB, sync 256 KiB, photos 8 KiB; `/api/uploads` had no limit at all). `uploadRequestSchema` is strict with `contentType` <= 100. `src/server/input-limits.test.ts` scans every `z.string()` / `z.array()` under `src/server`, `src/domain`, `src/lib` and fails for an unbounded one; schemas of server-written data (stored JSON, API responses, ORS / DeepL answers) are exempt through allow-list entries or `// unbounded-ok-start|end` markers with a reason. All other inputs already had `.max()` / regexes; unknown keys are stripped (not rejected) on form schemas, strict on the id-only and API schemas.
- **Signed URLs:** reviewed, unchanged: upload PUT 5 min, admin / stop-page reads 1 h, driver tour copy 12 h; pinned by `url-lifetimes.test.ts`, documented in `docs/deploy.md` section 11.2. Bucket privacy: documented (section 3 step 3 + 11.3) and `scripts/check-storage-private.ts` (anonymous listing / object GET must be 401/403); **not run against the real R2 bucket** (no production), only written and reasoned.
- **Dependencies:** `pnpm audit` reached the registry: 1 high (`braces` <= 3.0.3 via `eslint-config-next`, no patched release, dev tooling only, `pnpm audit --prod` clean). Accepted with `auditConfig.ignoreGhsas` + reason in `pnpm-workspace.yaml`; CI runs `pnpm audit --audit-level=high` after install.
- **Retention:** `GET /api/cron/retention` (daily 03:17 UTC, `CRON_SECRET`, fail closed) deletes screenshots older than `SCREENSHOT_RETENTION_DAYS` (default 180, 1..3650, invalid -> 180): storage object first, then row (`Order.screenshotId` becomes NULL by FK), 100 per run, a failed item stays for the next run; also deletes `LoginAttempt` rows older than 24 h (IP addresses). Unit tests (boundary at exactly 180 days, order of operations, failure paths, auth) and a DB integration test. `docs/privacy.md` (new): hosting, data inventory, retention, recipients (DeepL, ORS, tile provider), what is not collected (GPS, D19), audit-log retention design (append-only trigger, intended deletion job not implemented), open decision for orders / tours. `docs/env.md`, `.env.example`, `docs/deploy.md` section 11 and `AGENTS.md` updated.
- **Reviewed, no change needed:** login rate limiting (5 per user / 20 per IP per 15 min, DB backed, constant-time bcrypt for unknown users; client IP = first `x-forwarded-for` entry, trustworthy on Vercel only - documented); Auth.js session cookie (HttpOnly, SameSite=Lax, Secure on https, asserted in e2e); open redirects (`postLoginPath` fuzz test with 15 hostile values + e2e); SSRF (the app never fetches a URL taken from user data or from an imported file; ORS / DeepL hosts are fixed); CSV injection (there is no CSV export in the app; imports reject formula-like cells, NUD-090); error messages (health returns statuses only, server actions return codes, Next hides action error text in production, `error.tsx` is generic).
- **Fixed on the way:** `tests/e2e/customer-import.spec.ts` "review queue" test had a check-then-click race (clicked a skip button that was replaced by the summary and then hung for 180 s); it now waits for either state.
- Not verified: real browsers (only Chromium via Playwright, desktop project; the mobile project and iOS Safari were not run), Vercel serving the config headers, HSTS / CSP on the real domain, Neon, R2 bucket privacy and lifecycle rule, DeepL / tile-provider contracts (marked "to confirm" in `docs/privacy.md`).
- Follow-ups: NUD-110 .. NUD-113.

---

#### NUD-094 · Monitoring, backups, error pages, runbook
**Status:** done · **depends_on:** 007

**Scope**
- Sentry (optional via `SENTRY_DSN`) for server + client errors; source maps uploaded.
- Neon point-in-time restore documented; weekly logical backup (`pg_dump` via GitHub Action to R2) with 8-week retention.
- Localized friendly error pages (driver: "Something went wrong – your data is safe, try again").
- `docs/runbook.md`: deploy, rollback, restore DB, rotate keys, reset admin password, what to do if ORS/DeepL is down.

**Acceptance criteria**
- [x] A forced test error appears in Sentry (when DSN set). *Substitution: verified against a local mock ingest speaking the Sentry envelope protocol (`scripts/mock-sentry-ingest.ts`, `tests/e2e/sentry-ingest.spec.ts`, 3/3 with a DSN build): forced error, `mode=throw` via `onRequestError`, a page error and a real browser error arrive, scrubbed, with no CSP violation. A real Sentry project was not available: NUD-114.*
- [x] Backup workflow produces a restorable dump (documented test restore). *Substitution: the same script the workflow runs (`pnpm backup:db`, `pnpm backup:verify`) was run with real `pg_dump`/`pg_restore` 16 against embedded PostgreSQL 16 and a local S3 server (dump, upload, size check, prune, restore into an empty database, checks); documented in `docs/runbook.md` section 5. The GitHub workflow itself and real R2/Neon were not run: NUD-114.*

**Implementation notes**
- **Sentry** (`@sentry/nextjs` 11.8.0, errors only; no tracing/replay/profiling): optional and dynamic. `src/instrumentation.ts` (`register`, `onRequestError`) loads `sentry.server.config.ts` only for a valid `SENTRY_DSN`; the browser part is in `instrumentation-client.ts` behind `NEXT_PUBLIC_SENTRY_DSN` (inlined from `SENTRY_DSN` by `next.config.ts`; Turbopack removes the branch, checked: no Sentry in `.next/static` without a DSN). Server action / page errors are reported once (server via `onRequestError`; the client reports only errors without a digest, `monitoring-client.ts`). `serverExternalPackages: ["@sentry/nextjs"]`.
- **Scrubbing** (`src/lib/sentry-scrub.ts`, `beforeSend` + `beforeBreadcrumb`, unit-tested): no user record / IP, request keeps only method, URL without query, user-agent, accept-language; no body, cookies, headers, `server_name`; sensitive keys (password, pin, token, cookie, auth, signature, session ...) redacted in extra/contexts/tags; URLs, bearer tokens and signatures inside messages redacted; console breadcrumbs dropped; offline noise (`Failed to fetch`, `Load failed`, aborted ...) not sent. The e2e checks real events for personal data.
- **CSP:** the DSN origin is added to `connect-src` by `security-headers.ts` (tested). Service worker: does not intercept ingest; offline events are lost by design (documented). Precache grows by about 550 KiB uncompressed (76 -> 80 entries) in DSN builds.
- **Source maps:** `withSentryConfig` (from `@sentry/nextjs/config`) is applied only when `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are all set; maps are deleted after upload, no tunnel, telemetry off. `deploy-env` warns on an invalid DSN or a partial config.
- **Test error:** `GET /api/monitoring/test-error` with `Authorization: Bearer $CRON_SECRET` (fail closed; `{status:"disabled"}` without DSN; `?mode=throw` exercises the automatic hook). Rows in the authz matrix (`SECRET_ONLY`) and in the "exactly the bearer secret" list; unit tests with a mock `captureException`.
- **Error pages:** `driver/error.tsx`, `driver/(app)/error.tsx` (shell and offline sync stay mounted), `admin/error.tsx`, `admin/(shell)/error.tsx`, `global-error.tsx` (own `<html>`, texts from generated `src/lib/fatal-messages.json`, checked fresh by `i18n:check`). Driver page: "data is safe, try again" + retry (`router.refresh()` + `reset()`); **offline** it shows a calm no-connection page, reloads (service worker serves the shell) and reloads itself when the connection returns. Admin page shows the digest as a reference, never the message. de + zh-Hans by hand (`errorPages.*`), Hant generated; Chinese agent-written (see NUD-073). e2e `error-pages.spec.ts` (desktop + mobile, de/zh-Hans, offline switch) uses hidden pages enabled only by `ENABLE_ERROR_TEST_PAGES=true` (set in CI e2e; the production build check rejects it).
- **Backups:** `.github/workflows/backup.yml` (Sundays 02:23 UTC + manual; environment `backup`; job *backup* then job *verify* which restores into a disposable `postgres:16`). `scripts/backup/*` + `scripts/lib/backup.ts`: `pg_dump --format=custom` (version must be >= server, checked), password only via `PG*` env (not argv), `LoginAttempt` data excluded, dump sanity (size, TOC must contain `_prisma_migrations`, User, Settings), sha256, upload, HEAD size check, **then** prune (keep 8 weeks, never fewer than the newest 4, only files matching the naming scheme); pooled Neon URLs rejected. `pnpm backup:verify` refuses protected or non-empty targets and restores in one transaction. Tests: 12 unit + 4 integration with real pg_dump/pg_restore. Neon point-in-time restore and the full restore procedure + quarterly drill: `docs/runbook.md` sections 4-5, `docs/deploy.md` section 13 (one-time setup with the scoped secrets: separate R2 bucket and token, read-only `backup_reader` role).
- **Admin password reset:** `pnpm admin:reset-password --email ...` (`scripts/admin-reset-password.ts`, `src/server/admin-password.ts`): password from `ADMIN_NEW_PASSWORD`, hidden prompt (twice) or first stdin line, never an argument; admin role only; clears that account's lockout; prints host/db only; non-TTY needs `--yes`. Integration-tested including that the CLI output never contains the password.
- **Orphaned objects (follow-up of NUD-015/083):** implemented. `GET /api/cron/orphan-cleanup` (Sundays 04:07 UTC, bearer secret). Default `ORPHAN_CLEANUP_MODE=dry-run`; delete mode only after the operator switches it. Safeguards: grace period (default 14 days, minimum 7), only keys of the app's two key shapes, referenced objects kept (re-checked right before each delete), caps (50 deletes, 10,000 listed), abort when >= 20 candidates and more than half are orphans. `Storage.list` added (fake + S3). Unit and DB integration tests.
- **Runbook** `docs/runbook.md`: deploy, rollback, DB restore (Neon PITR and weekly backup), key rotation (`AUTH_SECRET` logs everyone out, S3, ORS, DeepL, `CRON_SECRET`, Sentry, backup), admin reset, ORS / DeepL (NUD-070 pending-translation retry) / Neon / R2 outages, `/api/health`, logs, orphan cleanup, Sentry checks, open human steps. `docs/privacy.md`, `deploy.md` (sections 12-13), `offline.md`, `AGENTS.md`, `.env.example`, `docs/env.md` updated.
- Checks: lint, typecheck, i18n:check, 1079 unit tests + 33 server integration files + 8 script test files (incl. backup integration) all green; e2e `error-pages` + `security-headers` 20/20 (desktop and 375 px mobile project) on a no-DSN build; `sentry-ingest` 3/3 on a DSN build. CI gets `postgresql-client-16` so the backup integration tests run there.
- Not verified: a real Sentry project (ingestion, grouping, the source-map upload path of `withSentryConfig` - never ran, no token), the GitHub workflow on a runner (incl. `postgresql-client-16` install), real R2 and Neon (point-in-time restore window of the plan, read-only role, `pg_dump` 16 against the real server version), GitHub failure e-mails, the hidden-prompt (TTY) path of the reset CLI (only env and stdin paths run), the real `global-error` page in a browser (component test only), real devices.
- Follow-ups: NUD-114 (human setup / verification). Pre-existing, not mine: Auth.js "crypto.getRandomValues while prerendering" log during build (NUD-097); `docs/i18n.md` fails prettier.

---

#### NUD-095 · Driver usability & accessibility pass
**Status:** done · **depends_on:** 083

**Scope**
- Review every driver screen against §4.3 rules; fix violations.
- Test with system font size at 130 %, dark mode, low-end Android (Chrome DevTools throttling: 4× CPU, Slow 4G).
- One-hand reachability: primary actions in bottom half.
- Check that every driver screen remains understandable when the locale is one the tester doesn't read (icons, numbers, photos carry meaning).
- Performance budget: driver home LCP < 2.5 s on Slow 4G after first load.

**Acceptance criteria**
- [x] axe-core e2e check has no serious/critical violations on driver screens. (`driver-a11y.spec.ts`: login, picker, today list + map, stop with / without photos, problem sheet, toast, result card, finished, offline list + stop, generic offline page, error page online + offline, iOS install hint + overlay; all four locales x light / dark; de + zh-Hant-TW also at 130 % font size. Moderate / minor findings that remain are listed in the notes.)
- [x] Performance budget met (Lighthouse CI on driver home). (Lighthouse CI ran locally with the sandbox Chromium: median LCP 1.9 s, DevTools Slow 4G + 4x CPU, warm profile; the Playwright PerformanceObserver test gives 0.6-0.9 s. The CI job was NOT run on a GitHub runner. Emulation, not a real phone.)

**Implementation notes**
- Method: wrote the checks first (`tests/e2e/driver-a11y.spec.ts`, `driver-usability.spec.ts`, `driver-performance.spec.ts`, helpers `driver-fixture.ts` / `driver-audit.ts`; `@axe-core/playwright` added), ran them against the production build, fixed what they found. `docs/driver-usability.md` explains checks and decisions.
- Fixed (axe serious/critical): progress bar without name (`aria-label`); contrast of mid-transition colours was a test artefact (the audit waits for animations); map depot marker without name (`title`).
- Fixed (rules 4.3): `Sheet` / `Dialog` close button 40 -> 48 px; "Anmeldung Büro" / "Fahrer-Anmeldung" link 24 -> 48 px high; German product name caption 14 -> 16 px; driver map markers 32 -> 48 px touch target (36 px circle, 18 px number) and zoom buttons 30 -> 48 px (`TourMap touch`, driver map only); fixed heights on driver buttons replaced by minimum heights and `Button size=lg` may wrap, so labels survive 130 % font size / long German words; top bar date wraps instead of truncating (known note of NUD-051); progress counter and "remaining" wrap cleanly; problem reasons use an auto-fit grid (one column at 130 %).
- Login (also admin): icons next to username / PIN / submit, input border and submit button use the theme tokens (the submit button was invisible in dark mode: `bg-zinc-900`; error text now `text-destructive`), visible focus ring.
- Other: sr-only `h1` on the tour screen (`driver.today.pageTitle`) and on the picker (the four language names); error page `role="alert"` moved from the `h1` to a wrapper (the heading lost its role); toast region name localized (`common.notifications`, hotkey hint removed, was English "Notifications alt+T"); bottom padding of the driver content (toast no longer covers the last list entries: closes the NUD-053 note); sticky submit / cancel bar in the problem sheet; picker, error page and generic offline page anchored to the lower part of the screen; generic offline page got an icon; `color-scheme: dark` in dark mode; global `prefers-reduced-motion` rule (spinners keep turning).
- One hand (bounding boxes, `driver-usability.spec.ts`): login submit, language choices (as a group), tour "start navigation", stop "delivered" / "problem" at the end of the page, sheet submit, error retry: centres in the bottom half at 375x667 and 412x915 (worst case: "delivered" at 363 / 667). Decision: status buttons stay in the page flow (no sticky bar).
- Locale-independent understanding: login, picker, error, offline and install screens now have an icon next to every action; numbers (quantities, stop numbers), photos and status icons carry the meaning on stop / tour screens. Not tested with real non-readers.
- Dark mode: exists since NUD-005 (tokens via `prefers-color-scheme`); kept, verified in all four locales (axe + screenshots), no toggle. Light-only was rejected: the tokens were already there.
- Font size 130 %: emulated by `html { font-size: 130% }` (everything is rem based), NOT Android's per-app font scale. Passes axe and the measurements in de and zh-Hant-TW.
- Performance: Playwright test (Slow 4G = 1.6 Mbit/s, 150 ms, 4x CPU through CDP, `next start`, 25 stops, warm after first visit): LCP 0.6-0.9 s. Lighthouse and `@lhci/cli` DO run here with the sandbox Chromium: `pnpm lighthouse:prepare` (persistent logged-in profile) + `pnpm lighthouse` (lhci via `pnpm dlx`, not a project dependency because `@lhci/cli` pulls 4 high advisories into `pnpm audit`), `lighthouserc.cjs`, CI job `lighthouse` (PRs): median LCP 1.9 s (1.2-2.0), CLS 0.04, TBT 0.45-0.64 s. First-ever visit (empty cache) is slower: 1.1-3.8 s in the Playwright runs (noisy); 502 KiB of the 870 KiB transferred is the OpenCC bundle (NUD-098), so NUD-098 would help the first visit.
- Verified: lint, typecheck, `i18n:check`, prettier, component tests (23 files incl. new heading / progress-bar test), `pnpm build`, e2e (mobile project): a11y / usability / performance specs, `driver-today`, `driver-stop`, `driver-status`, `shells`, `driver-language-picker`, `auth`, `pwa`, `error-pages`, `driver-offline`, `driver-outbox`, `driver-photo`, `customer-photos`, `drivers` (`driver-status` zh-Hant-HK failed once under load on a 30 s timeout and passed alone; `driver-offline` expected no `h1`, adapted). Screenshots at 375 px (de 130 %, zh-Hant-TW dark, sheet, finished, picker, login) inspected.
- NOT verified: real devices (TalkBack / VoiceOver, Android font scale, real low-end CPU, thumb reach, glare; see NUD-115), the CI job on a GitHub runner, the full vitest suite with DB tests (only component and script tests re-run; no server code changed), the desktop Playwright project, the admin screens that use `Button size=lg`, `Sheet` / `Dialog` (close button now 48 px; their e2e were not re-run), the unreviewed Chinese strings (`driver.today.pageTitle`, `common.notifications`; NUD-073).
- Remaining (documented, not fixed): axe "page should contain a level-one heading" (moderate) no longer occurs on driver screens; map credit line below 16 px / 48 px is exempt; the "tour updated" banner and its acknowledge button sit at the top of the list (not in the bottom half); no swipe (NUD-052); map offline (NUD-108); customer names in a different language than the UI carry no `lang` attribute.
- Follow-up: NUD-115 (real-device check).

---

#### NUD-096 · 👤 User acceptance test with client & drivers
**Status:** blocked (waiting for the client sign-off; the UAT itself is a human step) · **depends_on:** 093, 095

**Scope**
- `docs/uat.md`: test script for office (customers, products, orders, tour, release, import, print) and drivers (language choice, full tour, offline, photo, problem report).
- Feedback form (simple markdown table) incl. **which Chinese variant each driver actually chose** and any wording issues.
- Agent converts feedback into new tickets in this backlog.

**👤 Human step:** run the UAT with the client and at least one real driver per language used.

**Acceptance criteria**
- [ ] Client sign-off recorded in `docs/uat.md`.

**Human steps** (details in `docs/uat.md`)
1. Developer: finish the pre-UAT checklist (`docs/uat.md` section 9: real ORS key, tile provider, DeepL key, R2 CORS, Sentry, backups, CSP on the real deployment, reviewed Chinese strings, real depot, real products) and prepare the data (section 2: `pnpm db:seed --demo --today` on a UAT database, or the client's real data).
2. Run the office script (section 3) with the client's office staff and the driver script (section 4) with at least one real driver per language used, on at least one Android and one iPhone (section 6).
3. Collect the feedback forms (section 5: findings, chosen Chinese variant per driver, wording issues, device matrix) and give them to the agent: it creates tickets (section 8 of `docs/uat.md`), runs the wording rows through `pnpm i18n:import` and logs the variant choice (also resolves the open question in section 10 of this file).
4. The client fills in the sign-off block (`docs/uat.md` section 7). Only then tick the criterion above and set the ticket to `done`. Neither the agent nor the developer fills in the sign-off.

**Implementation notes**
- Wrote `docs/uat.md` (docs only, no code): preconditions with two data modes (demo seed with `--today`, or the client's real data), office script O-01..O-94 (login/settings, products with Chinese names, customers with photos and pins, translations tab, CSV/XLSX import with pin review, manual and screenshot orders, tour generate/reorder/lock/optimize/release, load sheet print, change after release and re-release, history, live progress, driver management), driver script D-01..D-54 and X-01..X-03 (first-start language picker, install on Android/iOS, full tour, quantity check against orders and load sheet, Google/Apple Maps hand-off, delivered/undo/problem with free text, photo capture, airplane-mode taps, cold start offline, Background Sync, logout with unsent taps, re-release notice, language switch, font size / sunlight / one hand / non-reader test), feedback form (findings, **chosen Chinese variant per driver**, wording issues with key/screen, current, suggested text for `pnpm i18n:import`), device matrix, an empty sign-off block, "how the agent converts feedback into tickets", the developer's pre-UAT checklist (references NUD-007, 073, 105, 107, 109, 113, 114, 115 instead of repeating them) and a table of known open items (NUD-073, 097, 099, 106, 108).
- Checked against the app: every route and URL named in the document exists (`/de/login`, `/de/driver/login`, `/de/admin/customers/import`, `/de/admin/customers/import/review`, `/api/health`), `tests/fixtures/customers-150.csv` exists, and every quoted German UI term was matched by a script against the values of `messages/de.json` (and the locale names in `src/lib/locale-resolution.ts`); the only unmatched quotes are English instructions or placeholder variants. Prettier passes on `docs/uat.md` and `backlog.md`. Not run: the UAT itself (human), and nothing was clicked in a browser, so the "Expected" column describes the behaviour documented in the tickets and the labels, not an observation.
- Seen while checking, not changed: a driver can log out only at the bottom of the home screen (`LogoutButton`); the product search by Chinese name is not promised anywhere, so O-52 records the behaviour as an observation only.
- No new tickets were needed: the findings the script may produce map to existing tickets (NUD-099, 106, 108) or are covered by the human tickets 105, 107, 109, 113, 114, 115.

---

#### NUD-097 · Silence Auth.js prerender error log
**Status:** done · **depends_on:** 004

**Goal:** the server log is free of `Route "/[locale]/admin" ... unstable value crypto.getRandomValues() while prerendering`.

**Scope**
- Find out why `auth()` (Auth.js CSRF/session handling) runs inside Next's partial-prefetch prerender of the guarded layouts/pages (present since NUD-004, reproduced on its commit) and make the dynamic access explicit (e.g. `await connection()` or reading `cookies()` before `auth()` in `requireRole`/`requirePageActor`), without weakening the guards.

**Acceptance criteria**
- [x] Requesting `/de/admin`, `/de/admin/orders` and `/de/driver` while logged in produces no prerender errors in the server log.
- [x] Guards still redirect/reject exactly as before (existing auth tests and e2e pass).

**Implementation notes**
- Root cause: Next's partial-prefetch validation (`partialPrefetching` + `cacheComponents`) renders the guarded layouts/pages in a prerender pass with an empty cookie jar. `requirePageActor` called `auth()` without any explicit dynamic access, so Auth.js found no CSRF cookie and generated a fresh token with `crypto.getRandomValues()` inside the prerender, which Next reports as a blocking-prerender error (once per guarded route, e.g. `/[locale]/admin`, `/admin/orders`, `/admin/orders/[id]`). The guards themselves behaved correctly (they sit inside `Suspense`); only the log was wrong.
- Fix: `await connection()` as the first statement of `requirePageActor` (`src/server/auth/page-guards.ts`), so the session read is declared request-time data and is skipped by the prerender. `requireRole` (server actions, route handlers) is unchanged. The unit test `driver-locale.integration.test.ts` mocks `next/server` `connection` (it only works inside a request scope).
- Verified: `pnpm build` log has no `getRandomValues`; `next start` log stayed clean (only the expected `CredentialsSignin` lines from the negative-login tests) over the e2e runs of auth, shells, security-headers, drivers, driver-today, orders (all pass; `orders` first-test failure with `--workers=2` together with other specs is the known shared-DB flake and passes alone). Unit/integration: `src/server/auth/*`, `authz-matrix`, `driver-locale.integration` pass (204 tests); lint, typecheck, prettier pass.
- Not verified: the complete `pnpm test` in one go (exceeds the 3-minute tool limit here; only the auth-touching files were run), and the remaining e2e specs (they do not touch the changed code path).

---

#### NUD-098 · Keep OpenCC out of the client bundle
**Status:** done · **depends_on:** 003

**Goal:** the browser must not download the ~1.3 MB OpenCC dictionaries (found in NUD-020: `language-switcher.tsx` and `users-manager.tsx` import `LOCALES` from `src/lib/localized-text.ts`, which imports `src/lib/opencc.ts`).

**Scope**
- Split locale constants/types/zod schema/`pick` from the OpenCC-based `withDerivedHant` (e.g. a server-only module), keep the public behaviour and tests.
- Check the production build: no chunk under `.next/static` contains OpenCC data (e.g. grep for a dictionary entry such as `麪`).

**Acceptance criteria**
- [x] No client chunk contains OpenCC; all existing tests pass.

**Implementation notes**
- Split: `src/lib/localized-text.ts` is now client-safe (locale constants, schema, `createLocalizedText`, `pick`, `pickWithSource`, DB-tag helpers); `withDerivedHant` moved unchanged to `src/lib/localized-text.server.ts` (the only importer of `src/lib/opencc.ts` besides server code, scripts and tests). Only `src/server/translator/localize.ts` used it; its test moved to `localized-text.server.test.ts`. Behaviour identical. No `server-only` package: it is not installed (`pnpm install` is not possible here) and tsx scripts/vitest would need aliasing, so the guard is a file naming convention plus two checks below.
- Guards: (1) ESLint `no-restricted-imports` (opencc-js, `lib/opencc`, `localized-text.server`) for `src/components`, `src/domain`, `src/sw`, `src/lib` (server half, opencc.ts and tests excepted); verified that a violating import in `src/components` fails lint. (2) `scripts/check-client-bundle.ts` (`pnpm check:client-bundle [--report]`): scans every file in `.next/static` for real OpenCC dictionary entries (`意大利面 意大利麪`, `意大利 義大利`) and the package name, exit 1 on a hit; runs at the end of `pnpm build` and `pnpm build:vercel` (so CI's build/lighthouse job fails too) and has a unit test for the signatures. `--report` prints first-load JS from `build-manifest.json` + the route's RSC client manifest (root files + page + ancestor layouts). Documented in AGENTS.md.
- Measured (production build, Turbopack): the offending chunk was 1166 KiB raw. First-load JS `/de/driver`: 2049 KiB raw / 773 KiB gzip -> 884 KiB / 273 KiB (-1165 KiB raw, -500 KiB gzip); `/de/admin`: 2050 / 776 -> 885 / 277 KiB. All client chunks 2931 -> 1753 KiB raw. Service worker precache: 74 entries / 3050 KiB -> 75 entries / 1872 KiB.
- Lighthouse (`pnpm lighthouse:prepare` + `pnpm lighthouse`, 3 runs, driver home, same environment as NUD-095): LCP 1.14-1.16 s (before: median 1.9 s, range 1.2-2.0), CLS 0.042 (unchanged), TBT 2-48 ms (before 0.45-0.64 s). Assertions pass.
- Verified: lint, typecheck, prettier on touched files, i18n:check, unit tests without DB (98 files, 1085 tests), integration tests touching OpenCC/localize (customer-actions, demo-seed, driver-today, product-actions, translation-retry: 73 pass); e2e shells + pwa (66), driver-offline (22, offline shell works), driver-today + drivers (16), products (live OpenCC pre-fill via server action) + customer-form (customer-form failed once when run together with products on the shared DB, passes alone: known shared-DB flake).
- Not verified: the full integration suite in one go (only the five OpenCC-related files), other e2e specs (code path unchanged), real-device first-visit timing.

---

#### NUD-099 · Late orders for an already completed tour
**Status:** done · **depends_on:** 043

**Goal:** an order confirmed after the tour of its day is COMPLETED must not vanish (found in NUD-043).

**Scope**
- Today `outdatedTourDates` / `markOutdatedForDate` ignore COMPLETED tours and `generateTour` / re-release refuse them, so a new confirmed order for such a day is on no tour and nobody is told.
- Decide with the office (simplest first): warn on the order form and in the overview ("tour of that day is already completed"), or allow a second tour for the date (D5: no unique constraint on `Tour.date`; `getTourPlan` shows only the latest tour of a day, so the page needs to list several).

**Acceptance criteria**
- [x] A confirmed order for a date whose only tour is COMPLETED is visibly reported to the office (and, if a second tour is chosen, can be delivered). (Overview notice + badge, dashboard card, banner on the planning page; "Folgetour erstellen" builds a second tour for the same date that the driver delivers. Integration `late-orders.integration.test.ts` (13), e2e `late-orders.spec.ts` (complete tour, late order, banner, follow-up, release, driver delivers; 4 locales).)

**Implementation notes**
- Design (both options of the scope, minimum viable): the office is told in three places and can deliver the order through a **follow-up tour** = a second `Tour` row for the same date. No schema change, no migration. A day's tours are all COMPLETED and a CONFIRMED order is on no stop = **late order** (`findLateOrderIds` in the new `src/domain/day-tours.ts`, which also holds `sortDayTours`, `pickDefaultTour`, `pickDriverTour`, `canCreateFollowUp`, `deliveredStopConflicts`; 20 unit tests). While an open tour (anything but COMPLETED) exists nothing is "late": the ordinary outdated flag, rebuild and re-release handle new orders as before; `markOutdatedForDate` is unchanged (completed tours stay unflagged, history).
- Scoping (the core of "several tours per date"): `listConfirmedOrdersForDate(db, date, {tourId})` returns the day's confirmed orders that are NOT on a stop of another tour of that day (`{tourId: null}` = for a tour that does not exist yet = on no stop). The builder, the re-release plan (`loadReleasePlan` and its order signature) and the planning read model use it, so a follow-up tour only contains the late orders and its diff never lists the completed tour's customers as "added". Without a second tour the scope excludes nothing: single-tour behaviour is unchanged (all earlier tour / re-release / builder tests pass untouched).
- Builder: `generateTourWith(deps, date, {followUp: true})` and `generateFollowUpTour(actorId, date)`; new action `createFollowUpTourAction({date})` (`requireRole("ADMIN")`, strict zod, like `generateTourAction`). Allowed only when the day has tours and all are COMPLETED (`follow_up_not_allowed` otherwise, so a second click or a stale page creates nothing), and when there is at least one late order with a confirmed pin (`no_late_orders`; customers without a confirmed pin come back as `PIN_UNCONFIRMED` warnings, as in a normal build); past days stay refused (`date_in_past`). The new tour is OPTIMIZED, built from the late orders only (one stop per customer, orders merged; a customer that was delivered earlier gets a second stop with only the new quantities), then planned, assigned and released like any tour. Plain `generateTour` is unchanged: it rebuilds the newest tour of the day (the open follow-up tour, scoped) and still answers `tour_not_editable` for a completed one. A concurrent second create loses with `conflict` (latest tour id/`updatedAt` re-checked under the per-date advisory lock).
- Audit (NUD-092): new action `tour.followup` (vocabulary, history label, `audit-history` case with the stop count) written in the creating transaction with `followUpOfTourIds` and the late `orderIds`; `audit-coverage.test.ts` and the authorization matrix (row for `createFollowUpTourAction`) pass; an integration test reads the entry back through `tourHistoryQuery`.
- Driver (NUD-051): `getDriverTour` now takes all released tours of the driver for the day and `pickDriverTour` chooses: the newest RELEASED / IN_PROGRESS one, else the newest COMPLETED (finished screen), so an unreleased follow-up keeps showing "tour finished" and a released one replaces it. Stop-status, photos and sync work by stop id and needed no change. Admin dashboard (`getTodayProgress`) shows `pickDefaultTour` (the open tour, else the newest) and a new `lateOrderCount` with an amber hint "N Bestellungen ... nach Abschluss der Tour ... Bitte eine Folgetour erstellen".
- UI: planning page (`?date=&tour=<id>`; `tourPlanQuery(date, tourId?)`, `getTourPlan(..., tourId?)` returns `tours[]` (id, number, status, stop count), the selected `tour` (default = `pickDefaultTour`, an unknown id falls back to it) and `late`): `TourTabs` ("Tour 1", "Tour 2 (Folgetour)" with status and stop count, only when there are two or more), `LateOrdersBanner` (red alert with the late customers and quantities via `TourDiffList`, a note for customers whose pin is not confirmed, button "Folgetour erstellen" that opens the new tour's tab; the button is disabled without a routable late customer; a second, neutral alert lists "Bestellungen nach der Lieferung geändert" = conflict note, see below). `TourPlanner` is keyed by tour id so tab changes reset local state. Order overview: `LateOrdersNotice` (one line per day with count and link to the planning page) and an amber badge "Nachbestellung - Tour abgeschlossen" in the tour column of late rows (`lateOrderIdsForRows`, one query). Strings `admin.tours.late/tabs`, `admin.orders.late`, `admin.dashboard.today.lateOrders`, error codes, `admin.history.actions.tour_followup`: de + zh-Hans by hand, Hant generated (Chinese agent-written, NUD-073).
- **Increased quantities on delivered stops (decision, see log):** not delivered by the follow-up tour. A confirmed order that IS on a stop of a completed tour and was edited or cancelled afterwards is reported as a **conflict note** (`deliveredStopConflicts`: delivered quantity -> now, per product; shown under the banner even when there is no late order); the office has to settle it with the customer and driver. To get the difference delivered the office creates a new order for the extra quantity, which then is a late order. Automating that is NUD-117.
- Tests: unit `day-tours.test.ts`; integration `late-orders.integration.test.ts` (late orders reported while the completed tour stays unflagged; overview flag + dashboard count; follow-up contents, completed tour byte-identical, audit entry + history; rebuild of the follow-up tour scoped apart from the completed one; driver picks follow-up after release and the finished tour before; re-release diff only names the follow-up's own orders; conflicts for edited / cancelled delivered orders; nothing reported / no follow-up for a day without tour or with an open tour; unconfirmed pins; past day; action rejects anonymous / driver with nothing written; input validation; mutation-checked: dropping the scope fails 5 tests); authz matrix row; e2e `tests/e2e/late-orders.spec.ts` (desktop: first tour built, released and delivered by the driver on a phone; late order entered through the order form; notice, badge, dashboard hint, banner; follow-up with tabs, completed tab unchanged; release; driver sees only the late quantities (A: 3, not 2 + 3), delivers; DB: two COMPLETED tours, 2 + 2 order links, `tour.followup` audit; second test: banner / notice / dashboard hint in all four locales, follow-up creation in zh-Hant-TW, no console errors, no horizontal scroll).
- Verified: lint, typecheck, `i18n:check`, prettier on touched files, `pnpm build` (incl. client-bundle check), vitest without DB (99 files, 1108 tests) and all 34 integration files on embedded PostgreSQL (399 tests, in three groups), e2e (desktop) `late-orders`, `tours`, `tour-rerelease`, `order-overview`, `orders`, `shells`, `admin-progress`, `mvp-happy-path` (demo seed, 5), e2e (mobile) `driver-today`, `driver-status`. Screenshots at 1280 px inspected (`test-results/nud-099-orders-1280.png`, `-banner-1280.png`, `-followup-1280.png`, `-released-1280.png`, `-banner-zh-Hans-1280.png`, driver `nud-099-driver-followup.png`), no horizontal scroll asserted.
- Observation (not fixed): the driver screenshot right after the release showed the amber "Offline - zuletzt aktualisiert" banner although the page listed the new follow-up tour correctly (cache served first, then refreshed); this is the cache behaviour NUD-118 should look at.
- NOT verified: the driver PWA on a real phone / with a warm offline cache when a second tour of the same day appears (NUD-118); drag-and-drop and touch on the follow-up tab (same component as before); real ORS routing for the follow-up (heuristic only); the e2e together with the other specs in one parallel CI run (like `tour-rerelease` / `tours` it flips `depotPinConfirmed` and needs "no tour for today"; run it alone or first); the order form itself gives no warning (NUD-116); the print view of a follow-up tour was not opened; Chinese strings are agent-written (NUD-073).
- Follow-ups: NUD-116, NUD-117, NUD-118. NUD-102 (several drivers per day) can build on the tabs, `pickDefaultTour` / `pickDriverTour` (extend to "all active tours of this driver") and the order scope.

---

#### NUD-105 · 👤 Real-device PWA install check + Lighthouse run
**Status:** todo · **depends_on:** 080

**Goal:** confirm what NUD-080 could only simulate.

**Scope**
- On a deployed HTTPS build: run Lighthouse (installable PWA) against `/<locale>/driver/login`, fix findings.
- Android Chrome: install via the hint button, check it starts on `/<locale>/driver` and the (maskable) icon looks right.
- iPhone Safari: follow the overlay steps, check icon, label, standalone start.

**Acceptance criteria**
- [ ] Lighthouse report shows the app as installable; Android and iOS installs tested and noted here.

---

#### NUD-106 · Installed app opens in the driver's current language
**Status:** done · **depends_on:** 080

**Goal:** after the driver switches language the home-screen app must not start in the old one.

**Scope**
- The manifest `start_url` is locale-prefixed (`/de/driver`). Options: locale-less `start_url` `/driver` that `proxy.ts` redirects using the stored user locale, or a re-install hint. Pick one, keep the localized `name`.

**Acceptance criteria**
- [x] A driver with locale `zh-Hans` who installed the app while in German opens it in Chinese. (Simulated, a real installation was not tried: driver installed in `zh-Hant-TW` switches to `de` / `zh-Hans`, a fresh load of the manifest `start_url` opens `/de/driver` / `/zh-Hans/driver`; offline launch shows the offline shell in the last-used language. Real devices: NUD-105.)

---

**Implementation notes**
- Fix: all manifests now have the locale-neutral `start_url` `/driver?source=pwa` (`DRIVER_LAUNCH_PATH` in `src/lib/pwa.ts`); `id` `/driver` and `scope` `/` unchanged. The per-locale manifests stay (localized `name` / `short_name` / `description` / `lang`), only `start_url` is now identical.
- Redirect: `proxy.ts` already redirected unprefixed paths; the rule moved into the pure `localeRedirectPath` (`src/lib/locale-redirect.ts`: session locale -> `NEXT_LOCALE` cookie -> Accept-Language -> `de`, path and query kept) and the redirect now carries `Cache-Control: no-store` and `Vary: Cookie, Accept-Language`. The session locale is current because the language switcher updates the JWT (`updateSession`) and the cookie. Not logged in: `/driver?source=pwa` -> `/<cookie locale>/driver?source=pwa` -> driver login in that language.
- Service worker: `/driver` (exact) counts as a driver navigation (`isDriverLaunchPath`): network only, nothing stored (e2e: no `/driver` or `/<locale>/driver` entry in Cache Storage after launches). Offline, the generic `offline.html` is answered under the URL `/driver`; its script reads the `NEXT_LOCALE` cookie (else `de`) and replaces the location with `/<locale>/driver`, which the worker answers with that locale's offline shell. No new precache entry, no change to the shell.
- Tests: unit `locale-redirect.test.ts` (rules), `pwa.test.ts` (same `start_url`, stable `id` / `scope`), `sw/rules.test.ts`, `offline-page.test.ts`; e2e `pwa.spec.ts` (19 tests, mobile): manifests, redirect headers (307, `no-store`, Accept-Language / cookie), unauthenticated launch lands on the login in the cookie language, driver zh-Hant-TW -> de -> zh-Hans launches into the current language, offline launch in the last-used language (de, then zh-Hant-HK), `getInstallabilityErrors` empty. Docs: `docs/offline.md` (new section), `docs/uat.md` (known-limit row for NUD-106 removed).
- Verified: lint, typecheck, `i18n:check`, vitest without DB (all passed) and the DB tests `admin-password` / `locale`, production build, e2e mobile `pwa` (19), `driver-language-picker`, `shells`, `driver-offline` (29 passed).
- NOT verified: real installation and launch on Android / iOS (NUD-105); the full DB integration suite was not rerun (no DB code touched); desktop Playwright project. Already installed apps keep their old `/<locale>/driver` start URL until the browser refreshes the manifest (Chrome/Android does it by itself, otherwise reinstall); iOS before 16.4 ignores the manifest `start_url` (starts on the page open at "Add to Home Screen") and needs a reinstall as well.

---

#### NUD-107 · 👤 Real-device offline check (dead spot, photos, logout)
**Status:** todo · **depends_on:** 081

**Goal:** confirm on real phones what the sandbox could only simulate.

**Scope**: on Android (Chrome, installed PWA) and iPhone (Safari, home-screen app): load the tour online, check "Offline bereit ✓", switch to airplane mode, open list, stops and photos, cold-start the app offline, come back online, log out and check that no tour is shown offline afterwards. Check the R2 CORS rule allows `GET` (photos count "n von m" otherwise).

**Acceptance criteria**
- [ ] All steps pass on one Android and one iOS device; findings written under the ticket.

---

#### NUD-108 · Map view offline (tiles)
**Status:** done · **depends_on:** 081

**Goal:** the list / map toggle must not show an empty map in a dead spot.

**Scope**: decide between hiding the map offline with a hint, or caching the tiles of the tour's bounding box at low zoom levels (respect the tile provider's terms).

**Acceptance criteria**
- [x] Offline the map view shows either tiles or a clear localized hint, never a blank map. (Offline: plain background + notice + markers + route, e2e de + zh-Hans in the production build incl. the offline shell; opt-in tile cache implemented but only unit-tested.)

**Implementation notes (NUD-108)**
- Decision: **no tile pre-caching** (providers' terms, OSM policy explicitly). `TourMap` (driver map and admin tour map) now degrades: `useOnline()` false, or 4 tile errors in a row without a loaded tile, removes the `TileLayer` (no broken-tile grid, no request storm), sets a plain neutral background (`.nudel-map-plain`, faint grid) and shows a `role="status"` notice above the map with WiFi-off + map-pin-off icons: "Kartenhintergrund offline nicht verfügbar" / "离线时无法显示地图背景" (Hant generated); when online but tiles fail: "Kartenhintergrund nicht verfügbar". New messages `maps.*` (de, zh-Hans, i18n:build, route hint). Stops (numbered), depot marker and route polyline stay, map still pans/zooms, tooltips work; the tile layer returns when the connection is back (`data-tiles="ok|unavailable"` on `tour-map`).
- Opt-in `MAP_TILE_CACHE=1` (default OFF; needs explicit `MAP_TILE_URL`; read at build time by `scripts/build-pwa.ts` -> `__TILE_CACHE_URL__`, and at start time for the page / CSP): the worker cache-first caches only tiles that were requested (no prefetch), CORS 200 answers only (tile layer uses `crossOrigin` then; opaque responses are padded heavily in the storage quota), LRU 300, 7 days (`src/sw/tile-cache.ts`, `rules.ts#tileUrlPattern`). CSP `connect-src` gets the tile host only with the flag (worker fetches are checked against it). Provider-terms caveat in `docs/env.md` and `docs/offline.md`; `.env.example` updated.
- Tests: `tour-map.test.tsx` (4 locales offline, tile-error fallback), `tile-cache.test.ts`, `rules.test.ts`, `map-config.test.ts`, `security-headers.test.ts`, e2e `driver-map-offline.spec.ts` (mobile, production build, tiles stubbed: online tiles -> offline notice + 4 markers + 1 route path + no tile images + no tile requests, reload offline = offline shell, axe serious/critical clean in de + zh-Hans, back online tiles return). 375 px screenshot viewed.
- NOT verified: the opt-in cache against a real provider (CORS, quota) or in a built worker (only its pure logic is unit-tested; the default build has it off); real phones (-> NUD-107); admin tour map offline (same component, no e2e); 130 % font scale of the new notice (wraps, not measured). Pre-existing: `auth.integration.test.ts` "applies the limit to unknown usernames" fails in the full run and in its file, passes alone with `-t`.
- Found: markers of the driver map only show the customer name as a tooltip; there is no tap-to-open-detail (the ticket text assumed it) -> NUD-119.

#### NUD-109 · 👤 Real-device check of the offline mutation queue
**Status:** todo · **depends_on:** 082

**Goal:** confirm on real phones what the sandbox could not: Background Sync (Android Chrome), queued taps through a real dead spot, logout with unsent taps (they stay and are sent after the next login), Safari / iOS behaviour (page triggers only), a re-release by the office while the phone is offline (notice).

**Acceptance criteria**
- [ ] Android Chrome: tap "Delivered" in flight mode, close the app, leave flight mode: the stop shows up in the admin view without opening the app.
- [ ] iOS Safari / installed PWA: taps queued offline are sent when the app is opened again.
- [ ] Logging out with a badge > 0 and back in sends the taps.


#### NUD-110 · Nonce-based script CSP (drop `'unsafe-inline'` for scripts)
**Status:** done · **depends_on:** 093

**Goal:** `script-src` without `'unsafe-inline'`. NUD-093 keeps it because Next.js streams inline hydration scripts and cache components / PPR prebuilt shells cannot carry a per-request nonce. Options to evaluate: nonce via `src/proxy.ts` for dynamic routes only (login, admin, driver are behind login anyway) with the public shells served nonce-less from a stricter route group, or waiting for Next.js support. Report-only first (`CSP_REPORT_ONLY`), then enforcing.

**Acceptance criteria**
- [x] Decision recorded (ADR or decision log) on how nonces fit `cacheComponents` / PPR. (`docs/deploy.md` section 11.1a + decision log below.)
- [x] Production policy has no `'unsafe-inline'` in `script-src`; the e2e suites and `security-headers.spec.ts` pass without CSP violations. (Desktop project, production build: whole suite first with `CSP_REPORT_ONLY=true` (0 `[csp-violation]` lines), then enforcing (0 lines apart from the 2 produced on purpose by the injection test); `sentry-ingest` 3/3 with a DSN build. The mobile project was not run.)

**Implementation notes**
- **Investigation (Next 16.4.2, Turbopack, `cacheComponents` + `partialPrefetching`; measured on the production build, not only read from docs):** (a) per-request nonce: the Next docs say PPR is incompatible ("static shell scripts won't have access to the nonce"). True for the prebuilt part, but a nonce in the CSP *request* header IS applied to every inline script rendered per request, including the resume part of a PPR page (bootstrap, flight data, `$RC` Suspense scripts). The prebuilt part of a PPR shell has exactly **two** inline scripts, a fixed `requestAnimationFrame(...)` line and the Turbopack chunk list `id="_R_"` (identical on all 147 prerendered pages of a build); the fully static pages (`/<locale>` home, `/<locale>/driver/offline-shell`, `_not-found`, `_global-error`) additionally have their flight data inline (`self.__next_f.push`). A static page is served prerendered even if the request carries a nonce. (b) `experimental.sri` is **not usable**: the integrity manifest comes from the webpack plugin only (`build/webpack/plugins/subresource-integrity-plugin.js`), nothing on Turbopack, and SRI covers `<script src>`, not inline scripts. (c) `'strict-dynamic'`: unnecessary, `'self'` already covers the chunk files. => **Feasible as a hybrid**: nonce for what is rendered per request + SHA-256 hashes for the fixed inline scripts of the prebuilt documents.
- **Policy** (`src/lib/security-headers.ts`): pages get `script-src 'self' 'nonce-<16 random bytes, base64, per response>' 'sha256-...'` (hashes of the locale-less documents + the request's locale, ~2 KB of header); API routes, `/_next`, files, `sw.js` get `script-src 'self'`. Development keeps `'unsafe-inline' 'unsafe-eval'` (HMR) and no nonce. Nonce / hash values are validated before they go into a header (throws on anything but base64 / `shaNNN-base64`). `style-src` is unchanged (`'unsafe-inline'`, Leaflet).
- **`src/proxy.ts`** builds the policy for every page response (redirects too), sets it on the request (Next.js reads the nonce from there; `Content-Security-Policy-Report-Only` works the same, so `CSP_REPORT_ONLY` keeps working per request) and on the response. `next.config.ts` now sets the CSP only for the complement of the proxy matcher (`/:path((?:api|_next|_vercel).*|.*\\..*)`) so no page gets two policies; the other security headers stay on `/:path*`.
- **Getting the hashes into the proxy** (the hashes exist only after `next build`, the proxy is bundled before): `pnpm build` / `build:vercel` now run `scripts/csp-script-hashes.ts reset` -> `next build` -> `write` -> `next build` -> `build-pwa` -> `check`. `write` hashes every inline script of `.next/server/app/**/*.html` into the git-ignored `.csp-script-hashes.json` (also the build ID of pass 1: it is inlined in the flight data of static pages, so pass 2 reuses it through `generateBuildId`); `next.config.ts` hands the hashes to the proxy as `process.env.CSP_SCRIPT_HASHES` (inlined at compile time, no file access at run time, nothing to trace on Vercel). `check` fails the build if the final output hashes differ from the embedded ones, if `public/*.html` has an inline script, or if no hashes were found: a deployment cannot ship a policy that does not match its pages. Cost: build time +about 15 s here (35 s total). First attempt without build-ID pinning failed `check` (build ID differs between passes), which is how that dependency was found.
- **Offline page:** `public/offline.html` had an inline script and an `onclick` attribute; the script is now `public/offline.js` (generated by `build-pwa.ts`, precached, `no-cache` header), the reload button uses `data-reload`. `pwa.spec.ts` / `driver-offline.spec.ts` allow and require `/offline.js` in the precache.
- **Tests:** unit `security-headers.test.ts` (no unsafe-inline / eval / strict-dynamic / wildcard for any env, nonce+hash rendering, validation against header injection, report-only, dev), `src/proxy.test.ts` (nonce differs per response incl. redirects, hashes of the request's locale only, request header = response header, report-only, dev; `vitest.config.ts` inlines `next-intl` for it), `scripts/lib/csp-hash-build.test.ts` (inline script extraction, hash, manifest per locale), `offline-page.test.ts`. e2e `security-headers.spec.ts` (production build only, skipped on `pnpm dev`): `script-src` of pages has a nonce and no `'unsafe-inline'`; a new nonce per response; **every inline script of five pages (login x2 locales, static home, offline shell, 404) is covered by the nonce or a hash**; API / files / offline page are `'self'` only; an injected inline `<script>` and an `onerror` handler are blocked (this test produces 2 `[csp-violation]` log lines on purpose); admin login works under the strict policy. Full desktop e2e run twice (report-only, then enforcing) and `sentry-ingest` with a DSN build: see criteria.
- **Performance:** Lighthouse CI (3 runs, driver home, same setup as NUD-095/098, enforcing production build): LCP 1.1 / 1.3 / 1.5 s (NUD-098: 1.14-1.16 s; the sandbox is noisy, budget < 2.5 s), CLS 0.015-0.042, TBT 10-20 ms. The shells are still prerendered and streamed (`x-nextjs-postponed`); the proxy already ran for every page, it now also creates a nonce and a header string. The Playwright LCP test (`driver-performance`) passes.
- **Service worker / offline shell:** the precached `/<locale>/driver/offline-shell` documents are fully static, covered by hashes, and keep the CSP header they were fetched with (a Cache Storage response keeps its headers); `driver-offline`, `driver-a11y` (offline shell + generic offline page in 4 locales x light/dark), `pwa` pass enforcing.
- **Found on the way (test only):** `src/server/auth/auth.integration.test.ts` "applies the limit to unknown usernames too ..." failed in a full-file run and passed with `-t`: the rate limit counts attempts newer than `now - 15 min` without an upper bound, earlier tests in the file log in with the real clock, and the test used fixed dates (`2026-10-17..19`) that are in the past since 2026-10-18 08:00 UTC, so those attempts looked recent. Not a product bug (production `now` is the real clock). Fixed in the test by using days in the future (`futureDay(n)`).
- Pre-existing, not changed: `/de/<unknown>` answers HTTP 200 for the not-found page (seen before and after this ticket); `admin-password.integration.test.ts` throws "Invalid URL" in a run without `DATABASE_URL` (the other integration files skip).
- Not verified: real browsers other than Chromium (Playwright desktop project only; no mobile project, no Safari / iOS, no installed PWA), Vercel (do the proxy headers apply to the static `/de` page on the CDN; does `build:vercel` converge with Vercel's deployment-ID handling: `check` would fail the build, not ship a broken policy; Sentry source-map upload in both passes), a Next.js / React upgrade. Rollout and checks on the real deployment: NUD-120.
- Follow-ups: NUD-120. `style-src 'unsafe-inline'` (Leaflet) is untouched; not ticketed (low value: style injection cannot run code, and the same nonce / hash approach would be needed).

#### NUD-111 · Audit log retention job
**Status:** done · **depends_on:** 093

**Goal:** implement the design in `docs/privacy.md` section 7: a cron route (`CRON_SECRET`) that deletes `AuditLog` rows older than the agreed period (proposal 24 months) as the only delete path, lifting the append-only trigger deliberately (`SET LOCAL app.audit_retention = 'on'` honoured by the trigger function, new migration), with tests that ordinary deletes still fail. Needs the client's decision on the period.

**Acceptance criteria**
- [x] Rows older than the period are deleted by the job and by nothing else; `UPDATE` / `DELETE` from the app or a hand-written statement still fail.
- [x] `docs/privacy.md` states the final period; the coverage scan in `audit-coverage.test.ts` still passes.

**Implementation notes**
- Migration `20261018130000_audit_log_retention` replaces the function `audit_log_append_only()` with `CREATE OR REPLACE` (the existing trigger keeps pointing at it, so it applies to a fresh and an existing database alike). `DELETE` is allowed only when `current_setting('nudel.audit_retention', true) = 'on'` AND `OLD."createdAt"` is older than 90 days by the database clock (`timezone('UTC', now())`); otherwise it raises. `UPDATE` is refused always. So the application cannot delete recent rows even with the switch on.
- `src/server/audit-retention.ts`: `auditRetentionDays()` (`AUDIT_RETENTION_DAYS`, default 730, 90..36500, anything else falls back to 730) and `purgeExpiredAuditEntries({db})`: batches of 1000 rows (`DELETE ... WHERE id IN (SELECT ... ORDER BY createdAt LIMIT n)`), each in its own transaction that first runs `set_config('nudel.audit_retention','on', true)` (transaction-local), at most 20 batches per run (`more: true` if the limit was hit). A period below 90 is refused with an error (not clamped). Returns `{retentionDays, cutoff, deleted, batches, more}`.
- Route `GET /api/cron/audit-retention` (`audit-retention-cron.ts`, bearer `CRON_SECRET`, 401 without a configured secret, 503 `{status:"error"}` on failure without leaking the message), daily 03:37 UTC in `vercel.json`; one log line `[audit-retention] {counts}`; the run is not written to the audit log. Added to the authz matrix (`SECRET_ONLY` row and the cron-secret test), `docs/privacy.md` (section 7 rewritten: 730 days, enforcement, table row, operator list), `docs/runbook.md` (new subsection under section 10), `docs/env.md`, `docs/deploy.md`, `.env.example`, `AGENTS.md`.
- `audit-coverage.test.ts`: the scan now allows `DELETE FROM "AuditLog"` in exactly one file (`server/audit-retention.ts`, which must contain the `set_config(... 'on', true)` switch); `UPDATE`/`TRUNCATE`/`auditLog.update*|delete*` stay forbidden everywhere.
- Tests: unit `audit-retention.test.ts` (days parsing and fallbacks, floor refusal, batching, `more`, route 401/200/503, log line), integration `audit-retention.integration.test.ts` on embedded Postgres (old rows deleted, younger kept, shorter period down to the floor, batching across runs, recent rows survive a forced `DELETE` with the switch on incl. 89-day-old rows, plain `DELETE`/`UPDATE` fail with and without the switch, floor refusal); `audit.integration.test.ts` append-only test unchanged and green. Full unit suite, all 36 integration files, lint, typecheck, `i18n:check`, `pnpm build` and `db:seed --demo` (fresh DB, twice) pass.
- Not verified: the cron on Vercel/Neon (no production), `prisma migrate deploy` itself (engine download blocked; migrations were applied by the test helper, which executes the SQL files in order), timing of a very large backlog. The 730-day period is a proposal until the client confirms it (`AUDIT_RETENTION_DAYS`, no code change).
- `src/server/admin-password.integration.test.ts` fails when `DATABASE_URL` is unset (no `skipIf`), unrelated to this ticket; it passes in the integration runs.

#### NUD-112 · Retention for orders, tours, stops and driver problem texts
**Status:** done (implemented scope; the periods and whole-order retention need the client, see the open questions in section 10) · **depends_on:** 093

**Goal:** decide with the client (data protection advisor) how long delivered orders / tours / driver problem texts are kept (proposal: 3 years) and implement the deletion or anonymisation (driver free text first), plus a short runbook for access / erasure requests (find and remove a person's name in notes, photos, screenshots).

**Acceptance criteria**
- [x] Analysis of what is personal data in orders, tours, stops and driver texts, and the period for driver texts (365 days, a proposal until the client confirms) written into `docs/privacy.md` section 6 and the retention table in section 2.
- [x] Cron job with test; history views cope with removed texts (planning view tested; the notes are optional in every view).
- [ ] Client confirms the driver text period and decides on whole-order / tour retention (not a code task; section 10).

**Implementation notes**
- Analysis (`docs/privacy.md` section 6): orders, tours and stops hold no personal data of their own beyond user ids (creator, driver) and two free-text fields (`Order.internalNote`, `Stop.problemNote`); customers are businesses. Deleting or anonymising whole orders / tours is neither needed for data protection nor safe without the client (disputes, accounting, backlog 4.3 "never hard-delete business data", a missing stop would falsify a completed tour). So **nothing in orders, tours or stops is deleted**, and no `ORDER_RETENTION_DAYS` exists; that is the open question in section 10.
- `src/server/data-retention.ts`: `scrubExpiredDriverTexts({db, mode, retentionDays})` sets only `Stop.problemNote` to NULL (`Prisma.DbNull`) on stops with `completedAt` older than `DRIVER_TEXT_RETENTION_DAYS` (default 365; 30..3650; invalid / out-of-range falls back to 365; below 30 refused in code, not clamped). `DATA_RETENTION_MODE`: `dry-run` (default, also for unknown values; counts only), `delete`, `off`. Batches of 500 (findMany then `updateMany` repeating the condition, so a stop changed in between is not touched), at most 20 batches per run, `more` flag, idempotent. Report `{mode, retentionDays, cutoff, expired, scrubbed, batches, more}`, counts only.
- Reason, status, `completedAt`, items, tour, orders and customers stay. The whole `LocalizedText` goes (original, German translation, pending marker). A note still pending translation is scrubbed too; `stopProblemNoteSource.find` no longer returns it and a late `save` is a no-op (tested), so the text cannot come back. The planning view and the problem-note component already treat a missing note as none (`getTourPlan` tested before / after).
- Route `GET /api/cron/data-retention` (`data-retention-cron.ts`, bearer `CRON_SECRET`, 401 without configured secret, 503 `{status:"error"}` without the message), daily 03:47 UTC in `vercel.json`, one log line `[data-retention] {counts}`. Authz matrix (`SECRET_ONLY` row + cron-secret test), `docs/privacy.md` (sections 2, 3, 6), `docs/runbook.md` (section 10: job, switching it on, "Access and erasure requests" with find / edit / SQL steps for notes, driver texts, screenshots, photos, accounts), `docs/env.md`, `docs/deploy.md`, `.env.example`, `AGENTS.md`.
- Audit: the job is exempt in `audit-coverage.test.ts` with a reason (system job without actor; `AuditLog` needs a user id and a per-record entity from a closed vocabulary; precedent screenshot / audit retention) instead of an aggregate audit entry. The integration test proves that nothing but `problemNote` changes.
- Tests: unit `data-retention.test.ts` (env parsing, floor, dry-run / off / delete, batching, `more`, route 401 / 200 / 503, counts-only response); integration `data-retention.integration.test.ts` on embedded Postgres (dry-run changes nothing, old scrubbed / recent kept / DELIVERED and PENDING stops untouched, all other stop columns identical, pending notes and the retry job, idempotent, batch limit and continuation, longer period, planning view). Lint, typecheck, `i18n:check`, 106 unit files (1182 tests), all 37 integration files (422 tests, backup test skipped without its env), `pnpm build` (via `~/b110.sh`) pass.
- Known gap, ticket NUD-121: the `stop.problem` audit entry carries the note cut to 200 characters until the audit retention (730 days) deletes it, i.e. up to a year longer than the stop's own text.
- Not verified: the cron on Vercel / Neon (no production), `prisma migrate deploy` (no migration in this ticket), behaviour with a very large backlog. No UI change, so no e2e run.

#### NUD-113 · 👤 Verify security configuration on the real deployment
**Status:** todo · **depends_on:** 007, 093

**Goal:** things NUD-093 could not check without production: (1) `curl -sI https://<prod>/de/login` shows the headers of `docs/deploy.md` section 11.1 and the page works in a real Android Chrome and iOS Safari (map tiles, photos, upload, PWA install) with no `csp-violation` lines in the Vercel logs; (2) `scripts/check-storage-private.ts` against the production R2 bucket exits 0; (3) lifecycle rule for `screenshots/` (190 days) created; (4) `CRON_SECRET` set and `GET /api/cron/retention` run once by hand (counts in the answer); (5) data processing agreements and the "to confirm" items in `docs/privacy.md` section 1 and 4 (Vercel, Neon, Cloudflare, DeepL Pro, ORS, tile provider) settled.

**Acceptance criteria**
- [ ] Items 1-4 verified and the result noted under the ticket.
- [ ] Item 5 confirmed by the operator.

---

#### NUD-114 · 👤 Set up and verify monitoring and backups on the real accounts
**Status:** todo · **depends_on:** 007, 094

**Goal:** the parts of NUD-094 that need real accounts, in the order of `docs/runbook.md` section 13: (1) Sentry EU project, `SENTRY_DSN` (+ token variables), redeploy, run the test error (runbook section 7) and add an e-mail alert; (2) uptime monitor for `/api/health`; (3) backup bucket, token, `backup_reader` role, GitHub environment `backup` (`docs/deploy.md` section 13.1), run the workflow once and confirm both jobs are green and the failure e-mail arrives; (4) one real restore drill (runbook section 5.4); (5) write the real Neon restore window into runbook section 4; (6) read the first orphan-cleanup dry-run reports and decide on `ORPHAN_CLEANUP_MODE=delete`; (7) confirm `postgresql-client-16` installs in CI.

**Acceptance criteria**
- [ ] Items 1-5 and 7 verified and the result noted under the ticket.
- [ ] Item 6 decided by the operator.

---

#### NUD-115 · 👤 Real-device usability check of the driver app
**Status:** todo · **depends_on:** 095

**Goal:** what NUD-095 could only emulate, checked on real phones.

**Scope**
- Android with system font size at the largest setting and display size large; one iPhone.
- TalkBack / VoiceOver through login, tour, stop, problem sheet.
- Dark mode, bright sunlight, one-hand use while walking (primary actions reachable with the thumb).
- Slow connection or low-end Android: first load and driver home speed.
- A person who does not read the chosen language completes a stop from icons, numbers and photos.

**Acceptance criteria**
- [ ] Findings noted under the ticket; blocking ones became tickets.

---

#### NUD-116 · Warn on the order form when the delivery day's tour is already completed
**Status:** todo · **depends_on:** 099

**Goal:** the office learns about a late order while typing it, not only after saving (NUD-099 reports it in the overview, on the dashboard and on the planning page).

**Scope**
- Next to the existing "combined into one stop" / "pin unconfirmed" warnings (`orderWarnings`), show "the tour of this day is already completed, this order needs a follow-up tour" for a CONFIRMED order on a day whose tours are all COMPLETED. Needs a small admin read (or an extension of `confirmedOrderCountAction`'s result) and an authz test / matrix row if it is a new action.

**Acceptance criteria**
- [ ] The warning shows while entering and editing such an order (e2e), nothing changes for other days.

---

#### NUD-117 · Deliver quantity changes on already delivered stops (correction stop)
**Status:** todo · **depends_on:** 099

**Goal:** an order that was already delivered and is increased afterwards (NUD-099 only reports it as a conflict note) can be delivered with one action.

**Scope**
- Decide with the office: "Create correction": a follow-up stop for the difference (new quantity minus delivered quantity) instead of asking the office to enter a second order. Keep audit entries and the "never reset delivered stops" rule (NUD-043); decrease / cancel stays a note (goods cannot be un-delivered).

**Acceptance criteria**
- [ ] An increase of a delivered order can be put on a follow-up tour with exactly the difference (integration + e2e); decreases are reported only.

---

#### NUD-118 · Driver app with two tours on one day (offline cache, hint, real device)
**Status:** todo · **depends_on:** 099, 081

**Goal:** check and, where needed, fix what NUD-099 only covered on the server: a driver who finished tour 1 and receives a follow-up tour the same day.

**Scope**
- Offline cache and service worker: does the cached "today" payload / photos switch from the completed to the released follow-up tour without a manual reload (also while offline-queued taps exist)?
- Home screen: show that this is a second tour ("Tour 2") or at least the new tour's stops clearly; the "tour finished" screen must not hide a newly released follow-up.
- Real-device check (extends NUD-107).

**Acceptance criteria**
- [ ] Driver with a warm cache sees the released follow-up tour after the next sync / focus, without logging out (e2e with the offline helpers); findings of the real-device check noted.

#### NUD-119 · Driver map: tap on a marker opens the stop detail
**Status:** todo · **depends_on:** 081

**Goal:** on the driver's map view a tap on a numbered marker leads to the stop screen (also offline, via the offline shell), as the driver expects from the list.

**Scope**: marker click / keyboard activation navigates to `/driver/stops/<id>` (tooltip with the customer name stays on hover / first tap or a small popup with a "Details" link, simplest that stays usable with 48 px targets); works in the offline shell.

**Acceptance criteria**
- [ ] Tapping a marker reaches the stop detail online and offline (e2e, 375 px); axe stays clean.

#### NUD-120 · 👤 Roll out the strict script CSP on the real deployment (report-only first)
**Status:** todo · **depends_on:** 110, 113

**Goal:** NUD-110 was verified with Chromium against a local production build only. On the real deployment: (1) deploy first with `CSP_REPORT_ONLY=true`, use the app in real Android Chrome and iOS Safari (login, admin pages, maps, photo upload, driver tour, install the PWA, go offline) and search the Vercel logs for `csp-violation` (expected: none); (2) `curl -sI https://<prod>/de/login` shows `script-src 'self' 'nonce-...' 'sha256-...'` without `'unsafe-inline'`, and a second request shows a different nonce; same for the static `/de`; (3) check the build log of `pnpm build:vercel` for `csp-script-hashes: OK`; (4) remove `CSP_REPORT_ONLY`, redeploy, repeat the smoke test.

**Acceptance criteria**
- [ ] No `csp-violation` lines in report-only on the real devices; the installed PWA works offline (offline shell, generic offline page).
- [ ] Enforcing policy deployed, results noted under the ticket.

---

#### NUD-121 · Driver problem text is also copied into the audit log
**Status:** todo · **depends_on:** 112

**Goal:** `stop.problem` audit entries store the driver's note (cut to 200 characters) in `diff.note`, so the text outlives the stop's own text (NUD-112, 365 days) by up to a year (audit retention 730 days) and cannot be edited because the log is append-only. Decide with the client: store only `hasNote: true` (and the length) in new entries, or align `AUDIT_RETENTION_DAYS` with `DRIVER_TEXT_RETENTION_DAYS`. Check the history views and tests that read `diff.note`; older entries are not changed (the trigger forbids it) and expire with the retention.

**Acceptance criteria**
- [ ] New `stop.problem` entries contain no driver free text (or the client chose the alignment of periods); history view still shows reason and status; `docs/privacy.md` section 6 "Known gap" updated.

### M2.5 — Owner pre-deploy fixes (NUD-122…127)

Requested by the owner before the first deployment (T6 below). Work them **in order, one ticket per session**; NUD-127 must not start before NUD-122…126 are `done`.

---

#### NUD-122 · Photo upload works on the office and driver path
**Status:** done · **depends_on:** –

**Goal:** an uploaded customer photo must end as a `Photo` row that points at an object which really exists in S3/MinIO — on the office path (`src/components/admin/customer-photo-slots.tsx` → `addCustomerPhoto`) **and** on the driver path (`src/components/driver/driver-photo-slot.tsx` → `src/lib/offline/photo-outbox-flush.ts`). Today the bytes arrive in the bucket (one local MinIO holds 111 `customers/<uuid>.jpg` objects with exactly the key shape `/api/uploads` issues) while `Photo` has **zero** `.jpg` rows: `attachCustomerPhoto` (`src/server/customer-photos.ts:68-69`) gates the whole write on `storage.head()` and, when that returns `null`, aborts as `object_missing` — while the UI still reports success. Prime mechanism for the `null`: `getStorage()` (`src/server/storage/index.ts:16-32`) caches **one** instance for the process lifetime and only refuses to fall back to the in-memory `FakeStorage` in production (`fake.ts:17` issues `fake://upload/<key>`, which `head()` can never find).

**Scope**
- Reproduce in a real browser first (office **and** driver), record which storage implementation the server resolved and why `head()` fails; fix that cause — do not paper over it in the UI and do not relax the security posture.
- Office and driver are **two separate code paths** and two separate fixes; a permanently failing outbox entry must not be retried forever (`photo-outbox-flush.ts:132` returns failure `server` and retries without limit, so the driver sees `Wartet auf Versand` forever).
- Close the test gap: `src/lib/upload-image.test.ts` does not exist (the client upload path is untested; `image-uploader.test.tsx` mocks `@/lib/upload-image` away, `driver-photo-slot.test.tsx` mocks `resizeImage`/`enqueuePhoto`, `uploads.test.ts` and the photo integration tests use `FakeStorage`, `tests/e2e/uploads.spec.ts` never PUTs), and `tests/e2e/customer-photos.spec.ts:80` skips itself when `S3_*` is missing — in CI the e2e job has no MinIO service and no `S3_*`, so the only real browser upload never runs.

**Acceptance criteria**
- [x] Office: uploading a STORE and a PARKING photo in `pnpm dev` creates a current `Photo` row per kind whose `storageKey` exists in the bucket; a reload serves the signed URL and the image decodes.
- [x] Driver: a captured photo leaves `Wartet auf Versand` and becomes `Gesendet`, with the same `Photo` row result.
- [x] Storage failure is never reported as success: `/api/uploads` never returns a non-`http(s)` upload URL, and the client treats one as `UPLOAD_FAILED`.
- [x] A permanently failing outbox entry stops retrying and is visible to the driver (notice + the slot offers the photo again); transient/network failures still retry without limit.
- [x] `src/lib/upload-image.test.ts` covers resize, grant (401/403/413/other/network), PUT (2xx/4xx/error/abort/progress) and rejects a `fake://` grant; the unit suite and `pnpm i18n:check` stay green.
- [x] `tests/e2e/customer-photos.spec.ts` fails loudly instead of skipping when `S3_*` is absent; the CI e2e job gets a MinIO service + bucket step so the real PUT/attach path runs.
- [x] No new route handler or server action was needed (the existing `/api/uploads` row in `authz-matrix.test.ts` still covers the route); the matrix test stays green.

**Implementation notes**
- **Reproduction (real browser, Playwright + local MinIO, `pnpm dev` on port 3100).** Office path (`/de/admin/customers/<id>`, `setInputFiles`): `POST /api/uploads` → real presigned URL → `PUT` to MinIO **200** → server action **200** → one `Photo` row (`customers/<uuid>.jpg`, bytes 7449, `isCurrent`) → `HEAD` exists → the slot shows the image. Driver path (own released tour for today, `fahrer-de`): capture → `Pending` badge → **within 2.5 s** `POST /api/driver/photos` `{"outcome":"applied"}` → badge `Gesendet` → `Photo` row with `clientMutationId`. Both paths therefore **work** in the current environment.
- **The reported defect that did reproduce** is the driver outbox: with the storage `PUT` forced to `403` (expired signature / CORS / wrong bucket), the slot stayed on `Wartet auf Versand` for **60+ s across 5 silent retries**, with no error and no notice — the owner's symptom exactly. `photo-outbox-flush.ts` classified every non-ok PUT as failure `server`, which the controller retries with backoff forever.
- **Why the "111 objects, 0 `.jpg` rows" evidence is not a broken office path.** The 40 seeded photos are `.png` and *do* have rows; the 111 `.jpg` objects correlate with e2e runs whose spec deletes its test customer in `finally` (cascade deletes the `Photo` row, leaves the object) — the orphan-cleanup job exists for exactly those. Byte-level: a fresh office upload creates a row every time.
- **Fix (driver):** an *answered* error (rejected `PUT`, failing grant, non-ok register answer) is now counted per entry (`httpFailures`); after `MAX_HTTP_FAILURES = 3` the photo is dropped and an `upload_failed` notice appears ("… Das Foto konnte nicht hochgeladen werden. Bitte neu aufnehmen.", de + zh-Hans + generated Hant), the waiting badge disappears and the slot shows the placeholder again so the driver can retake it. A *network* failure (offline) still retries without limit — offline must never cost a photo (D17). Verified end to end: 3 intercepted PUTs, then the notice, queue empty, no `Photo` row, 12.8 s total.
- **Fix (storage configuration):** `POST /api/uploads` returns `503 STORAGE_UNAVAILABLE` when the storage cannot produce a URL a browser can PUT to, and `requestUploadGrant` rejects a non-`http(s)` upload URL as `UPLOAD_FAILED`; `getStorage()` re-reads the environment and no longer pins a fallback `FakeStorage` for the whole process lifetime. A `fake://upload/...` grant is the half-success that made the UI look alive while nothing was stored.
- **Tests:** new `src/lib/upload-image.test.ts` (10 tests: decode/scale/HEIC/JPEG encode, grant status mapping, dead network, abort, rejected `fake://` grant, end-to-end `uploadImage` with a fake XHR); three new cases in `photo-outbox-controller.test.ts` (notice after 3 answered failures, unlimited retry while offline, a `fake://` grant counted but never PUT to); `uploads.test.ts` now uses a *usable* fake target and has a case asserting the 503; `customer-photos.spec.ts` throws instead of skipping (explicit opt-out `ALLOW_MISSING_S3=1`) and the CI e2e job starts MinIO and creates the bucket.
- **Surprises / follow-ups:** the local `pnpm` on PATH is broken (the managed-version shim is incomplete); `corepack pnpm …` works. The CI workflow change is written but cannot be executed here (no GitHub runner). `tests/e2e/driver-photo.spec.ts` already covers the driver path against real storage but needs a production build; a case for the rejected-PUT → notice flow there would be the natural next hardening step (the unit test covers it today).

---

#### NUD-123 · Add driver / customer / order through the GUI
**Status:** done · **depends_on:** –

**Goal:** adding a driver ("Neuer Fahrer"), a customer ("Neuer Kunde"; there is no separate restaurant entity — restaurants are `Kunde`/`Kunden`) and an order ("Neue Bestellung") must each create the record through the GUI. The likely shared suspect is the redesigned Select/Combobox (one broken Select breaks all three forms at once), but `product-form.tsx:141` looks correct — **reproduce it in a real browser first and diagnose from the observed failure; do not guess.**

**Outcome:** all three flows **work**; the report could not be reproduced. The only verified defect in this area was the *coverage*: the redesign's plural unit labels left the add-order e2e assertions red (NUD-128 covers the sibling specs).

**Acceptance criteria**
- [x] Each flow has a browser reproduction with screenshot + console/network evidence recorded under the ticket before any fix (see notes; no fix was needed).
- [x] Driver create: a new `DRIVER` user with username + 6-digit PIN exists and can log in (DB row `{role: DRIVER, active: true}`, PIN shown once, `drivers.spec.ts` logs in with it).
- [x] Customer create: the record is saved with a confirmed pin (`{pinConfirmed: true}` in the DB, `customer-form.spec.ts` green).
- [x] Order create: the order with its items is saved and appears in the overview (`CONFIRMED` + 1 `OrderItem`, the form navigates to the list; `orders.spec.ts` green after the assertion realignment).
- [x] The e2e coverage of the add-order form is green again; no new UI text was added (the forms were not broken).
- [x] No new server actions (none were needed), so no new `authz-matrix.test.ts` rows.

**Implementation notes**
- **Reproduction (real browser, Playwright + local dev server on port 3100, seeded demo DB).** *Driver*: `/de/admin/drivers` → `create-driver` → Anzeigename/Benutzername → language control (still a **native `<select>`**, `locale-input`) → submit → PIN sheet (`985505`) → DB row created. *Customer*: `/de/admin/customers` → `new-customer` → fields → `customer-find` → candidate → `pin-confirm` switch → `customer-save` → DB row with `pinConfirmed = true`. *Order*: `/de/admin/orders/new` → the redesigned **Combobox** for the customer (typing "Trattoria" narrows 20+ customers to 12 options, the full name to 1) → product Combobox ("Spaghetti" → 5 options) → quantity `3` → delivery date → `order-save` → navigates to `/de/admin/orders?from=…&to=…` with a `CONFIRMED` order and one `OrderItem`.
- **The "shared broken Select/Combobox" hypothesis is not supported:** the create-driver form uses a native `<select>`, the customer form uses no select at all, and the order form's redesigned `Combobox` filtered, selected and saved correctly. Two of my own first attempts failed for **test-side** reasons and are worth remembering: `getByRole("option")` also matches the admin shell's language-switcher options (a `.first()` click then hangs on a non-actionable item), and the order form needs the delivery date filled before it saves.
- **Real defect found and fixed:** `orders.spec.ts` was red because the redesign replaced the plain unit labels with ICU plurals under `driver.units` (re-design.md §9.3) — `"2,5 Packung"` is now `"2,5 Packungen"`. The add-order save itself always worked (the DB rows were created); only the assertions were stale, which is why a red run looked like "add order is broken". The four expectations are realigned.
- **Not reproduced / to check with the owner:** the flows work from a clean browser profile. A stale service worker from an earlier `pnpm start` (the offline test in `RUN-AND-TEST.md` §7 registers one on `localhost:3100`) can serve a pre-redesign shell and break every form at once — DevTools → Application → Service Workers → Unregister (or a hard reload) is the first thing to try if the failure persists. The exact red error text from the owner's attempt was never available.
- **First-start language picker (checked because `drivers.spec.ts` fails here):** the GUI-created driver is stored with `localeChosen = false` (the create form only sets `locale`), login lands on `/{locale}/driver` and the `(app)` layout guard then redirects to `/{locale}/driver/start`, where the picker renders — verified in a browser (a driver written directly into the DB with `localeChosen = false` also reaches `/driver/start`). The spec fails under `pnpm dev` only because `expect(page).toHaveURL(...)` uses its 5 s default while the redirect chain needs an on-demand Turbopack compile; CI runs a production build (`pnpm start`), and `RUN-AND-TEST.md` §8 documents exactly this dev-mode flakiness. No product change.
- **Gates:** `pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm i18n:check` ok. `pnpm test`: **1790 passed, 4 skipped**, but the run was reported as failed once because the `afterAll` of `admin-password.integration.test.ts` (`DROP DATABASE … WITH (FORCE)`) hit the 10 s default hook timeout — that file passes in isolation (9.7 s), so it is a flaky teardown, ticketed as NUD-130. E2E: `orders.spec.ts` green on desktop (3/3), `customer-form.spec.ts` green on desktop + mobile (4/4), `drivers.spec.ts`: the management test fails only at its 5 s `toHaveURL` for the language picker under `pnpm dev` (see above); the mobile `orders.spec.ts` list-overflow failure is NUD-129.
- **Follow-up:** NUD-128 realigns the same drift in `order-overview.spec.ts` (verified failing) and `order-screenshot.spec.ts`; NUD-129 covers the admin order list's horizontal overflow at 393 px that the mobile project reports.

---

#### NUD-124 · Product list: relabel `PACK` → Beutel, six real products, archive the demo ones
**Status:** todo · **depends_on:** –

**Goal:** the catalog must hold exactly **6** products — *Nudeln* and *Wantan-Teig*, each in *kg* / *Karton* / *Beutel* — replacing the 6 demo products. "Beutel" is the existing `PACK` unit **relabelled** (no Prisma enum change, no fourth unit); `CRATE` = Karton, `KG` = kg. The owner confirmed there are **no real orders** on the demo products (all demo data), so they are retired with the existing `Deaktivieren` soft delete (`active=false`) — products already on an order cannot be hard-deleted (`OrderItem.productId` is `onDelete: Restrict`).

**Scope**
- `messages/de.json` + `messages/zh-Hans.json`: the UI label of `PACK` (and the unit pickers / load sheet / driver quantity views) becomes Beutel + its Chinese counterpart; `zh-Hant-*` generated by `pnpm i18n:build`, never hand-edited.
- `prisma/seed.ts`: the 6 real products with `de` + `zh-Hans` names, units (`KG`, `CRATE`, `PACK`), sort order.
- Migrate the demo data correctly: archive the demo products and, where demo orders exist, move their `OrderItem`s onto the matching new product (orders are transactional history, D19, and are never deleted).
- Check the hard-coded `UNIT_ORDER` (`src/domain/driver-today.ts:3`, `src/domain/load-sheet.ts:9`) and `src/lib/units.ts` follow the relabel rather than a new unit.

**Acceptance criteria**
- [ ] The unit that was `PACK` is labelled Beutel (+ Chinese) everywhere it is shown to the office or the driver; no new enum value, no migration of the `Unit` type.
- [ ] The catalog lists the 6 real products; the 6 demo products are archived and no longer selectable for new orders.
- [ ] Existing demo order items still render and point at a valid product after the migration.
- [ ] `pnpm db:seed` works on a fresh DB and the unit/domain tests pass.
- [ ] New/changed UI text exists in `de` + `zh-Hans`; `pnpm i18n:build` was run.

---

#### NUD-125 · Parking spots: schema + office UI
**Status:** todo · **depends_on:** –

**Goal:** a customer has a **list** of parking spots (new `ParkingSpot` table) instead of today's single `PARKING` photo / single `lat`/`lng` pin. The office manages the list; routing and optimisation keep using the single customer pin (one point per stop, D5).

**Scope**
- Prisma schema + committed migration for `ParkingSpot` (customer, label/note, lat/lng, sortOrder, `active`, timestamps); soft delete only.
- Service layer + server actions (zod, `.max()` on every string, `requireRole`, `rejectCrossOrigin` where it is a route handler) and audit entries in the same transaction (NUD-092).
- Office UI on the customer detail page (add / edit / reorder / remove, first one is the default); new text in `de` + `zh-Hans`.

**Acceptance criteria**
- [ ] Migration is committed and `pnpm db:seed` still works on a fresh DB.
- [ ] The office can create, edit, reorder and deactivate parking spots; every write has an audit entry.
- [ ] Wrong-role access is rejected (authorization test + `authz-matrix.test.ts` rows).
- [ ] `docs/privacy.md` updated if a spot stores free text; screens checked at 1280 px with no horizontal scroll.

---

#### NUD-126 · Parking spots: driver UI, park-first navigation, offline
**Status:** todo · **depends_on:** 125

**Goal:** the driver sees the parking spots of his stop and navigation guides him to the **parking spot first**, with the shop entrance as the secondary target. Routing/optimisation still uses the customer pin.

**Scope**
- Driver stop detail shows the customer's parking spots (label + note); primary action navigates to the chosen spot, secondary action to the entrance.
- `src/lib/navigation.ts:5-12` currently builds Google/Apple Maps URLs from the single customer pin — extend it to take an explicit target point.
- Offline: the parking list is part of the cached tour (NUD-081 pattern); touch targets ≥ 48 px; text in `de` + `zh-Hans`.

**Acceptance criteria**
- [ ] The driver can pick a parking spot and open navigation to it directly; the entrance stays reachable as the secondary target.
- [ ] The parking list is available offline from the cached tour.
- [ ] Routing/optimisation output is unchanged (still one point per stop).
- [ ] Driver screen checked at 375 px, no horizontal scroll; new text in `de` + `zh-Hans`.

---

#### NUD-127 · 👤 Deploy to the vServer (handoff doc)
**Status:** in-progress (the owner asked for it directly on 2026-10-26, ahead of NUD-124…126) · **depends_on:** 122, 123, 124, 125, 126

**Goal:** deploy the app to the vServer following `docs/handoff-vserver-deploy-and-help.md` (T6). **HUMAN ticket.** The document has two deliverables; this ticket now covers **deliverable 1 (the automated deploy)** first, because the owner wants to install the driver PWA from `https://87.106.60.131/delivery-app/de/driver`. Deliverable 2 (`hand-off.html`) becomes its own ticket after the app is live.

**Measured on the server (read-only ssh, 2026-10-26)** — the doc's own "step 0":
- Ubuntu 24.04.3, 2 vCPU, **1855 MB RAM, no swap**, 66 GB free on `/`.
- Node **v22.23.3** ✓; **pnpm missing** (install via corepack); **Docker 29.1.3 present** and already hosting other apps; **nginx 1.24** (no Caddy); **PostgreSQL not installed**; **port 3100 free**, the quiz is on `127.0.0.1:3000`.
- nginx: the IP vhost `/etc/nginx/sites-enabled/ip-https` is the `443 default_server` for `87.106.60.131` and `include`s `snippets/quiz-game.conf`. `/quiz` is proxied with `proxy_pass http://127.0.0.1:3000/;` (trailing slash = prefix stripped); ours must use **no URI part** because the build carries `basePath`.
- **TLS is solved:** `/etc/letsencrypt-ip/live/ip-cert/fullchain.pem`, Let's Encrypt, SAN `IP Address:87.106.60.131`, renewed by `certbot-ip.timer`. A trusted secure context, so the PWA install is not blocked by a certificate warning (this was open decision §11 #2).
- Still open for the first run: RAM is below the ~2 GB the doc wants for `next build` → add 2 GB swap before building; confirm the MinIO images still pull.

**Acceptance criteria**
- [ ] `https://87.106.60.131/delivery-app/de/login` and `/de/driver/login` work over HTTPS, `/api/health` reports `ok` for database and storage, and the app works under the `/delivery-app/` prefix (no root-relative URL escapes, service worker scope `/delivery-app/`).
- [ ] `https://87.106.60.131/quiz/` and every other site on that nginx are unchanged (backup of `/etc/nginx`, `nginx -t` clean, automatic rollback).
- [ ] `deploy.bat` deploys/updates the running tree in one run and is idempotent; the service restarts on boot (`systemctl`).
- [ ] No secret in the repo; the server env file is `chmod 600`; `SEED_DRIVERS` is **not** left enabled and `ENABLE_ERROR_TEST_PAGES` is not set.
- [ ] The office and driver apps are usable end to end with real data entered through the UI (depot pin confirmed, ≥ 1 customer with a confirmed pin, ≥ 1 order, a released tour).
- [ ] `docs/deploy.md` gets the new self-hosting section, `AGENTS.md` mentions `deploy.bat`, `.env.example` documents the three `REMOTE_*` keys, and the work is committed per convention.

**Implementation notes:** filled in as the deploy progresses.
- **Built so far (local, not yet on the server):** `deploy.bat`, `deploy/deploy.ps1` (pre-flight refuses a dirty tree unless `-AllowDirty`, installs the SSH key on first run, packs with the doc's excludes, runs the server script over ssh), `deploy/server-setup.sh` (stages 0-11: swap, Node, pnpm via corepack, PostgreSQL 16 with an idempotent role/db, MinIO in Docker, `.new`/`.old` code swap, `/etc/delivery-app.env` chmod 600 with secrets generated once, install/migrate/build as the service user, systemd unit, nginx snippet + include injection with backup and rollback, health checks), `deploy/delivery-app.nginx.conf`, `deploy/delivery-app.service`. `docs/deploy.md` gained section 13, `AGENTS.md` a line under Commands, `.env.example` the three `REMOTE_*` keys. Both scripts pass a syntax check (`bash -n`, PowerShell parser).
- **Deliverable 2 begun:** `content/hand-off/` (types, the topic data, the validation test) is being written against the doc's section 8; `scripts/lib/hand-off-page.ts` builds the HTML/CSS/data/behaviour as pure functions, `scripts/build-hand-off.ts` writes the four files into `public/` and fails the build on a broken index. The page renders every topic in **both** languages inside one article per topic (so `#topic-<id>` is unique and the page is complete with JS disabled), loads only relative asset URLs and contains no inline script or handler.
- **Deliverable 2 done and verified (51 topics / 84 glossary terms):** `pnpm build` writes `public/hand-off.{html,css,js,data.js}`; `content/hand-off/index.test.ts` (labels must exist verbatim in `messages/de.json`, ids, step counts, the `waren typ hinzufügen` acceptance phrase) needed `content/**/*.test.ts` in `vitest.config.ts` and `// @vitest-environment node` (jsdom has no `readFileSync(new URL(...))`). Browser-verified: `waren typ hinzufügen` and `添加产品` each hit exactly the product topic and clicking focuses `#topic-produkt-anlegen`; the language switch persists in `localStorage`; print hides the controls; **without JavaScript both languages are visible** (the CSS only hides the inactive one once the script sets `body[data-js]`); no console errors. Linked from both login screens and the admin user menu through `withBasePath` (a relative href would resolve to `/de/driver/hand-off.html`). The static-file CSP branch (`script-src 'self'`, `style-src 'self' 'unsafe-inline'`) allows the external files — no relaxation needed.
- **Next.js sub-path facts, established empirically (not from the guides):**
  - `redirect()` from `next/navigation` **does** get the base path (Next calls `addPathPrefix` in `app-render.js`), so page guards, auth actions and `postLoginPath` keep unprefixed paths.
  - `NextResponse.redirect(new URL(target, request.url))` does **not** (the URL is resolved against the origin), so `src/proxy.ts` and `/api/session-ended` build their targets with `withBasePath`.
  - The proxy matcher **is** prefixed by Next at build time and matched against the full pathname (`regexp: ^\/delivery-app(?:…(?!api|_next|_vercel|.*\..*)…)` in `.next/server/functions-config-manifest.json`), while `request.nextUrl.pathname` inside the middleware is already stripped.
  - `headers()` sources are prefixed by Next **as well** — the opposite of what source-reading suggested. Adding the prefix by hand produced `/delivery-app/delivery-app/...` in `.next/routes-manifest.json`, which silently cost `/delivery-app/api/health` its CSP header and `/delivery-app/sw.js` its `Cache-Control: no-store` (a deployed worker would then have been cached immutably and never updated). Symptom to remember: `curl -i …/sw.js` showing `public, max-age=0` instead of the configured value. The sources in `next.config.ts` are therefore unprefixed.
- **Verification gotcha:** never start `next start` while a build is still writing `.next` (even after `BUILD_ID` appears). Doing so produced a 30 s `/delivery-app/de/login` 500 with `Failed to proxy http://localhost:PORT/… ECONNRESET`, which looks exactly like a base-path or host-binding bug. It is not: with the completed build, `HOSTNAME=127.0.0.1` plus `Host: <public>` / `X-Forwarded-Proto: https` (what nginx forwards) returns 200.
- **Object storage on the server (deviation from the doc's section 6.3, on purpose):** a prefix-stripping proxy such as `/delivery-app-s3/` cannot work, because a presigned URL is signed over the exact request path the SDK built from `S3_ENDPOINT`; nginx stripping the prefix makes MinIO verify a different path, so every upload fails with `SignatureDoesNotMatch`. Instead `S3_ENDPOINT=https://<host>` (no path) with `location /nudel-photos/ { proxy_pass http://127.0.0.1:9000; }` (no URI part, `Host $host`) — the signed path, the forwarded path and the path MinIO verifies are the same, and only that one bucket is exposed. `storageSources()` in the CSP derives the origin from `S3_ENDPOINT`, so the browser may PUT/GET there.
- **Server pre-flight (read-only ssh, 2026-10-26):** nothing named `nudel`/`delivery-app` exists anywhere in `/etc/nginx`, so the include cannot collide; the IP vhost has a catch-all `location /` that a longer prefix wins over; port 3100 is free (the quiz holds `127.0.0.1:3000`); Docker is present but no MinIO image is pulled yet (the one unverified pull); 1.8 GB RAM without swap confirms the script's swap step is needed; 66 GB free.
- **Deployed 2026-10-26 (`deploy.bat`, commits `a315644` + `a0e50a0`).** The server run did: 2 GB swap, Node 22, pnpm 12.14.0 (a real global install; the service user's HOME would otherwise have to download a corepack shim), PostgreSQL 16 + role/database, **MinIO in Docker with the bucket (both chainguard images pulled fine — the doc's unverified risk is closed)**, code to `/opt/delivery-app` with `.old` kept, `/etc/delivery-app.env` (chmod 600, secrets generated once), `pnpm install --frozen-lockfile` (863 packages), `prisma migrate deploy` (12 migrations, none pending), `pnpm build` (166 pages, ~2 min with swap), systemd service enabled+active on 3100, the nginx snippet included into `ip-https` (backup + `nginx -t` + reload). Live: `/delivery-app/api/health` 200 `{"status":"ok","database":"ok","storage":"s3"}`, `/delivery-app/de/login` 200, `/delivery-app/de/driver/login` 200, `/delivery-app/hand-off.html` 200, `/delivery-app` → 302 → `/delivery-app/admin`, and **`/quiz/` still 200**.
- **Three faults found and fixed during the deploy (all in the deploy tooling, none in the app):**
  1. The pre-flight counted untracked scratch as "dirty" and refused to deploy a clean tree; it now checks tracked changes only (untracked scratch is excluded from the tarball anyway).
  2. `--exclude=./messages/_fragments` broke the build: `next build` type-checks test files, and four component tests import locale fixtures from there (deploy failed after the first `next build`; `set -e` aborted before systemd/nginx, so nothing was exposed). Directory excludes are also unreliable for nested paths, so `docs/` is excluded as a whole (a top-level prune, which works) and the tarball is verified at 1.5 MB / 1003 entries with no junk.
  3. Every HTML page under the prefix answered **502** with `upstream sent too big header while reading response header from upstream` while `/api/health` worked: the upstream header is 4247 bytes (per-request CSP nonce + the sha256 hashes of the prebuilt shells), just over nginx's 4 kB `proxy_buffer_size`, which is used even with `proxy_buffering off`. The snippet now sets 16k header buffers (`a0e50a0`).
- **Production data:** seeded with `pnpm db:seed` (`SEED_DRIVERS=false`, so no demo drivers): settings + one ADMIN + the 6 demo products. The admin password was set once with `pnpm admin:reset-password` (the first attempt generated a placeholder because a PowerShell RNG call failed silently — caught and replaced). The catalogue still holds the demo products; NUD-124 replaces them.
- **nginx scope of the change (worth knowing):** the include injection adds `include snippets/delivery-app*.conf;` to **every** enabled server block, exactly like the quiz deploy does for `/quiz`. So `/delivery-app/…` is also served on the other hostnames of that nginx (login required; no data exposed) and the HTTP blocks redirect it to HTTPS. The IP vhost's own siblings were re-checked after the change: `/quiz/`, `/vision-loop/`, `/restaurant-demo/` all still 200. The domain vhosts (`medicleaner.at`, `mc-dream.education`, `tool.mc-dream.education`) are not resolvable from the development machine, so their behaviour after the change was NOT verified — if that matters, the python pass should be narrowed to the IP vhost only (one condition, then one more deploy run).
- **Known, deliberate deviation from the doc:** the doc's §6.4 says `NEXT_PUBLIC_BASE_PATH` belongs only in the build step. It must also be in the service environment: `next start` re-reads `next.config.ts` (basePath, headers) at boot, and the value has to match the one the client bundles were built with. The env file sets it, the build and the service read the same file, and the deploy passes it explicitly to the build so a `runuser` environment subtlety cannot ship an unprefixed build.
- **Still open at the time of writing:** the office and driver flows with real data on production (one driver, two customers, one order each, one released tour) were being entered through the deployed UI by a separate agent, which is the last acceptance criterion. The catalogue is still the demo one (NUD-124) and there are no parking spots (NUD-125/126).
- **Deployment hygiene verified on the server:** the 2 GB swap is in `/etc/fstab` (persistent; 586 MB of it was used during the build), the service is `enabled` and runs as `deliveryapp` with `ProtectSystem=strict` and `ReadWritePaths` limited to `/opt/delivery-app/.next` and `/var/lib/delivery-app`, `/etc/delivery-app.env` is `600 root:deliveryapp`, and the deployed tree contains no `.env` (the only matches for `AUTH_SECRET=` are in next-auth's own files). Disk: 61 GB free.
- **Not scheduled yet (follow-up):** no systemd timer/cron for the retention and backup jobs, so `docs/runbook.md`'s jobs never run on this host — retention stays in `dry-run` (nothing is deleted, which is the safe default) but **there is also no automatic database backup**. The server's own `certbot`/`certbot-ip` timers are present and untouched. Worth a ticket before the office keeps real data in it.

---

#### NUD-128 · Realign the order e2e assertions with the redesign's plural unit labels
**Status:** todo · **depends_on:** –

**Goal:** the redesign replaced the plain unit labels with ICU plurals under `driver.units` (re-design.md §9.3): `"2,5 Packung"` is now `"2,5 Packungen"`, `"1 Packung"` stays singular. `orders.spec.ts` was realigned in NUD-123; these two specs still assert the old singular and are red for that reason alone:

- `tests/e2e/order-overview.spec.ts` — lines 160, 161, 164, 256, 269, 282, 291. **Verified failing** (the detail view renders `"3,75 Packungen · Spaghetti 5 kg1 Packung · Penne 5 kg"` where the spec expects `"3,75 Packung · …"`); the first test in that file also failed after 2.5 min, so re-run it and check whether anything besides the labels is stale.
- `tests/e2e/order-screenshot.spec.ts` — line 231. Not yet run; check it.

**Acceptance criteria**
- [ ] Both specs pass on the `desktop` and `mobile` projects (or the remaining failure is shown to have a different, separately ticketed cause).
- [ ] Only expectations are changed — no product behaviour and no test step is weakened.
- [ ] Any further redesign drift found while doing this gets its own ticket instead of being edited in passing.

---

#### NUD-129 · Admin order list overflows horizontally at phone width
**Status:** todo · **depends_on:** –

**Goal:** `orders.spec.ts` asserts "no horizontal scroll" on the order list and fails on the `mobile` project (Pixel 7, 393 px) after a **successful** save: the list renders wider than the viewport. Measured while working NUD-123; the order itself was created correctly, so this is layout only.

Overflowing elements reported by the spec's own check: `DIV.flex flex-col gap-1`, `SPAN.text-sm font-medium`, `DIV.inline-flex items-center gap-1 rounded-md bg-muted p-0.5 h-1` (a `SegmentedControl`), `BUTTON.inline-flex min-w-0 flex-1 …`, `SPAN.truncate`, `TABLE.group/table w-full caption-bottom text-base [&_td]:px-2 …`.

Note: the admin area is specified for 1280 px (§5 DoD), but the suite runs the admin specs on the `mobile` project too, so either the list is made to fit (preferred — a phone is what the office uses while looking at a WhatsApp screenshot, D6) or the spec's expectation is scoped to desktop **with a comment explaining why**.

**Acceptance criteria**
- [ ] Reproduce at 393 px, identify the element that pushes the width (no `overflow-x` masking).
- [ ] `orders.spec.ts` passes on both projects.
- [ ] No horizontal scroll at 393 px on the order list and the order detail; screenshots added.
- [ ] If the decision is "desktop only", the spec says so explicitly instead of silently skipping the check.

---

#### NUD-130 · Give the admin-password test teardown the same timeout as its setup
**Status:** todo · **depends_on:** –

**Goal:** `src/server/admin-password.integration.test.ts` fails `pnpm test` at random with `Error: Hook timed out in 10000ms` in its `afterAll` (`DROP DATABASE IF EXISTS "…" WITH (FORCE)`) while **all** tests pass (seen on 2026-10-26: `Test Files 1 failed | 164 passed`, `Tests 1790 passed`; the same file passes in isolation in 9.7 s). The `beforeAll` already passes an explicit timeout, the teardown does not.

**Acceptance criteria**
- [ ] The `afterAll` gets an explicit timeout (or the file sets `hookTimeout`), with a one-line reason.
- [ ] `pnpm test` is green three times in a row with a warm dev server and Postgres under load.
- [ ] No test behaviour is weakened — only the teardown's timeout changes.

---

#### NUD-131 · The dev server serves 127.0.0.1 a page whose buttons do nothing
**Status:** done · **depends_on:** –

**Goal:** reported by the owner while testing on the tablet/desktop: at `http://127.0.0.1:3100/de/driver/stops/<id>` **no button works** — not `Geliefert`, not `Problem`, not `Foto aufnehmen` — while the page itself renders. `localhost:3100` worked, which is why no test saw it (the whole e2e suite uses `localhost`).

**Acceptance criteria**
- [x] Root cause identified from the real failure, not guessed.
- [x] `http://127.0.0.1:3100/...` is as interactive as `localhost:3100/...`; the 13 HMR errors are gone.
- [x] The fix is development-only and does not relax anything in production (`allowedDevOrigins` has no effect on a build).
- [x] Verified in a browser on both origins, side by side.

**Implementation notes**
- **Reproduction, both origins, same dev server, same DB row** (`Stop` reset to `PENDING` before each run): at `localhost:3100` clicking `btn-delivered` showed the result panel, wrote `DELIVERED` and sent `POST …/sync` (origin `http://localhost:3100`); at `127.0.0.1:3100` the **same click produced zero requests**, the stop stayed `PENDING`, and the console showed 13 × `WebSocket ws://127.0.0.1:3100/_next/hmr … net::ERR_INVALID_HTTP_RESPONSE`. A fresh browser profile with **no** service worker behaved identically, so it was neither the SW nor hydration of a stale bundle.
- **Cause:** Next.js 16 blocks requests to dev-only assets and endpoints from origins other than the one the dev server was started with (`localhost` by default) — the bundled doc `node_modules/next/dist/docs/…/allowedDevOrigins.md:8-20` states it, and the client runtime never starts, so React handlers never fire. Nothing in `next.config.ts` widened that list.
- **Fix:** `allowedDevOrigins: ["127.0.0.1"]` plus optional extra hostnames from `DEV_ALLOWED_ORIGINS` (comma separated, hostnames only) in `next.config.ts`, so a phone or a tunnel on the LAN does not hit the same trap during the NUD-107/109/115 real-device checks. Documented in `.env.example` and `docs/env.md`.
- **Re-verified after the fix:** `127.0.0.1:3100` → result panel shown, stop `DELIVERED`, `POST …/sync` sent, **0** console errors; `localhost` unchanged. `pnpm lint`, `typecheck`, `i18n:check` green.
- **Not changed:** the app's own `PwaRuntime` still registers the worker in production only (`src/components/driver/pwa-runtime.tsx:27`). A worker installed by an earlier `pnpm start` on the same origin keeps controlling it in dev — the one-time fix stays "DevTools → Application → Service Workers → Unregister".

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
| 2026-10-17 | NUD-030 | Same product twice in one order is MERGED (quantities added), with a hint in the form | Office typing from a chat message may repeat a product; adding is what the customer meant, rejection costs time |
| 2026-10-17 | NUD-030 | Quantity input allows at most 2 decimals; a third decimal (e.g. "1.000") is rejected, never rounded or read as thousands | Correct quantities are client priority 2; "1.000" is ambiguous |
| 2026-10-17 | NUD-030 | Delivery dates before today (factory time zone) are rejected by the server; future dates allowed | A past order can never be routed; avoids typo orders |
| 2026-10-17 | NUD-030 | Delivery date field is a native `<input type="date">` (value `YYYY-MM-DD`), not the calendar popover | No time-zone shift through `Date`, keyboard friendly, simplest |
| 2026-10-17 | NUD-030 | Unconfirmed pin and existing same-day orders are warnings only; saving is allowed. Archived customers and inactive products are rejected on the server and not offered | Ticket scope; routing is blocked later by the tour builder |
| 2026-10-17 | NUD-030 | After saving, the form redirects to `/admin/orders` (minimal list of orders from today on, cancelled included) | Simplest way to show the result; NUD-032 replaces the page |
| 2026-10-17 | NUD-031 | Screenshot is optional on the existing order form; its presence (validated key) makes `source=SCREENSHOT`, the client never sends a source | Simplest; keeps one create path and one authority for `source` |
| 2026-10-17 | NUD-031 | Screenshot key validated like NUD-015 (`screenshots/<uuid>.<ext>` pattern, `Storage.head` must find it, used once); Screenshot row is created in the same statement as the order | No orphan rows, no forged keys |
| 2026-10-17 | NUD-031 | Split view is a CSS grid at `lg` (1024 px) with a sticky pane; "remove" is the only way to change the screenshot (no replace button) | Simplest; paste/upload is offered again after removing |
| 2026-10-17 | NUD-031 | Minimal read-only order detail `/admin/orders/[id]` added here; list date links to it | Ticket requires viewing the screenshot from order detail; NUD-032 extends it |
| 2026-10-17 | NUD-031 | Order form state is reset after a successful save | Next keeps the previous route hidden with its state; otherwise the next new-order form would still hold the saved screenshot |
| 2026-10-17 | NUD-032 | Orders of past delivery days (and cancelled orders) are read-only: no edit, no cancel; they can still be duplicated | A tour for a past day is history; keeps the rules simple and the data honest |
| 2026-10-17 | NUD-032 | Editing keeps the customer and the screenshot fixed (wrong customer: cancel and re-enter); the status can switch DRAFT <-> CONFIRMED, CANCELLED only through cancel and is final | Smallest edit surface; customer change would move stops between customers and tours |
| 2026-10-17 | NUD-032 | Update re-uses `orderInputSchema` with the stored customer injected; a deactivated product may stay in an existing order but cannot be added | One validation path for quantities (client priority 2); no forced removal of old lines |
| 2026-10-17 | NUD-032 | Duplicate creates a DRAFT (source MANUAL, no screenshot, internal note and lines copied) and opens it; same day allowed; needs active customer and products | A copy must be confirmed on purpose so wrong quantities do not slip into a tour unnoticed |
| 2026-10-17 | NUD-032 | Overview default = next delivery date (`getDefaultDeliveryDate`), all statuses incl. cancelled shown until filtered; range capped at 62 days, 300 rows, then a truncation notice | Simplest consistent with NUD-012/030; keeps page and totals readable |
| 2026-10-17 | NUD-032 | Totals panel counts CONFIRMED orders of each date in the range and ignores the customer/status/source filters | It answers what must be produced and loaded that day; a customer filter must not shrink it |
| 2026-10-17 | NUD-032 | `markOutdatedForDate` flags all not COMPLETED tours of the date and is called on every create/update/cancel/duplicate (also for drafts, old and new date on a date change) | Ticket says every change; NUD-043 refines; over-flagging is safe, missing a flag is not |
| 2026-10-17 | NUD-032 | After creating an order the form redirects to the overview filtered to that order's date | The new default filter (next delivery date) would otherwise hide orders for other days |
| 2026-10-17 | NUD-032 | Archiving a customer with upcoming orders shows a warning in the archive dialog but is still allowed; orders are not cancelled | Ticket asks for a small warning only; cancelling is a separate office decision |
| 2026-10-17 | NUD-040 | Result carries a required `approximate: boolean`; `legs` includes the return leg (n + 1); `totalDurationS` excludes service time | Ticket requires `approximate` reporting; the return leg is part of the tour; NUD-041 adds service minutes to ETAs |
| 2026-10-17 | NUD-040 | ORS profile via env `ORS_ROUTING_PROFILE` (`driving-car` default, `driving-hgv`), not a `Settings` column | Ticket says "if a setting says truck"; no column exists and a migration is out of scope (same reasoning as `ORS_GEOCODE_COUNTRIES`) |
| 2026-10-17 | NUD-040 | One 8 s deadline for the whole ORS call (optimization + directions), no retries; any failure falls back to the heuristic | Office waits at most 8 s before an approximate result; retrying would exceed that |
| 2026-10-17 | NUD-040 | Directions are requested in chunks of at most 50 coordinates sharing boundary points | ORS caps waypoints per directions request; 50 stops + depot twice is 52 points |
| 2026-10-17 | NUD-040 | More than 50 stops -> `RoutingError` `TOO_MANY_STOPS` from every provider, never routed on the fallback either; invalid input does not fall back | Ticket demands a documented error; the fallback must not hide caller mistakes |
| 2026-10-17 | NUD-040 | Missing key -> `LocalHeuristicProvider` alone with one warning (also in production); its results are flagged `approximate` | Mirrors NUD-010; the heuristic is an estimate, never presented as road data |
| 2026-10-17 | NUD-041 | `Tour.approximate` is a new column (migration), not part of `geometry` JSON | `geometry` is passed straight to `TourMap`; a flag is cheap to query and a schema-visible fact for NUD-042 |
| 2026-10-17 | NUD-041 | `Tour.totalDurationS` = driving (incl. return leg) + service minutes of all stops; stop `legDurationS`/`legDistanceM` = leg arriving at that stop | The office wants the tour's real length; legs and ETAs stay reproducible from stored values |
| 2026-10-17 | NUD-041 | Re-running is allowed only for DRAFT/OPTIMIZED tours; RELEASED, IN_PROGRESS and COMPLETED return `tour_not_editable` | Replacing stops of a tour the driver may already use would break priority 2; re-release is NUD-043 |
| 2026-10-17 | NUD-041 | Locked tour: kept customers keep their position, new ones are appended in order of their first order, customers with no routable confirmed order left are removed (and reported), legs/ETAs recomputed with `route()` | Ticket says "only adds new customers at the end"; keeping an empty stop would show the driver nothing to unload |
| 2026-10-17 | NUD-041 | Existing stop rows are reused per customer on every re-run (updated in place), not deleted and recreated | Stable stop ids for NUD-042/043 diffs; same outcome as "replace" |
| 2026-10-17 | NUD-041 | No routable stops: error `no_stops` (with the warnings) when no tour exists; an existing unreleased tour is emptied instead | An empty new tour is useless; a stale tour must not keep deleted orders |
| 2026-10-17 | NUD-041 | Dates before today (factory time zone) are refused (`date_in_past`); delivery weekdays are not enforced; archived customers with confirmed orders still get a stop | Same rule as order entry; weekdays only drive defaults; the office cancels orders it does not want delivered |
| 2026-10-17 | NUD-041 | The write is one transaction with a per-date advisory lock that re-checks the tour and confirmed orders (id + `updatedAt`) used for planning; a mismatch returns `conflict` | Routing can take up to 8 s; an order saved meanwhile (whose outdated flag would be missed) must not yield a silently stale tour |
| 2026-10-17 | NUD-042 | Drag and drop is native HTML5 (`draggable`), no DnD library; up/down buttons are the keyboard and touch path | Simplest, no dependency; touch drag is not supported by HTML5 DnD |
| 2026-10-17 | NUD-042 | Manual reorder keeps `locked` as it is and does not lock the tour; re-optimize on an unlocked tour discards manual order (button hint says so); on a locked tour the same button is labelled "update from orders" and keeps the order (NUD-041 rule) | Lock is an explicit office decision (ticket lists it as its own toggle) |
| 2026-10-17 | NUD-042 | All edits (reorder, lock, driver, re-run) of RELEASED / IN_PROGRESS / COMPLETED tours are refused with `tour_not_editable`; the page shows them read-only | Ticket says reject edits to released tours; what NUD-043 may allow is defined there |
| 2026-10-17 | NUD-042 | Release is refused for an outdated tour (`outdated`: orders changed after the tour was built) and for a tour whose `version` (`updatedAt`) differs from the one shown in the dialog (`conflict`) | Priority 2: the driver must not get stale quantities; the office releases exactly what it confirmed |
| 2026-10-17 | NUD-042 | Only active users with role DRIVER can be assigned; the assignment can be cleared (`null`) on an unreleased tour; a deactivated assigned driver blocks release (`driver_invalid`) | Driver accounts are soft-deleted (D13 / 4.3) |
| 2026-10-17 | NUD-042 | Stop "item count" = number of distinct products over the stop's linked orders; "photos missing" flags use the current STORE / PARKING photos of the customer | Ticket asks for item count and missing-photo flags only; quantities are shown by the driver screens |
| 2026-10-17 | NUD-042 | Pin warnings are recomputed from the confirmed orders on every page load (not only after "generate") | They must stay visible after reload and when no tour exists yet |
| 2026-10-17 | NUD-042 | Date picker is a native `<input type="date">` bound to `?date=`; no/invalid date = next delivery date | Same choice as NUD-030/032 |
| 2026-10-17 | NUD-043 | The quantities released to the driver are stored per stop (`Stop.items` snapshot, backfilled by the migration); the driver read model uses the snapshot, not the live order lines | An order edited after release must not change what the driver sees before the office re-releases (priority 2); the snapshot is also the base of the diff |
| 2026-10-17 | NUD-043 | Order changes flag tours only when a CONFIRMED order is involved and something a tour contains changed (customer, day or quantities); the flag is written in the same transaction as the order change | Ticket says 'create/update/cancel'; drafts and no-op saves are not on a tour, and a change without its flag would break priority 2 |
| 2026-10-17 | NUD-043 | `markOutdatedForDate` still flags all not COMPLETED tours of the day (also unreleased ones), the diff on the page decides what really differs | Over-flagging is safe and the release refusal of NUD-042 stays; a re-release with no visible difference just clears the flag |
| 2026-10-17 | NUD-043 | Re-release keeps the order of the open stops, appends new customers, removes open stops without orders and recomputes legs / ETAs with `route()` (no re-optimization); ETAs stay planned values from the departure time, not a live prediction | The driver is already underway and must not see his remaining stops reshuffled; same rule as a locked tour (NUD-041) |
| 2026-10-17 | NUD-043 | Completed stops (DELIVERED / PROBLEM) are frozen: status, completion data, quantities, order links and ETA are never written; later edits to their orders are only reported (`completedChanged`); a new order of an already delivered customer becomes a second open stop at the end | Never reset completed work (ticket); a delivered quantity cannot change retroactively, but the office must be told |
| 2026-10-17 | NUD-043 | A re-release that changes nothing the driver sees (changes cancelled out, or only completed stops edited) clears the flag and does not bump the revision | Otherwise the driver would get a 'Tour was updated' banner without anything to look at |
| 2026-10-17 | NUD-043 | Change data for the driver app: `Tour.releaseRevision` (1 = first release, +1 per effective re-release), `reReleasedAt`, `lastChange` (JSON incl. removed customers' names), `Stop.changeKind` ADDED / CHANGED, `changedInRevision`, `previousItems`; the 'seen' state is kept on the device by NUD-051 | Ticket allows markers or a revision field; both together let the driver app highlight stops it has not seen yet and name removed stops, without a server-side acknowledgement |
| 2026-10-17 | NUD-043 | Re-release needs an assigned, active driver and the `version` (tour `updatedAt`) the office saw; inside the transaction (per-date advisory lock) tour version, stop statuses and confirmed orders are re-checked and writes to open stops are guarded by `status = PENDING`, otherwise `conflict` | Same pattern as release / generate; a stop completed by the driver or an order saved meanwhile must never be overwritten |
| 2026-10-17 | NUD-043 | Status machine: DRAFT -> OPTIMIZED -> RELEASED -> IN_PROGRESS -> COMPLETED, self-transitions only for rebuild (OPTIMIZED), re-release (RELEASED / IN_PROGRESS); a stop is done when it is not PENDING; `syncTourProgress` derives the status from the stops; COMPLETED is final | Matches the ticket; PROBLEM also closes a stop (NUD-053); how Undo interacts with COMPLETED is left to NUD-053 (noted there) |
| 2026-10-17 | NUD-050 | Seeded demo drivers for the four languages have `localeChosen=true`; new seeded `driver-new` has false | Keeps e2e logins deterministic while a demo of the picker remains |
| 2026-10-17 | NUD-050 | After picking a language the driver always lands on the driver home, not on a previous deep link | Simplest; the picker only appears once per driver |
| 2026-10-17 | NUD-050 | Picker is enforced in `requirePageActor` (page guard) for DRIVER only, not in the proxy; admins in support view skip it | Token has no `localeChosen` claim; avoids a DB read per request in the proxy |
| 2026-10-17 | NUD-051 | "Today" = calendar day in `Settings.timezone`; the driver id comes only from the session; an admin in the support view sees the empty state | Authorization by construction (no id from the client); ticket says own tour only |
| 2026-10-17 | NUD-051 | Item summary shows one total per unit (kg, Packungen, Kisten, Stück) next to the number of varieties, never one summed number | Adding packs and kg would be wrong quantities (priority 2) |
| 2026-10-17 | NUD-051 | Remaining time = planned driving legs to the open stops + service minutes per open stop, rounded up to 5 min, without the way back; not shown at 0 | Uses stored plan values only; no live prediction; return leg is not stored per stop |
| 2026-10-17 | NUD-051 | 'Seen revision' stored in `localStorage` per tour id; banner and highlights stay until the driver taps "Verstanden"; current revision is recorded silently while the tour was never re-released | Ticket asks for device-side memory; no server acknowledgement exists |
| 2026-10-17 | NUD-051 | Placeholder route `/driver/stops/[stopId]` (name only, 404 for stops outside the driver's own tour today) until NUD-052; page re-fetches when the app becomes visible | Details button needs a target; a long-open app must notice a re-release |
| 2026-10-17 | NUD-052 | No swipe between stops, only prev / next buttons (disabled at ends); order = tour sequence regardless of status | Swipe is optional in the ticket; buttons are simplest and 48 px accessible |
| 2026-10-17 | NUD-052 | Apple Maps button only when the browser reports iOS/iPadOS; Google Maps button always first | Ticket: secondary option on iOS, detected client-side |
| 2026-10-17 | NUD-052 | Photos shown `contain` in a fixed 4:3 frame; missing photo uses the same frame | Layout never shifts; the whole photo is visible without cropping |
| 2026-10-17 | NUD-052 | DE badge shown whenever the picked note text is German and the UI locale is not German (via `pickWithSource`) | Becomes invisible automatically once NUD-071 adds translations |
| 2026-10-17 | NUD-052 | German product name is shown only when it differs from the displayed name; copied address = "street, postal code city" | Avoids a duplicate line in German; address format matches the list |
| 2026-10-17 | NUD-053 | Idempotency log table `StopMutation` (id = clientMutationId, stored result) in addition to `Stop.clientMutationId` | A single unique column on Stop cannot make undo replay-safe or return the same result for a replay; accepted ids only, rejections are retryable |
| 2026-10-17 | NUD-053 | Once the tour is COMPLETED nothing can be undone (also not the last stop); undoing the only done stop leaves the tour IN_PROGRESS | COMPLETED is final and the tour never moves backwards in the status machine; avoids widening it |
| 2026-10-17 | NUD-053 | Auto-advance = next PENDING stop behind the current one in tour order, else the first open one before it, else the tour screen (finished) | Follows the driving order; never leaves the driver on a done stop while others are open |
| 2026-10-17 | NUD-053 | Stop mutations are not limited to "today"; the stop only has to be in the driver's own RELEASED / IN_PROGRESS tour | Queued offline mutations (NUD-082) may sync after midnight |
| 2026-10-17 | NUD-053 | Status buttons sit in the page flow (slot after items / notes), no sticky bar; Undo also as a button on the result card within the window | Simplest consistent with NUD-052; toast alone is gone after navigation |
| 2026-10-17 | NUD-053 | Problem free text is optional for every reason (also OTHER); source locale = `User.locale` of the acting driver | Ticket says optional; the language switcher keeps `User.locale` in sync with the UI |
| 2026-10-17 | NUD-053 | "Tour finished" screen = enhanced all-done card on `/driver` with delivered / problem counts | The driver is sent there after the last stop; no extra route needed |
| 2026-10-17 | NUD-054 | Polling interval comes from the server env `LIVE_POLL_INTERVAL_MS` (default 30000, range 1000..300000, invalid -> default) and is passed to the client as a prop | Needed a test hook to run e2e faster; the default stays the product value, no `NEXT_PUBLIC_` env baked into the bundle |
| 2026-10-17 | NUD-054 | `router.refresh()` polling only while the tab is visible (hidden ticks are skipped, immediate refresh on becoming visible); dashboard polls unless the tour is COMPLETED, the tour page only for RELEASED / IN_PROGRESS | Ticket makes pausing optional; cheap to do; COMPLETED is final and unreleased tours only change by admin actions |
| 2026-10-17 | NUD-054 | "Today" card shows the latest tour of today's date (factory time zone); an unreleased tour shows a hint, not progress | v1 has one tour per day (D5); progress of a tour the driver cannot see would mislead |
| 2026-10-17 | NUD-054 | Map markers by status: colour plus shape (diamond for problem) plus badge glyph (check / "!"); darker 700 colour shades | Accessibility: status must not depend on colour alone, white text needs AA contrast |
| 2026-10-17 | NUD-054 | The driver's problem text is shown as written (source locale of the `LocalizedText`), labelled "Originaltext des Fahrers", with `lang` set to that locale | German translation for the office is NUD-072 |
| 2026-10-17 | NUD-060 | Demo seed = `pnpm db:seed --demo [--no-photos] [--today]`; depot "Absberggasse 27, 1100 Wien" and the 20 customer addresses are real public Vienna streets, pins are hand-picked street-level approximations (not geocoded) with `pinConfirmed=true` | Fake geocoder points are random inside a box; hand-picked ones are plausible. Real onboarding still needs the admin's pin confirmation |
| 2026-10-17 | NUD-060 | Demo seed needs an S3-compatible store and aborts before writing anything otherwise; `--no-photos` is the explicit escape hatch (CI) | The Fake store lives per process and would lose the photos; CI has no MinIO |
| 2026-10-17 | NUD-060 | Placeholder photos are PNGs from a tiny built-in bitmap-font encoder, text in capitals ("EINGANG"/"PARKEN") plus the customer number; keys are deterministic UUIDs | No image library in the repo; capitals need only 20 glyphs; deterministic keys make reruns idempotent |
| 2026-10-17 | NUD-060 | Demo orders: next delivery day by default, `--today` for a live demo; rerun guard = a demo-marked order with `deliveryDate >= today` exists | The driver sees only today's tour; the guard keeps reruns idempotent without touching admin edits |
| 2026-10-17 | NUD-060 | The happy path creates its own customer + order for TODAY and fails (no skip) when the depot pin is unconfirmed or a tour for today exists; it runs after the plain-seed specs in CI | Never depend on the cached Settings row; a silent skip could hide a broken demo seed |
---
| 2026-10-17 | NUD-070 | Pending marker = optional `meta.pendingTranslation` inside the `LocalizedText` JSON, no new column/table, no migration | Simplest option the ticket offers; it travels with the text, works for every column, and Prisma can filter on the JSON path |
| 2026-10-17 | NUD-070 | Retry job finds records through a registry (`PENDING_SOURCES`: `Customer.notes`, `Stop.problemNote`) and saves only if `meta.updatedAt` is unchanged | Small and explicit; an office edit between read and write is never overwritten |
| 2026-10-17 | NUD-070 | Provider only handles German <-> Simplified (`ZH-HANS`, source `ZH`); Hant via OpenCC; `localize` makes one provider call per text | Ticket; saves quota and keeps HK/TW consistent with the UI strings |
| 2026-10-17 | NUD-070 | `completeTranslation` fills only empty locales and never overwrites existing ones; a German source with any Chinese text present is not sent to the provider | Hand-written / edited translations (D15, NUD-071) must survive a retry |
| 2026-10-17 | NUD-070 | DeepL endpoint via `DEEPL_API_PLAN=free|pro`, default from the `:fx` key suffix; 5 s timeout, 1 retry (timeout/network/5xx/429) | Ticket asks for env-based free/pro; same limits as the geocoder |
| 2026-10-17 | NUD-070 | Missing `DEEPL_API_KEY` -> Fake + one warning (also in production); the cron route then skips and leaves pending texts alone | Mirrors NUD-010/040; the retry must not replace real pending records with prefixed fake text |
| 2026-10-17 | NUD-070 | A provider error ends a retry run; only `INVALID_INPUT` is per-record; 50 records per source and 45 s per run | An outage fails every record the same way; next cron run retries; stays under the 60 s function limit |
| 2026-10-17 | NUD-070 | Cron route `GET /api/cron/retry-translations` authenticates with `Authorization: Bearer $CRON_SECRET`, fails closed (401) when unset; schedule `*/10 * * * *` | Vercel Cron convention; the 10 minute schedule needs the Vercel Pro plan (Hobby = daily), documented |
| 2026-10-18 | NUD-071 | The multilingual editor is a "Translations" tab on the customer detail page with its own save; the customer form keeps editing only the German note | Keeps the form simple; translations are reviewed after the source exists |
| 2026-10-18 | NUD-071 | All four versions are editable in the tab; editing German there is a source change (same merge as the form) and must not be empty | Backlog says "edit any version"; one code path for source changes |
| 2026-10-18 | NUD-071 | "Hand-written" = non-empty Chinese version without `meta.machine[locale]`; "source changed, check translation" is the optional `meta.stale[locale]`, cleared by editing the text, "Mark as checked" or Re-translate | No migration or extra column; an unchanged-but-correct version needs a way to dismiss the flag |
| 2026-10-18 | NUD-071 | Source change: one provider call (Simplified) + OpenCC for Hant, applied to machine/empty versions only; a changed German text with a failing provider empties them and sets `pendingTranslation` | Same cost as NUD-070 `localize`; failures never block saving |
| 2026-10-18 | NUD-071 | "Re-translate" with a failing provider changes nothing and shows an error | Never destroy hand-written text without a replacement |
| 2026-10-18 | NUD-071 | Saves from the tab carry `baseUpdatedAt` and write guarded on `meta.updatedAt`; mismatch returns `conflict` and reloads | Protects against the retry job / a second office user without locks |
| 2026-10-18 | NUD-072 | Non-German problem text is stored with `meta.pendingTranslation` inside the driver's transaction; translation runs afterwards in `after()` (`scheduleProblemNoteTranslation`), the cron retry job is the safety net; `applyStopMutation` itself never calls the translator | Driver mutation can never be delayed or failed by a provider; serverless-safe; same hook reusable by NUD-082 |
| 2026-10-18 | NUD-072 | German problem text: no flag, no translation, no Chinese variants | Office reads German; ticket only asks for German for the office |
| 2026-10-18 | NUD-072 | Admin shows the German text first with a "maschinell übersetzt" badge and a toggle for the original; while pending: "Übersetzung folgt" + original shown | Office needs something readable at once; original always reachable |
| 2026-10-18 | NUD-072 | A late translation is saved only if the note still has the `meta.updatedAt` that was read (existing `stopProblemNoteSource.save`) | Undo or a new report in between must win |
| 2026-10-18 | NUD-073 | CSV is comma separated with UTF-8 BOM by default; import auto-detects `,` `;` tab | German Excel saves `;` files; avoids a `sep=` hack line |
| 2026-10-18 | NUD-073 | Only `corrected_zh-Hans/-HK/-TW` columns are applied; German corrections go in the comment column; comments are not stored | German is developer-maintained; backlog asks for corrected text per Chinese locale only |
| 2026-10-18 | NUD-073 | Import is all-or-nothing, refuses placeholder-set changes vs German and stale rows (`--force` to override); Hant correction equal to the OpenCC output removes the override | Protects against broken ICU/outdated CSVs; keeps override files minimal |
| 2026-10-18 | NUD-073 | Route hints are a plain TS prefix list (`scripts/lib/i18n-routes.ts`), longest prefix wins, text in parentheses = description not URL | Simplest maintainable form; a unit test flags stale entries |
| 2026-10-18 | NUD-080 | Service worker built after `next build` by `scripts/build-pwa.ts` (esbuild + `@serwist/build` injectManifest) instead of the Serwist Next plugin | Plugin needs webpack; the app builds with Turbopack |
| 2026-10-18 | NUD-080 | SW caches only the precached shell (hashed `_next/static`, icons, `offline.html`); driver navigations NetworkOnly with generic offline page fallback; no runtime caching | Authenticated HTML / RSC / API must never be stored before NUD-081 designs data caching |
| 2026-10-18 | NUD-080 | Manifest `id` `/driver` for all locales, `scope` `/`, `start_url` `/<locale>/driver` | One installed app; language switch stays in scope; ticket demands localized start_url (follow-up NUD-106) |
| 2026-10-18 | NUD-080 | Worker registered in production builds only, from the `/driver` layout (login included) | Avoids stale workers in `next dev`; admin pages are not handled by driver logic |
| 2026-10-18 | NUD-080 | Install hint dismissal is permanent (`localStorage`, in-memory fallback); iOS detected by user agent | Simplest "dismissible and remembered"; iOS has no install event |
| 2026-10-18 | NUD-080 | Real Lighthouse replaced by CDP `Page.getInstallabilityErrors` + assertions | Lighthouse not runnable in the sandbox; stated in the ticket (NUD-105) |
| 2026-10-18 | NUD-081 | Offline data model = the API JSON itself (`DriverTourResponse`, zod, schemaVersion 1); the server pages and the offline shell derive their screen models from it with the same pure functions | Online and offline must render identically; one schema validates API answers and stored records |
| 2026-10-18 | NUD-081 | Names and notes travel as `LocalizedText` in all four locales and are picked on the device (not resolved for the driver's locale on the server) | Offline pages follow the URL locale; language switch needs no new download; payload stays small |
| 2026-10-18 | NUD-081 | Photos are cached in Cache Storage under the stable URL `/api/driver/photo-cache/<photoId>` (not the signed URL); the worker serves that path from the cache only | Signed URLs change on every load; ids are immutable so only new photos are downloaded; same-origin path avoids opaque responses |
| 2026-10-18 | NUD-081 | Signed photo URLs in the tour payload are valid 12 h (`DRIVER_PHOTO_URL_TTL_SECONDS`); photos are fetched with CORS `GET` (bucket CORS rule must allow GET, already in docs/env.md) | Ticket requires >= 12 h; opaque `no-cors` responses cannot be checked and cost quota; failures show 'partly ready' instead of claiming readiness |
| 2026-10-18 | NUD-081 | Offline navigation: public prerendered shell page `/<locale>/driver/offline-shell` precached by the worker and served (Serwist fallbacks, 8 s network timeout) for `/<locale>/driver` and `/driver/stops/<id>`; it reads IndexedDB client side. Authenticated HTML is still never stored | Keeps the NUD-080 privacy rule; the shell contains no personal data; hard page loads between screens are acceptable and robust |
| 2026-10-18 | NUD-081 | Cached data is per user (one IndexedDB record keyed by user id, other users' records removed on every save) and per day (records not from today in the factory time zone are never shown and are deleted) | Shared phones and stale quantities (priority 2) |
| 2026-10-18 | NUD-081 | The login pages purge IndexedDB and the photo cache on mount (instead of purging on the logout click) | A login page means no session: also covers expired / ended sessions and a different driver; an offline logout that fails must not delete data of a still logged-in driver |
| 2026-10-18 | NUD-081 | The sync is not gated on `navigator.onLine`; it runs at start, on `online`, when visible, every 5 min and after status changes; only DRIVER users sync (admin support view would get 403) | `onLine` can be wrong (false in this sandbox); a failed fetch is cheap |
| 2026-10-18 | NUD-081 | Offline the status buttons are disabled with a notice and undo is hidden | Mutation queue is NUD-082; a server action cannot succeed offline |
| 2026-10-18 | NUD-082 | Every tap goes through the outbox (outbox first, then send), also online; the UI is optimistic; the server action is no longer used by the UI | One code path, a tap is instant and never lost; the same idempotent function runs for each entry |
| 2026-10-18 | NUD-082 | `createdAt` of a queued tap is trusted within [server now - 24 h, server now] and becomes `completedAt`, the start of the undo window and the conflict cut-off | A phone clock that is ahead or far behind cannot future-date stops or reopen old windows; undo counts from the driver's action, not from the delivery of the request |
| 2026-10-18 | NUD-082 | Conflict = new column `Stop.adminChangedAt` (set by a re-release that changes / adds a stop) later than the tap -> `changed_by_office`; removed stop / inactive tour / closed stop are rejected as well; rejected entries are final (removed, notice) | Needs a per-stop time (tour `reReleasedAt` would flag unchanged stops); quantities are priority 2, so a tap made on old quantities must not win |
| 2026-10-18 | NUD-082 | A queued completion that no request carries can always be cancelled by Undo (outside the 5-minute window too); otherwise an undo is queued; the last stop's toast offers no Undo | The server never saw it; the window and the COMPLETED rule only apply to confirmed state (NUD-053) |
| 2026-10-18 | NUD-082 | Backoff 2 s doubling to 5 min; `online` / focus / start skip it, the 60 s timer and new taps respect it; chunks of 50; a 400 chunk is retried entry by entry | Spec asks for exponential backoff; a changed situation deserves one immediate attempt; one bad entry must not block the queue |
| 2026-10-18 | NUD-082 | Unsent taps and notices survive logout / the login purge (kept per user, other drivers' after 3 days); the worker's Background Sync only sends for the user of the stored tour copy | "Taps are never lost"; avoids sending one driver's taps in another's session |
| 2026-10-18 | NUD-082 | Settled stop states are shown on top of the not yet refreshed page for 20 s ("confirmed" overlay) | Prevents a flicker back to "pending" between removing the queue entry and the server data refresh |
| 2026-10-18 | NUD-083 | Photos have their own IndexedDB store (`photos`, DB v3) and controller next to the tap outbox, with the same triggers, backoff and notice cards; the top-bar badge counts both | Taps are tiny JSON batches, photos are blobs with a three-step upload; one queue per kind keeps both simple and the "outbox" semantics (queued on the device, retried, idempotent) |
| 2026-10-18 | NUD-083 | Registration is `POST /api/driver/photos` (idempotent by the new unique `Photo.clientMutationId`), not a server action; the customer is derived from the stop, never sent by the client | Must work from the offline queue and the worker; client-chosen customers would let a driver change any customer's photo |
| 2026-10-18 | NUD-083 | Allowed tours: the driver's own, status RELEASED / IN_PROGRESS / COMPLETED, day = today or yesterday in the factory time zone (instead of only today / RELEASED / IN_PROGRESS) | A photo taken offline in the evening is registered after midnight, and drivers often notice a missing photo while closing the last stop (COMPLETED); older tours stay closed |
| 2026-10-18 | NUD-083 | The `storageKey` is saved in the queue row right after the PUT; the presigned PUT (5 min) is always requested in the same attempt as the upload; `object_missing` re-uploads up to 3 times, then the photo is dropped with a notice | A lost registration answer must not upload twice; a stale grant is never reused |
| 2026-10-18 | NUD-083 | A new photo of the same customer and kind replaces older unsent queue entries (not those in flight) | They would be current for a moment and then replaced; saves bandwidth and history rows |
| 2026-10-18 | NUD-083 | The slot shows the queued photo from an object URL of the local blob; after registration the blob is also stored in the photo cache under the real photo id and the tour copy is patched, "Gesendet" overlay for 20 s | Immediate feedback offline, no flicker before the page data refreshes, no download of what the phone already has |
| 2026-10-18 | NUD-083 | The office sees "Aktualisiert von Fahrer X am <date>" only for photos uploaded by a driver | Spec asks for the driver attribution; office uploads need none |
| 2026-10-18 | NUD-090 | XLSX is read with `exceljs` (SheetJS CDN blocked, npm `xlsx` outdated); CSV with an own RFC 4180 parser; `uuid` overridden to >= 11.1.1 | Only safe option available; audit clean |
| 2026-10-18 | NUD-090 | The file is parsed server-side (route handler, 5 MB cap while reading); the browser holds the table and sends only mapped cells, re-validated by the actions | Server actions have a 1 MB body limit; client parsing could not be trusted anyway |
| 2026-10-18 | NUD-090 | Column mapping is remembered in `localStorage` (header text per field), not in the database | No migration; per-browser is enough for one office |
| 2026-10-18 | NUD-090 | Unchanged address keeps pin and confirmation on re-import; a changed address drops pin (lat/lng null) and confirmation | Re-importing must not undo 150 reviews; the old pin belongs to the old address (NUD-014) |
| 2026-10-18 | NUD-090 | Empty optional cells never erase stored data; archived customers are updated but not reactivated; a number twice in the file: first row wins | Import must not destroy data; reactivation is a decision for the office |
| 2026-10-18 | NUD-090 | Formula-like cells (`=`, `@`, TAB, CR, `+`/`-` + non-number) make the row invalid instead of being altered | CSV injection; visible reason instead of silent change |
| 2026-10-18 | NUD-090 | Spreadsheet-dropped leading zero of a 4-digit German postal code is restored (DE only), with a row warning | Excel turns 01067 into 1067; AT/CH codes are 4 digits |
| 2026-10-18 | NUD-090 | Imported notes are stored German-only with `pendingTranslation`; no translator call per row | 2000 DeepL calls in one request is slow; the NUD-070 retry job translates |
| 2026-10-18 | NUD-090 | Geocoding: 5 customers per action, server throttle 700 ms with a real key (`GEOCODE_BATCH_DELAY_MS`), stop on 429/403 or 3 failures; best candidate stored as unconfirmed pin | Stays under the ORS free tier (~100/min); the admin confirms every pin (D9) |
| 2026-10-18 | NUD-090 | Pin review queue = all active unconfirmed customers, not just the last import; skip is client-side only | No import-batch column needed; one list for every unconfirmed pin |
| 2026-10-18 | NUD-091 | The print page lives in a new route group `admin/(print)` with the same ADMIN gate but no `AdminShell`; all existing admin pages and the old admin layout moved unchanged into `admin/(shell)` | Route groups are the Next.js way to give some pages a different layout without changing any URL; avoids hiding the shell with CSS |
| 2026-10-18 | NUD-091 | The sheet prints the quantities of the tour (`Stop.items` snapshot), not the live orders; an outdated tour prints with a loud warning (screen toolbar + banner on the paper) instead of being blocked | Matches what the driver sees (priority 2); the office may still need a sheet, but must know the numbers are stale |
| 2026-10-18 | NUD-091 | Invalid / missing `?locale=` falls back to the locale in the page URL (no error page) | A bad link should still give a usable sheet; zod `localeSchema` is the only accepted shape |
| 2026-10-18 | NUD-091 | Totals come from one shared `sumQuantities` (per product AND unit) in `order-overview.ts`, which `aggregateTotalsByDate` now uses too | Ticket demands one shared aggregation function; units are never mixed |
| 2026-10-18 | NUD-091 | Section 2 shows both the load position (1 = loaded first) and the original stop number; German product name in small type under the Chinese one | The loader needs the load order, the driver the stop number; Chinese-reading loaders may still talk to German staff |
| 2026-10-18 | NUD-091 | NUD-008's global `@media print { body * { visibility: hidden } }` is scoped with `body:has(.pin-sheet)` | The unscoped rule blanked every printed page of the app; the PIN print still works (e2e assertion added) |
| 2026-10-18 | NUD-092 | `AuditLog.entity` / `action` are plain strings validated in code, not Prisma enums; `actorId` is not a foreign key | New actions need no migration; users are archived but the history must survive any user row and e2e fixtures delete their users |
| 2026-10-18 | NUD-092 | Append-only is enforced twice: no update/delete path in code (scanned by a test) and a Postgres trigger refusing UPDATE/DELETE | Cheap defence in depth; a later retention job must deliberately bypass the trigger |
| 2026-10-18 | NUD-092 | Diffs store ids and values (quantities in hundredths), names are resolved when read; problem notes and internal notes truncated to 200 characters; keys like password/hash/token/signature/url are dropped | No PII copies or secrets in a log that cannot be edited |
| 2026-10-18 | NUD-092 | An order save that changes nothing writes no entry; a locked-tour rebuild is logged as `tour.reoptimize`, first build as `tour.generate`; photo audit sits in the shared `attachCustomerPhoto` | Less noise; one place covers office and driver photos |
| 2026-10-18 | NUD-092 | Tour history = entries of the tour plus every entry whose diff has `tourId` (stop changes, driver photos); shown below the planner because v1 has no separate tour detail page | Simplest query, no extra column |
| 2026-10-18 | NUD-093 | CSP keeps `'unsafe-inline'` for `script-src` and `style-src`; everything else is locked down (`object-src`, `base-uri`, `form-action`, `frame-ancestors`, per-type host lists) | Next.js hydration scripts are inline and PPR / cache-components shells cannot carry a per-request nonce; Leaflet sets inline styles. Strict scripts are NUD-110 |
| 2026-10-18 | NUD-093 | Headers and CSP are set in `next.config.ts` (build / start time env), not in the proxy | The proxy skips `/api` and files with extensions, so it would miss API routes, `offline.html` and `sw.js`; the cost is a redeploy after changing `MAP_TILE_URL` / `S3_*` (documented) |
| 2026-10-18 | NUD-093 | Added a public `POST /api/csp-report` (`report-uri`) that only logs one sanitized line and answers 204 | Makes report-only rollout and production monitoring possible and gave the e2e run a way to detect violations server-side across all specs |
| 2026-10-18 | NUD-093 | Zod runs `jitless` in the browser (`src/instrumentation-client.ts`) | Its `new Function` probe is blocked by the CSP and reported as a violation although zod copes; adding `'unsafe-eval'` would weaken the policy |
| 2026-10-18 | NUD-093 | `Permissions-Policy: camera=(self)` although driver photos use `<input capture>` | The attribute needs no permission; the entry only keeps a future `getUserMedia` working on our own origin and denies embedded frames |
| 2026-10-18 | NUD-093 | Origin check: reject a foreign `Origin` or cross-site `Sec-Fetch-Site`, let requests with neither header pass | Browsers always send one of them on cross-site POSTs; header-less clients are not browsers (cookies would be needed anyway) and the existing tests / Playwright API calls stay valid |
| 2026-10-18 | NUD-093 | One daily route `GET /api/cron/retention` for screenshots and old `LoginAttempt` rows instead of a screenshot-only route | `recordFailure` only cleans up on the next failure, leaving IP addresses in the table after quiet periods; one cron entry, one secret |
| 2026-10-18 | NUD-093 | Screenshot purge deletes the storage object first, then the row; a failed item is kept for the next run; not written to the audit log | A row without object is harmless and self-healing, an object without row would be orphaned forever; audit entries would copy what retention removes (exempt in `audit-coverage.test.ts`) |
| 2026-10-18 | NUD-093 | Invalid / zero `SCREENSHOT_RETENTION_DAYS` falls back to 180 instead of disabling or deleting everything | A typo must not be able to switch retention off or purge all screenshots |
| 2026-10-18 | NUD-093 | Audit-log retention only documented (design in `docs/privacy.md`), not implemented (NUD-111) | Instruction from the ticket owner: the append-only trigger would need a deliberate bypass; the period is a client decision |
| 2026-10-18 | NUD-093 | `braces` advisory accepted via `auditConfig.ignoreGhsas` | No patched release exists, dev-only path, production audit clean; CI still fails on any new high / critical |
| 2026-10-18 | NUD-093 | Authz matrix tests behaviour with a stubbed database instead of the embedded Postgres | Runs in every `pnpm test` without DATABASE_URL, so the 100 % coverage gate can never be skipped; role / active re-check against the DB is simulated by the stub |
| 2026-10-18 | NUD-094 | Sentry is optional: no `SENTRY_DSN` = SDK never loaded (dynamic imports, Turbopack drops the client branch); browser DSN is build-time (`NEXT_PUBLIC_SENTRY_DSN` from `SENTRY_DSN`) | Zero overhead and no network without DSN; verified in the build output |
| 2026-10-18 | NUD-094 | Sentry events are scrubbed in `beforeSend`/`beforeBreadcrumb` (no body, cookies, query strings, user, headers but UA/language, console, offline noise); errors only, no tracing/replay; no tunnel route, the DSN host goes into CSP `connect-src` | Data protection (NUD-093 rules); simplest CSP change; a tunnel would add a route and bandwidth |
| 2026-10-18 | NUD-094 | Source maps uploaded only if DSN + `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` are all set, then deleted from the output; not run here | Build must stay identical and offline-safe without a token |
| 2026-10-18 | NUD-094 | Test error = `GET /api/monitoring/test-error` guarded by the existing `CRON_SECRET` bearer instead of an admin UI button (`?mode=throw` tests the automatic hook) | Smallest authz surface, curl-able, fits the SECRET_ONLY matrix; no new secret |
| 2026-10-18 | NUD-094 | Error pages: `(app)`/`(shell)` boundaries keep the shell; driver page checks `navigator.onLine` and shows a calm offline variant that reloads via the service worker; admin page shows only the digest; `global-error.tsx` reads texts from a generated JSON (`i18n:build`) | Offline sync must stay mounted; no scary message offline; no intl provider in global-error |
| 2026-10-18 | NUD-094 | Weekly backup uses a separate R2 bucket + token, a read-only `backup_reader` role, `pg_dump --format=custom`, excludes `LoginAttempt` data, keeps 8 weeks but never fewer than the newest 4, no R2 lifecycle rule; verify job restores into a disposable postgres:16 | Blast-radius separation; a stalled schedule must not empty the bucket; backup of throttling data adds only personal data (IPs) |
| 2026-10-18 | NUD-094 | Photos/screenshots are not part of the backup | Objects live in R2; acceptable for v1, noted in deploy.md |
| 2026-10-18 | NUD-094 | `pnpm admin:reset-password`: password only via env, hidden prompt or stdin (no argument), admin role only, clears the lockout, `--yes` required when not interactive | No password in shell history/process list; avoids resetting the wrong role |
| 2026-10-18 | NUD-094 | Orphan cleanup shipped with default `dry-run`, grace 14 days (min 7), key-shape allowlist, reference re-check, caps and a plausibility abort; `Storage.list` added | Deleting objects is irreversible: the operator enables delete after reading dry-run reports |
| 2026-10-18 | NUD-094 | Hidden error test pages exist only with `ENABLE_ERROR_TEST_PAGES=true` (CI e2e); the production env check rejects the variable | Need a real thrown error in e2e without shipping a crash route |
| 2026-10-18 | NUD-095 | Driver UI keeps supporting dark mode through `prefers-color-scheme` (no toggle); verified with axe in all four locales | The tokens existed since NUD-005; light-only would be a regression for night driving |
| 2026-10-18 | NUD-095 | Status buttons stay in the page flow, not sticky; checked to be in the bottom half at the end of the page | A sticky "Delivered" invites a tap before the quantities are read (client priority 2) |
| 2026-10-18 | NUD-095 | Map credit line (OSM / Leaflet) exempt from the 16 px / 48 px rule; driver map markers and zoom buttons enlarged | Attribution is required text; markers and zoom are real controls |
| 2026-10-18 | NUD-095 | `Button size=lg` is `min-h-12` and wraps; driver buttons use min-heights | Fixed heights clipped labels at 130 % font size |
| 2026-10-18 | NUD-095 | 130 % font size emulated through root font size; throttling through CDP on a desktop CPU | Only available emulation here; real devices are NUD-115 |
| 2026-10-18 | NUD-095 | Lighthouse CI runs through `pnpm dlx @lhci/cli@0.15.1` on a warm logged-in profile, not as a project dependency; LCP < 2.5 s error budget | `@lhci/cli` adds 4 high advisories to `pnpm audit` (CI gate); the budget is "after first load" |
| 2026-10-18 | NUD-095 | Toast region label localized and sonner hotkey removed | The default label is English and mentions a keyboard shortcut a phone does not have |
| 2026-10-18 | NUD-096 | UAT script offers two data modes (demo seed with `--today`, or the client's real data) and keeps the sign-off block empty; wording issues are routed to `pnpm i18n:import`, not to code tickets | Drivers see only today's tour, and the demo seed must never touch production; the Chinese texts are still unreviewed (NUD-073) |
| 2026-10-18 | NUD-097 | `await connection()` at the top of `requirePageActor` (page guards only), not in `requireRole` | Fixes the Auth.js CSRF `getRandomValues` prerender error at its cause; actions/route handlers are already request-scoped and stay unchanged |
| 2026-10-18 | NUD-098 | OpenCC guard = file split (`localized-text.server.ts`) + ESLint `no-restricted-imports` + bundle scan in `pnpm build`, instead of the `server-only` package | `server-only` is not installed (no pnpm install here) and throws under tsx/vitest without aliasing; the ESLint rule + bundle scan catch the same mistakes without touching scripts and tests |
| 2026-10-18 | NUD-099 | Late orders are handled with a follow-up tour (second `Tour` row for the date, D5) instead of re-opening the completed tour; no schema change | COMPLETED is final in the status machine (NUD-043) and the driver's completed stops must never change; a second tour reuses planning, release, driver and audit unchanged |
| 2026-10-18 | NUD-099 | "Late order" = CONFIRMED order on no stop while every tour of its day is COMPLETED; with an open tour the existing outdated flag / rebuild / re-release path decides, `markOutdatedForDate` keeps skipping COMPLETED tours | One rule, no new flag; detection by the unlinked-order query as the ticket asked |
| 2026-10-18 | NUD-099 | Tour code reads the day's orders with a scope ("not on a stop of another tour of that day"); a customer delivered in tour 1 who orders again gets a second, separate stop in the follow-up tour with only the new quantities | Keeps D5 "all confirmed orders of a customer merged into one stop" per tour; prevents double delivery and false "added" diffs |
| 2026-10-18 | NUD-099 | Increased / changed / cancelled quantities on already delivered stops are NOT re-dispatched; shown as a conflict note, correction = new order for the difference (automation: NUD-117) | Delivered stops are frozen (NUD-043); goods cannot be un-delivered; simplest safe behaviour |
| 2026-10-18 | NUD-099 | Only one follow-up tour may be open at a time (create refused while any tour of the day is not COMPLETED); further late orders flag that tour outdated and are added by rebuild / re-release | Avoids several half-planned tours and double clicks; matches "1 tour per date" as far as possible |
| 2026-10-18 | NUD-099 | Planning page selects the tour by `?tour=<id>` (default: newest open tour, else newest) and shows tabs only with two or more tours; driver gets the newest RELEASED / IN_PROGRESS tour, else the newest COMPLETED one; dashboard shows the open tour | Single-tour days look exactly as before; a released follow-up must replace the finished screen |
| 2026-10-18 | NUD-099 | New audit action `tour.followup` instead of reusing `tour.generate` | The history must say that this tour was created for late orders; vocabulary stays a closed list (NUD-092) |
| 2026-10-18 | NUD-099 | Order form warning not built, only overview notice + badge, dashboard hint and planning banner; ticket NUD-116 | After saving, the overview opens on that day and already shows the notice; the form needs another action + matrix row |
| 2026-10-18 | NUD-106 | Manifest `start_url` is the locale-neutral `/driver?source=pwa` for all locales; the existing unprefixed-path redirect in `proxy.ts` (session locale -> cookie -> Accept-Language -> `de`) picks the language at launch; per-locale manifests kept for the localized name | Simplest fix without a re-install hint; reuses the NUD-003 rule; `id` and `scope` unchanged |
| 2026-10-18 | NUD-106 | The unprefixed redirect is `no-store`; the worker treats `/driver` as a network-only navigation and never stores it | The answer depends on session and cookie |
| 2026-10-18 | NUD-106 | Offline launch: `offline.html` forwards `/driver` to `/<NEXT_LOCALE cookie>/driver` (German if missing), no extra precache entry and no locale stored in IndexedDB / localStorage | The cookie is already written by login and the switcher and is readable by script; the IndexedDB record has no locale |
| 2026-10-18 | NUD-108 | No tile pre-caching by default; offline / failing tiles remove the tile layer and show a plain background plus a localized notice, markers and route stay | Provider terms generally forbid bulk caching (OSM policy); simplest safe behaviour, never a blank or broken-tile map |
| 2026-10-18 | NUD-108 | Tiles count as failed after 4 tile errors in a row (reset by any loaded tile); the tile layer returns on the `online` event | Single missing tiles at the edge must not hide the map; a dead provider must not cause endless requests |
| 2026-10-18 | NUD-108 | Opt-in `MAP_TILE_CACHE=1` (default OFF, explicit `MAP_TILE_URL` required, build-time for the worker): worker cache-first for tiles the page requested, LRU 300, 7 days, CORS 200 only (`crossOrigin` on the tile layer), CSP `connect-src` gets the tile host only then | Browser-cache-like, no prefetch; opaque responses would cost ~7 MB quota each; worker fetches are checked against connect-src |
| 2026-10-18 | NUD-108 | The notice lives in `TourMap` itself (also the admin tour map), strings in new namespace `maps` | One component, one behaviour; admin planners get the same honest hint |
| 2026-10-18 | NUD-108 | Marker tap -> stop detail not added (does not exist today); ticket NUD-119 | Out of scope of the offline ticket |
| 2026-10-18 | NUD-110 | Hybrid script CSP in production: per-request nonce (proxy) for everything Next.js renders per request + SHA-256 hashes for the inline scripts of the prebuilt documents; `script-src 'self'` for API / files; no `'unsafe-inline'`, no `'strict-dynamic'` | Measured on the 16.4.2 build: the nonce reaches the PPR resume part, the prebuilt shells have 2 fixed inline scripts (+ flight data in 4 static page types), so hashes cover them; the Next docs' "PPR incompatible" only holds for the prebuilt part |
| 2026-10-18 | NUD-110 | `experimental.sri` not used | Webpack-only in 16.4.2, and SRI does not cover inline scripts |
| 2026-10-18 | NUD-110 | Two `next build` passes in `pnpm build` / `build:vercel` plus a `check` step that fails on any mismatch; hashes inlined into the proxy via `next.config` `env`; build ID pinned between the passes | The proxy bundle is built before the prerendered HTML (and its hashes) exist; run-time file reads from the proxy cannot be verified on Vercel; a mismatch must break the build, never the site |
| 2026-10-18 | NUD-110 | The CSP of pages moved from `next.config.ts` to `src/proxy.ts`; `next.config.ts` keeps it for the complement of the proxy matcher only | One policy per response (two CSP headers would intersect); API routes, files and the worker are not seen by the proxy |
| 2026-10-18 | NUD-110 | `offline.html` script moved to `public/offline.js` (precached), `onclick` removed | Static files get `script-src 'self'`; hashing a file generated after `next build` is not possible from `next.config.ts` |
| 2026-10-18 | NUD-110 | Development keeps `'unsafe-inline' 'unsafe-eval'` and no nonce | HMR needs them and a nonce would disable `'unsafe-inline'`; strictness is asserted by the e2e on production builds (skipped on `pnpm dev`) |
| 2026-10-18 | NUD-110 | `style-src 'unsafe-inline'` left as is | Out of scope (ticket is about scripts); Leaflet sets inline styles |
| 2026-10-18 | NUD-110 | Rate-limit integration test uses days in the future instead of fixed dates | Fixed dates became "past" on 2026-10-18 and collided with attempts logged with the real clock (test-only fix) |
| 2026-10-18 | NUD-111 | The trigger's bypass switch is the transaction-local setting `nudel.audit_retention = 'on'` (not `app.audit_retention` as in the older design text) | Task/ticket owner's instruction for the final name; namespaced to this app, only visible inside the transaction that sets it |
| 2026-10-18 | NUD-111 | The 90-day floor lives inside the trigger function (database clock) in addition to `MIN_AUDIT_RETENTION_DAYS` in the app; a shorter period in code is refused, not clamped | The app cannot delete recent history even with the switch on or after a bug; a refused run is visible, a silently clamped one is not |
| 2026-10-18 | NUD-111 | `AUDIT_RETENTION_DAYS` default 730, accepted 90..36500, invalid / out-of-range falls back to 730 (not to the floor) | Same principle as `SCREENSHOT_RETENTION_DAYS`: a typo keeps more history instead of deleting more; 24 months as proposed in `docs/privacy.md`, pending client confirmation |
| 2026-10-18 | NUD-111 | Daily run, batches of 1000 rows in separate transactions, at most 20 batches (20 000 rows) per run, `more` flag | Bounded lock time and function duration (60 s); a large backlog is worked off over several days |
| 2026-10-18 | NUD-111 | The retention run writes no audit entry; it reports counts in the response and one sanitized log line | An entry about deleting entries would be one more row to delete later; same as the screenshot retention |
| 2026-10-18 | NUD-112 | Orders, tours and stops are never deleted or anonymised by a job; no `ORDER_RETENTION_DAYS`. Only `Stop.problemNote` is scrubbed | The analysis finds no personal data in them beyond user ids and free text; business history must stay (backlog 4.3, disputes, accounting, completed tours stay complete); whole-order retention is a client question (section 10) |
| 2026-10-18 | NUD-112 | Driver text period 365 days from `Stop.completedAt`, `DRIVER_TEXT_RETENTION_DAYS` 30..3650, invalid values fall back to 365, below 30 refused in code | Disputes about a delivery arise within months; the structured reason stays; proposal until the client confirms. Same typo principle as the other retention variables |
| 2026-10-18 | NUD-112 | `DATA_RETENTION_MODE` `dry-run` (default) / `delete` / `off`; unknown values mean `dry-run` | Irreversible removal defaults to report-only (backlog 0 rule 5), same convention as `ORPHAN_CLEANUP_MODE`. So after deployment nothing is removed until the operator sets `delete` |
| 2026-10-18 | NUD-112 | The whole `problemNote` JSON is set to NULL (original, translation, pending marker); the structured `problemReason` stays | The translation is a copy of the same personal text; a NULL note is already a valid state in every view and for the translation retry job |
| 2026-10-18 | NUD-112 | The scrub job is exempt from the audit rule with a reason instead of writing an aggregate audit entry | `AuditLog` needs a user id as actor and a per-record entity from a closed vocabulary (NUD-092); a system job has neither; counts go to the response and the log, as for the screenshot and audit retention |
| 2026-10-18 | NUD-112 | Copy of the note in the `stop.problem` audit entry left as is; ticket NUD-121 | Changing what audit entries store is a separate decision (history views, client period); documented as known gap in `docs/privacy.md` |
| 2026-10-18 | NUD-112 | Erasure runbook uses manual SQL for driver texts, screenshots and photos before their period | No admin UI to delete these exists and building one is out of scope; steps are explicit and touch one column / row |
| 2026-10-26 | – | The owner's four pre-deploy fixes are tracked as NUD-122…127 (NUD-127 = the vServer deploy) and worked in that order, one ticket per session; they depend only on `done` tickets, so the older `todo` tickets (mostly 👤 HUMAN) stay untouched | AGENTS.md: one ticket per session, lowest-numbered eligible one; the owner asked for this order explicitly |
| 2026-10-26 | NUD-122 | Office upload and driver upload are two tickets' worth of one defect: same root cause class, but two separate code paths and two separate fixes; the `head()` existence gate stays | Direct server action vs. IndexedDB outbox + flush (`photo-outbox-flush.ts`); the gate is what makes a missing object visible instead of storing a dangling key |
| 2026-10-26 | NUD-122 | A storage provider must never be reported as working when it cannot store: `/api/uploads` must not hand out a non-`http(s)` URL and the client rejects one as `UPLOAD_FAILED` | The silent `FakeStorage` fallback in non-production (`storage/index.ts`) is what let the UI look alive while `Photo` stayed empty |
| 2026-10-26 | NUD-124 | "Beutel" is the existing `PACK` unit relabelled in the UI (de + zh-Hans); no Prisma enum change, no fourth unit | The owner asked for the label only; an enum migration would be risk without benefit |
| 2026-10-26 | NUD-124 | The 6 demo products are retired with `Deaktivieren` (`active=false`); demo `OrderItem`s, if any, are moved to the matching new product — orders are never deleted | §4.3 soft delete; `OrderItem.productId` is `onDelete: Restrict`; D19 keeps order history. Owner confirmed there are no real orders on them |
| 2026-10-26 | NUD-125 | Parking spots are a list per customer; the office manages them and a driver may add one; routing/optimisation keeps using the single customer pin | Owner decision; one point per stop keeps the D5 optimisation model unchanged |
| 2026-10-26 | NUD-126 | Navigation guides to the parking spot first, the shop entrance second | Owner decision; client priority 4 (stored shop and parking photos) |
| 2026-10-26 | NUD-122 | The office upload path is not broken in the current environment; the reproduced defect is the driver outbox. The bucket's 111 `.jpg` objects come from e2e runs that delete their test customer (orphan objects), and the office client already reports a rejected PUT honestly | Measured in a real browser against MinIO: office presign → PUT 200 → attach 200 → `Photo` row; driver capture → `applied` → `Gesendet`. With the PUT forced to 403 the driver waited 60 s+ over 5 silent retries — that is the owner's symptom |
| 2026-10-26 | NUD-122 | An *answered* error while sending a driver photo (rejected PUT, failing grant, non-ok register) is counted per entry and, after `MAX_HTTP_FAILURES = 3`, drops the photo with an `upload_failed` notice; a *network* failure (offline) keeps retrying without limit | A configuration error must not leave a badge that never changes, but offline must never cost a photo (D17) |
| 2026-10-26 | NUD-122 | After `upload_failed` the driver takes the photo again instead of pressing a "retry" button: the blob is dropped together with the entry and a retry against a broken configuration would only loop | IndexedDB is a queue, not a permanent store; the notice names the customer and the slot shows the placeholder again, which is the honest retry |
| 2026-10-26 | NUD-122 | `POST /api/uploads` answers `503 STORAGE_UNAVAILABLE` for a target a browser cannot PUT to, the client rejects a non-`http(s)` grant as `UPLOAD_FAILED`, and `getStorage()` no longer caches a fallback Fake for the process lifetime | A `fake://upload/...` grant is a half-success no browser can complete — the failure mode that made the UI look alive while nothing was stored |
| 2026-10-26 | NUD-122 | `customer-photos.spec.ts` throws when `S3_*` is missing instead of skipping itself (explicit opt-out `ALLOW_MISSING_S3=1`); the CI e2e job gets a MinIO service and a bucket-creation step | It is the only browser test of the real upload path and it used to skip itself in CI, which is why the gap stayed invisible |
| 2026-10-26 | NUD-123 | All three "add" flows work through the GUI; the "one broken Select" theory is dropped. The driver form uses a native `<select>`, the customer form no select at all, and the order form's redesigned `Combobox` filters and selects correctly | Reproduced each flow in a real browser against the seeded dev server; created a driver (+PIN), a customer (`pinConfirmed`) and a `CONFIRMED` order with an item |
| 2026-10-26 | NUD-123 | The add-order e2e assertions were realigned to the ICU plural unit labels instead of the old singular; the sibling specs get NUD-128 | `orders.spec.ts` was red only on `"2,5 Packung"` vs `"2,5 Packungen"` while the order was created correctly — a red run that looked like "add order is broken" |
| 2026-10-26 | NUD-123 | Realigning only `orders.spec.ts` in this ticket, everything else about the redesign's presentation drift goes to NUD-128 | Backlog §0: stay in scope, missing things become new tickets |
| 2026-10-26 | NUD-123 | The first-start language picker needs no change: a GUI-created driver is `localeChosen = false`, the layout guard redirects to `/driver/start` and the picker renders. `drivers.spec.ts` fails only under `pnpm dev` (5 s `toHaveURL` vs. an on-demand route compile) | Verified in a browser plus a control driver written straight into the DB; `RUN-AND-TEST.md` §8 documents the dev-mode flakiness, CI runs a production build |
| 2026-10-26 | NUD-131 | `127.0.0.1` goes into `allowedDevOrigins` (plus `DEV_ALLOWED_ORIGINS` for a phone/tunnel), instead of telling everyone to use `localhost` | The owner hit it from the tablet/desktop and it is indistinguishable from "the app is broken": Next 16 blocks cross-origin dev requests, the page renders server-side and every button is dead. The env var also protects the upcoming real-device tickets (NUD-107/109/115) from the same trap |

## 10. Open questions for the client (do not block on these – use placeholders)

- Exact depot (factory) address → set in Settings (NUD-012).
- Real product list with units and Chinese names → seed / product admin (NUD-020).
- Existing customer list file → import (NUD-090).
- Which Chinese variant(s) the drivers actually read → collected in UAT (NUD-096); all four locales ship regardless.
- Vehicle type (car vs. van/truck profile for routing) → ORS profile setting (NUD-040).
- Map tile provider account for production (NUD-011) and DeepL API account (NUD-070).
- Retention of orders, tours and stops (NUD-112): keep forever (current behaviour, nothing is deleted), or delete / anonymise completed orders and tours after N years (proposal 3 years, or as long as accounting and dispute obligations require)? What may be anonymised: `Order.internalNote`, the driver link of tours? Also confirm the driver text period (365 days proposed) and the audit period (730 days proposed). Until decided nothing is deleted; the periods are variables (`docs/privacy.md` section 6).
