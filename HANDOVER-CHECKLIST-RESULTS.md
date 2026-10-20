# Nudelfabrik handover checklist — results of the human pass

Run on 2026-10-18 on Windows, against `nudel-liefer-app` at commit `7f7f63b` (`NUD-112`).
Toolchain found: Docker Desktop 29.6.2 (running), Node v24.13.1, pnpm 12.14.0 (repo-pinned), Git 2.49.0.

The checklist's own status line is **exactly right**: 44 done / 7 blocked (NUD-001, 002, 004, 006,
007, 073, 096) / 17 todo, matching the `backlog.md` index row for row.

**Headline: phases 1, 3, 4 are partly verifiable and two of them do not pass as written.** Phase 1
cannot be completed because three separate blockers stop the prescribed commands; phases 2, 5, 6, 7,
8 need accounts, phones, a deployment and the client, and were not attempted.

---

## What passes

| Check | Result |
|---|---|
| Docker, Node, pnpm, Git installed and working | ✅ (Node 24.13.1 ≥ `engines.node` 22) |
| `pnpm db:migrate` | ✅ all migrations applied |
| `pnpm db:seed` | ✅ `Seed finished` (1 admin, 5 drivers, 3 customers, products) |
| `pnpm lint` | ✅ exit 0 |
| `pnpm typecheck` | ✅ exit 0 |
| `pnpm i18n:check` | ✅ `i18n:check ok` |
| `pnpm test` | ✅ **after 2 fixes** — 143 files passed / 1 skipped, 1604 tests passed |
| `pnpm install --frozen-lockfile` (CI + Vercel path) | ✅ lockfile up to date |
| `pnpm exec playwright install chromium` | ✅ |
| Photo upload against real MinIO | ✅ full pipeline verified (see below) |
| `pnpm i18n:export` | ✅ wrote 998 rows to `i18n-review.csv` |
| `pnpm i18n:import <csv> --dry-run` | ✅ round-trips with 0 changes |
| `pnpm db:seed --demo --today` flags | ✅ supported in `prisma/seed.ts` |
| Every `docs/deploy.md` section the checklist cites | ✅ §1, §2, §3, §4, §5, §6, §7, §9, §11.1a, §11.3, §12.2, §13.1 all exist |
| `scripts/check-storage-private.ts`, `.github/workflows/backup.yml`, `vercel.json` crons | ✅ exist and match the docs |
| All env vars in the checklist documented | ✅ in `.env.example` + `docs/env.md` |
| `docs/uat.md` §9 pre-UAT checklist, §7 sign-off, §5 feedback form | ✅ exist |

---

## Blockers found (these stop Phase 1)

### 1. `docker compose up -d` fails — both MinIO images no longer exist

```
Image minio/mc:latest Error pull access denied for minio/mc, repository does not exist
Error response from daemon: pull access denied for minio/minio, repository does not exist
```

`minio/minio:latest`, `minio/minio:edge`, `minio/minio:RELEASE.2025-04-22…`, `quay.io/minio/minio`,
`bitnami/minio` — **all unavailable**. `postgres:16` pulls fine, so `docker compose up -d postgres`
works but the MinIO service and its `minio-init` bucket-creation container cannot start.

*Impact:* the checklist step "Check photo upload against MinIO" cannot be done as written.
*Workaround found:* `chainguard/minio:latest` pulls and runs.
*Fix:* update `docker-compose.yml` to a pullable MinIO image (or document the manual step).

### 2. `pnpm install` fails on Windows — `ERR_PNPM_IGNORED_BUILDS`

```
× installing dependencies
╰─▶ Ignored build scripts: @embedded-postgres/windows-x64@16.14.0-beta.17
```

`pnpm-workspace.yaml` → `allowBuilds` listed only `@embedded-postgres/linux-x64`. On Windows the
native package is a different one, so pnpm refuses the install and exits 1.
*Fixed* — see "Changes made" below.

### 3. `pnpm test:e2e` fails heavily — two independent root causes

**Run exactly as the checklist prescribes** (`pnpm test:e2e`, dev server):

```
198 failed
119 did not run
19 passed (20.8m)
```

**Run the way CI does** (production build, env exported):

```
168 failed
4 flaky
78 did not run
90 passed (12.6m)
```

**Cause A — the Playwright process never loads `.env`.** The e2e specs read
`process.env.DATABASE_URL` directly (e.g. `tests/e2e/admin-progress.spec.ts:36`), but only
`vitest.config.ts` imports `dotenv/config`. Playwright loads nothing, so `DATABASE_URL` is
undefined and `pg` throws:

