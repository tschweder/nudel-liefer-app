---
covers:
- src/server/auth/**
- src/server/session.ts
- src/server/csrf.ts
- src/server/admin-password.ts
- src/server/throttle.ts
- src/server/cron-auth.ts
- src/lib/access.ts
- src/app/api/auth/**
stamp: 135e006a9c8d8d45349a337def4cd294d28787784c7107789147ed4011813489
status: fresh
stale_since: null
---
# Server-side authentication, sessions, and access control

This unit is everything that authenticates users, holds their session, and decides
who may reach which route or run which server action: the Auth.js wiring in
`src/server/auth/`, the session helper in `src/server/session.ts`, the CSRF/origin
check in `src/server/csrf.ts`, the offline admin password reset in
`src/server/admin-password.ts`, the shared throttle in `src/server/throttle.ts`,
the cron authorization in `src/server/cron-auth.ts`, the route access policy in
`src/lib/access.ts`, and the NextAuth route handler at
`src/app/api/auth/[...nextauth]/route.ts`.

There are two identities: **ADMIN** (email + password, 12 h sessions) and
**DRIVER** (username + 6-digit PIN, 90-day sessions). Secrets are stored as bcrypt
hashes (cost 12, decision log NUD-004).

## Auth.js wiring (`src/server/auth/`)

- `auth.config.ts` — provider-free `NextAuthConfig` safe to import from
  `src/proxy.ts` (no database access): `trustHost: true`, cookie strategy `jwt`,
  cookie `maxAge` is the longest (driver) session, and the `jwt.encode` hook
  overrides the JWT expiry per role via `sessionMaxAge(token.role)`. The `jwt` and
  `session` callbacks apply `applyJwt` and copy `id`, `role`, `locale` from the
  token onto `session.user` (defaulting role to `DRIVER`, locale to `de`).
- `auth.ts` — constructs the Auth.js instance with the two Credentials providers
  (`admin` and `driver`) and exports `handlers`, `auth`, `signIn`, `signOut`, and
  `updateSession` (`unstable_update`). The `authorize` callback calls
  `authenticate()`; a rate-limited login throws `RateLimitedError`
  (`code = "rate_limited"`, surfaces as `code=rate_limited` in the sign-in URL).
  Client IP is taken from `x-forwarded-for` (first value) or `x-real-ip`.
- `authenticate.ts` — `authenticate()` verifies admin (email + password) or driver
  (username + 6-digit PIN) credentials. Admin identifiers are validated with
  `adminSchema` (1–254 chars), driver usernames with `driverSchema` (≤ 64 chars,
  secret must match `/^\d{6}$/`). Users are looked up case-insensitively with
  `mode: "insensitive"` and must have the matching role and `active = true`.
  Inactive users and wrong-role accounts return the same `invalid` result as wrong
  credentials (no information leak). One bcrypt comparison runs even for unknown
  users (against `DUMMY_HASH`) so timing does not reveal existence. On success it
  clears that user's failure counter, sets `lastLoginAt` on the user row, and
  returns `{ ok: true, user }`.
- `password.ts` — `hashSecret(secret)` and `verifySecret(secret, hash)` wrap
  bcryptjs; `DUMMY_HASH` is the precomputed hash used for timing-neutral
  comparisons.
- `rate-limit.ts` — per-login throttle: window `LOGIN_WINDOW_MS` (15 min),
  `MAX_FAILURES_PER_USER` (5) per `user:<kind>:<identifier>` key and
  `MAX_FAILURES_PER_IP` (20) per `ip:<address>` key (keys truncated to 100/64
  chars). `loginKeys()` builds the key pair, `isRateLimited()` counts rows in
  `loginAttempt` newer than the window, `recordFailure()` deletes expired rows and
  inserts one row per key, `clearFailures()` deletes only the `user:` keys after a
  successful login (the IP counter is kept). `purgeLoginAttempts()` deletes rows
  older than `LOGIN_ATTEMPT_RETENTION_MS` (24 h) and is the housekeeping the daily
  retention cron relies on, because `recordFailure()` only cleans up opportunistically.
- `sign-in-result.ts` — `parseSignInResult(url)` interprets the URL returned by
  Auth.js `signIn(..., { redirect: false })` into `LoginError`:
  `rateLimited` from `code=rate_limited`, `invalid` from `error=CredentialsSignin`,
  else `generic`.
- `actions.ts` — server actions. `login(kind, formData)` reads the
  identifier/secret fields (`email`/`password` for admin, `username`/`pin` for
  driver) plus `callbackUrl`, calls `signIn` with `redirect: false`, maps failures
  via `parseSignInResult`, and on success re-queries the user from the database to
  set the `LOCALE_COOKIE` from the user's own locale and `redirect()` to
  `postLoginPath(...)`. Exports `adminLoginAction`, `driverLoginAction`
  (both `(prev, formData) => LoginState`), and `logoutAction`, which signs out and
  redirects to `/<locale>/driver/login` for drivers, `/<locale>/login` otherwise
  (default locale `de`).
- `session-token.ts` — `ADMIN_SESSION_SECONDS` (12 h) vs `DRIVER_SESSION_SECONDS`
  (90 days), `sessionMaxAge(role)` picks one, and `applyJwt()` copies identity onto
  the token at sign-in and applies `locale` on a `trigger: "update"` session update.
- `proxy-session.ts` — `readProxySession(getCookie, secret)` decodes the session JWT
  from `__Secure-authjs.session-token` or `authjs.session-token` without re-issuing
  the cookie (so logout's cookie deletion is not overwritten). Invalid/expired
  tokens yield `null`; used by the proxy instead of the Auth.js middleware wrapper.
- `session-ended.ts` — `sessionEndedTarget(locale, section)` returns the login page
  path for a visitor whose session was just invalidated (`/api/session-ended`);
  `null` for invalid parameters. `SESSION_COOKIE_NAMES` lists the cookie names.
- `guards.ts` — `requireRole(...roles)` is the server-side check for every server
  action and route handler: it reads the session with `auth()` and calls
  `resolveActor()` against the database. Re-export of `Actor`, `Role`,
  `AuthorizationError`, `authErrorStatus`, `resolveActor`.
- `actor.ts` — `AuthorizationError` with `code: "UNAUTHENTICATED" | "FORBIDDEN"`;
  `Actor` (`id`, `role`, `locale`, `name`, `localeChosen`); `resolveActor(claims,
  roles, db)` resolves the session's user id against the DB and requires the user to
  exist, be `active`, and have a DB role in `roles` (the DB role wins over the
  token's); `authErrorStatus(error)` maps to 401/403 for route handlers.
- `page-guards.ts` — `requirePageActor(section, locale, options)` is the page-level
  defence in depth behind the proxy: `admin` section allows ADMIN only; `driver`
  section allows ADMIN and DRIVER. It calls `connection()` first (the session is
  request data; without it Next's partial-prefetch validation renders with an empty
  cookie jar). A `FORBIDDEN` result redirects to `/<locale>/driver`; an
  unauthenticated/deactivated user is sent to `/api/session-ended?...` so the
  session cookie gets cleared. A DRIVER with `localeChosen = false` is redirected to
  `driverStartPath(locale)` (the full-screen language picker, NUD-050) unless
  `{ allowUnchosen: true }` is passed — see `needsLanguagePicker()`.

Tests in the same directory (`auth.integration.test.ts`, `session-token.test.ts`,
`session-ended.test.ts`, `sign-in-result.test.ts`) pin the token shape and the
sign-in result mapping.

## Session helper (`src/server/session.ts`)

`getSessionUserId()` returns the current user id from the Auth.js session or
`null` when nobody is logged in.

## CSRF / origin check (`src/server/csrf.ts`)

`isSameOriginRequest(request)` rejects anything whose `Sec-Fetch-Site` is not
`same-origin`/`none`, then compares the `Origin` host (parsed, "null" origins fail)
against `x-forwarded-host` or the `Host` header. A request with neither header is
not from a browser and is allowed through. `rejectCrossOrigin(request)` returns a
`403 { error: "bad_origin" }` response or `null`. State-changing route handlers
(`/api/uploads`, `/api/driver/sync`, `/api/driver/photos`, the import parser) call
this after their role check, because Next.js only applies its Origin/Host check to
server actions. Cookie layer: session cookies are `SameSite=Lax`.

## Admin password reset (`src/server/admin-password.ts`)

`resetAdminPassword(db, { email, password, reactivate })` backs `pnpm
admin:reset-password` (NUD-094) for the case where no admin can log in. Password
must be 10–200 chars (`ADMIN_PASSWORD_MIN`/`MAX`, same rule as admin creation).
Email is matched case-insensitively and must resolve to exactly one ADMIN; multiple
matches return `ambiguous`, an inactive account needs `reactivate: true`. Success
updates `passwordHash`, optionally sets `active: true`, and clears the login
rate-limit key `user:admin:<email lower-cased>`. Never logs or returns the
password. Existing sessions stay valid until they expire or `AUTH_SECRET` is
rotated. Driver PIN resets happen in the admin area, not here.

## Shared throttle (`src/server/throttle.ts`)

`createThrottle(intervalMs, clock?, sleep?)` returns a `waitTurn()` that spaces
calls at least `intervalMs` apart, also across concurrent callers of the same
instance (each caller reserves the next free slot). Used for geocoding batches to
stay under the ORS free tier.

## Cron authorization (`src/server/cron-auth.ts`)

`isCronAuthorized(authorization, secret)` accepts `Authorization: Bearer
$CRON_SECRET`, compared with SHA-256 digests in constant time. Fails closed: no
secret configured means nobody is authorized. Vercel Cron sends the variable
automatically when set.

## Route access policy (`src/lib/access.ts`)

- `AppRole`, `ADMIN_LOGIN` (`/login`), `DRIVER_LOGIN` (`/driver/login`),
  `DRIVER_OFFLINE_SHELL` (`/driver/offline-shell`, public, no personal data),
  `homePathFor(role)`.
- `splitLocalePath(pathname)` splits `/zh-Hans/admin/x` into locale + rest.
- `decideAccess(rest, role)` (locale prefix removed): `/admin/**` is ADMIN-only
  (logged-out visitors go to `/login` with a callback marker, DRIVERs to their
  home); `/driver/**` is DRIVER plus ADMIN (support/read-only views — mutations
  still enforce `requireRole`); login pages are only for logged-out visitors;
  the offline shell is public. Returns `{ type: "allow" }` or
  `{ type: "redirect", to, withCallback }`.
- `postLoginPath({ role, locale, callbackUrl })` sends users to the page they
  requested when it is a same-site path the role may open, otherwise to the role's
  home under their own locale. Rejects non-path callback URLs (`//`, relative
  scheme-relative, backslashes, control characters) and redirects back to login
  paths.

## API route (`src/app/api/auth/[...nextauth]/route.ts`)

`export const { GET, POST } = handlers` — the standard NextAuth route handler at
`/api/auth/*`, exported from `@/server/auth/auth`.
