# Environment variables

| Variable                | Required                         | Ticket  | Description                                                                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | yes (db, seed, integration test) | NUD-002 | PostgreSQL connection string. Local default (docker compose): `postgresql://postgres:postgres@localhost:5432/nudel`.                                                                                                                                                                |
| `SEED_ADMIN_PASSWORD`   | yes for `pnpm db:seed`           | NUD-002 | Password of the seeded `admin@example.com`. Never reuse in production.                                                                                                                                                                                                              |
| `SEED_DRIVER_PIN`       | no                               | NUD-002 | 6-digit PIN of the 4 seeded drivers (`fahrer-de`, `driver-hans`, `driver-hk`, `driver-tw`). Default `123456`, local dev only.                                                                                                                                                       |
| `AUTH_SECRET`           | yes (app, e2e)                   | NUD-004 | Secret that signs/encrypts the Auth.js session JWT. Generate with `openssl rand -base64 32`; different per environment.                                                                                                                                                             |
| `S3_ENDPOINT`           | no (empty = AWS S3)              | NUD-006 | Endpoint of the S3-compatible storage: `http://localhost:9000` (MinIO) or `https://<account>.eu.r2.cloudflarestorage.com` (R2, EU jurisdiction). Path-style addressing is used whenever it is set.                                                                                  |
| `S3_REGION`             | no (default `auto`)              | NUD-006 | Signing region. `auto` for R2, any value (e.g. `us-east-1`) for MinIO.                                                                                                                                                                                                              |
| `S3_BUCKET`             | yes for uploads                  | NUD-006 | Private bucket for customer photos and order screenshots (`nudel-photos` locally).                                                                                                                                                                                                  |
| `S3_ACCESS_KEY_ID`      | yes for uploads                  | NUD-006 | Access key. Without bucket + both keys the Fake storage is used (dev/test only; production refuses to start uploads).                                                                                                                                                               |
| `S3_SECRET_ACCESS_KEY`  | yes for uploads                  | NUD-006 | Secret key. Never commit.                                                                                                                                                                                                                                                           |
| `DATABASE_URL_UNPOOLED` | production/preview on Neon       | NUD-007 | Direct (non-pooled) Neon connection string. `prisma migrate deploy` uses it when set (PgBouncer in the pooled URL breaks migration locks); the app itself uses `DATABASE_URL`.                                                                                                      |
| `SEED_ADMIN_EMAIL`      | no                               | NUD-007 | Email of the seeded admin (default `admin@example.com`). Set a real address when seeding production.                                                                                                                                                                                |
| `SEED_DRIVERS`          | no                               | NUD-007 | `false` skips the 4 demo drivers. Always `false` on production.                                                                                                                                                                                                                     |
| `ORS_API_KEY`           | no (Fake without it)             | NUD-010 | OpenRouteService API key (geocoding now, routing in NUD-040). Sent as `Authorization` header, never in URLs. Without it the `FakeGeocoder` is used (coordinates derived from a hash of the address, around Vienna) and one warning is logged; admins must confirm every pin anyway. |
| `ORS_GEOCODE_COUNTRIES` | no                               | NUD-010 | Comma-separated ISO 3166-1 alpha-2 codes restricting address search (`boundary.country`). Default `AT,DE`.                                                                                                                                                                          |

Further variables are added here and in `.env.example` by the ticket that introduces them (see backlog.md §4.4).

## Local database

```bash
cp .env.example .env
docker compose up -d          # postgres:16 + minio
pnpm db:migrate && pnpm db:seed
pnpm test                     # includes the DB integration test when DATABASE_URL is set
```

Without Docker: `pnpm db:embedded` starts a throwaway PostgreSQL (npm `embedded-postgres`) on port 5432 and prints the `DATABASE_URL`; leave it running in a second terminal.

## Object storage (uploads)

Uploads go browser -> presigned `PUT` -> bucket (the app server never proxies the bytes). The bucket stays **private**; images are shown through signed `GET` URLs valid for 1 hour (`Storage.getReadUrl`).

- Local: `docker compose up -d` starts MinIO (console on http://localhost:9001, `minioadmin`/`minioadmin`) and creates the bucket `nudel-photos`. MinIO allows cross-origin `PUT` from the dev server by default.
- Cloudflare R2: create the bucket in the EU jurisdiction and an API token with object read/write. The bucket needs a **CORS rule** so the browser may `PUT` from the app origin: allowed origins = the app URL(s), methods `GET, PUT`, allowed headers `content-type, content-length`, max age 3600.
- Keys are generated by the server: `customers/<uuid>.<ext>` and `screenshots/<uuid>.<ext>`.

## Hosted environments (Vercel)

Set in Vercel, never in git. Production values, preview values and local values must all differ (especially `AUTH_SECRET`). The complete click-by-click setup, including which variable goes to which Vercel environment, is in [`deploy.md`](./deploy.md). The build (`pnpm build:vercel`) fails early with a readable list when a required variable is missing or still points to localhost (`scripts/check-deploy-env.ts`).

Variables Vercel provides automatically and the app reads only for `GET /api/health`: `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_REGION`.
