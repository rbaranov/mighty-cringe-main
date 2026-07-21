# ADR 0002: Google OIDC and server-side sessions

- Status: accepted
- Date: 2026-07-21

## Context

The first API version assigned every request to one demonstration user. That made previewing easy,
but provided neither authentication nor isolation between real users. The PWA also kept one shared
IndexedDB database in a browser profile.

## Decision

Use Google's OpenID Connect authorization-code flow on the API server. The flow uses a one-time
`state`, an OIDC `nonce`, and PKCE (`S256`). The API validates the signed ID token issuer, audience,
nonce, verified email, and subject. Google access and refresh tokens are not retained.

After successful identity verification, the API creates an opaque random session token. Only its
SHA-256 hash is stored in PostgreSQL. The browser receives the token in a `Secure`, `HttpOnly`,
`SameSite=Lax` cookie. Logout revokes the server-side session and expires the cookie. Sessions
expire after 30 days by default and can be configured from 1 to 90 days.

Every workout and mutation query receives the authenticated user ID from the session. Client input
cannot choose the owner. A set can only be added to a workout owned by the same user. Anonymous
application endpoints return `401`; only health and authentication bootstrap endpoints are public.

The default role is `athlete`. Emails listed in the server-only `ADMIN_EMAILS` setting receive the
`admin` role at sign-in. The existing `trainer` and legacy `superadmin` enum values remain compatible,
while admin-only endpoints accept `admin` and `superadmin`.

IndexedDB stores the active user ID. On account change or logout, local workouts, sets, and pending
mutations are deleted before the next account can use the application. The public exercise catalog
is retained.

## Consequences

- A Google OAuth Web client and production secrets must exist before login is available.
- Loss of a session cookie requires signing in again; it does not expose Google credentials.
- Existing demonstration rows can remain in PostgreSQL but are inaccessible because no session is
  created for their user.
- Adding another identity provider later can reuse the same application-session boundary.
