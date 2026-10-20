# Nudelfabrik — what to do now, step by step

Companion to [HANDOVER-CHECKLIST-RESULTS.md](HANDOVER-CHECKLIST-RESULTS.md). That file says what is
broken; this one says what to do about it, in the order that avoids rework.

**Critical path:** the project cannot currently be installed or tested on a fresh machine → fix that
→ get CI green → deploy → then the human/device/client work can start. Everything in Parts 6–9 waits
on Part 4.

Rough effort: Parts 1–4 are one focused day. Parts 5–8 are another day plus real-device time.
Part 6 has the longest lead time (external reviewers) — start it as early as you can.

---

## Part 0 — Clean up what I left running (2 minutes)

```bash
docker rm -f nudel-minio
docker compose -f docker-compose.yml down
```

`nudel-minio` is the container I started to verify photo uploads. The compose `down` stops the
Postgres I started for the test run.

---

## Part 1 — Make the project runnable again ✅ DONE

All four fixes are applied and verified. This section is kept as the record of what changed and why.
`pnpm install`, `db:migrate`, `db:seed`, `lint`, `typecheck`, `test` and `i18n:check` all pass, and
the end-to-end suite passes against a production build.

The host ports in `docker-compose.yml` were also remapped to **5123** (Postgres) and **9123 / 9121**
(MinIO API / console), and `.env.example`, `docs/env.md` and `docs/demo.md` were updated to match.

### 1.1 Replace the dead MinIO images

`docker-compose.yml` cannot start: `minio/minio` and `minio/mc` no longer exist on Docker Hub. I
tested replacements and confirmed these work end to end (server boots, healthcheck passes, bucket is
created):

```yaml
  minio:
    image: chainguard/minio:latest          # was minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
      MC_HOST_self: http://minioadmin:minioadmin@localhost:9000   # inside the container: always 9000
    ports:
      - "9123:9000"   # host ports are remapped; only the left number changes
      - "9121:9001"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "self"]   # was ["CMD","mc","ready","local"]
      interval: 5s
      timeout: 5s
      retries: 10

  minio-init:
    image: chainguard/minio-client:latest   # was minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    # The image is distroless: no /bin/sh, so the old `entrypoint: /bin/sh -c "..."` cannot work.
    # MC_HOST_local sets the alias without a shell.
    entrypoint: ["mc"]
    environment:
      MC_HOST_local: http://minioadmin:minioadmin@minio:9000
    command: ["mb", "--ignore-existing", "local/nudel-photos"]
```

Then `docker compose up -d` and confirm `docker compose ps` shows minio healthy.

### 1.2 Let Playwright see `.env` ✅

`pnpm test:e2e` failed everywhere because the test process had no `DATABASE_URL` (the specs read
`process.env.DATABASE_URL` directly; only Vitest loads dotenv). Added to `playwright.config.ts`:

```ts
import "dotenv/config";
```

dotenv never overwrites variables that are already set, so the CI workflow's `env:` block still wins.

### 1.3 Stop the e2e suite poisoning its own login rate limit ✅

There turned out to be **two** independent causes, not one. Both are fixed.

**Cause A — the shared per-IP limit.** Every spec runs from IP `::1`, and the suite's own deliberate
failed logins (the "6th wrong PIN" tests) fill `MAX_FAILURES_PER_IP = 20`. Once full, `isRateLimited`
short-circuits *every* login in the run. Proof: queried live during a run, `ip:::1` held exactly 20
rows; after `DELETE FROM "LoginAttempt"`, `driver-a11y.spec.ts` went from 52 failures to 8.

Fix: `LOGIN_MAX_FAILURES_PER_IP` (1..1000000, default 20) is parsed by `maxFailuresPerIp()` in
`src/server/auth/rate-limit.ts`, and `playwright.config.ts` sets it to `1000000` in `webServer.env`.
The per-identifier limit (5) that the rate-limit tests actually assert is unchanged, and production is
unaffected because the default is untouched. Unit-tested in `src/server/auth/rate-limit.test.ts`.