```
Error: SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string
```

CI gets away with it because its workflow sets `DATABASE_URL` in the job `env:` block. A developer
following the checklist has only a `.env` file, so every spec that touches the database fails.
*Fix:* export the variables, or add `import "dotenv/config"` to `playwright.config.ts`.

**Cause B (dominant) — the suite poisons its own login rate limit.** `MAX_FAILURES_PER_IP = 20`
(`src/server/auth/rate-limit.ts:7`). Every spec runs against the same IP (`::1`), and several specs
deliberately fail logins (the "6th wrong PIN" tests, wrong-credential tests). Once 20 failures land
inside the 15-minute window, `isRateLimited` short-circuits **every** login in the suite until rows
age out — so every login-dependent test fails with `CredentialsSignin`.

Evidence, queried live during the full run:

```
        key         | n  |          first          |          last
--------------------+----+-------------------------+-------------------------
 ip:::1             | 20 | 2026-10-18 18:36:00.049 | 2026-10-18 18:40:35.219
```

Exactly 20 — the limit itself, because once the bucket is full `authenticate` returns early *before*
recording, so the count pins at the cap.

Control experiment: after `DELETE FROM "LoginAttempt"`, `driver-a11y.spec.ts` alone went from
**52 failures → 8 failures (18 passed)**. The rate limit, not the app, was the cause.

*This is a test-infrastructure problem, not a product bug* — a single login driven sequentially
works perfectly (URL becomes `/de/admin`, POST 200, no console errors, dashboard renders). But the
e2e suite as shipped cannot pass, and **CI has never run to catch it** (see below).

**Remaining 8 a11y failures** are a separate test-harness race, not an app defect:

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
   at helpers/network.ts:25   (setOnline: context.setOffline() then page.evaluate())
```

### 3b. Outcome after the fixes

Measured on the same machine, CI-equivalent (production build, split demo seed):

| | baseline | after rate limit + build | after the network helper |
|---|---|---|---|
| passed | 90 | 270 | **304** |
| failed | 168 | 31 | **12** |
| `mvp-happy-path` (pass 2) | — | 4 / 4 | **4 / 4** |

**Fixed — 19 failures.** The offline family had one root cause in
`tests/e2e/helpers/network.ts`, which was hiding three separate bugs:

1. `context.setOffline(false)` makes Chromium fire a **real** `online` event (verified with a probe).
   The offline shell (`offline-driver-app.tsx`) and the driver error page (`driver-error.tsx`) reload
   on it, which destroyed the execution context in the middle of the helper's `page.evaluate` —
   `Execution context was destroyed, most likely because of a navigation`. The flag is now written
   *before* the network is touched, so the reloaded document reads the new value, and the evaluations
   survive navigations.
2. The helper also dispatched a synthetic event unconditionally, so the app saw **two** `online`
   events and started two reloads that cancelled each other — no `load` ever completed. It now
   dispatches only when the platform stays silent.
3. The reload could still be in flight when the caller's next `page.goto` ran —
   `Navigation … is interrupted by another navigation`. The online direction now waits for it.

`tests/e2e/error-pages.spec.ts` waited for `load`, which does not surface on the page object for a
service-worker-answered reload; it now waits for `framenavigated`.

That cleared `driver-a11y` (14), `driver-map-offline` (2) and `error-pages` (2).

**Still open — 9 to 11 depending on the run, all accounted for.**

Two groups, and they need different answers.

**A. Deterministic — "owns today's tour" (4 failures).** `admin-progress:155` and `late-orders:99`,
desktop and mobile. Both file headers say it outright: *"Run it alone: it owns 'today's tour' of the
database."* The suite runs files in parallel and many specs create a released tour for today, so the
dashboard's `pickDefaultTour` (NUD-099: *"the one that still needs work, else the newest"*) picks a
foreign open tour. `admin-progress` then reads "1 von 3" where it expects "0 von 3"; `late-orders`
never finds its "generate tour" button. This is a test-architecture problem, not a flake, and it needs
a decision — a separate serial project, a per-worker database, or scoping the assertions to their own
tour. Playwright's `dependencies` would fix the ordering but silently skips the whole project when
anything else fails, which hides tests.

**B. The offline "next stop" navigation (3–5 failures) — a product finding.** `driver-outbox:236/318`,
`driver-offline:284` and `driver-photo:306` all reduce to one thing: after marking a stop delivered
while offline, the app navigates to the next stop with a **soft navigation**, because `StopLink` in
`stop-detail.tsx` renders a next-intl `<Link>`. Offline there is no RSC payload to fetch, so Next.js
falls back to a hard navigation that the service worker answers with the offline shell. That fallback
is slow and sometimes never completes — the Playwright call log says it plainly:

```
- waiting for "http://localhost:3500/de/driver/stops/stop-1-…" navigation to finish…
```

Raising the assertion timeout to 15 s did not help, so it is not merely slow. **This affects real
drivers**: in a dead spot, tapping "next stop" can leave them on the previous screen. A hard
navigation (`<a>`) while `!online` would let the service worker answer immediately. Per `AGENTS.md`
("missing things become new tickets") this should become a ticket rather than an unannounced change.

**C. Flaky under parallel load (2–3 failures).** `customer-import:264`, `products:31` and
`driver-usability:44` fail in the full run and pass on their own. Not yet root-caused.

**The "did not run" number is benign.** The suite reports 30 tests as "did not run", which looked
alarming. It is not a bug: the JSON report shows **no test without a result**. All 47 skipped tests are
explicit `test.skip()` calls — the specs that need `S3_*` (16 in `driver-offline`, 6 in
`driver-outbox`, 6 in `sentry-ingest`, …) and the ones skipped on the wrong project. CI does not set
`S3_*` either, so those skip there too. Set `S3_*` (the local MinIO works) to run them.

So `pnpm test:e2e` is **not yet fully green**, and unlike the earlier passes this is no longer purely
test infrastructure: group B is a real offline-reliability finding.

### 4. A port-3000 collision silently invalidates the whole run

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`. On this machine port 3000 is
taken by a Forgejo container, so Playwright saw a live `http://localhost:3000` and **skipped starting
the app entirely** — the suite then tested Forgejo (`/de` → 404, 104 junk failures). Nothing warns
you. *Fix:* run with `PORT=<free port>` or make the readiness check app-specific.

