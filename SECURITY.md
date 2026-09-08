# Security

What is protected, how, and — just as importantly — what is not done yet.

---

## Passwords

Hashed with **scrypt** from Node's own `crypto`, at N=65536, r=8, p=1, with a
16-byte random salt and a 32-byte derived key. The stored format is
`scrypt$N$r$p$salt$hash`, so the cost parameters can be raised later without
invalidating existing passwords.

Node's standard library rather than a native dependency: no build toolchain is
required on any machine this has to run on, which removes a whole class of
deployment failure.

Verification is constant-time (`timingSafeEqual`). A malformed stored value
returns `false` rather than throwing, so a corrupted row cannot be distinguished
from a wrong password by watching for a 500.

Weak passwords are rejected with specific reasons: minimum ten characters, and
not containing the user's own name or email address.

---

## Sessions

The cookie holds 32 random bytes, base64url-encoded. The database stores only
its SHA-256. A database leak therefore yields no usable session.

Cookies are `httpOnly`, `sameSite=lax`, and `secure` in production. `httpOnly`
means no token is reachable from JavaScript and nothing lives in `localStorage`.

Sign-out deletes the session row, so it genuinely ends. Changing a password
deletes every session for that user. Expired sessions are deleted on sight
rather than merely ignored.

---

## Account enumeration

Registration always returns the same message and status whether or not the
address is already in use; what differs is which email gets sent. Password reset
behaves the same way.

Sign-in returns one message for an unknown address and for a wrong password
alike, and deliberately runs a hash verification against a decoy even when no
user was found, so response timing does not distinguish the two.

Verification codes are rejected with the same message whether the address exists
or not.

All four behaviours are covered by tests.

---

## One-time codes

Six digits, generated with `crypto.randomInt`, stored only as a SHA-256, expiring
after 15 minutes, limited to five attempts. Every failure path increments the
attempt counter, so guessing is bounded regardless of which failure the caller
triggers. Issuing a new code consumes the previous one, so "resend" three times
does not leave three live codes.

---

## Tenant isolation

Every organizational table carries `org_id` with a foreign key and an index, and
every query filters on it.

Authorization is resolved server-side in `plugins/context.ts` from the session
and the membership table. No handler reads an organization id or a user id from
a request body or header, because a client can set those to anything.

A non-member and a non-existent organization both produce 404 with identical
wording. Tested.

---

## Roles

`ADMIN` > `LEADER` > `OPERATOR` > `VIEWER`, checked as "at least this role".

Reading the audit trail requires `LEADER`. Changing the model, running scenarios
and moving actions require `OPERATOR`. Changing someone's role requires `ADMIN`,
and the last remaining administrator cannot be demoted — otherwise an
organization could lock itself out of its own administration.

---

## Database connections

TLS certificate verification is **on** in production. A managed provider's CA
can be supplied through `DATABASE_CA_CERT`.

`DATABASE_SSL_INSECURE_SKIP_VERIFY` exists for providers that offer no
downloadable CA. It is deliberately verbose, and setting it logs a prominent
warning at every startup explaining that the connection is encrypted but not
authenticated and can therefore be intercepted. It should be a conscious,
temporary choice that shows up in a config review.

---

## Errors and logging

Clients receive a stable code, a sentence written for a person, and a request id.
Stack traces and driver messages stay in the server log.

The logger redacts cookies, authorization headers, `set-cookie`, and any request
body field named `password` or `code`.

The audit writer strips a list of secret-shaped keys as a backstop before
writing, so a single missed field at a call site cannot become a password in the
database. Audit writes never throw into the caller: failing to record an audit
line must not roll back the business change that just succeeded, but it is
logged loudly.

---

## Input handling

Every request body, query and path parameter is parsed with a Zod schema.
Unrecognised fields are dropped rather than passed through. Entity and
dependency refs are constrained by pattern. Body size is capped at 5 MB.

Imports are transactional: a reference that cannot be resolved aborts the whole
import, so a partial organization is never committed.

Authentication endpoints are rate-limited (10 attempts per 5 minutes; 5 per 15
minutes for code resends).

Standard headers are set on every response: `x-content-type-options: nosniff`,
`referrer-policy: no-referrer`, `x-frame-options: DENY`.

---

## Google sign-in

The authorization-code flow, server side. Notes on the choices:

- **State** is a random 24-byte value held in a short-lived httpOnly cookie and
  compared in constant time on the callback, so a forged callback cannot sign
  anyone in.
- **The ID token's signature is not checked**, and that is correct here: the
  token is fetched by this server directly from Google's token endpoint over
  TLS, in a request authenticated with the client secret. Google's own guidance
  is that a token obtained that way needs no signature check, because the
  transport already establishes who sent it. A signature check *would* be
  required if the token arrived from the browser; it never does.
- **The claims are still validated** — issuer, audience, expiry — because those
  describe the token's content rather than its origin.
- **An unverified Google email is refused.** Accepting one would let anybody who
  claimed an address take over the C.O.R.E. account registered with it.
- **Linking** an existing account by email is allowed only because Google has
  confirmed the address is verified.

Unset credentials disable the feature: the button does not appear and the
endpoint says it is unconfigured.

---

## The service's own address

The public origin is used to build OAuth redirect URIs and two redirect
targets, so it comes from configuration only: `APP_URL`, or the platform's
`RENDER_EXTERNAL_URL`. In production the process refuses to start without one.

An earlier version derived it from the request. With `trustProxy` enabled that
resolves from `X-Forwarded-Host`, which a platform edge does not validate
against the service's real hostname — making the sign-in redirects an open
redirect and handing an attacker-chosen `redirect_uri` to the OAuth exchange.
The Google exchange would likely have rejected an unregistered URI, but relying
on the far side to catch it is not a control. Tests now assert that a spoofed
forwarded host cannot influence the origin.

Outside production the request is still used, because nothing sits in front of
a development server.

---

## Not done yet

Stated plainly so nobody assumes otherwise:

- **No Content-Security-Policy header.** Should be added before the service
  holds real organizational data.
- **No CSRF token.** Currently mitigated by `sameSite=lax` plus the fact that
  every state-changing endpoint requires a JSON content type. A token should be
  added.
- **No file upload.** Import accepts JSON only. There is no upload endpoint and
  therefore no file-validation surface — but any future upload path needs type,
  size and content validation before it ships.
- **No secret rotation procedure.** Rotating `SESSION_SECRET` signs everyone out;
  that is correct but undocumented as an operational runbook.
- **No dependency vulnerability scanning in CI.** `npm audit` should be added.
- **Audit trail is append-only by convention and API surface**, not by database
  permission. A compromised application role could still delete rows.

---

## Reporting a problem

This is a personal project with no production deployment. If you find something,
raise an issue on the repository.
