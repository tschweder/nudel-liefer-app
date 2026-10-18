# AGENTS.md

Conventions for coding agents. Source of truth: [`backlog.md`](./backlog.md) (read §0-§6 each session) and [`projektbeschreibung.md`](./projektbeschreibung.md). If they disagree, backlog §2 Decisions wins.

## Workflow (backlog §0)

- One ticket per session: lowest-numbered `todo` ticket whose `depends_on` are `done`.
- Set `in-progress` before starting, `done` only when all acceptance criteria and the Definition of Done pass. Update the §7 index row too.
- Stay in scope; missing things become new tickets. Unspecified details: simplest option consistent with §2, one line in the Decision log (§9). Irreversible actions: mark `blocked` and stop.
- Never commit secrets; config via env vars documented in `.env.example` (and `docs/env.md`).
- Commit message: `NUD-xxx: <title>`.

## Conventions (backlog §4)

- Stack: Next.js App Router, TypeScript strict, pnpm, Prisma + PostgreSQL, Tailwind + shadcn/ui, next-intl, zod, Auth.js v5, Vitest, Playwright.
- Code, identifiers, comments, commits in English; all UI text through next-intl (4 locales: `de`, `zh-Hans`, `zh-Hant-HK`, `zh-Hant-TW`). `zh-Hant-*` message files are generated, never hand-edited.
- Layout: `src/domain` (pure logic, no framework imports), `src/server` (db, services, providers), `src/components`, `src/lib`, `tests/e2e`, `docs`.
- Server mutations: zod validation + server-side role check. Providers (geocoder, routing, translator, storage) behind interfaces with a Fake implementation.
- Auth: every server action / route handler starts with `requireRole(...)` from `src/server/auth/guards.ts` (the proxy is not enough); driver mutations use `requireRole("DRIVER")`. A new server action (`"use server"` module export) or `route.ts` handler must get a row in `src/server/authz-matrix.test.ts` (the test enumerates the source tree and fails otherwise); state-changing route handlers call `rejectCrossOrigin` (`src/server/csrf.ts`), read bodies with `readTextLimited`, and every zod string/array on client input needs `.max()` (`input-limits.test.ts`). Security headers / CSP: `src/lib/security-headers.ts`, see `docs/deploy.md` section 11; personal data and retention: `docs/privacy.md`.
- Soft delete only (`active=false`). Driver UI: touch targets >= 48 px, body >= 16 px.
- Use the glossary in backlog §3 (Tour vs. route, Stop, Release, ...).
- UI kit: shadcn-style components in `src/components/ui` (use `cn` from `src/lib/utils`); shared states `EmptyState`/`ErrorState`/`LoadingSkeleton` in `src/components/shared/states.tsx`; format dates/quantities with `createAppFormatters` (`src/lib/format.ts`). Driver screens use `size="lg"` / `icon-lg` buttons (48 px). New admin pages go under `src/app/[locale]/admin/` (layout guard + `requirePageActor` in the page), driver pages under `src/app/[locale]/driver/(app)/` (the login page stays outside the group).

## Commands

`pnpm dev` | `pnpm lint` | `pnpm typecheck` | `pnpm test` | `pnpm test:e2e` | `pnpm i18n:build` | `pnpm i18n:check` | `pnpm format` | `pnpm db:migrate` | `pnpm db:seed` | `pnpm db:embedded` (Postgres without Docker) | `pnpm build:vercel` (Vercel build: env check, `prisma migrate deploy`, `next build`). Deployment guide: `docs/deploy.md`; `GET /api/health` checks DB + storage.

## Definition of Done (backlog §5)

`pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` green (plus `pnpm test:e2e` for UI flows); new UI text in `de` + `zh-Hans`; authorization tests for new mutations; env vars documented; migrations committed; screens checked at 375 px (driver) / 1280 px (admin); implementation notes added under the ticket.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## OpenCC is server-only (NUD-098)

- `opencc-js` ships ~1.2 MB of dictionaries. It is imported only by `src/lib/opencc.ts` and `src/lib/localized-text.server.ts` (`withDerivedHant`), which belong to server code, scripts and tests. `src/lib/localized-text.ts` is the client-safe half (types, schema, `LOCALES`, `pick`); never import OpenCC into it, into `src/components/**`, `src/domain/**` or `src/sw/**` (ESLint `no-restricted-imports` enforces this).
- Backstop: `pnpm check:client-bundle` scans `.next/static` for OpenCC dictionary entries and fails the build if one is found (it runs at the end of `pnpm build` / `pnpm build:vercel`; `--report` prints the first-load JS of `/de/driver` and `/de/admin`). If it fails, find the client component that reaches OpenCC through a shared import and move the OpenCC use behind a server action or server module.

## Content-Security-Policy: no inline scripts (NUD-110)

- Production `script-src` is `'self'` + a per-request nonce + the hashes of the prebuilt shells (`src/proxy.ts`, `src/lib/security-headers.ts`, `docs/deploy.md` section 11.1a). Never add `'unsafe-inline'` / `'unsafe-eval'` to make something work; fix the cause (no `onclick="..."`, no inline `<script>` in `public/*.html`, no `dangerouslySetInnerHTML` scripts; put code in a file or a client component).
- Build with `pnpm build` (two `next build` passes + `scripts/csp-script-hashes.ts check`). `.csp-script-hashes.json` is a git-ignored build artifact. `pnpm dev` keeps the loose development policy, so check script changes against a production build (`security-headers.spec.ts` asserts the strict policy there).

## Monitoring and error pages (NUD-094)

- Sentry is optional and loaded only through dynamic imports behind `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (zero overhead without). Every event goes through `src/lib/sentry-scrub.ts`; never add request bodies, cookies or query strings. The DSN host is added to the CSP `connect-src` by `src/lib/security-headers.ts`.
- New cron/ops routes use the bearer `CRON_SECRET` and need a `SECRET_ONLY` row in `src/server/authz-matrix.test.ts`.
- Audit log (NUD-092/111): append-only. The only delete path is `src/server/audit-retention.ts` (cron `GET /api/cron/audit-retention`), which sets the transaction-local `nudel.audit_retention = 'on'`; the trigger function honours it for `DELETE` of rows older than 90 days only (floor in SQL and `MIN_AUDIT_RETENTION_DAYS`). Never write another `DELETE`/`UPDATE` on `"AuditLog"` (`audit-coverage.test.ts` fails); a new migration touching the trigger function must keep both rules.
- Each segment has an `error.tsx` (driver, admin, `global-error.tsx`); texts live in `errorPages.*` (global-error reads the generated `src/lib/fatal-messages.json`, rebuilt by `pnpm i18n:build`).
- Operations: `docs/runbook.md`.
