# Environment variables

| Variable              | Required                         | Ticket  | Description                                                                                                                   |
| --------------------- | -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | yes (db, seed, integration test) | NUD-002 | PostgreSQL connection string. Local default (docker compose): `postgresql://postgres:postgres@localhost:5432/nudel`.          |
| `SEED_ADMIN_PASSWORD` | yes for `pnpm db:seed`           | NUD-002 | Password of the seeded `admin@example.com`. Never reuse in production.                                                        |
| `SEED_DRIVER_PIN`     | no                               | NUD-002 | 6-digit PIN of the 4 seeded drivers (`fahrer-de`, `driver-hans`, `driver-hk`, `driver-tw`). Default `123456`, local dev only. |

Further variables are added here and in `.env.example` by the ticket that introduces them (see backlog.md §4.4).

## Local database

```bash
cp .env.example .env
docker compose up -d          # postgres:16 + minio
pnpm db:migrate && pnpm db:seed
pnpm test                     # includes the DB integration test when DATABASE_URL is set
```

Without Docker: `pnpm db:embedded` starts a throwaway PostgreSQL (npm `embedded-postgres`) on port 5432 and prints the `DATABASE_URL`; leave it running in a second terminal.
