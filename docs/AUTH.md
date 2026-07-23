# Authentication

The whole app is gated — the legacy dashboard (`/`, `/api/fees*`), the v2
management UI (`/manage/*`) and every `/api/v2/*` endpoint require a signed-in
account. Only `/login` and the `/api/auth/*` endpoints are public.

## How it works

- **Accounts** live in the `User` table (email + scrypt-hashed password, a
  `role` of `ADMIN` or `STAFF`, and an `isActive` flag). Passwords are hashed
  with Node's built-in `scrypt` — no native dependency.
- **Sessions are stateless**: on login the server issues an HMAC-SHA256 signed
  cookie (`fees_session`, HTTP-only, `SameSite=Lax`, `Secure` in production)
  carrying the user id, name, role and a 7-day expiry. No session table.
- **The gate** is `src/proxy.ts` (Next 16's renamed middleware, Node runtime).
  It verifies the cookie's signature + expiry on every request — no database
  round-trip. Unauthenticated page requests are redirected to
  `/login?next=…`; unauthenticated API requests get a `401`. Signed-in users
  who hit `/login` are bounced to the dashboard.
- Token signing/verifying (`src/lib/auth/token.ts`) uses only Web Crypto, so
  the identical code runs in the proxy and in route handlers.

## Endpoints (`/api/auth`)

| Route | Method | Purpose |
|---|---|---|
| `/status` | GET | `{ authenticated, needsSetup, user }` — used by the login screen and sidebar |
| `/setup` | POST | Create the **first** admin. Self-disables once any user exists (403). |
| `/login` | POST | `{ email, password }` → sets the session cookie. Throttled after repeated failures. |
| `/logout` | POST | Clears the session cookie. |

## First-time setup

On a fresh database there are no users, so `needsSetup` is `true` and the
`/login` screen shows a **"Create admin account"** form instead. The first
account it creates is an `ADMIN`, and the setup endpoint then locks itself.

Alternatively (or to add more accounts / reset a password), use the CLI:

```bash
npm run db:create-admin -- --email you@school.com --password "at-least-8-chars" --name "Head Admin"
# or via env: ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME
```

Re-running with an existing email updates that account's password/name and
re-activates it.

## Deployment checklist

1. **Apply the schema** so the `User` table exists:
   ```bash
   npx prisma db push        # or: npx prisma migrate deploy
   ```
2. **Set `AUTH_SECRET`** to a long random string (e.g. `openssl rand -hex 32`).
   It signs the session cookies. If it is unset the app falls back to an
   insecure dev secret and logs a warning — never rely on that in production.
   Changing `AUTH_SECRET` invalidates all existing sessions (everyone must log
   in again).
3. **Create the first admin** — either open the app and use the setup form, or
   run `npm run db:create-admin`.

Roles (`ADMIN` / `STAFF`) are stored for future authorization; today any
active account has full access.