**Cause B — the dev server is too slow under parallel load.** After A was fixed, `auth.spec.ts` still
failed 2 of 4. The page snapshot showed the submit button `[disabled]` — that is `disabled={pending}`
from `useActionState`, i.e. a submit was *already in flight*. Under `pnpm dev`, Turbopack compiles
routes on demand and the login server action exceeded the 5 s assertion timeout. The same spec passes
4/4 against a production build.

Fix: run e2e against a production build locally too — which is what CI already does. `CI=1` makes
Playwright run `pnpm build && pnpm start`.

### 1.4 Update the checklist and docs ✅

- Added the missing first step: `cp .env.example .env` (nothing created a `.env`, so `db:migrate` had
  no `DATABASE_URL`).
- `openssl rand -base64 32` now also shows the `node -e "..."` one-liner, since `openssl` is only on
  the PATH inside Git Bash on Windows. Updated in `.env.example` and `docs/env.md`.
- Fixed the UAT counts: 57 office tests and 39 driver tests, not 94 and 54 (the numbering is not
  contiguous).
- Noted that `docs/deploy.md` §7 uses bash `read -rs` and needs Git Bash on Windows.
- **New:** `scripts/check-storage-private.ts` could not run at all — it used top-level `await`, which
  tsx compiles to CommonJS because `package.json` has no `"type": "module"`. Fixed, plus a second bug:
  `process.exit()` while `fetch()` handles were still closing tripped a libuv assertion on Windows
  (`0xC0000409`) and destroyed the documented exit code. It now sets `process.exitCode`.
- **New:** the checklist gave that command without the required env vars. `docs/deploy.md` §11.3 has
  it right — it needs `S3_ENDPOINT` and `S3_BUCKET` in the environment, because it does not load
  `.env`.
- The corrected checklist is `handover-checklist.html`.

### 1.5 Verify

```bash
pnpm install --frozen-lockfile && pnpm db:migrate && pnpm db:seed
pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check
pnpm exec playwright install chromium

# e2e against a production build, on a port nothing else uses
CI=1 PORT=3500 pnpm test:e2e
```

Verified green: `lint`, `typecheck`, `i18n:check`, `test` (1611 tests) and, end to end, **304 passed /
12 failed** (from 90 passed / 168 failed at the start). The full record is in
`HANDOVER-CHECKLIST-RESULTS.md`.

> **Watch out:** `playwright.config.ts` has `reuseExistingServer: !CI`. If anything else is already
> listening on port 3000, Playwright silently tests *that* instead of the app and you get hundreds of
> meaningless failures. Always pass `PORT=<free port>`. (On this machine 3000 is taken by Forgejo.)

### 1.6 Fix the offline test helper ✅

The largest remaining cluster — `driver-a11y`, `driver-map-offline` and `error-pages`, 18 failures —
came from one helper. `tests/e2e/helpers/network.ts` `setOnline()` hid three separate bugs:

1. `context.setOffline(false)` makes Chromium fire a **real** `online` event, and the offline shell
   (`offline-driver-app.tsx`) and driver error page (`driver-error.tsx`) reload on it. That destroyed
   the execution context inside the helper's `page.evaluate`. The flag is now written before the
   network is touched, and the evaluations survive navigations.
2. The helper also dispatched a synthetic event unconditionally, so the app saw two `online` events
   and started two reloads that cancelled each other — no `load` ever completed. It now dispatches
   only when the platform stays silent.
3. The reload could still be in flight when the caller's next `page.goto` ran. The online direction
   now waits for it.

`error-pages.spec.ts` also waited for `load`, which does not surface for a service-worker-answered
reload; it waits for `framenavigated` now.

**Still open (12):** mostly flaky — different tests fail on different runs and pass alone
(`driver-offline`, `driver-photo`, `driver-outbox`, `driver-usability`, `admin-progress`, `products`).
`late-orders` needs exclusive ownership of "today's tours", which the parallel suite violates;
`load-sheet` needs poppler-utils and is now skipped where it is missing.

---

## Part 2 — Get CI green (you, ~30 min)

CI has **never run** — there is no git remote. Until it does, nobody knows whether the suite really
passes.

1. Create a **private** GitHub repository (this is also `docs/deploy.md` §1).
2. Push the repository.
3. **Open a pull request, not a direct push.** In `.github/workflows/ci.yml` the `e2e` and
   `lighthouse` jobs are gated with `if: github.event_name == 'pull_request'` — pushing to `main`
   runs only lint/typecheck/test, never the browser tests. A PR from a branch is the only way to
   exercise the full pipeline.
