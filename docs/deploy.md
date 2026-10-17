# Deployment (Vercel + Neon + Cloudflare R2)

Target setup (backlog decision D4): Vercel project in `fra1` (Frankfurt), Neon Postgres in EU (Frankfurt), Cloudflare R2 bucket in the EU jurisdiction. Budget target: under 50 EUR per month.

This guide is written for a person without developer background. Everything an agent can prepare is already in the repo: `vercel.json`, the `build:vercel` script (runs the environment check, then `prisma migrate deploy`, then `next build`), `GET /api/health`, and the seed options. Menu names in the three web consoles change from time to time; if a label differs slightly, look for the closest one.

**Rules:** never paste a key, password or connection string into git, a ticket, a chat or an email. Put secrets only into the Vercel environment variable form (section 5) and into your password manager.

Contents: 0 Overview and costs, 1 GitHub, 2 Neon, 3 Cloudflare R2, 4 Vercel project, 5 Environment variables, 6 First deploy, 7 Seed production once, 8 Preview deployments, 9 Verify, 10 Troubleshooting.

## 0. Overview and costs

| Service       | Purpose                | Plan to choose                                                                                                                                                           |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub        | code, triggers deploys | Free                                                                                                                                                                     |
| Vercel        | hosts the app          | **Pro (about 20 USD per user per month).** The free Hobby plan is for non-commercial use only, so it must not be used for a real client project.                         |
| Neon          | PostgreSQL             | Free plan is enough to start (0.5 GB). Move to Launch (usage based, typically a few USD) when the database grows or you need longer point-in-time restore (see NUD-094). |
| Cloudflare R2 | photos and screenshots | Free tier: 10 GB stored per month, no egress fees. R2 asks for a payment method when you enable it; staying within the free tier costs nothing.                          |

Prices are from memory and may have changed: check each pricing page before you enter a payment method. Creating accounts and adding payment methods is your decision; the agent never does it.

## 1. GitHub repository (once)

The project currently exists only on your computer.

1. Sign in at github.com, click **+** (top right) then **New repository**. Name: `nudel-liefer-app`. Visibility: **Private**. Do not add README, .gitignore or license. Click **Create repository**.
2. On your computer, in the project folder, run the two commands GitHub shows under "push an existing repository" (`git remote add origin ...` and `git push -u origin main`).
3. In the repository: **Settings > Branches > Add branch protection rule** for `main` (optional but recommended): require a pull request and the status check `check` (from `.github/workflows/ci.yml`).

Tip for the first push: CI runs on GitHub for the first time. NUD-001 and NUD-004 list "CI green" as an open check; once it is green, tell the agent so those tickets can be closed.

## 2. Neon (database, EU Frankfurt)

1. Go to neon.com, **Sign up** (GitHub login is fine).
2. **Create project** (or "New project"):
   - Project name: `nudel-liefer-app`
   - Postgres version: **16** (or newer; the app is developed against 16)
   - Cloud provider: **AWS**
   - Region: **Europe (Frankfurt) - aws-eu-central-1**. This is the one region that matters for GDPR; it cannot be changed later.
   - Click **Create**.
3. Neon creates a branch called `main` (production) with a database `neondb`. Keep these defaults, or rename the database to `nudel` under **Databases**.
4. Copy two connection strings, both for branch `main`: on the project dashboard click **Connect**.
   - Turn **Connection pooling ON** and copy the string. This is `DATABASE_URL` (host contains `-pooler`).
   - Turn **Connection pooling OFF** and copy the string. This is `DATABASE_URL_UNPOOLED` (direct connection, used for migrations and for the one-time seed).
   - Both must end with `?sslmode=require`. Keep them in your password manager for now.
5. Create the shared staging branch for preview deployments (see section 8): **Branches > Create branch**. Name: `staging`, parent: `main` (production is still empty at this point, so the branch holds no real data). Copy its two connection strings the same way (pooled and direct).

