# Authentication

First-party authentication. Cloudflare Access is not used.

## Browser clients

There is no public self-registration. The first owner/tenant is seeded with `npm run seed:owner` (see [SETUP.md](SETUP.md)). Additional users are created by an admin via `POST /users`.

1. `POST /auth/login` verifies password (PBKDF2-SHA-256, 100_000 iterations, 16-byte salt, 32-byte key), issues a new session, sets `HttpOnly; Secure; SameSite=Lax` cookie.
2. Session token is a 32-byte random value. Only SHA-256(token) is stored.
3. `GET /auth/session` returns current principal.
4. `POST /auth/logout` revokes the current session and clears the cookie.

Credentials are never stored in localStorage by this API. The cookie is the only browser credential.

## Session properties

- TTL default 12 hours (`SESSION_TTL_SECONDS`).
- Multiple sessions per user are allowed.
- Login always creates a new session id (session fixation defense).
- Explicit revoke of one or all sessions.
- Sliding last-seen; expiry is absolute from issuance unless rotated.

## Password change

Logged-in users change their password with `POST /auth/change-password`. There is no email-based reset. An owner/admin invites a replacement user or the operator resets the store.

## Machine clients

`Authorization: Bearer oe_<secret>` on public HTTP.

Worker-to-worker **service bindings** may strip `Authorization`. In that case send:

```text
Oe-Api-Key: oe_<secret>
```

(or `X-Api-Key`). Raw keys are shown once at creation. Only hashes are stored. Scopes:

```text
logs:write logs:read
metrics:write metrics:read
traces:write traces:read
dashboards:read dashboards:write
alerts:read alerts:write
admin
```

## Brute force

Failed logins are recorded by email-hash and IP-hash. After 10 failures in 15 minutes the login API returns `AUTH_RATE_LIMITED`. Cloudflare Rate Limit binding provides an additional approximate IP throttle.

## CSRF

Cookie-authenticated mutating requests require `Origin` in the allow-list or header `X-Open-Edge-CSRF: 1` from same-site clients. API-key requests are exempt (no cookie).
