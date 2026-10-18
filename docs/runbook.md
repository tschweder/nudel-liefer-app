# Runbook

For the person who operates the app. First setup is in [`deploy.md`](./deploy.md), variables in [`env.md`](./env.md), data handling in [`privacy.md`](./privacy.md).

Contents: 1 Where things are, 2 Deploy, 3 Roll back, 4 Restore the database (Neon point-in-time), 5 Restore from the weekly backup, 6 Rotate keys, 7 Sentry, 8 Reset the admin password, 9 If a service is down, 10 Orphaned storage objects, 11 Reading /api/health, 12 Logs, 13 Open human steps.

Commands run from the repository root with `pnpm` (Node 22+). Production connection strings are secrets: put them in the shell only for the one command (`DATABASE_URL_UNPOOLED=... pnpm ...`), never into a file in the repository.

## 1. Where things are

| What                                    | Where                                                        |
| --------------------------------------- | ------------------------------------------------------------ |
| Code, CI, backup workflow               | GitHub repository (`.github/workflows/ci.yml`, `backup.yml`) |
| App, environment variables, logs, crons | Vercel project                                               |
| Database                                | Neon project, branch `main`                                  |
| Photos, screenshots                     | Cloudflare R2 bucket `nudel-photos`                          |
| Weekly database backups                 | R2 bucket `nudel-backups`, folder `db/`                      |
| Errors                                  | Sentry project (optional)                                    |

## 2. Deploy

1. Merge to `main` (CI must be green). Vercel builds and deploys Production automatically. The build runs the database migrations first; a failed migration stops the build and the previous deployment keeps serving.
2. Watch Vercel > **Deployments** until _Ready_, then check `/api/health` (section 11) and log in as admin.
3. Migrations only move forward. Before merging a migration that deletes or rewrites data, take a manual backup (section 5.1).

## 3. Roll back

Code: Vercel > **Deployments** > the last good deployment > **...** > **Promote to Production** (instant, no rebuild). Then revert the commit on `main` so the next push does not redeploy the bad code.

The database is **not** rolled back by this. If the bad deployment ran a migration that the old code cannot work with, restore the database too (section 4) or ship a fix forward. Environment-variable mistakes: fix the variable and **Redeploy** (variables are read at build or start).

## 4. Restore the database (Neon point-in-time)

Use for "someone deleted data / a migration went wrong a few hours or days ago".