### 5. CI has never actually run

`git remote -v` is empty — there is no remote. So checklist step "Push the repo to GitHub and confirm
CI is green" is unverified, and the 168 e2e failures above have never been caught by CI. `ci.yml` and
`backup.yml` look complete (postgres service, `--frozen-lockfile`, `pnpm audit --audit-level=high`,
the demo-seed split for `mvp-happy-path`).

---

## Gaps and inaccuracies in the checklist itself

- **No `.env` step.** Step 2 runs `pnpm db:migrate` with no `.env` present. The repo ships only
  `.env.example`; without copying it to `.env` there is no `DATABASE_URL`. The checklist never says so.
- **`openssl` is not on PATH on Windows.** Step 2's `openssl rand -base64 32` fails in PowerShell/cmd.
  It exists at `C:\Program Files\Git\usr\bin\openssl.exe` (works), or use
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- **`docs/deploy.md` §7 uses bash `read -rs`**, so it needs Git Bash on Windows, not PowerShell.
- **UAT test counts are overstated.** The checklist says "O-01 to O-94, D-01 to D-54, plus X-01 to
  X-03" (151 tests). The document actually contains **57 O-tests, 39 D-tests, 3 X-tests**; the
  numbering is non-contiguous (e.g. O-06…O-09, O-15…O-19, O-29 are unused). The maxima match, the
  counts do not.
- **`Order.internalNote`** is not its own §10 open question; it is folded into the retention bullet.
- **The bucket-privacy command as written cannot run.** `pnpm exec tsx scripts/check-storage-private.ts`
  needs `S3_ENDPOINT` and `S3_BUCKET` in the environment (it does not load `.env`); without them it
  exits 2, "not configured". `docs/deploy.md` §11.3 shows the correct form. The script itself was also
  broken — see below.
- `pw.local.config.ts` is untracked in the working tree and is not part of this check.

---

## Verified properly: the photo upload pipeline works

The compose image is broken, but the application's storage layer is fine. With
`chainguard/minio:latest` running and the bucket created, the real `S3Storage` implementation
(`src/server/storage/s3.ts`) was exercised end to end:

```
bucket created: nudel-photos
checkReachable: ok (credentials + bucket valid)
presigned PUT: HTTP 200 (expected 200)
head after upload: bytes=160 contentType=image/jpeg
presigned GET: HTTP 200 (expected 200), 160 bytes
list("customers/"): 1 object(s): customers/00000000-0000-4000-8000-000000000000.jpg
delete: ok, head now = null
```

So only `docker-compose.yml` needs the new image; no application code is at fault.

---

## Changes made to the repository