Backups: Neon keeps a short history (free plan about 6 hours, paid plans longer) that you can restore from under **Backup & Restore**. Real backups and restore drills are NUD-094.

## 3. Cloudflare R2 (photos, EU jurisdiction)

1. Go to cloudflare.com, **Sign up**. In the dashboard left menu click **R2 Object Storage** (under "Storage & databases"). If asked, enable R2 and add a payment method (free tier, see section 0).
2. **Create bucket**:
   - Bucket name: `nudel-photos`
   - Location: choose **Specify jurisdiction** and then **European Union (EU)**. Do not pick "Automatic": data could be stored outside the EU, and the jurisdiction cannot be changed afterwards.
   - Default storage class: **Standard**. Click **Create bucket**.
3. Keep the bucket **private**: on the bucket's **Settings** page make sure **Public access** shows "Disabled" for both the `r2.dev` subdomain and custom domains. The app shows photos through short-lived signed links.
4. Create a second bucket the same way (also EU jurisdiction) named `nudel-photos-staging` for preview deployments.
5. Note the **Account ID**: R2 overview page, right-hand side ("Account details"). The S3 endpoint for EU buckets is
   `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`
   (this is `S3_ENDPOINT`; note the `.eu.` part - without it the EU buckets are not found).
6. Create an API token for the production bucket: R2 overview, **Manage API tokens** (or **API** > **Manage API Tokens**) > **Create API token**.
   - Token name: `nudel-photos-production`
   - Permissions: **Object Read & Write**
   - Specify bucket(s): **Apply to specific buckets only** > `nudel-photos`
   - TTL: forever (or set a reminder to rotate it)
   - Click **Create API Token**. The next page shows **Access Key ID** and **Secret Access Key** exactly once. Copy both into your password manager now. (Ignore the "Token value" and the "URL for jurisdiction" shown there; the app needs Access Key ID, Secret Access Key and the endpoint from step 5.)
   - Repeat for `nudel-photos-staging` with the name `nudel-photos-staging`.
