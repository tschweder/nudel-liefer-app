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
- Auth: every server action / route handler starts with `requireRole(...)` from `src/server/auth/guards.ts` (the proxy is not enough); driver mutations use `requireRole("DRIVER")`.
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