1. Neon console > project > **Backup & Restore**. The history window depends on the plan (free: about 6 hours; paid: up to 7 or 30 days; check the console, it shows the earliest possible time).
2. Choose the point in time (shortly before the damage; check the UTC time against the app's data) and first restore into a **new branch** (_Restore to a new branch_), not over `main`. Look at the data with the SQL editor.
3. If it is right: restore `main` to that time (_Restore branch_ > _main_ > timestamp). Neon keeps the replaced state as a backup branch named `main_old_<time>`; do not delete it for a few days.
4. Connection strings of `main` stay the same after an in-place restore, so no variable changes. After a restore into a different branch you would have to change `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel and redeploy.
5. Everything written after the chosen time is lost. Tell the dispatchers which deliveries and notes to enter again. Drivers' queued offline taps from before the incident are applied when their phones reconnect; check for duplicates.
6. After restoring data older than 24 h, the retention job (`/api/cron/retention`) will delete again what was already deleted; nothing to do. See `privacy.md` for what a restored copy contains.

## 5. Restore from the weekly backup

For when point-in-time restore is not enough (project deleted, damage older than the Neon window, Neon down for long). Backups are custom-format dumps `nudel-<UTC timestamp>.dump` in the R2 bucket `nudel-backups` under `db/`, made Sundays 02:23 UTC, kept 8 weeks (the newest 4 never expire). They hold the database only, not photos.

### 5.1 Take a backup now

GitHub > **Actions > Database backup > Run workflow**. Wait for both jobs (_backup_ and _verify_) to turn green. The summary lists the file. Do this before risky migrations.

### 5.2 Restore into a new database

1. Create a new empty database: Neon console > **Branches > Create branch** is not suitable (it copies data); instead create a new **project** (or a new database in the project: _Databases > New database_). Copy its direct (unpooled) connection string.
2. Download the dump: R2 > `nudel-backups` > `db/` > the file (or `aws s3 cp --endpoint-url https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com s3://nudel-backups/db/<file> ./`). Treat the file as confidential (it contains password hashes and customer data) and delete it when done.
3. Check and restore with the tested script, which refuses a target that is not empty:

   ```
   RESTORE_DATABASE_URL='postgresql://...new-empty-db...?sslmode=require' \
   BACKUP_S3_ENDPOINT=... BACKUP_S3_BUCKET=nudel-backups \
   BACKUP_S3_ACCESS_KEY_ID=... BACKUP_S3_SECRET_ACCESS_KEY=... \
   pnpm backup:verify --key db/<file>
   # or, with the file already downloaded:
   RESTORE_DATABASE_URL='...' pnpm backup:verify --file ./<file>
   ```

   It restores in one transaction (all or nothing) and checks: all migrations finished, an active admin exists, exactly one Settings row, no LoginAttempt rows, row counts. It prints the counts; compare them with what you expect.

4. Point the app at it: set `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) in Vercel, redeploy, check `/api/health`, log in.
5. Run `pnpm admin:reset-password` (section 8) if the admin password is unknown. Sessions survive a restore (they are signed with `AUTH_SECRET`).
6. Photos: the objects in `nudel-photos` are untouched. Rows from the dump refer to them by key; a photo uploaded after the backup exists as an unreferenced object (the orphan job deals with it, section 10).

Do not run `pg_restore` by hand against a database that has data: the script exists to prevent exactly that.

### 5.3 Notes

- `pg_dump` must be at least the version of the Neon server. The workflow installs version `PG_MAJOR` (16). When Neon's version goes up, raise `PG_MAJOR` in `backup.yml`; the run fails loudly otherwise.
- The workflow uses a read-only role (`backup_reader`); it cannot change data.
- `LoginAttempt` data is not in the dump on purpose (login attempt rate limiting restarts empty).

### 5.4 Restore drill (every quarter, 30 minutes)

1. Run section 5.2 steps 1-3 into a throwaway Neon project with the newest dump.
2. Check the printed counts against the Neon console (tables > row counts) within a few percent; open a connection and look at the newest delivery.
3. Delete the throwaway project and the downloaded file. Write the date of the drill into the log of your choice (a ticket comment is enough).

The workflow's _verify_ job does steps 1-3 automatically with a disposable Postgres after every backup, which proves the dump is readable; the drill proves that **you** can do it with real credentials.

## 6. Rotate keys

Always: change the value at the provider, set the new value in Vercel (Production and, if used, Preview), **Redeploy**, check `/api/health`, then revoke the old value.

| Secret                                      | Effect and steps                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                               | Signs all sessions. **Changing it logs out everyone** (admins and all drivers); drivers with queued offline taps log in again and the taps are still sent afterwards. Generate: `openssl rand -base64 32`. Do it when it may have leaked or an admin laptop was lost.                                    |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Cloudflare R2 > Manage API tokens: create a new token for `nudel-photos` (Object Read & Write), put both values in Vercel, redeploy, check health shows storage ok, then delete the old token. Signed photo links already in open pages stop working after the old token is deleted; reloading fixes it. |
| `ORS_API_KEY`                               | openrouteservice dashboard: create a new key, set it, redeploy, delete the old key. While missing or invalid the app falls back to estimated distances (marked approximate).                                                                                                                             |
| `DEEPL_API_KEY`                             | DeepL account > API keys: create, set, redeploy, delete the old key. While missing or invalid, texts are saved untranslated and retried (section 9).                                                                                                                                                     |
| `CRON_SECRET`                               | Vercel sends it to the cron routes automatically from the variable; set a new random value (`openssl rand -hex 32`), redeploy. It also protects `/api/monitoring/test-error`. Anything that calls these routes by hand needs the new value.                                                              |
| `SENTRY_AUTH_TOKEN`                         | Sentry > Developer Settings > the integration > create a new token, set it in Vercel, delete the old one. Only needed at build time.                                                                                                                                                                     |
| `BACKUP_*`                                  | GitHub > Settings > Environments > `backup`: replace the secrets; create the new R2 token and database role password first, run the workflow once, then revoke the old ones.                                                                                                                             |
| Database password                           | Neon console > Roles > reset password, update `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in Vercel, redeploy. Do the same for `backup_reader` in the `backup` environment.                                                                                                                               |

## 7. Sentry

### Check that Sentry works (production or preview)

Only with `SENTRY_DSN` set and the deployment built after that.

1. `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/monitoring/test-error`  
   Expected: `{"status":"sent","eventId":"...","delivered":true}`. `{"status":"disabled"}` means no valid DSN in this build. 401 means a wrong secret (without the header the route always answers 401).
2. In Sentry the issue `MonitoringTestError` appears within a minute.
3. Server-side crash path: add `?mode=throw`; the response is a 500 and the issue `MonitoringTestError (thrown)` appears, proving the automatic error hook works.
4. Browser path: open the app, open the developer console and run `setTimeout(() => { throw new Error("sentry browser test") })`. The issue shows platform _javascript_. If it does not arrive, look in the console for a blocked request (CSP `connect-src`): the DSN host must be there; redeploy after changing the DSN.
5. Resolve the test issues in Sentry.

The event must not contain cookies, a request body, query strings or user data; open the event and look at _Request_ and _User_.

### Check Sentry locally (no Sentry account)

This is how the code was verified. Start the mock ingest `pnpm tsx scripts/mock-sentry-ingest.ts` (port 9999, writes events to a JSONL file), build with `SENTRY_DSN=http://key@localhost:9999/1`, run with the same value and `CRON_SECRET`, then `E2E_SENTRY_LOG=<jsonl path> pnpm exec playwright test tests/e2e/sentry-ingest.spec.ts`.

### Source maps

Uploaded only when the four variables `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are all set (see `deploy.md` section 12). Without them stack traces are minified but everything else works.

## 8. Reset the admin password

If an admin is locked out (forgotten password or lockout after failed attempts).

```
DATABASE_URL_UNPOOLED='postgresql://...production direct string...' \
pnpm admin:reset-password --email admin@example.com
```

- It asks twice for the new password without showing it (10 to 200 characters), asks you to retype the e-mail address of the account, and prints only the database host and name so you can see **which** database it touches.
- Non-interactive: `ADMIN_NEW_PASSWORD` in the environment, or one line on standard input, and `--yes`. There is deliberately **no** `--password` option: a password in the command line ends up in shell history and process lists.
- Only accounts with the admin role are changed. It also clears the lockout counter of that account. `--reactivate` switches an inactive admin back to active. An unknown or ambiguous e-mail address changes nothing.
- The password is never printed or logged. Other sessions of that user keep working until they expire; to end them, rotate `AUTH_SECRET` (section 6).
- Afterwards log in and change the password in the app.
- Driver PINs are reset by an admin in the app (Drivers > driver), not with this tool.

## 9. If a service is down

First check `/api/health` (section 11) to see which part is meant. Status pages: Vercel (vercel-status.com), Neon (neonstatus.com), Cloudflare (cloudflarestatus.com), DeepL (deepl.com/status), openrouteservice (via its dashboard / forum).

| Down                        | What users see                                                                                                                                                                 | What to do                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **openrouteservice** (ORS)  | Route optimisation falls back to a straight-line heuristic. The result is marked _approximate_; distances/times are estimates. Drivers can still work.                         | Nothing urgent. Do not re-optimise many routes during the outage if exact times matter. After recovery re-optimise open days. Check the quota in the ORS dashboard if only some requests fail (HTTP 429).                                                                 |
| **DeepL** (NUD-070)         | Texts that need translation (notes, messages) are saved at once and shown in the original language, marked as pending translation. Nothing is lost and nobody is blocked.      | Nothing. The job `/api/cron/translate` retries every 10 minutes and fills in the translations when DeepL is back. If it lasts longer than a day check the key and the usage limit in the DeepL account (456 = quota used up); raise the limit or wait for the next month. |
| **Neon** (database)         | Everything that loads data fails; `/api/health` is 503 with database failing; drivers see the friendly error page (their taps are queued in the phone and sent when it works). | Check the Neon status page; free-plan databases wake up in seconds after idle, so a short first-request delay is normal. If the project is paused/over quota, open the console. For lasting loss use section 4 or 5. Do not redeploy as a fix.                            |
| **R2** (storage)            | Photos and screenshots do not load or upload; `/api/health` is 503 with storage failing. Deliveries and routes still work.                                                     | Check Cloudflare status and the R2 token (expired or deleted token: section 6). Photo uploads are queued in the phone and retried.                                                                                                                                        |
| **Vercel**                  | App unreachable.                                                                                                                                                               | Wait for Vercel; nothing in this repository helps.                                                                                                                                                                                                                        |
| **Sentry**                  | Nothing visible to users.                                                                                                                                                      | The app does not wait for Sentry.                                                                                                                                                                                                                                         |
| **GitHub Actions** (backup) | No new backup.                                                                                                                                                                 | Look at the Actions tab; re-run the workflow.                                                                                                                                                                                                                             |

## 10. Orphaned storage objects

Uploads that never became a database row (cancelled or failed action) remain in the bucket. `/api/cron/orphan-cleanup` (Sundays 04:07 UTC, Vercel cron, bearer `CRON_SECRET`) finds them.

- Default is **dry-run**: it only logs `[orphan-cleanup]` lines with counts (listed, referenced, candidates, would delete). Nothing is deleted.
- Safeguards even in delete mode: only keys of the app's own shape (`customers/...` photos and `screenshots/...`), only objects older than `ORPHAN_CLEANUP_GRACE_DAYS` (default 14, minimum 7), anything referenced by a Photo or Screenshot row is kept, the reference is checked again immediately before each delete, at most 50 deletions and 10,000 listed objects per run, and the run stops without deleting when 20 or more objects are candidates and more than half of them are orphans (this looks like a broken database connection or a wrong bucket, not cleanup).
- Switch on: read two or three weekly dry-run reports in Vercel Logs (search `orphan-cleanup`). If the numbers are small and plausible, set `ORPHAN_CLEANUP_MODE=delete` and redeploy. Set it back to `dry-run` to stop.
- Run by hand: `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/orphan-cleanup`. A result `aborted: "suspicious_ratio"` means look at it, do not force it.
- Deleted objects cannot be recovered (the bucket has no versioning). That is why delete mode is a conscious switch.

## 11. Reading /api/health

`GET /api/health` needs no login and returns no secrets.

```
{ "status": "ok", "checks": { "database": { "status": "ok" }, "storage": { "status": "ok", "mode": "s3" } } }
```

- HTTP 200, `status: ok`: database and storage answer.
- HTTP 503, `status: error` with the failing check named: see section 9 for that service. The page of the app can still be served from the cache for a moment.
- No answer or 5xx from Vercel itself: the deployment is down; see Vercel status and section 3.
- It does not test ORS, DeepL or Sentry on purpose (their failure is handled by fallbacks). Use the uptime monitor of `deploy.md` section 12.2.

## 12. Logs

- Vercel > project > **Logs** (retention depends on plan, short on free: copy what you need). Filter by _Error_ / by text.
- Useful search words: `[csp-violation]` (blocked resources, no query strings), `[orphan-cleanup]`, `[retention]` (deleted old screenshots, counts), `translate` (DeepL retries), `migrate` (build log).
- Build and migration output: Vercel > **Deployments** > the deployment > **Build Logs**.
- Cron runs: Vercel > **Settings > Cron Jobs** (and the Logs, source _Cron_).
- Application errors with stack traces and release: Sentry (section 7), if configured.
- Backup runs: GitHub > **Actions**.
- Database queries and size: Neon console > Monitoring.
- Logs never contain passwords, PINs, cookies or signed URLs (checked by tests); report it if you ever see one.

## 13. Open human steps (NUD-094)

The code is verified locally with substitutes; these need your accounts:

1. **Sentry:** create the EU project, set `SENTRY_DSN` (and the token variables), redeploy, run section 7, add the e-mail alert rule.
2. **Uptime monitor** for `/api/health` (`deploy.md` section 12.2).
3. **Backups:** `deploy.md` section 13.1 (bucket, token, `backup_reader`, GitHub environment `backup`), first manual run, then the first restore drill (section 5.4). Confirm the GitHub failure e-mail arrives (for example by temporarily wrong secret).
4. **Neon point-in-time:** open _Backup & Restore_ once and note the real history window of your plan here in section 4.
5. **Orphan cleanup:** read the first dry-run reports, then decide on `ORPHAN_CLEANUP_MODE=delete`.
6. Check that `postgresql-client-16` installs on the GitHub runner (first CI run after merge) and that `PG_MAJOR` matches the Neon version.