7. CORS (required, otherwise the browser cannot upload): open bucket `nudel-photos` > **Settings** > **CORS Policy** > **Add CORS policy** > JSON tab, and paste the following. Replace the origin with your real production URL (add your own domain too once it exists; list every origin from which people open the app). No trailing slash.

   ```json
   [
     {
       "AllowedOrigins": ["https://<your-production-domain>"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["content-type", "content-length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   For `nudel-photos-staging` (previews have a different URL per deployment and R2 does not accept wildcard subdomains) use `"AllowedOrigins": ["*"]`. That bucket only ever contains test data. Never use `*` for the production bucket.

## 4. Vercel project (region fra1)

1. Go to vercel.com, **Sign up** with GitHub. Upgrade to **Pro** (section 0) under **Settings > Billing** before you put real data in.
2. **Add New... > Project**, pick the GitHub repository `nudel-liefer-app` (click "Adjust GitHub App Permissions" if it is not listed) and **Import**.
3. On the configure screen:
   - Framework Preset: **Next.js** (detected). Root Directory: leave empty (`./`).
   - Build and Output Settings: leave as they are. `vercel.json` in the repository already sets install command `pnpm install --frozen-lockfile`, build command `pnpm build:vercel` and region `fra1`.
   - Do **not** click Deploy yet. Open **Environment Variables** and enter the variables of section 5, or click Deploy (it will fail the first build with a clear list of missing variables, which is harmless) and enter them afterwards under **Settings > Environment Variables**.
4. **Settings > Functions > Function Region**: confirm **Frankfurt, Germany (West) - fra1** (it follows `vercel.json`; a change here takes effect on the next deployment).
5. **Settings > General > Node.js Version**: **22.x**.
6. **Settings > Git**: Production Branch = `main`. Every push to `main` now deploys to production, every pull request gets a preview deployment.
7. **Settings > Deployment Protection**: keep "Vercel Authentication" enabled for **Preview** deployments (only logged-in team members can open previews). Production stays public (drivers and the office use it).

## 5. Environment variables

Enter them under **Settings > Environment Variables**. For each variable choose the environments shown in the table (checkboxes Production / Preview / Development). Mark every secret as **Sensitive** when Vercel offers it. Do not set anything for "Development" (local work uses `.env`).

| Variable                | Production value                                              | Preview value                     | Sensitive |
| ----------------------- | ------------------------------------------------------------- | --------------------------------- | --------- |
| `DATABASE_URL`          | Neon `main`, **pooled** string (section 2 step 4)             | Neon `staging`, **pooled** string | yes       |
| `DATABASE_URL_UNPOOLED` | Neon `main`, **direct** string                                | Neon `staging`, **direct** string | yes       |
| `AUTH_SECRET`           | new random value: run `openssl rand -base64 32` in a terminal | a **different** random value      | yes       |
| `S3_ENDPOINT`           | `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`            | same                              | no        |
| `S3_REGION`             | `auto`                                                        | `auto`                            | no        |
| `S3_BUCKET`             | `nudel-photos`                                                | `nudel-photos-staging`            | no        |
| `S3_ACCESS_KEY_ID`      | token `nudel-photos-production`                               | token `nudel-photos-staging`      | yes       |
| `S3_SECRET_ACCESS_KEY`  | token `nudel-photos-production`                               | token `nudel-photos-staging`      | yes       |

Notes:

- Vercel lets you add the same variable name twice with different environments ticked (one entry for Production, one for Preview).
- Do **not** set `SEED_ADMIN_PASSWORD` in Vercel. It is only needed for the one-time seed on your computer (section 7).
- Variables for later tickets (`ORS_API_KEY`, `DEEPL_API_KEY`, `MAP_TILE_*`, `SENTRY_DSN`) are added by those tickets.
- Changing a variable only affects new deployments: after a change click **Deployments > ... > Redeploy**.

## 6. First deploy

1. **Deployments > Redeploy** (or push a commit to `main`). Open the build log; you should see, in this order: `[deploy-env] ok`, Prisma applying the migrations (`prisma migrate deploy`), then the Next.js build.
2. If the first lines say `[deploy-env] error: ...`, fix the listed variables (section 5) and redeploy. The check never prints values.
3. When the deployment is "Ready", click **Visit**. You see the login page. Copy the production URL and add it to the R2 CORS policy of `nudel-photos` (section 3 step 7) if you have not done so.

Each deployment runs `prisma migrate deploy` against its database before building. Migrations are applied automatically and never reset data; a failed migration fails the build, and the previous deployment stays live.

## 7. Seed production once

The migrations create empty tables. One command creates the settings row (placeholder depot), the first admin and six placeholder products. Run it **once**, on your computer, after the first successful deploy (so the tables exist). It needs Node 22 and pnpm; if you do not have them, ask a developer to run it with you.

1. In a terminal in the project folder, run `pnpm install` (once).
2. Run the following block. It asks for the values without echoing them, so nothing lands in your shell history. Use the **direct** (unpooled) Neon string of branch `main`, pick a strong admin password (at least 16 characters, from your password manager) and your real admin email address.

   ```bash
   read -rs -p "Neon main DIRECT url: " DATABASE_URL && echo
   read -rs -p "Admin password: " SEED_ADMIN_PASSWORD && echo
   read -r -p "Admin email: " SEED_ADMIN_EMAIL
   export DATABASE_URL SEED_ADMIN_PASSWORD SEED_ADMIN_EMAIL SEED_DRIVERS=false
   pnpm db:seed
   unset DATABASE_URL SEED_ADMIN_PASSWORD SEED_ADMIN_EMAIL SEED_DRIVERS
   ```

3. Expected output: `Seed finished`. `SEED_DRIVERS=false` is important: without it four demo drivers with the well-known PIN `123456` would exist on production. Drivers are created in the admin area (NUD-008).
4. Running it again is harmless (it only creates what is missing), but it does not change an existing password. Do not run it with other values to "reset" the admin.
5. Sign in on the production URL with that email and password. You land on the admin dashboard.

For `staging` (previews) do the same once with the staging direct URL, a throw-away password and without `SEED_DRIVERS=false` (the demo drivers are useful there).

## 8. Preview deployments: decision

Every pull request already gets its own Vercel preview URL. Which database do previews use?

- **Chosen for v1: one shared Neon branch `staging`** (created in section 2 step 5, seeded with fake data), used by all previews through the Preview-scoped variables of section 5, with the separate R2 bucket `nudel-photos-staging`. Reasons: production data (customers, addresses, password hashes) never reaches previews; no extra moving parts or Vercel marketplace integration; free. Each preview build runs `prisma migrate deploy` against `staging`, so previews always get the newest migrations.
- **Known downside:** two open pull requests with different migrations share one database and can break each other's preview. Acceptable with one developer and short-lived PRs. If it starts hurting, reset staging: Neon > Branches > `staging` > **Reset from parent** (this copies production, so re-seed/anonymise afterwards), or recreate the branch.
- **Alternative (not chosen now): a Neon branch per PR** via Neon's Vercel integration (Vercel project > Integrations > Neon, option "create a database branch for each preview deployment"). Technically feasible and gives full isolation, but those branches are copies of production data unless the parent is a clean branch, which has to be confirmed in the integration settings. Revisit after the first real customers are loaded.

## 9. Verify

1. Open `https://<production-url>/api/health`. Expected (HTTP 200):

   ```json
   {
     "status": "ok",
     "checks": {
       "database": { "status": "ok", "latencyMs": 12 },
       "storage": { "status": "ok", "mode": "s3", "latencyMs": 80 }
     },
     "release": "a1b2c3d",
     "region": "fra1"
   }
   ```

   `region` must be `fra1`. A failing dependency gives HTTP 503 and `"status": "error"` (the response never contains secrets or error details; the reason is in **Vercel > Logs**). This URL is public on purpose and is the one to give to an uptime monitor (NUD-094).

