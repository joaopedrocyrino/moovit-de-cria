# Accounts, saved places and favorite lines

Accounts are optional. Guests can search, plan and track trips. Sign-in uses email and
password; a user can save places with aliases, reuse their exact coordinates as an
origin/destination, and favorite public bus/BRT/metro lines from route results or the
line catalog. Saving a line does not pin a timetable variant or direction; schedules
can be replaced without losing favorites. Metro favorites have no live train GPS.

## Storage and ownership

| Store                  | Native default            | Docker                        | Lifecycle                       |
| ---------------------- | ------------------------- | ----------------------------- | ------------------------------- |
| Transit snapshot       | `.data/transit.sqlite`    | `/data/transit.sqlite`        | Read-only API; replaceable GTFS |
| Accounts + analytics   | PostgreSQL (`app` schema) | PostgreSQL in `postgres_data` | Durable personal data           |
| Cookie encryption keys | `.data/accounts/keys`     | `/accounts/keys`              | Durable session keys            |

PostgreSQL 17 stores all accounts, sessions, saved addresses, favorites and analytics.
The application uses the restricted `cria` role; the admin password stays in the database container.
Startup applies embedded versioned migrations transactionally under a PostgreSQL advisory lock.
Connection pooling and per-user row locks protect concurrent saves across API replicas.

Native: `npm run dev` starts PostgreSQL and generates local credentials in ignored `.env` if missing.
Standalone setup: `npm run db:up`. Docker maps local PostgreSQL only to `127.0.0.1:5433`.
Production has a private database network and no published database port.
Set `DATABASE_PASSWORD` and `POSTGRES_ADMIN_PASSWORD` in the VPS `.env` before the first push.
Generate two distinct values with `openssl rand -hex 32`; never commit these values.
`Database__ConnectionString` can configure an external PostgreSQL instance (use TLS for remote connections).
The managed role owns only the application schema, with no superuser, database creation or role creation privileges.
Changing environment values alone does not rotate an initialized PostgreSQL role password.
Existing SQLite account files are preserved; this change does not import their contents automatically.

- `users`: name, email/case-insensitive unique email key, salted PBKDF2 password hash
  (ASP.NET PasswordHasher, 210,000 iterations), login failures/lockout and creation time.
- `sessions`: SHA-256 hashes of random 256-bit session identifiers, user and expiry.
- `addresses`: owner, alias/normalized alias key, address label and exact coordinates.
  Maximum 20 per user; aliases are unique per user, ignoring accents/case. Rio bounds
  and finite coordinates are required. Autocomplete selection supplies coordinates.
- `favorite_lines`: owner, mode, public line and catalog name; unique mode/line per
  user, maximum 50. Repeat saves are idempotent. The API validates the real catalog.
- Every read/update/delete scopes data to the authenticated user ID. The browser never
  supplies an owner. Foreign keys cascade personal data/session deletion.

## Sessions and API

Production uses encrypted, host-only `__Host-cria-session` and `__Host-cria-csrf`
cookies: Secure, HttpOnly, Path=/, SameSite=Lax. Browser requests use credentials;
only the exact client origin receives credentialed CORS. Client and API must share
the same HTTPS site. Native development uses non-Secure cookies through the Vite
proxy. Passwords/session identifiers are never placed in localStorage or URLs.

Sessions expire after 14 days with no sliding renewal. Every authenticated request
checks server-side revocation. Logout revokes the current session. Password changes
require the current password, revoke every session, and sign in the current browser
again. Account deletion requires the current password and deletes all owned data.
After five failed password logins, that account locks for 15 minutes; authentication
and sensitive account operations also share an eight-per-minute client IP limit.

| Method              | Endpoint                        | Behavior                                          |
| ------------------- | ------------------------------- | ------------------------------------------------- |
| GET                 | `/api/auth/session`             | Current user or null, plus CSRF request token     |
| POST                | `/api/auth/register`            | Name/email/password (12–128 characters); signs in |
| POST                | `/api/auth/login`               | Email/password; signs in                          |
| POST                | `/api/auth/logout`              | Revokes current session                           |
| GET                 | `/api/account/saved`            | Private addresses and favorite lines              |
| POST / PUT / DELETE | `/api/account/addresses[/{id}]` | Create, edit or remove private places             |
| GET                 | `/api/lines?query=…`            | Public real-line catalog search                   |
| POST / DELETE       | `/api/account/lines[/{id}]`     | Save or remove private favorite lines             |
| POST                | `/api/account/password`         | Current `password` and `newPassword`              |
| DELETE              | `/api/account`                  | Current `password` in JSON body                   |

Every account/authentication write requires `X-CSRF-Token` obtained from session,
login or registration. Personal API responses are never cached. The service worker
excludes API requests. TanStack Query holds private data only in memory and removes
it on logout/account changes. Saved aliases are matched locally, without sending the
alias to geocoding providers. GPS/route history is not automatically persisted.

## Backups and recovery

Back up PostgreSQL using `pg_dump` and restore with `pg_restore` to a disposable instance.
Back up persistent cookie keys separately; losing them signs users out.

```bash
docker compose -p moovit-de-cria --env-file /opt/moovit-de-cria/.env \
  -f /opt/moovit-de-cria/current/docker-compose.prod.yml exec -T database \
  pg_dump -U postgres -d moovit -Fc > /private/backup/moovit.dump
```

Keep backups private, encrypted off-host, and consistent with analytics retention/deletion.
Never remove `postgres_data` or `accounts_data` during deployment.
The latter now stores cookie keys; account/analytics records live in PostgreSQL.

## First-version scope and verification

Email verification and forgotten-password email recovery are not implemented: no
mail provider is configured. This is password sign-in, not a verified email identity.
Users can change a known password and delete their own account. Add verification and
one-time, expiring reset tokens with an email service before requiring verified email
for another feature. No social login or account linking exists in this version.

`npm test` includes storage/ownership/expiry/lockout/password/deletion rules and saved
alias matching. `npm run test:accounts` creates disposable account/timetable stores,
starts the real API, tests cookies/CSRF/ownership/revocation, restarts it with the same
stores, then verifies persistence. `ACCOUNTS_BROWSER=1 npm run test:accounts` also
tests the real UI; `BROWSER=webkit` selects Safari's engine. CI runs HTTP tests and
the account browser checks against the exact client Pages artifact and API image.

References: [ASP.NET cookie authentication](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie?view=aspnetcore-10.0),
[persistent Data Protection keys](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-10.0),
[antiforgery tokens](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery?view=aspnetcore-10.0).

## Guest favorites and appearance

Guests can save the same 20 aliased addresses and 50 bus/BRT/metro favorites in
`cria.guest-saved.v1` localStorage. Exact coordinates are retained, aliases match
locally, and saves survive reloads/synchronize across tabs. Invalid stored entries
are ignored; storage failures display an error. Clearing this site's browser data
removes these favorites. Guest storage has no cross-device synchronization.

Signing in switches to private server favorites; signing out restores the local
favorites. There is no automatic import or copy of account data into localStorage.
The initial light/dark theme follows the OS, including later OS changes. The header
toggle persists an explicit choice in `cria.theme`; **Sobre o aplicativo → Aparência
→ Seguir sistema** restores automatic behavior. A blocking pre-paint theme bootstrap
and service-worker shell caching also cover reload/offline appearance.

[Usage analytics](analytics.md) is separately optional and consent controlled.