4. Wait for all three jobs. Fix whatever they find, then merge.

Only after this is green should you trust the test suite.

---

## Part 3 — Create the accounts and keys (you, ~1 h)

Do this before deploying. Store everything in a password manager, never in git. Variable names are in
`.env.example` and `docs/env.md`.

| What | Why | Env var |
|---|---|---|
| OpenRouteService API key | real geocoding + routing; without it you get approximate routes and a "Näherungswerte" badge | `ORS_API_KEY` |
| Map tile provider with a usage plan (e.g. MapTiler/Stadia) | the OpenStreetMap default is development-only | `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION` |
| DeepL API key (Pro) | real translations + the 10-minute retry cron | `DEEPL_API_KEY` |
| Two random secrets | session signing + cron authentication | `AUTH_SECRET`, `CRON_SECRET` |
| Optional: Sentry EU project | error monitoring | `SENTRY_DSN` (+ token vars) |

Generate the two secrets — run it twice, once per secret (Git Bash or the node one-liner from 1.4):

```bash
openssl rand -base64 32
```

---

## Part 4 — Deploy staging and production (you, ~2 h)

Follow `docs/deploy.md` click by click. Short version:

1. **§2 Neon** — project in Frankfurt, plus a branch called `staging`. Copy both connection strings.
2. **§3 Cloudflare R2** — EU jurisdiction, **two private buckets**, scoped tokens, CORS rule allowing
   `GET` and `PUT` from the app address.
3. **§4 Vercel** — Pro plan (the cron jobs in `vercel.json` need it), region `fra1`, import the repo.
4. **§5 Environment variables** — per environment; production and staging get different values.
5. **§6 First deploy.**
6. **§7 Seed production once** — creates the first admin. Use `SEED_DRIVERS=false` or you get four
   demo drivers sharing PIN `123456` in production.
7. **§9 Verify** — `GET /api/health` must report database and storage OK, and you must be able to log
   in as admin.
8. **§11.3** — confirm the bucket is private:
   ```bash
   pnpm exec tsx scripts/check-storage-private.ts   # must exit 0
   ```
9. **§12.2 + §13.1** — uptime monitor and the backup workflow (add its secrets to the GitHub
   environment `backup`).

---

## Part 5 — Verify security and monitoring on the real accounts (you, ~1–2 h)

### NUD-113 — security configuration

1. `curl -sI https://<prod>/de/login` — headers must match `docs/deploy.md` §11.1.
2. Open the app on a real Android Chrome and a real iOS Safari: map tiles, photos, upload, PWA
   install all work, and the Vercel logs show **no** `csp-violation` lines.
3. `scripts/check-storage-private.ts` against the **production** R2 bucket → exit 0.
4. Create the R2 lifecycle rule for `screenshots/` (190 days).
5. Run `GET /api/cron/retention` by hand once with the bearer secret; check the counts in the answer.
6. Settle the data processing agreements listed in `docs/privacy.md` §1 and §4 (Vercel, Neon,
   Cloudflare, DeepL Pro, ORS, tile provider).

### NUD-114 — monitoring and backups

Follow `docs/runbook.md` §13, in order:

1. Sentry EU project, `SENTRY_DSN` + token variables, redeploy, trigger the test error
   (`docs/runbook.md` §7), add an e-mail alert.
2. Uptime monitor on `/api/health`.
3. Backup bucket, token, `backup_reader` role, GitHub environment `backup` (`docs/deploy.md` §13.1);
   run the workflow once and confirm both jobs are green **and** that the failure e-mail arrives.
4. One real restore drill (`docs/runbook.md` §5.4).
5. Write the real Neon restore window into `docs/runbook.md` §4.
6. Read the first orphan-cleanup dry-run reports, then decide on `ORPHAN_CLEANUP_MODE=delete`.
7. Confirm `postgresql-client-16` installs in CI.

Then tick the criteria in `backlog.md` and set NUD-113 and NUD-114 to `done`.

---

## Part 6 — Chinese language review (you, ~2 weeks lead time — start early)