### First pass (the verification run)

1. **`pnpm-workspace.yaml`** — added `@embedded-postgres/windows-x64`, `darwin-x64`,
   `darwin-arm64` to `allowBuilds`. Without this `pnpm install` cannot succeed on Windows or macOS.
2. **`src/sw/tile-cache.test.ts`** — added `// @vitest-environment node`. The service-worker cache
   test has no DOM dependency, but ran under the jsdom default, where jsdom's `Blob` is not
   recognised by undici's `Response` and `res.text()` returns `"[object Blob]"`. Passes under `node`.
3. **`src/server/admin-password.integration.test.ts`** — spawn the tsx CLI through
   `process.execPath` + `node_modules/tsx/dist/cli.mjs` instead of the extensionless
   `node_modules/.bin/tsx`, which Windows cannot execute (`spawnSync … ENOENT`, `status: null`).

### Part 1 follow-up (applied on request)

4. **`docker-compose.yml`** — `chainguard/minio` + `chainguard/minio-client` replace the removed
   MinIO images, with a shell-free `MC_HOST_local` bucket init and an `mc ready self` healthcheck.
   Host ports remapped to **5123** (Postgres) and **9123 / 9121** (MinIO API / console).
5. **`playwright.config.ts`** — `import "dotenv/config"` so the specs see `.env`; `webServer.env`
   sets `LOGIN_MAX_FAILURES_PER_IP=1000000`.
6. **`src/server/auth/rate-limit.ts`** — new `maxFailuresPerIp()` reading `LOGIN_MAX_FAILURES_PER_IP`
   (1..1000000, default 20); `loginKeys()` takes the IP limit as a parameter. Default and the
   per-identifier limit unchanged, so production behaviour is identical.
7. **`src/server/auth/rate-limit.test.ts`** — new, 7 tests covering the env parsing and `loginKeys`.
8. **`scripts/check-storage-private.ts`** — top-level `await` moved into an `async main()` (tsx
   compiled it as CommonJS, so the script could not run at all), and `process.exit()` replaced with
   `process.exitCode` (the forced exit tripped a libuv assertion on Windows and lost the exit code).
9. **Docs made consistent with the new ports** — `.env.example`, `docs/env.md` (incl. the new
   variable), `docs/demo.md`.
10. **`handover-checklist.html`** — corrected checklist (`.env` step, Windows-safe secrets, the
    production-build note for e2e, the `S3_*` requirement for the bucket check, UAT counts, Git Bash
    note, PR-only CI jobs).

Also created (git-ignored, not part of the repo): a local `.env`.

## Environment left behind

The compose stack is up on the remapped ports. Stop it when you are done:

```bash
docker compose -f docker-compose.yml down
```

---

## Still needs a human (unchanged by this pass)

- **Phase 2** — OpenRouteService key, map tile account, DeepL key, `AUTH_SECRET`/`CRON_SECRET`,
  optional Sentry. Documentation is complete; the accounts are yours to create.
- **Phase 3** — the actual Neon/R2/Vercel deploy. Every referenced doc section and script exists.
- **Phase 4** — native-speaker review of the Chinese texts. Export/import tooling verified working.
  `docs/i18n.md` states plainly that the Chinese texts are unreviewed agent text.
- **Phase 5** — NUD-105, 107, 109, 113, 114, 115, 120 all need a real deployment and real
  Android/iPhone hardware. Their criteria are concrete and readable.
- **Phase 6** — the client UAT session itself (`docs/uat.md`).
- **Phase 7** — the client's answers to `backlog.md` §10.
- **Phase 8** — whether to run follow-ups NUD-116/117/118/119/121 and when to start M3.

## Recommended next actions

Items 1–4 of the original list are done (see "Part 1 follow-up" above). What remains:

1. **Push to GitHub and open a pull request** so CI runs for the first time. The `e2e` and
   `lighthouse` jobs only run on `pull_request`, so a push to `main` will not exercise them.
2. **Decide whether to keep `LOGIN_MAX_FAILURES_PER_IP=1000000` in `playwright.config.ts`** or move
   the cleanup into a per-spec fixture. The current fix is the smaller change; a fixture would also
   keep exercising the IP limit itself.
3. **Consider whether 20 failed logins per IP per 15 minutes is right** for an office behind one NAT.
   Unchanged by this pass — a decision for the client, not a code fix.
4. **Run the e2e suite against a production build from now on** (`CI=1 PORT=<free> pnpm test:e2e`).
   The dev server is too slow under parallel load and produces false failures.
