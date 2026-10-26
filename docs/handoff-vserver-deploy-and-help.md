# Hand-off: automated vServer deploy under `/delivery-app/` + bilingual help page

**Audience:** the next coding agent (and the human reviewing it).
**Scope:** two deliverables, in this order. Nothing else.
**Status of this document:** instructions only. No code has been written yet; no server has been touched.

| # | Deliverable                                          | Result                                                                    |
| - | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 1 | One-command automated deploy of this app to the vServer, served under `https://<server>/delivery-app/` | `deploy.bat` on Windows → app running as a systemd service behind nginx   |
| 2 | `hand-off.html` on that server, German + Chinese, with a search box over every app function | `https://<server>/delivery-app/hand-off.html` |

Every path, line number and German UI label in this document was read from the repository (or from the two example scripts in `C:\Users\niko\Desktop\quiz-game\deploy\`). Where something is a **recommendation** or **unverified**, it is marked as such. Do not silently promote a recommendation to a fact.

Contents: 1 Goal, 2 Reference implementation, 3 Hard rules, 4 Deliverable 1 (deploy), 5 Code changes for the sub-path, 6 Server side, 7 Deliverable 2 (hand-off page), 8 Search index specification, 9 Verification, 10 Acceptance criteria, 11 Risks and open decisions, 12 What does not exist in the app.

---

## 1. Goal

1. **Automated deploy.** A single command on Windows ships the current working tree of `nudel-liefer-app` to the already-existing vServer and (re)starts it. The app must be reachable at `https://<server-ip>/delivery-app/` (admin at `/delivery-app/de/login`, driver at `/delivery-app/de/driver/login`). The quiz app that already lives at `https://<server-ip>/quiz` must keep working untouched.
2. **A help page.** `hand-off.html`, served publicly (no login) from the same path, explaining **every** function of the app in **German** and **Chinese**, with a small search box: typing e.g. `waren typ hinzufügen` (or `添加产品`) shows the matching topic and how/where to do it.

The app is **not** deployed to Vercel/Neon/R2 in this task. `docs/deploy.md` describes that path and stays valid; this document describes the self-hosted path. When the two disagree about the *hosting*, this document wins for this task; everything else (env rules, security, privacy) stays as documented in `docs/deploy.md`, `docs/env.md`, `docs/privacy.md`.

## 2. Reference implementation (read these first)

The example scripts that already work on the same server for another app:

| File                                                     | What it shows                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `C:\Users\niko\Desktop\quiz-game\deploy\deploy.ps1`      | Windows side: read `.env` for `REMOTE_IP`/`REMOTE_USER`/`REMOTE_PASSWORD`, create + install an SSH key on first run, `tar` the tree, `scp` it plus the setup script, run the setup over `ssh`. |
| `C:\Users\niko\Desktop\quiz-game\deploy\server-setup.sh` | Server side: install Node, create a system user, unpack to `/opt/...`, keep data in `/var/lib/...`, write a systemd unit, then either extend an existing nginx (snippet + `include` injected into every `server { }` block by a `python3` pass, backup + `nginx -t` + rollback) or fall back to Caddy. |
| `C:\Users\niko\Desktop\quiz-game\deploy.bat`             | The double-click wrapper.                                                                                                 |
| `C:\Users\niko\Desktop\quiz-game\README.md`              | Prose version of the same flow.                                                                                           |

Copy the **structure and the safety behaviour** (idempotent, backup before touching nginx, `nginx -t` with rollback, health check before declaring success). Do **not** copy the quiz's `proxy_pass` line, port 3000, or its data model.

Credentials for the target server are already in `C:\Users\niko\Desktop\nudel-liefer-app\.env` (git-ignored): `REMOTE_IP`, `REMOTE_USER`, `REMOTE_PASSWORD` (lines 12-14). The quiz script reads exactly these three keys, so the same `.env` conventions work.

## 3. Hard rules

1. **Never break the quiz app.** It is served from the same nginx on ports 80/443. Back up `/etc/nginx` before editing, never rewrite an existing `server { }` block, only add includes, and roll back automatically if `nginx -t` fails.
2. **Never commit secrets.** `deploy.ps1` lives in the repo; `.env` stays git-ignored. The server-side env file (section 6.4) is `chmod 600` and owned by the service user. Extend `.env.example` with the three `REMOTE_*` keys, commented out.
3. **Build artifacts are git-ignored.** `pnpm build` writes `.next/`, `public/sw.js`, `public/offline.html`, `public/offline.js`, `.csp-script-hashes.json` (`scripts/build-pwa.ts:5`, `.gitignore`).
4. **No inline scripts or inline styles in `hand-off.html`.** Production CSP is `script-src 'self'` + nonce/hashes (`src/lib/security-headers.ts`, AGENTS.md "Content-Security-Policy: no inline scripts"). External files only, no `onclick=`, no CDN fonts. Follow `scripts/lib/offline-page.ts` (it exists for exactly this reason) and mirror it in `scripts/lib/hand-off-page.ts`.
5. **The app's own production policies stay on.** Do not add `'unsafe-inline'`, do not disable `requireRole`, do not set `ENABLE_ERROR_TEST_PAGES` (`scripts/lib/deploy-env.ts:85` fails the check).
6. **Do not run `pnpm build` inside `deploy.ps1`'s ssh session as root.** Build as the service user or let systemd own the process user; a root-owned `.next` breaks the service (`EACCES`).
7. **Stay in scope.** Anything not asked for becomes a ticket in `backlog.md` (AGENTS.md workflow), not a code change in this task.
8. **This file is the only new file the preparer created.** The implementing agent will add the files listed in sections 4-7; keep the existing docs in sync (`docs/deploy.md` gets one new section pointing here, `AGENTS.md` gets one line under Commands).

## 4. Deliverable 1 — the automated deploy

### 4.1 Files to add

```
deploy.bat                      # double-click wrapper (copy of quiz-game\deploy.bat)
deploy\deploy.ps1               # Windows side
deploy\server-setup.sh          # server side, runs as root
deploy\delivery-app.nginx.conf  # the /delivery-app/ snippet (kept in the repo for review)
deploy\delivery-app.service     # the systemd unit (kept in the repo for review)
```

Interface between them, exactly as in the example:

```
deploy.bat  ->  powershell -File deploy\deploy.ps1
deploy.ps1  ->  tar + scp  ->  ssh "bash /tmp/server-setup.sh <PUBLIC_HOST> /tmp/nudel-delivery-app.tgz"
server-setup.sh <PUBLIC_HOST> <ARCHIVE>
```

### 4.2 Windows side (`deploy\deploy.ps1`)

Start from `C:\Users\niko\Desktop\quiz-game\deploy\deploy.ps1` and change:

- `$tgz = Join-Path $env:TEMP 'nudel-delivery-app.tgz'`.
- The `tar` excludes. The quiz excludes its `./data`; this app keeps no data in the tree, so exclude instead:
  `--exclude=./.next --exclude=./node_modules --exclude=./.git --exclude=./.env --exclude=./test-results --exclude=./web-test --exclude=./.lighthouseci --exclude=./tsconfig.tsbuildinfo --exclude=./.embedded-postgres --exclude=./i18n-review.csv`
  (`node_modules` and `.next` are produced on the server; see 4.5 for why.)
- Keep `$ErrorActionPreference = 'Continue'` and the `cmd /c ... >nul 2>&1` probe: native tools report through `$LASTEXITCODE` and `'Stop'` would turn their stderr into fatal errors in Windows PowerShell 5.1. Do not "improve" this.
- Keep the first-run SSH key install (`~/.ssh/id_ed25519`, `ssh-keygen`, `authorized_keys`).
- Add a pre-flight check before packing, because the server build needs a clean tree:
  `pnpm i18n:check` is **not** required for the deploy, but a failing `pnpm lint`/`typecheck` in CI is; do not silently deploy a red tree. Print the current `git rev-parse --short HEAD` and refuse when the working tree has uncommitted changes **unless** `-AllowDirty` is passed (a dirty tree is how you test, so it must stay possible, just explicit).
- Final line prints the real URLs:
  `Done: https://<IP>/delivery-app/de/login (Büro) and https://<IP>/delivery-app/de/driver/login (Fahrer), Hilfe: https://<IP>/delivery-app/hand-off.html`

### 4.3 Server side (`deploy\server-setup.sh`)

Structure it like the quiz script: `set -euo pipefail`, a `log()` helper, functions per stage, idempotent (re-running is the normal update path).

Stages, in order:

1. **Preconditions** — need root; detect `PUBLIC_HOST` (an IP here); read `ARCHIVE`.
2. **Node.js ≥ 22** — `engines.node` is `>=22` (`package.json:99`). Reuse the quiz's NodeSource 22.x block.
3. **pnpm** — `packageManager: pnpm@12.14.0` (`package.json:97`). `corepack enable && corepack prepare pnpm@12.14.0 --activate`, or `npm i -g pnpm@12.14.0`. Verify with `pnpm -v`.
4. **PostgreSQL 16** — `apt-get install -y postgresql`; create role + database (section 6.2). Must be idempotent (`DO $$ ... IF NOT EXISTS`).
5. **Object storage** — see section 6.3. The app **cannot run in production without S3** (`src/server/storage/index.ts:21-24` throws when `NODE_ENV=production` and no `S3_*` is set), so this is not optional.
6. **Code** — unpack the tarball into `/opt/delivery-app` using the same `.new`/`.old` swap as the quiz (`rm -rf $APP_DIR.new && mkdir $APP_DIR.new && tar -xzf ... -C $APP_DIR.new && mv $APP_DIR $APP_DIR.old && mv $APP_DIR.new $APP_DIR`), then `chown -R` the service user. Keep the previous release as `.old` so a rollback is a directory rename.
7. **Dependencies + migrations + build** (as the service user, section 6.5). This is the slow step; budget several minutes and print progress.
8. **Env file** — write `/etc/delivery-app.env` (section 6.4) from values created in steps 4/5 and one generated `AUTH_SECRET`. `chmod 600`, `chown root:deliveryapp`. Never print the values.
9. **systemd unit** — section 6.6; `daemon-reload`, `enable`, `restart`.
10. **nginx** — section 6.7; snippet + include + `nginx -t` + reload, with backup and rollback exactly like the quiz script (`setup_nginx()` in `server-setup.sh:9-94` is a working template, including the `python3` brace-matching pass and the "no HTTPS server yet → make a self-signed one" fallback).
11. **Health check** — `curl -fsS http://127.0.0.1:3100/delivery-app/api/health` (the build's own basePath makes the prefix part of the path the Node server sees) and then the public URL through nginx; print both. Fail the run when `/api/health` does not answer `"status":"ok"`.

### 4.4 The `.env` keys

Extend `.env.example` (commented, no values):

```
# vServer deploy (deploy\deploy.ps1). Never commit real values.
# REMOTE_IP=203.0.113.10
# REMOTE_USER=root
# REMOTE_PASSWORD=...
```

`.env` already has them (git-ignored).

### 4.5 Build on the server, not on Windows

**Decision: build on the server.** Reasons, all verifiable in the repo:

- `prisma generate` runs in `postinstall` (`package.json:22`) and produces platform-specific engine binaries; cross-building on Windows and running on Linux is a classic source of "Query engine binary for current platform could not be found".
- `pnpm build` runs `next build` **twice** with `scripts/csp-script-hashes.ts` in between, then `scripts/build-pwa.ts`, then `check-client-bundle` (`package.json:7`). All of it is platform-neutral, but `build-pwa.ts` reads `.next/BUILD_ID` and writes into `public/` — running it on Windows leaves Windows-only artifacts in a directory that is then only partially replaced on the server.
- Cost: the server needs enough RAM for `next build` (turbo). **Unverified:** the bundled Next.js memory guide (`node_modules/next/dist/docs/01-app/02-guides/memory-usage.md`) gives no number. Check the server's RAM in step 0 of the run and, if it is below ~2 GB, add 2 GB of swap before the first build (`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` + fstab). Do **not** guess; measure.

**Command on the server** (as the service user, in `/opt/delivery-app`):

```bash
pnpm install --frozen-lockfile
pnpm db:migrate                 # prisma migrate deploy
CHECK_DEPLOY_ENV=1 pnpm exec tsx scripts/check-deploy-env.ts   # fails loudly on a bad env, see below
pnpm build
```

`scripts/check-deploy-env.ts:8` skips itself unless `VERCEL_ENV` **or** `CHECK_DEPLOY_ENV` is set — setting `CHECK_DEPLOY_ENV=1` is the supported way to get the same validation on a non-Vercel host (the file comment says so explicitly). Expect one error worth understanding: `DATABASE_URL points to localhost` (`scripts/lib/deploy-env.ts:23`) — on this server Postgres is local, so either run the check with a non-localhost host name, or accept and document that this one rule is a Neon-era guard that does not apply. **Do not weaken `deploy-env.ts`; document the exception in the deploy script's output instead.**

### 4.6 Update and rollback

- **Update:** run `deploy.bat` again. Steps 6-11 are idempotent; the database and the object store are untouched.
- **Rollback:** `mv /opt/delivery-app /opt/delivery-app.failed && mv /opt/delivery-app.old /opt/delivery-app && systemctl restart delivery-app`. Migrations are forward-only; a migration that already ran is **not** rolled back by this, which is the normal Prisma behaviour and must be said in the script's output.
- **Logs:** `journalctl -u delivery-app -n 200 -f`.

## 5. Code changes so the app works under `/delivery-app/`

Next.js 16 supports a sub-path via `basePath` (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/basePath.md:8-18`). Key facts from that doc: it is **build-time** (line 18: "must be set at build time and cannot be changed without re-building"), `next/link` and `next/router` apply it **automatically** (line 22), and **`next/image` does not** — the `src` must already contain the prefix (line 48). Everything below is the consequence of that one sentence plus the app's own hard-coded absolute paths.

**Rule for the implementation:** every absolute URL the app hands to the *browser* must be built as `BASE_PATH + path`. Add one exported helper and use it, instead of concatenating strings in ten files.

### 5.1 Configuration

- `next.config.ts`: add `basePath` from an env var, e.g.
  `basePath: process.env.NEXT_PUBLIC_BASE_PATH?.trim() || undefined` and put the same value into `env` (the block at `next.config.ts:48-53`) so client and server code see it. Keep it **empty** for local dev and for the Vercel path, so nothing changes there.
- Build and start with `NEXT_PUBLIC_BASE_PATH=/delivery-app`. Because it is inlined at build time, the value used for `pnpm build` **must** equal the value used by `pnpm start`.

### 5.2 Files with hard-coded absolute paths (each one is a real, verified hit)

| File:line                                             | Current                                                    | Needed under a sub-path                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/lib/pwa.ts:7` `SW_URL`                           | `"/sw.js"`                                                 | `basePath + "/sw.js"`                                                                      |
| `src/lib/pwa.ts:8` `OFFLINE_URL`                      | `"/offline.html"`                                          | `basePath + "/offline.html"`                                                               |
| `src/lib/pwa.ts:10-16` `PWA_ICONS`                    | `/icons/...`                                               | prefix each                                                                                |
| `src/lib/pwa.ts:19` `manifestPath()`                  | `/${locale}/manifest.webmanifest`                          | prefix (or rely on Next's own basePath for app routes — verify, see 9.3)                   |
| `src/lib/pwa.ts:28` `DRIVER_LAUNCH_PATH`              | `"/driver?source=pwa"`                                     | prefix — this is the installed app's `start_url`                                           |
| `src/lib/pwa.ts:30` `driverHomePath()`                | `/${locale}/driver`                                        | prefix (used in redirects)                                                                 |
| `src/lib/pwa.ts:69` `id` / `:75` `start_url` / `:76` `scope` | `"/driver"`, `"/driver?source=pwa"`, `"/"`          | all three must live under the prefix; `scope: "/"` would claim the whole origin (incl. `/quiz`) |
| `src/lib/offline/constants.ts:26` `PHOTO_CACHE_PATH`  | `"/api/driver/photo-cache/"`                               | prefix                                                                                     |
| `src/lib/offline/constants.ts:33` `OFFLINE_SHELL_SEGMENT` | `"driver/offline-shell"` (relative, used with a locale) | ok as a segment; the generated `offlineShellUrls()` must carry the prefix                   |
| `src/lib/offline/constants.ts:35,38,41` `TOUR_API_PATH`, `SYNC_API_PATH`, `PHOTO_REGISTER_API_PATH` | `/api/driver/...`                          | prefix — the service worker calls these directly                                           |
| `src/lib/offline/photo-outbox-flush.ts:86`            | `fetchImpl("/api/uploads", ...)`                           | prefix                                                                                     |
| `src/sw/rules.ts:21` `DRIVER_PATH`, `:48` `SHELL_ROUTE` | `^/(locale)/driver...`                                    | strip the prefix before matching, or include it in the pattern                             |
| `src/sw/rules.ts:45` `isPrecachedStaticPath`          | `/_next/static/`                                           | prefix                                                                                     |
| `src/sw/rules.ts:58,63` `offlineShellUrl(s)`          | `/${locale}/driver/offline-shell`                          | prefix                                                                                     |
| `src/sw/sw.ts:84` fallback                            | `url: "/offline.html"`                                     | prefix                                                                                     |
| `scripts/build-pwa.ts:79` `modifyURLPrefix`           | `"/_next/static/"`, `"/"`                                  | prefix both, or the precache list points at URLs that do not exist                          |
| `scripts/build-pwa.ts:85` `additionalPrecacheEntries` | from `offlineShellUrls()`                                  | follows `rules.ts`                                                                          |
| `src/components/driver/pwa-runtime.tsx:28`            | `register(SW_URL, { scope: "/" })`                         | `scope` must be the prefix; see 5.3                                                         |
| `scripts/lib/offline-page.ts:20,40-45,93`             | `/offline.js`, `/driver` checks, `/` + lang + `/driver`    | prefix — this file builds HTML by string concatenation                                      |
| `src/lib/offline/routes.ts:9-18`                       | parses `/driver/stops/<id>`                                | must strip the prefix first (it uses `splitLocalePath`, which expects the locale first)     |
| `src/app/[locale]/manifest.webmanifest/route.ts`      | returns the manifest JSON                                  | check the `start_url`/`scope`/`icons` it returns (5.2)                                      |

**Verified, so you do not have to rediscover it:** `next start` serves `public/` files through the same static handler as `_next/static` and adds `Cache-Control: public, max-age=31536000, immutable` to them (`node_modules/next/dist/server/lib/router-server.js:483-495`). For this app that is wrong for exactly three files — `sw.js`, `offline.html`, `offline.js` — which is why `next.config.ts:70-83` overrides their `Cache-Control` explicitly, and why `hand-off.html`, `hand-off.js`, `hand-off-data.js` and `hand-off.css` need an equivalent entry in that `headers()` list if they are ever regenerated with new content (the filenames are not content-hashed). Add them to the `next.config.ts` headers next to the `offline.html|offline.js` rule.

**Cache Storage names are not URLs** (`PHOTO_CACHE_NAME`, `OFFLINE_DB_NAME`, `OFFLINE_DB_VERSION` in `src/lib/offline/constants.ts:7-18`): leave them alone. Bumping `OFFLINE_DB_VERSION` is **not** needed for a path change.

### 5.3 The service worker is the hard part

Three things must be true, and all three are testable in the browser:

1. **Registration URL** — `/delivery-app/sw.js`.
2. **Scope** — by default a worker can only control paths **at or below its own directory**, so `/delivery-app/sw.js` naturally gets scope `/delivery-app/`. That is exactly what we want (it must not control `/quiz`). Two consequences:
   - `scope: "/"` in `pwa-runtime.tsx:28` must become the prefix, or the registration is rejected with a `SecurityError`;
   - the old `/sw.js` must not be registered anywhere. Anyone who already installed the app from an earlier root deployment keeps an old worker with scope `/` — document the one-time fix (unregister in DevTools → Application → Service Workers, or a new origin/port).
3. **`Service-Worker-Allowed`** is only needed when you *widen* the scope. Narrowing to the prefix needs nothing. Do **not** add the header. Verified in the installed Next 16: `next start` sets `Service-Worker-Allowed` **only** for files under `public/service-worker/` (`node_modules/next/dist/server/lib/router-server.js:483-486`, `res.setHeader('Service-Worker-Allowed', config.basePath || '/')`); our worker lives at `public/sw.js` and therefore gets no such header, so its scope stays the default `/delivery-app/`. That is the behaviour we want, but it also means `scope: "/"` in `pwa-runtime.tsx` is now wrong — see item 1.
4. **Precache URLs** — everything `scripts/build-pwa.ts` puts into the manifest (`.next/static` hashed assets, icons, `offline.html`, `offline.js`, the four offline-shell pages) must be prefixed, or the worker installs, fails to precache and the offline mode silently stops working. Verify by opening DevTools → Application → Cache Storage and looking for `/delivery-app/_next/static/...` entries.
5. **`proxy.ts` matcher.** `src/proxy.ts:80` is `["/((?!api|_next|_vercel|.*\\..*).*)"]` and the comment claims it is "the exact complement" of the `next.config.ts:67` header source. With a basePath, requests arrive as `/delivery-app/...`. **Verify empirically** (9.3) whether Next strips the prefix before matching. If it does not, both the matcher and the header source must be widened — a wrongly-matched static asset is served without its `Cache-Control` (cosmetic), but a wrongly-matched **page** loses its CSP nonce and the page breaks under the strict policy; and a wrongly-matched `/api/...` route would suddenly run the i18n middleware. This is the single most likely breakage of the whole change.

### 5.4 What is (probably) already fine — verify, do not assume

- `next/link`/`useRouter` navigation (basePath is applied automatically).
- Server actions and `<form action={...}>` (they post to the route they are rendered on).
- `redirect()`/`NextResponse.redirect(new URL(target, request.url))` in `src/proxy.ts:61` and `:70-73` — the base path is part of `request.url`'s pathname, but `splitLocalePath` (`src/lib/access.ts:15-20`) splits on the **first** segment, so it would read `delivery-app` as the locale and treat everything as "no locale". **This needs a fix**: strip the basePath before `splitLocalePath` in `src/proxy.ts`, and check every other caller of `splitLocalePath` (`src/lib/offline/routes.ts:10` is one).
- Auth.js: `trustHost: true` is already set (`src/server/auth/auth.config.ts:12`), so no `AUTH_URL` is needed as long as `X-Forwarded-Host`/`X-Forwarded-Proto` are forwarded by nginx (section 6.7) — **verify** by logging in through the public URL and checking the session cookie attributes.
- `GET /api/health` lives at `basePath + /api/health`. Point the nginx health check and any monitor at that.

### 5.5 The cheaper alternative (offer it, do not take it silently)

If the client accepts a **host name** (or a second port) instead of a path, serve the app at `https://delivery.example.com/` and skip section 5 almost entirely: `basePath` stays empty, nginx does a plain `proxy_pass` of `/`, the service worker scope `/` is correct, and `prisma`/CSP/PWA need no changes at all. Mention this in the deploy script's output as the fallback if the sub-path verification in 9.3 fails. The user explicitly asked for `/delivery-app/`, so implement that — but do not hide the option.

## 6. Server side details

### 6.1 Layout

```
/opt/delivery-app            # code + .next + node_modules (built here)
/opt/delivery-app.old        # previous release (rollback)
/var/lib/delivery-app        # nothing yet; reserve it for future local files
/etc/delivery-app.env        # secrets, chmod 600, root:deliveryapp
/etc/systemd/system/delivery-app.service
/etc/nginx/snippets/delivery-app.conf
/etc/nginx/snippets/delivery-app-redirect.conf
/var/log/delivery-app/       # optional: log files if journald is not enough
```

Service user: `deliveryapp` (system user, `--home /var/lib/delivery-app`, `--shell /usr/sbin/nologin`), mirroring the quiz's `quiz` user (`server-setup.sh:105`).

### 6.2 PostgreSQL

```bash
apt-get install -y postgresql postgresql-contrib
sudo -u postgres psql <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nudel') THEN
    CREATE ROLE nudel LOGIN PASSWORD 'REPLACE_WITH_GENERATED_PASSWORD';
  END IF;
END $$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='nudel'" | grep -q 1 || sudo -u postgres createdb -O nudel nudel
```

- Keep Postgres on `127.0.0.1:5432` only (default for Debian/Ubuntu `listen_addresses`). Do not open it.
- `DATABASE_URL=postgresql://nudel:<pw>@127.0.0.1:5432/nudel` — `/etc/delivery-app.env` is `chmod 600`, that is the protection; there is no TLS on loopback.
- The app is developed against Postgres 16 and the migrations use plain SQL; a newer major version is normally fine, an older one is not.
- `pg_dump` backup: a daily `cron`/systemd timer writing to `/var/backups/nudel/` with a 14-day rotation (the app's own `pnpm backup:db` expects S3 credentials for the **backup** bucket, `docs/deploy.md:378-399`; on this server a local `pg_dump` is enough for v1 — document the difference).

### 6.3 Object storage (photos, screenshots) — required

`src/server/storage/index.ts:21-24` throws in production when `S3_*` is unset, and `scripts/lib/deploy-env.ts:40-42` turns a missing bucket into a build error. So the server needs an S3-compatible store. Two options:

- **MinIO in Docker (recommended).** `docker-compose.yml` already defines it with the images the project had to switch to after `minio/minio` disappeared from Docker Hub — `chainguard/minio:latest` and `chainguard/minio-client:latest` (`docker-compose.yml:22,39`). Reuse that knowledge; do not try `minio/minio:latest`. Install Docker if it is missing, run MinIO bound to `127.0.0.1:9000`, create the bucket `nudel-photos` with `mc mb --ignore-existing`.
- **MinIO from a static binary.** If Docker is not welcome on this box, MinIO ships a single binary; the same `mc` bucket creation applies.

Then:

- The S3 endpoint must be reachable **by the browsers**, because photos are uploaded with presigned URLs and rendered from presigned URLs, and the origin is added to the CSP (`storageSources()` in `src/lib/security-headers.ts:27-42`, and `img-src`/`connect-src` in the same file). So publish MinIO through nginx on the HTTPS vhost — e.g. `location /delivery-app-s3/ { proxy_pass http://127.0.0.1:9000/; ... }` — and set `S3_ENDPOINT=https://<server>/delivery-app-s3`. **A plain `http://127.0.0.1:9000` endpoint cannot work from a browser**: it would be mixed content and outside the CSP.
- Keep the bucket private; verify with the existing script: `S3_ENDPOINT=... S3_BUCKET=nudel-photos pnpm exec tsx scripts/check-storage-private.ts` (exit 0 = private; `scripts/check-storage-private.ts:1-19`).
- CORS: presigned `PUT` from the browser origin must be allowed. MinIO is permissive by default; if uploads fail with a CORS error, set the bucket CORS to the app origin, `GET`/`PUT`, headers `content-type`, `content-length`.
- The upload route enforces its own limits (≤ 15 MiB per object, resized client-side to 1600 px) but nginx must not reject it earlier: set `client_max_body_size 20m` on the location (section 6.7).

### 6.4 `/etc/delivery-app.env`

```ini
# --- required ---
NODE_ENV=production
DATABASE_URL=postgresql://nudel:<pw>@127.0.0.1:5432/nudel
AUTH_SECRET=<openssl rand -base64 32>
S3_ENDPOINT=https://<server>/delivery-app-s3
S3_REGION=us-east-1
S3_BUCKET=nudel-photos
S3_ACCESS_KEY_ID=<minio root or a dedicated user>
S3_SECRET_ACCESS_KEY=<...>

# --- recommended ---
CRON_SECRET=<openssl rand -base64 32>          # the /api/cron/* routes reject everything without it
AUDIT_RETENTION_DAYS=730
DRIVER_TEXT_RETENTION_DAYS=365
DATA_RETENTION_MODE=dry-run
SCREENSHOT_RETENTION_DAYS=180
ORPHAN_CLEANUP_MODE=dry-run
ORPHAN_CLEANUP_GRACE_DAYS=14

# --- optional, each with a graceful fallback ---
# DEEPL_API_KEY=...        # without it texts get a visible "[zh-Hans]" prefix from the Fake translator
# ORS_API_KEY=...          # without it routing is estimated and the UI shows the "Näherungswerte" badge
# MAP_TILE_URL=...         # without it the map uses the OSM dev tiles (usage policy!) — see .env.example:41-50
# MAP_TILE_ATTRIBUTION=...
# SENTRY_DSN=...
```

`NEXT_PUBLIC_BASE_PATH=/delivery-app` belongs **only** in the build step (`NEXT_PUBLIC_BASE_PATH=/delivery-app pnpm build`), never in the running service: it is a build-time value that is already inlined into the client bundles, and `next.config.ts` would only re-read it when the config is loaded. Keeping it out of the service environment removes a whole class of "the build and the running process disagree" bugs. The setup script must export it for the build and not write it into this file.

`AUTH_SECRET` must not be the placeholder (`scripts/lib/deploy-env.ts:36-38`: at least 32 characters, not `change-me-local-only`). Never set `SEED_ADMIN_PASSWORD` or `ENABLE_ERROR_TEST_PAGES` here permanently (`deploy-env.ts:56,85`).

Full reference for every variable: `docs/env.md`; the annotated list: `.env.example`.

**Two traps to close in the script:**

1. `prisma.config.ts:1` starts with `import "dotenv/config"` and `:15` prefers `DATABASE_URL_UNPOOLED` over `DATABASE_URL`. A stale `.env` in `/opt/delivery-app` would therefore silently override the service environment for every Prisma command. The tarball **must not** contain `.env` (section 4.2 excludes it) — and the setup script should fail loudly if one appears: `[ -f /opt/delivery-app/.env ] && { echo "refusing: .env must not be on the server"; exit 1; }`.
2. `NODE_ENV=production` must be set for the service, not only for the build: `getStorage()` (`src/server/storage/index.ts:21`) and the CSP/security headers read it at request time, and the dev-only branches (loose CSP, Fake providers with warnings) must never be active on the server. Setting it in both the unit (above) and `/etc/delivery-app.env` is cheap insurance.

`DATABASE_URL_UNPOOLED` is **not** needed here: the `-pooler` rule in `scripts/lib/deploy-env.ts:27` is Neon-specific, and `prisma migrate deploy` takes its advisory locks against the local Postgres directly.

### 6.5 First run and seeding

```bash
# once, after migrate, as the service user, with DATABASE_URL in the environment:
DATABASE_URL=... SEED_ADMIN_EMAIL=office@example.com SEED_ADMIN_PASSWORD='<strong>' SEED_DRIVERS=false pnpm db:seed
```

`SEED_DRIVERS=false` matters: without it four demo drivers with the well-known PIN `123456` exist on production (`docs/deploy.md:151`, `.env.example:9-12`). `RUN-AND-TEST.md:84-88` lists those demo accounts for local use only. The seed is idempotent and does not reset an existing password. An admin password can be reset with `pnpm admin:reset-password --email ...` (`package.json:32`).

**Everything the office must configure once after the first login** (this is also the first chapter of the help page):

1. `Einstellungen` → depot pin + confirmation checkbox (without it **no tour can be created**, `messages/de.json:733`).
2. `Einstellungen` → `Standard-Abfahrtszeit`, `Minuten pro Stopp`, `Liefertage`.
3. `Produkte` → the real products with German + simplified-Chinese names.
4. `Kunden` → import or create, and confirm every pin.
5. `Fahrer` → create the accounts, note each PIN (shown once).

### 6.6 systemd unit

```ini
[Unit]
Description=Nudel Liefer App (Next.js)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=deliveryapp
Group=deliveryapp
WorkingDirectory=/opt/delivery-app
EnvironmentFile=/etc/delivery-app.env
Environment=PORT=3100
Environment=HOSTNAME=127.0.0.1
Environment=NODE_ENV=production
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start
Restart=always
RestartSec=2
# hardening (adjust if a feature needs more)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/delivery-app/.next /var/lib/delivery-app

[Install]
WantedBy=multi-user.target
```

Notes:

- `PORT` and `HOSTNAME` are the documented env vars for `next start` (`node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md:70-71,122-123`). `HOSTNAME=127.0.0.1` keeps it off the public interface; nginx is the only ingress.
- Port **3100**, not 3000: the quiz app already holds 3000 (`server-setup.sh:6`). Check with `ss -ltnp` anyway.
- Use the absolute `node` path from `command -v node`, as the quiz script does (`server-setup.sh:120`), so a PATH change cannot break the unit.
- `.next` must be writable by the service (Next writes its cache there at runtime); the `ReadWritePaths` line does that under `ProtectSystem=strict`.
- `pnpm start` is `next start` (`package.json:9`) — either form works; prefer the direct `node` call so systemd does not depend on a pnpm shim.

### 6.7 nginx

Snippet `/etc/nginx/snippets/delivery-app.conf`, included into the existing HTTPS `server { }` (the quiz script's `setup_nginx()` shows how to inject the `include` into every enabled block and how to roll back):

```nginx
location = /delivery-app { return 301 /delivery-app/; }

location /delivery-app/ {
    proxy_pass http://127.0.0.1:3100;      # NOTE: no trailing slash and no path -> the prefix is passed through
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        "";

    # React Server Components stream; nginx buffering would delay the first byte
    proxy_buffering off;                   # or: proxy_set_header X-Accel-Buffering no;
    proxy_request_buffering off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    client_max_body_size 20m;              # photo/screenshot uploads (app limit: 15 MiB)

    # The worker must never be cached, or a deploy does not reach installed apps
    location = /delivery-app/sw.js {
        proxy_pass http://127.0.0.1:3100;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }
    location = /delivery-app/offline.html { proxy_pass http://127.0.0.1:3100; add_header Cache-Control "no-cache" always; }
    location = /delivery-app/offline.js   { proxy_pass http://127.0.0.1:3100; add_header Cache-Control "no-cache" always; }

    # Hashed build assets: immutable
    location /delivery-app/_next/static/ {
        proxy_pass http://127.0.0.1:3100;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }
}

# Optional but recommended: the health endpoint on a plain, auth-free path,
# so an uptime monitor does not need to know about the app path.
location = /delivery-app-health {
    proxy_pass http://127.0.0.1:3100/delivery-app/api/health;
    access_log off;
}

# Plain HTTP -> HTTPS for the app path (the auth cookie is Secure in production)
location ^~ /delivery-app { return 301 https://$host$request_uri; }   # into the 80-server
```

Why `proxy_pass http://127.0.0.1:3100;` **without** a URI part: when `proxy_pass` has no URI, nginx forwards the request URI unchanged, so the Node server receives `/delivery-app/de/login` — which is what a `basePath` build expects. The quiz snippet uses `proxy_pass http://127.0.0.1:3000/;` (with a slash) because that app has no basePath and must see `/admin`, not `/quiz/admin`. Getting this wrong yields a `308` loop or a 404 on every asset.

Caddy fallback (only if nginx is absent): `handle_path` strips the prefix and would therefore be **wrong** here; use `handle /delivery-app/* { reverse_proxy 127.0.0.1:3100 }`, which preserves the path, plus `tls internal`.

Do not add `add_header Strict-Transport-Security` in nginx: the app already sends `Strict-Transport-Security: max-age=63072000; includeSubDomains` (`src/lib/security-headers.ts:139`), and duplicating it on a self-signed certificate is how you lock yourself out of the host.

### 6.8 Cron (replacing Vercel cron)

`vercel.json` schedules five routes; on this server they become a systemd timer or a crontab entry that sends the bearer token:

```cron
# /etc/cron.d/delivery-app
*/10 * * * * deliveryapp curl -fsS -H "Authorization: Bearer $(. /etc/delivery-app.env; printf %s "$CRON_SECRET")" http://127.0.0.1:3100/delivery-app/api/cron/retry-translations >/dev/null 2>&1
17 3 * * *    deliveryapp curl -fsS -H "Authorization: Bearer $(. /etc/delivery-app.env; printf %s "$CRON_SECRET")" http://127.0.0.1:3100/delivery-app/api/cron/retention >/dev/null 2>&1
27 3 * * *    deliveryapp curl -fsS -H "Authorization: Bearer $(. /etc/delivery-app.env; printf %s "$CRON_SECRET")" http://127.0.0.1:3100/delivery-app/api/cron/audit-retention >/dev/null 2>&1
37 3 * * *    deliveryapp curl -fsS -H "Authorization: Bearer $(. /etc/delivery-app.env; printf %s "$CRON_SECRET")" http://127.0.0.1:3100/delivery-app/api/cron/data-retention >/dev/null 2>&1
7 4 * * 0     deliveryapp curl -fsS -H "Authorization: Bearer $(. /etc/delivery-app.env; printf %s "$CRON_SECRET")" http://127.0.0.1:3100/delivery-app/api/cron/orphan-cleanup >/dev/null 2>&1
```

`/etc/cron.d` files must not be readable by others if they contain the secret — better: put `CRON_SECRET` in a small `chmod 600` file owned by `deliveryapp` and `source` it, or use systemd timers with `EnvironmentFile=/etc/delivery-app.env`. The retention jobs are safe by default (`dry-run`), see `docs/audit-and-retention.md` and `docs/privacy.md`.

## 7. Deliverable 2 — `hand-off.html`

### 7.1 Where it lives and why

`public/hand-off.html` → served as `https://<server>/delivery-app/hand-off.html`.

Two verified reasons for this choice:

- Files with an extension are excluded from the i18n/auth proxy (`src/proxy.ts:80`, `next.config.ts:67`), so the page is reachable **without a login** — which is what a help page needs. Anything under `/de/...` without an extension would go through `decideAccess` (`src/lib/access.ts:35-52`) and, for an admin-only path, redirect to the login form.
- The static-file branch of the CSP allows `'self'` only — hence no inline `<script>`/`<style>`, no `onclick`, no external fonts/JS. `scripts/lib/offline-page.ts` is the working precedent in this repo; follow it.

Add a link to it: a "Hilfe" entry in the admin user menu and one on both login pages (small, secondary, opening in a new tab via `<a target="_blank" rel="noopener">`). Keep it a plain link, not a Next route.

`public/*.html` currently contains only generated files: `offline.html`, `offline.js`, `sw.js` are written by `scripts/build-pwa.ts` and are git-ignored. `hand-off.html` and its siblings **are** generated the same way and should be git-ignored too — the source of truth is the TypeScript data/config, so a hand-edit of the HTML is always lost on the next build. Say this at the top of the generated file and in `docs/`.

### 7.2 Files to add

| File                                | Role                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `content/hand-off/index.ts`         | the typed topic list (German + Chinese) — the single source of truth                   |
| `content/hand-off/types.ts`         | the topic type (section 8.2)                                                           |
| `content/hand-off/index.test.ts`    | data-quality test that runs in `pnpm test` (section 8.4)                                |
| `scripts/lib/hand-off-page.ts`      | pure functions that render HTML + the search index script (unit-testable, no I/O)       |
| `scripts/build-hand-off.ts`         | writes `public/hand-off.html`, `public/hand-off.css`, `public/hand-off.js`, `public/hand-off-data.js` |
| `package.json`                      | append the build step to the `build` and `build:vercel` chains, after `tsx scripts/build-pwa.ts` |
| `.gitignore`                        | the four generated files under `public/`                                                |

Content location: `content/hand-off/` keeps non-code out of `src/` and out of the client bundle; the checker `scripts/check-client-bundle.ts` only scans `.next/static`, so this adds nothing to the app's first-load JS.

### 7.3 Page behaviour

1. **Single page, two languages, no server.** A language switch (`Deutsch` / `简体中文`) at the top, remembered in `localStorage` (`handoff.lang`), default German.
2. **Search box** at the top with live filtering as you type (no submit button needed, but Enter must also work), showing a result list of matching topics: title, one-line summary, and the section it belongs to.
3. **Topic view.** Clicking a result (or a topic in a category list) shows: the title, *what it is for*, a numbered step list (`1.` … each step = one UI interaction with the **exact German label** in a `<code>`-like span), the click path (`Seitenleiste → Stammdaten → Produkte → «Neues Produkt»`), and a "Das passiert danach" line. A "Zurück zur Suche" link and `Esc` clear the topic.
4. **Category list** under the search box: `Büro (Admin)` / `Fahrer (App)` / `Anmeldung & Konto` / `System & Einstellungen` / `Begriffe (Glossar)`. On an empty search the whole list shows, grouped.
5. **Everything works offline and with JS disabled.** Without JS the page still renders every topic as HTML; the search box is the only enhancement. This also keeps it usable on the driver's phone.
6. **Print-friendly:** `@media print` hides the search box (a driver may print the two driver pages).
7. **Chinese:** Simplified Chinese (`zh-Hans`) is the primary Chinese variant, matching the app's own `zh-Hans` message file. Add a short note at the top of the Chinese version that the driver app is also available in English, Serbian (`Srpski`) and Czech (`Čeština`) and that German UI labels stay German.
8. **Honesty banner** at the top: "Diese Hilfe beschreibt die App. Die chinesischen Texte werden noch von einem Muttersprachler geprüft." — because `docs/i18n.md` states the Chinese UI texts are agent-written and not native-reviewed. Do not present machine quality as final.

### 7.4 Style

Keep the repo's look: the app's primary is `#9a3412` (`src/lib/pwa.ts:4`), page background white, `color-scheme: light dark` with a dark block like `scripts/lib/offline-page.ts:79`, system font stack incl. `"PingFang SC"`, `"Microsoft YaHei"` (the offline page already ships that stack — reuse it), body ≥ 16 px, touch targets ≥ 48 px on the driver topics. No web fonts (CSP + offline + Chinese subsetting are all reasons not to).

### 7.5 Wiring into the build

`scripts/build-hand-off.ts` runs after `scripts/build-pwa.ts` in `package.json:7-8`. It must:

- validate the content (`assertHandOffContent`) and exit non-zero on a broken index — a build must never ship a half-broken help page;
- write `public/hand-off.html` with **both** languages rendered server-side (all topics), so the page is complete without JS;
- write `public/hand-off.js` (search + language switch + topic view; plain ES5-ish IIFE like `buildOfflineScript()`, no imports) and `public/hand-off-data.js` (`window.HANDOFF_INDEX = [...]`, JSON — this keeps the data out of the HTML *and* out of the JS logic file);
- log one line: `hand-off: public/hand-off.html (N topics, de+zh), hand-off.js, hand-off-data.js`.

Both scripts are loaded with `<script defer src="...">`. Use relative URLs (`hand-off.js`, not `/hand-off.js`) or prefix with the base path — a relative URL is correct under `/delivery-app/` **and** under a future root deployment, so prefer relative.

## 8. Search index specification

### 8.1 What the search must answer

Searching must work for a **user's words**, not just the UI's. That means each topic carries a `search` array with synonyms, common misspellings without umlauts, and both German and Chinese keywords. The concrete requirement from the user: typing `waren typ hinzufügen` must find the topic for creating a product. Note the correction in section 12: the app calls it **`Produkt`**, not `Waren-Typ`, so the topic must be listed under both spellings and its answer must say which word the app actually uses.

Minimum coverage (one topic each; the labels are exact strings from `messages/de.json`):

**Büro**
1. Produkt anlegen (`Produkte` → `Neues Produkt`) — search: `waren typ hinzufügen`, `produkt anlegen`, `nudelsorte`, `neuer artikel`, `添加产品`, `新建产品`, `货号`, `sku`
2. Produkt bearbeiten / Namen (vereinfachtes Chinesisch Pflicht, Englisch, Serbisch, Tschechisch automatisch übersetzt) / `Neu aus dem deutschen Namen übersetzen`
3. Produkt deaktivieren/aktivieren (`Deaktivieren`, `Aktivieren`) und Reihenfolge (`nach oben`/`nach unten`)
4. Kunde anlegen (`Kunden` → `Neuer Kunde`) mit Adresse
5. Adresspunkt setzen und bestätigen (`Auf Karte suchen`, `Adresspunkt geprüft: …`) — search: `adresspunkt`, `karte`, `adresse suchen`, `地址点`
6. Kundenfotos hochladen/ersetzen (`Geschäft / Eingang`, `Parken / Entladen`, `Foto ersetzen`, `Bild auswählen`, Strg+V) — search: `foto hochladen`, `bild`, `eingang`, `parken`
7. Kunden importieren (4 Schritte `Datei`/`Spalten`/`Vorschau`/`Ergebnis`; Limits 5 MB, 2000 Zeilen) — search: `import`, `csv`, `excel`, `kundenliste`, `导入`
8. Adresspunkte prüfen nach Import (`Adresspunkte prüfen`, `Adresspunkt bestätigen`, `Überspringen`)
9. Kunde archivieren/wiederherstellen (`Archivieren`, `Wiederherstellen`, Filter `Archivierte`)
10. Kunden suchen und filtern (`Suche`, `Fotos fehlen`, `Adresspunkt unbestätigt`)
11. Bestellung anlegen (`Bestellungen` → `Neue Bestellung`, `Produkt hinzufügen`, `Menge`, `Bestätigt speichern` / `Als Entwurf speichern`) — search: `bestellung anlegen`, `order`, `menge`, `新建订单`
12. Screenshot zur Bestellung hochladen (`Screenshot`, Strg+V)
13. Bestellung bearbeiten / `Auf anderes Datum kopieren` / `Stornieren`
14. Bestellungen filtern und `Summen je Liefertag` lesen
15. Tour erstellen (`Touren` → `Tour erstellen`) — search: `tour planen`, `route`, `liefertour`, `配送线路`
16. Tour umsortieren / `Reihenfolge sperren` / `Neu optimieren`
17. Fahrer zuweisen (`Fahrer`, `Kein Fahrer gewählt`) und `Tour freigeben` (+ `Jetzt freigeben`)
18. `Erneut freigeben` nach Änderungen (`Bestellungen seit der Freigabe geändert…`) und `Folgetour erstellen`
19. `Ladeliste drucken` (Sprache des Ausdrucks wählen; `1. Gesamtmenge pro Produkt`, `2. Beladereihenfolge`)
20. Fortschritt beobachten (`Übersicht`, `Zu erledigen`, `Letzte Aktivität`; Aktualisierung ~30 s)
21. Fahrer anlegen + PIN (`Fahrer anlegen`, `PIN für {name}`, `PIN kopieren`, `Drucken`, `PIN zurücksetzen`)
22. Fahrer deaktivieren/reaktivieren und seine Sprache ändern (`Sprache bearbeiten`)
23. Admin anlegen (`Admin anlegen`, E-Mail + Passwort ≥ 10 Zeichen)
24. Einstellungen: Depot-Standort + Bestätigungshäkchen, `Standard-Abfahrtszeit`, `Minuten pro Stopp`, `Liefertage`
25. `Verlauf` lesen (append-only, wer wann was geändert hat)
26. Notizen übersetzen (Kunden-Tab `Übersetzungen`, `Übersetzungen speichern`, `Neu übersetzen`, `Als geprüft markieren`)
27. Büro-Anmeldung / Abmelden / Sprache wechseln

**Fahrer**
28. Anmelden mit Benutzername + `PIN (6 Ziffern)` (Fehlertexte: `Benutzername oder PIN falsch`, `Zu viele Fehlversuche…`)
29. Erster Start: Sprachauswahl (vier Knöpfe) — search: `sprache`, `chinesisch`, `语言`
30. Tages-Tour ansehen (`Heutige Tour`, `Nächster Stopp`, `Ankunft ca.`, `Fortschritt`, `Alle Stopps`, `Liste`/`Karte`)
31. Stopp-Details (`Lieferung`, `Gesamt`, `Hinweis`, `Lieferzeiten`, `Fotos`, `Adresse kopieren`)
32. `Navigation starten` (Google Maps / `Apple Karten`, navigiert zum Adresspunkt)
33. `Geliefert` melden, `Rückgängig` (nur 5 Minuten)
34. `Problem melden` — die sieben Gründe + `Anmerkung (freiwillig)`
35. Foto aufnehmen/ersetzen (`Foto aufnehmen`, `Foto verwenden`, `Neu aufnehmen`, `Wartet auf Versand`, `Gesendet`)
36. Tour abschließen (`Alle Stopps erledigt`, `Zurück zum Depot`)
37. Offline arbeiten (`Offline bereit ✓`, `Wartet auf Übertragung`, `Jetzt senden`, `Hinweise`, Grenzen: 50 Einträge / 256 KiB / 24 h)
38. App installieren (`App installieren`, `Installieren`, `So geht's`, `Nicht jetzt`)
39. Sprache wechseln in der App (`Sprache ändern`)
40. Abmelden; was beim Abmelden/Anmelden mit den Offline-Daten passiert

**System / Fehler**
41. Was tun, wenn `Etwas ist schiefgelaufen` erscheint (inkl. `Fehler-ID`)
42. Keine Verbindung / `Offline nicht verfügbar` / `Keine gespeicherte Tour`
43. Karte leer (`Kartenhintergrund nicht verfügbar` / `offline nicht verfügbar`; Stopps und Route bleiben)
44. `Näherungswerte`-Badge erklären (kein Routing-Dienst verbunden)
45. Warum eine Tour nicht erstellt werden kann (Depot-Standort, `Kein Stopps`-Gründe, `Zu viele Stopps`)
46. Warum ein Kunde nicht in der Tour ist (`Nicht in der Tour: Adresspunkt nicht bestätigt`)
47. `/delivery-app-health` (Betrieb), Kontakt/Support-Hinweis

**Glossar**
48. Eine Glossar-Seite: the term table from section 8.3 (German ↔ 简体中文), searchable, so a Chinese-speaking driver can look up a German word they see on a printed sheet.

**Two more topics that belong in the help page because they are easy to get wrong**

49. `Ladeliste` lesen und drucken: A4, 12 mm Rand, `Sprache des Ausdrucks` unabhängig von der UI-Sprache, `1. Gesamtmenge pro Produkt` + `2. Beladereihenfolge` (`Der letzte Stopp wird zuerst eingeladen, der erste Stopp zuletzt`), Warnung `ACHTUNG: Bestellungen wurden nach der Freigabe dieser Tour geändert…`
50. Bedienung am Bildschirm allgemein: `Seitenleiste einklappen`/`ausklappen`, `Menü öffnen` auf schmalen Fenstern, die Taste `/` springt in die Seitensuche, Toasts unten, `Verstanden` quittiert Hinweise, `Ungespeicherte Änderungen` + `Verwerfen`.

Also include a short "Diese Funktionen gibt es nicht" page (section 12) so nobody searches forever for a password-reset screen.

Depth of the steps: write for someone who has never used the app. Good step text names **one** control and says what happens: „Seitenleiste → **Stammdaten** → **Produkte** öffnen. Oben rechts auf **«Neues Produkt»** klicken. `Artikelnummer (SKU)` und `Einheit` ausfüllen. Unter `Namen` den deutschen Namen und den Namen auf **vereinfachtem Chinesisch** eintragen (Pflichtfeld). Auf **«Anlegen»** klicken — oben erscheint „Produkt angelegt.“ Die beiden traditionellen Namen werden automatisch vorgeschlagen (Kennzeichnung „automatisch“) und können von Hand geändert werden." Add the small details that actually trip people up: quantities accept comma **or** point (`2,5`), `Enter` adds the next line, the depot pin must be confirmed before any tour can be created, an unconfirmed customer pin keeps that customer out of every tour, a driver PIN is shown **once**, undo only works for 5 minutes, the print language is chosen separately.

### 8.2 Data model

```ts
// content/hand-off/types.ts
export type HandOffLocale = "de" | "zh";
export type HandOffText = { de: string; zh: string };

export type HandOffStep = {
  /** What the user does, in both languages. */
  text: HandOffText;
  /** Exact UI label the step clicks/taps, e.g. "Neues Produkt" — shown verbatim, never translated. */
  label?: string;
  /** Optional result/toast text, e.g. "Produkt angelegt." */
  result?: string;
};

export type HandOffTopic = {
  /** kebab-case, stable, used as the URL fragment (#produkt-anlegen). */
  id: string;
  area: "buero" | "fahrer" | "konto" | "system" | "glossar";
  title: HandOffText;
  /** One line under the title in the result list. */
  summary: HandOffText;
  /** Click path, e.g. "Seitenleiste → Stammdaten → Produkte → «Neues Produkt»". */
  path: HandOffText;
  /** Extra searchable terms, per language. Include the user's wrong word here. */
  search: { de: string[]; zh: string[] };
  steps: HandOffStep[];
  /** "Das passiert danach" — one sentence. */
  after?: HandOffText;
  /** App route this topic is about, e.g. "/de/admin/products/new" (for maintainers, shown small). */
  route?: string;
};

export type HandOffContent = { topics: HandOffTopic[]; glossary: { de: string; zh: string }[] };
```

### 8.3 Glossary (German UI term → 简体中文)

Use these; they are taken from `messages/zh-Hans.json` where that file has the term, so the help page and the app agree. Build the glossary from this list, and add the ones the app itself uses in the printed load sheet.

Büro 办公室 · Fahrer 司机 · Übersicht 总览 · Bestellungen 订单 · Produkt (in einer Bestellung) 订单中的产品 · Touren 配送线路 (admin) / 行程 (driver) · Stopp 站点 · Tour planen 规划行程 · Tour erstellen 生成配送线路 · Freigabe / freigeben 发布 · Erneut freigeben 重新发布 · Folgetour 补充线路 · Nachbestellung 补单 · Kunde 客户 · Kundennummer 客户编号 · Produkt / Nudelsorte 产品 · Artikelnummer (SKU) 货号（SKU）· Einheit 单位 · kg 公斤 · Beutel 袋 · Karton 纸箱 · Stück 件 · Menge 数量 · Lieferdatum 送货日期 · Liefertag 送货日 · Lieferung 送货内容 · Lieferadresse 送货地址 · Lieferzeiten 送货时间 · Problem 问题 · Problem melden 报告问题 · Grund 原因 · Notiz 备注 · Interne Notiz 内部备注 · Hinweis 提示 · Archiv / archivieren 归档 · Import 导入 · Ladeliste 装车单 · Foto 照片 · Synchronisierung 同步 · Offline 离线 · Adresspunkt 地址点 · Adresspunkt bestätigen 确认地址点 · Adresse suchen 查找地址 · Depot / Fabrik 仓库（工厂）· Einstellungen 设置 · Berechtigung 权限 · Verlauf 变更记录 · Entwurf 草稿 · Bestätigt 已确认 · Storniert 已取消 · Freigegeben 已发布 · Abgeschlossen 已完成 · Offen 待送 · Geliefert 已送达 · Standard-Abfahrtszeit 默认出发时间 · Zeitzone 时区 · Summen 合计 · Kennzahlen 关键指标 · Zu erledigen 待处理 · Letzte Aktivität 最近活动 · Nächster Stopp 下一站 · Navigation starten 开始导航 · Foto aufnehmen 拍照 · Gesendet 已发送 · Wartet auf Versand 等待发送 · Rückgängig 撤销 · Anmerkung 补充说明 · Screenshot 截图 · Manuell 手动录入 · PIN PIN码 · PIN zurücksetzen 重置PIN码 · Passwort 密码 · Benutzername 用户名 · E-Mail 电子邮箱 · Anmelden 登录 · Abmelden 退出登录 · Sprache 语言 · Administratoren 管理员 · Gesamtmenge 总数量 · Beladereihenfolge 装车顺序

(Tour differs by area on purpose — that is how the app's own Chinese files do it. Do not "fix" it; mention it in the glossary note.)

### 8.4 Validation (`content/hand-off/index.test.ts`)

Fail the test suite when:

- a topic has an empty `title`, `summary`, `path`, `steps`, `search.de` or `search.zh`;
- `id`s are not unique or not kebab-case;
- a `label` string is not actually present in `messages/de.json` (read the JSON in the test and assert the substring) — this is the guard that keeps the help page from inventing UI labels;
- a topic has fewer than 2 or more than 12 steps;
- the required coverage list of section 8.1 is not present (assert a fixed list of expected `id`s exists);
- `waren typ hinzufügen` does not resolve to exactly one topic (hard-code that one search query as the acceptance example).

## 9. Verification (must be done, in this order)

### 9.1 Local, before touching the server

```bash
pnpm i18n:check && pnpm lint && pnpm typecheck && pnpm test
NEXT_PUBLIC_BASE_PATH=/delivery-app pnpm build      # the real basePath build
NEXT_PUBLIC_BASE_PATH=/delivery-app PORT=3100 pnpm start
```

Then, locally:

- `http://127.0.0.1:3100/delivery-app/de/login` renders; `http://127.0.0.1:3100/` returns 404 (correct — nothing is served at the root).
- Log in as admin, open `/delivery-app/de/admin`, `/delivery-app/de/admin/products`, create a product.
- Log in as a driver (demo accounts: `RUN-AND-TEST.md:84-88`), open `/delivery-app/de/driver`.
- `curl -i http://127.0.0.1:3100/delivery-app/api/health` → 200 and `"status":"ok"`.
- No CSP violation in the console on a page load (the nonce must reach the inline scripts). If `script-src` blocks something, section 5.3 item 5 is the cause.
- DevTools → Application: `sw.js` registered with scope `/delivery-app/`; Cache Storage contains prefixed `_next/static` URLs.
- `/delivery-app/hand-off.html`: search `waren typ hinzufügen` and `添加产品`; both must open the product topic; the German UI label shown must be `Neues Produkt`.
- With JS disabled: the page still shows all topics in both languages.

### 9.2 First deploy, on the server

- `systemctl status delivery-app` active; `journalctl -u delivery-app -n 50` shows `Ready`.
- `curl -fsS http://127.0.0.1:3100/delivery-app/api/health`.
- `curl -sI https://<IP>/delivery-app/` → 200/308 (not 502, not 404) and **`https://<IP>/quiz/` still answers as before**.
- `curl -sI https://<IP>/delivery-app/_next/static/...` → 200 with the immutable cache header.
- Log in through the public HTTPS URL (this also proves `X-Forwarded-*` and `trustHost` are right) and confirm the session survives a reload.
- Take a driver photo from a phone through the public URL — this is the only end-to-end proof that the S3 endpoint works from a browser, is inside the CSP, and passes CORS.
- `pnpm exec tsx scripts/check-storage-private.ts` → exit 0.
- `nginx -t` clean, `/etc/nginx` backup exists, quiz app untouched (`git`/file diff of the vhost).

### 9.3 The two things most likely to be wrong

1. **`basePath` + `proxy.ts` matcher.** Check whether the CSP `nonce-…` appears in the `Content-Security-Policy` response header of a page **and** on the inline `<script>` tags of the same response (`curl -s -D- -o page.html ...`). Both must carry the nonce. Also check `curl -sI /delivery-app/api/health` for the absence of i18n redirects.
2. **`splitLocalePath` with the prefix.** `src/proxy.ts:32` and `src/lib/access.ts:15-20` assume the locale is the **first** segment. Verify that `/delivery-app/de/admin` is authorized (not redirected to the login page endlessly) and that `/delivery-app/de/driver/stops/<id>` still parses (`src/lib/offline/routes.ts:10`).

If either fails and cannot be fixed cheaply, stop and present the sub-domain option of section 5.5 to the user before sinking more time into the sub-path.

## 10. Acceptance criteria

1. `deploy.bat` on Windows deploys the current tree in one run, from a machine that has never talked to the server (only `.env` set). Re-running it is the update path and is idempotent.
2. `https://<IP>/delivery-app/de/login` and `https://<IP>/delivery-app/de/driver/login` work, and `https://<IP>/quiz/` is unchanged.
3. `/api/health` reports `ok` for database and storage.
4. The service restarts automatically (`systemctl restart delivery-app`, and after a reboot).
5. `https://<IP>/delivery-app/hand-off.html` is reachable **without login**, works with JS disabled, and its search finds the right topic for at least the 50 topics of section 8.1 in German and Chinese — including `waren typ hinzufügen`.
6. Every UI label quoted in the help page exists verbatim in `messages/de.json` (enforced by `content/hand-off/index.test.ts`).
7. `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` are green, `pnpm build` with the sub-path is green, and no CSP relaxation was added anywhere.
8. `docs/deploy.md` has a new section "Self-hosting on a vServer (path `/delivery-app/`)" that links here, `AGENTS.md` mentions `deploy.bat` under Commands, `.env.example` documents the three `REMOTE_*` keys, and everything is committed in one `NUD-xxx`-style commit per the repo convention.

## 11. Risks and open decisions (the human must answer these)

| # | Question / risk                                                                                                                | Why it matters                                                                                                                        | Recommendation if nobody answers |
| - | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1 | Path `/delivery-app/` (as asked) or a sub-domain?                                                                               | The sub-path needs the code changes of section 5 and carries the PWA/proxy risk. A sub-domain needs almost none.                       | Implement the sub-path as asked; keep 5.5 ready |
| 2 | Is the TLS certificate self-signed (IP only) or is there a real host name?                                                      | Self-signed means every driver must accept a warning on the phone; an installed PWA with a bad certificate is a bad experience. Let's Encrypt needs a domain. | Ask; do not create the host name yourself |
| 3 | Which object storage: MinIO in Docker or a static binary, and on which public path?                                              | Photos and screenshots do not work without it (`src/server/storage/index.ts:21`).                                                      | MinIO in Docker + `/delivery-app-s3/` via nginx |
| 4 | Does the server have enough RAM for `next build` (>2 GB) and free disk for Postgres + MinIO + photos?                            | An OOM during the first build looks like a random failure.                                                                            | Measure first, add swap, report the numbers |
| 5 | Is a driver PIN reset / an office password reset acceptable as "ask the office", or is a self-service password reset needed?     | It is a **gap** in the app today (section 12), and the help page cannot paper over it.                                                | Document the gap; propose a ticket |
| 6 | Privacy: the app stores customer addresses and photos on a server in the EU, with a daily local `pg_dump` instead of Neon's PITR | `docs/privacy.md` and the client's expectations may assume Neon/R2.                                                                   | Flag it in the hand-over; do not silently downgrade |
| 7 | Who checks the Chinese help texts?                                                                                              | `docs/i18n.md` says the Chinese UI texts are agent-written and unreviewed; the help page inherits that status.                         | Say it on the page (7.3 item 8) and ask for a reviewer |
| 8 | Do the cron jobs run at all (crontab vs systemd timers) and with which retention values?                                        | Without `CRON_SECRET` every cron route rejects; with `dry-run` nothing is deleted even though the client may expect deletion.           | Install the timers, keep `dry-run`, report counts for two weeks |

## 12. What does not exist in the app (do not invent it in the help page)

Read from `messages/de.json` (all four locale files) and the route tree — these were explicitly checked:

- **`Waren-Typ` does not exist anywhere in the UI.** The entity is `Produkt` (`Produkte`, `Neues Produkt`, `Produkt bearbeiten`). The user's search phrase must still work (section 8.1 topic 1), and the answer must use the app's own word.
- **No password change and no "forgot password"** for office accounts. An admin creates accounts with `Admin anlegen` (e-mail + password ≥ 10 characters); the only credential reset in the whole UI is `PIN zurücksetzen` for a driver.
- **No tour templates**, no `Sammelrechnung`/`Rechnung`/`Beleg`, no signature capture, no time windows (`Lieferzeiten` are free text information), no capacity planning, no shortfall (`Fehlmenge`) field, no role editor (roles are `Büro`/`Fahrer` only).
- **No self-service language for the office beyond the header switch**, and no per-user notification settings.
- **`/dev-kit`, `/admin/dev/maps`, `/admin/dev/error`, `/driver/dev-error` are development pages** — not in the nav and 404 in production (`ENABLE_ERROR_TEST_PAGES` must not be set).
- Orders, tours and stops are **never deleted**; only photos, audit entries and driver free text are pruned by the cron jobs.

---

### Provenance of the claims in this file

- German UI labels: `messages/de.json` (exact strings, line numbers given inline for the important ones).
- Chinese terms: `messages/zh-Hans.json`.
- Routes: the `page.tsx`/`route.ts` tree under `src/app/[locale]/` and `src/app/api/`.
- Behaviour and limits (import limits, photo limits, outbox limits, session lifetimes, retention): the module files cited inline plus `docs/*.md`.
- Next.js facts: `node_modules/next/dist/docs/01-app/...` (the guides bundled with the installed Next 16.4.2), cited with file and line, plus two facts read from the installed server bundle itself (`router-server.js`) that the guides do not state.
- Server/deploy facts: `C:\Users\niko\Desktop\quiz-game\deploy\*` and `C:\Users\niko\Desktop\nudel-liefer-app\.env` (lines 12-14).
- **Not verified on the real server:** available RAM, disk, Docker presence, whether ports 80/443 host nginx or Caddy today, and whether the MinIO images still pull. Establish these in the first ssh session and adjust sections 6.3, 6.6 and 11 accordingly.

### One caveat about the working tree

When this document was written, the repository had a **large uncommitted re-design in the working tree** (dozens of modified components, new `src/components/ui/*`, new `page-header.tsx`, `src/app/[locale]/dev-kit/`, and an updated `src/components/admin/nav-items.ts` that already contains the sidebar groups `Betrieb`/`Stammdaten`/`System`). Sections 8.1 and the label quotes in this document follow the **working tree**, because that is what will be deployed — but a `git stash`, a `git checkout .` or a deploy from a fresh clone would ship a different UI, and some labels quoted here (e.g. the sidebar groups, `page-header` controls) may not exist in that older state.

Consequence for the implementer: build the help page against a **running instance of the tree you are about to deploy** (`pnpm dev`, walk every topic once, compare the labels) rather than against this document alone. The `label`-must-exist-in-`de.json` test of section 8.4 catches invented labels that live in the message files, but it cannot catch a control that only exists in the uncommitted re-design. Before the first production deploy, settle with the user whether the re-design is part of the release or must be excluded.