**NUD-073.** Needs one native Simplified reviewer and one native Traditional reviewer (HK and/or TW).
The tooling is verified working.

1. `pnpm i18n:export` → writes `i18n-review.csv` (998 rows).
2. Send the CSV **and the glossary** (`docs/i18n.md`, "Glossary of fixed terms") to both reviewers.
   Ask them to correct wording, not structure.
3. On return: `pnpm i18n:import <file.csv> --dry-run` — fix any reported errors with the reviewer
   first.
4. `pnpm i18n:import <file.csv>` then `pnpm i18n:check`.
5. Commit and set NUD-073 to `done`.

Until this is done, `docs/i18n.md` is explicit: **do not go live with the driver app in Chinese.**

---

## Part 7 — Real-device checks (you, ~3 h)

All of these need the deployed staging URL and real phones — Android **and** iPhone. Read each
ticket's acceptance criteria in `backlog.md` first.

| Ticket | What to check |
|---|---|
| **NUD-105** | Lighthouse installability; install via the hint button on Android; Add to Home Screen on iOS; correct icon and label |
| **NUD-107** | Offline: "Offline bereit ✓", list/stops/photos in airplane mode, cold start offline, logout shows no tour |
| **NUD-109** | Offline queue: Background Sync on Android (tap delivered in flight mode, close app, leave flight mode → appears in admin without opening the app); iOS sends on reopen; logout with a badge > 0 and back in |
| **NUD-115** | Largest system font, TalkBack/VoiceOver through login→tour→stop→problem, dark mode, sunlight, one-hand use, slow connection, and a person who cannot read the language completing a stop from icons |

### Then NUD-120 — roll out the strict CSP

Set `CSP_REPORT_ONLY=true`, deploy, watch the violation reports for a few days, fix anything
legitimate, then switch to enforcing. See `docs/deploy.md` §11.1a.

Anything that fails becomes a new ticket.

---

## Part 8 — User acceptance test with the client (you + client, ~1 day)

**NUD-096.** Script is `docs/uat.md`.

1. Work through the pre-UAT checklist (`docs/uat.md` §9) — it cross-references NUD-007, NUD-113,
   NUD-114, NUD-073 and the device tickets, so finish those first.
2. Load demo data if needed: `pnpm db:seed --demo --today` (add `--no-photos` to skip photos).
   `docs/demo.md` has a 5-minute walkthrough.
3. Run the office script (57 tests) with the client — one person drives, one writes findings on the
   feedback form.
4. Run the driver script (39 tests) with real drivers, one session per language, on Android and
   iPhone.
5. Ask which Chinese variant the drivers actually prefer.
6. Collect the feedback forms and the client sign-off (`docs/uat.md` §7).
7. **Hand the forms to me** — I convert them into tickets using the rules in the doc.

---

## Part 9 — Decisions to take (client meeting + you)

### Ask the client (one meeting, `backlog.md` §10)

- Retention periods: driver problem texts (365 days proposed), audit log (730 days proposed) — and
  whether whole orders/tours are ever deleted (proposal: keep, nothing is deleted today).
- Keep or remove `Order.internalNote`.
- The real depot address (route start/end).
- The real product list with Chinese names.
- The existing customer list file (check `docs/privacy.md` first).
- Vehicle type — car or van/truck routing profile.
- Confirm the tile provider and DeepL plan are paid by the client.

Record the answers in the decision log (§9 of `backlog.md`).

### Then tell me what to build next

- Follow-ups waiting on your go-ahead: **NUD-116** (warn when the day's tour is already completed),
  **NUD-117** (correction stop for delivered quantities), **NUD-118** (two tours in one day),
  **NUD-119** (tap a map marker to open the stop), **NUD-121** (driver problem text in the audit log).
- **Milestone 3** (NUD-100…104) only after the client signs off milestone 2.

---

## Quick summary of who does what

| Part | Who |
|---|---|
| 1 — make it runnable | **me**, on your go-ahead |
| 2 — CI green | you |
| 3 — accounts and keys | you |
| 4 — deploy | you |
| 5 — security + monitoring verification | you |
| 6 — Chinese review | external reviewers (start early) |
| 7 — real-device checks | you + phones |
| 8 — UAT | you + client |
| 9 — decisions | client, then me |
