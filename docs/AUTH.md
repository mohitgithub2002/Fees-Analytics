# Authentication

The whole app is gated — the legacy dashboard (`/`, `/api/fees*`), the v2
management UI (`/manage/*`) and every `/api/v2/*` endpoint require a signed-in
account. Only `/login` and the `/api/auth/*` endpoints are public.

**Login is by mobile number + password.**

## Roles

| Role | Created by | Can do |
|---|---|---|
| `SUPERUSER` | CLI only (`npm run db:create-superuser`) | Everything, **plus** create/manage admin accounts in the app |
| `ADMIN` | The superuser, in the app (`/manage/users`) | Everything except account management |

There is exactly one bootstrap path: the superuser is seeded from the server.
Admins are then created inside the app by the superuser. Regular admins never
see account-management options and the APIs reject them.

## How it works

- **Accounts** live in the `User` table: `phone` (unique login id), `name`,
  scrypt-hashed password, `role`, `isActive`. scrypt is built into Node — no
  native dependency.
- **Sessions are stateless**: on login the server issues an HMAC-SHA256 signed
  cookie (`fees_session`, HTTP-only, `SameSite=Lax`, `Secure` in production)
  carrying the user id, name, role and a 7-day expiry. No session table.
- **The gate** is `src/proxy.ts` (Next 16's renamed middleware, Node runtime).
  It verifies the cookie's signature + expiry on every request — no database
  round-trip. Unauthenticated page requests are redirected to `/login?next=…`;
  unauthenticated API requests get a `401`. Signed-in users who hit `/login`
  are bounced to the dashboard.
- **Authorization** (superuser-only actions) is enforced inside the
  `/api/auth/users*` handlers, which check the session role.
- Mobile numbers are normalized (`src/lib/auth/phone.ts`) before storing or
  matching, so `+91 98765 43210` and `9876543210` resolve to the same account.

## Endpoints (`/api/auth`)

| Route | Method | Who | Purpose |
|---|---|---|---|
| `/status` | GET | anyone | `{ authenticated, needsSetup, user }` — used by the login screen and sidebar |
| `/login` | POST | anyone | `{ phone, password }` → sets the session cookie. Throttled after repeated failures. |
| `/logout` | POST | anyone | Clears the session cookie. |
| `/users` | GET / POST | SUPERUSER | List accounts / create an ADMIN (`{ name, phone, password }`) |
| `/users/[id]` | PATCH | SUPERUSER | Rename, enable/disable, or reset the password of an ADMIN |

## Creating the superuser

```bash
npm run db:create-superuser -- --phone 9876543210 --password "at-least-8-chars" --name "Principal"
# or via env: SUPERUSER_PHONE / SUPERUSER_PASSWORD / SUPERUSER_NAME
```

Re-running with an existing mobile number updates that account's
password/name and re-activates it.

## Creating admins

Sign in as the superuser and open **Users** in the sidebar (visible only to the
superuser). Use **New Admin** to create an account — it's created as `ADMIN`
and signs in with its mobile number. From the same screen the superuser can
reset an admin's password or disable/enable the account.

## Deployment checklist

1. **Apply the schema** so the `User` table exists:
   ```bash
   npx prisma db push        # or: npx prisma migrate deploy
   ```
2. **Set `AUTH_SECRET`** to a long random string (e.g. `openssl rand -hex 32`).
   It signs the session cookies. Without it the app falls back to an insecure
   dev secret and logs a warning. Changing `AUTH_SECRET` invalidates all
   existing sessions (everyone must log in again).
3. **Create the superuser** with `npm run db:create-superuser`, then sign in
   and create the admin accounts from the Users screen.
