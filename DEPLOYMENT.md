# Deployment

C.O.R.E. ships as one container that serves both the API and the built web app
from a single origin. That keeps the session cookie first-party and removes CORS
from production entirely.

Nothing here has been deployed yet — the steps below are written to be followed
once, in order, on an account you control.

---

## What you need

- A GitHub account (to hold the repository)
- A Render account (for the web service and the PostgreSQL database)
- Nothing else. Email and Google sign-in are optional and the product states
  plainly when they are not configured.

---

## 1. Push the repository to GitHub

From the project root:

```bash
gh repo create core --private --source=. --remote=origin --push
```

If you would rather not use the `gh` CLI: create an empty private repository on
github.com called `core`, then run

```bash
git remote add origin https://github.com/<your-username>/core.git && git push -u origin main
```

## 2. Create the Render blueprint

`render.yaml` in the repository root already describes the web service and the
database, so Render can read the whole setup from the repo.

1. Go to **https://dashboard.render.com/blueprints**
2. Click **New Blueprint Instance**
3. Choose the `core` repository you just pushed
4. Render reads `render.yaml` and shows one web service (`core`) and one
   PostgreSQL database (`core-db`)
5. Click **Apply**

Render will build the Dockerfile, provision Postgres, and inject `DATABASE_URL`
and a generated `SESSION_SECRET` automatically.

## 3. There is no step three

Nothing has to be configured after the first deploy. Render supplies the
database URL, generates the session secret, and injects `RENDER_EXTERNAL_URL`
— which the service uses as its own public address.

That variable comes from the platform, not from the request, and that
distinction matters: the address is used to build OAuth redirect URIs and
redirect targets, so deriving it from the `Host` header would let a caller
choose where those point. In production the service refuses to start unless
either `RENDER_EXTERNAL_URL` or `APP_URL` is present, rather than guessing.

**If you put a custom domain in front**, set `APP_URL` to it. Otherwise the
service will keep using the `onrender.com` hostname for sign-in redirects.

## Free tier — what it costs

`render.yaml` pins both the web service and the database to Render's **free**
plan, so the Blueprint should not ask for payment. Three things follow from
that, and it is better to know them now than in a month:

| | |
| --- | --- |
| **Sleeping** | The service sleeps after ~15 minutes with no traffic. The next request wakes it and takes about 50 seconds. Everything after that is normal. |
| **Database expiry** | Render **deletes a free PostgreSQL database after 30 days.** This is the one that bites. Move to a paid database before then, or export your work first. |
| **Memory** | 512 MB, which is comfortable for this service. |

To get your data out before an expiry, use the Reports page or the CLI:

```bash
core report <org> risk --format pdf --out risk.pdf
core assess <org> --json > assessment.json
```

To upgrade, change `plan: free` to `plan: starter` on the web service and to a
paid plan on the database in `render.yaml`, commit, and Render redeploys.

**If Render still shows a paid plan**, it is reading an older commit — check
that the Blueprint is pointed at `main` and that the latest commit is the one
you expect.

---

## 4. Verify

```bash
scripts/smoke.sh https://core-xxxx.onrender.com
```

This checks liveness, readiness (database reachable and migrations applied), that
the app shell is served, that client-side routes fall through correctly, and that
protected endpoints refuse anonymous callers. It does not need an account.

Then open the URL in a browser and create an account. **Read the note on email
below before you do.**

---

## Email verification — read this before creating an account

Accounts require email verification. Without an SMTP provider configured, the
service does not send email; it writes the six-digit code to the service log
instead, and the interface says so on screen.

So on a fresh deployment with no SMTP configured:

1. Create your account in the browser
2. Open the Render dashboard → the `core` service → **Logs**
3. Find the block that reads `EMAIL NOT SENT (no SMTP_URL configured)` and copy
   the six-digit code from it
4. Enter it in the browser

To send real email instead, set `SMTP_URL` in the service environment, for
example:

```
SMTP_URL=smtps://apikey:SG.xxxxx@smtp.sendgrid.net:465
MAIL_FROM=C.O.R.E. <no-reply@yourdomain.com>
```

Any SMTP provider works — SendGrid, Postmark, Fastmail, your own server. The
service picks it up on the next deploy and stops writing codes to the log.

---

## Google sign-in — optional

Unset, the Google button does not appear and the endpoint reports that it is
unconfigured rather than failing obscurely.

To enable it:

1. Go to **https://console.cloud.google.com/apis/credentials**
2. **Create credentials → OAuth client ID → Web application**
3. Under **Authorised redirect URIs**, add exactly:
   `https://your-service.onrender.com/api/v1/auth/google/callback`
   using the real service hostname. C.O.R.E. builds the same URI from the
   incoming request, so the two match as long as the hostname is right.
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` in the Render service environment

The flow is implemented server-side: state is held in a short-lived httpOnly
cookie and compared on the callback, the code is exchanged directly with Google
over TLS, and the resulting identity is refused if the address is unverified.

**Untested against a live Google client.** The code is written and reviewable
but this project has no Google credentials, so nobody has run it end to end.
Expect to debug the redirect URI on first use — that is where this flow usually
goes wrong.

---

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Injected by Render from `core-db`. |
| `SESSION_SECRET` | Yes in production | Generated by Render. Must stay stable, or every session is invalidated on restart. |
| `APP_URL` | No | Only when a proxy rewrites the host the browser used. Otherwise derived from the request. |
| `NODE_ENV` | Yes | `production`. |
| `PORT` | No | Defaults to 4000. Render sets it. |
| `DATABASE_CA_CERT` | No | Provider CA, so the database certificate can be verified. |
| `DATABASE_SSL_INSECURE_SKIP_VERIFY` | No | Last resort. Encrypts but does not authenticate the connection. Logged loudly at startup. |
| `SMTP_URL` | No | Without it, verification codes go to the log. |
| `MAIL_FROM` | No | Sender for verification emails. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No | See the Google note above. |
| `DEMO_MODE_ENABLED` | No | Defaults to `true`. Set `false` to remove the demo organization option. |
| `LOG_LEVEL` | No | Defaults to `info`. |

The service refuses to start on invalid configuration rather than failing later
on the first request that happens to need a missing value.

---

## Migrations

Migrations run automatically at startup, before the port is bound, so an
instance never serves traffic against a schema it does not understand.

They are immutable: the runner records a checksum for each applied file and
refuses to start if a file that has already run has since been edited. To change
the schema, add a new file in `apps/api/drizzle/` — never edit an old one.

To run them by hand against any database:

```bash
DATABASE_URL=postgresql://... npm run migrate --workspace @core/api
```

---

## Rollback

Render keeps every previous deploy.

1. Go to the `core` service → **Events**
2. Find the last known-good deploy
3. Click **Rollback to this deploy**

**Before rolling back, check whether the bad deploy applied a migration.** Code
rollback does not roll the schema back, and the older code may not understand the
newer schema. Migrations in this project are written to be additive for exactly
this reason, but verify against `apps/api/drizzle/` before relying on it.

If a deploy is failing at startup, the service will not pass its health check and
Render keeps the previous version serving. A failed deploy therefore does not
take the running service down by itself.

---

## Running the production image locally

```bash
docker build -t core .
docker run --rm -p 4000:4000 \
  -e DATABASE_URL=postgresql://core:core_local_dev@host.docker.internal:5433/core \
  -e SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") \
  -e APP_URL=http://localhost:4000 \
  core
```

Then `scripts/smoke.sh http://localhost:4000`.