2. Sign in on `/de/login` with the seeded admin. You reach the admin dashboard.
3. Neon console > Branches > `main` > **Tables** shows the app's tables, and `_prisma_migrations` lists the applied migrations.
4. Upload check: once a page with the image uploader exists (NUD-015), upload a photo and check that it appears in the R2 bucket (Objects) and that opening the object's plain URL without a signature is denied.
5. Tell the agent: production URL and the result of `/api/health`. The ticket NUD-007 can then be closed.

## 10. Troubleshooting

| Symptom                                                          | Likely cause and fix                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Build log: `[deploy-env] error: ...`                             | A variable is missing or still a placeholder. Fix it in section 5 and redeploy.                                                               |
| Build fails in `prisma migrate deploy` with a timeout or lock    | `DATABASE_URL_UNPOOLED` is missing or is the pooled string. It must be the **direct** one (no `-pooler` in the host name).                    |
| `/api/health` returns 503, `database: error`                     | Wrong `DATABASE_URL`, Neon compute suspended and still waking up (retry once), or Neon project deleted. See Vercel Logs.                      |
| `/api/health` returns 503, `storage: error`                      | Wrong bucket name, endpoint without `.eu.`, or token not scoped to that bucket. See Vercel Logs.                                              |
| Photo upload fails in the browser with a CORS error              | The app's origin is missing in the bucket's CORS policy (section 3 step 7), or has a trailing slash.                                          |
| Login works locally but not on Vercel                            | `AUTH_SECRET` missing in that environment, or you changed it (all sessions become invalid, which is fine). Redeploy after changing variables. |
| `Seed finished` never appears / `SEED_ADMIN_PASSWORD is not set` | The variable was not exported in the same terminal session; repeat the block of section 7.                                                    |
