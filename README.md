# C.O.R.E.

**Continuity, Operations, Risk & Execution** — organizational resilience and
decision support.

C.O.R.E. takes what an organization has written down about how it works — its
people, systems, suppliers, places and the dependencies between them — and
answers seven questions:

1. What is happening?
2. What does it affect?
3. What should we do?
4. What is the best solution?
5. Who needs to act?
6. Did it work?
7. How do we prevent it next time?

It is not a risk register. A register records that something is dangerous;
C.O.R.E. works out what would actually stop, proposes options against the
organization's real circumstances, recommends one and says why, turns it into
tracked actions, and defines how you will know it worked.

---

## Two rules the whole product is built on

**No invented numbers.** Risk is an ordinal band — LOW, MODERATE, HIGH,
CRITICAL — never a percentage. A percentage would imply a calibrated probability
model built on incident-frequency data this system does not have, and presenting
one would be a fabricated fact.

**Nothing unknown is counted as fine.** A check that failed and a check nobody
has answered are different problems with different fixes. The engine tracks
`KNOWN`, `ESTIMATED`, `ASSUMED`, `UNKNOWN` and `UNVERIFIED` separately, shows
which is which, and never quietly promotes an unknown to a pass.

Both are enforced by tests, not by convention.

---

## Quick start

Requires Node 20+ and Docker.

```bash
npm install
docker compose up -d
cp .env.example .env
cp .env .env.local 2>/dev/null || true
npm run build --workspace @core/engine
npm run migrate --workspace @core/api
```

Then, in two terminals:

```bash
npm run dev --workspace @core/api
```

```bash
npm run dev --workspace @core/web
```

Open **http://localhost:5173**.

Create an account. Because no SMTP provider is configured locally, the six-digit
verification code is printed to the API terminal in a box labelled
`EMAIL NOT SENT`. Copy it into the browser.

Then choose **Open the demo organization** to get a worked example with real
weaknesses in it, or create your own and start adding what you depend on.

---

## Layout

```
packages/engine   deterministic domain logic — no I/O, no network, no model calls
apps/api          Fastify + Drizzle + PostgreSQL; auth, tenancy, persistence
apps/web          React + Vite; the product interface and the introduction
scripts/smoke.sh  post-deployment verification
```

### The engine

`packages/engine` is the heart, and it performs no I/O and reads no implicit
clock. Given the same organization and the same `now`, it returns the same
answer every time — which is what lets the product claim its conclusions are
explainable and auditable rather than merely plausible.

It contains dependency propagation, single-point-of-failure detection defined in
terms of that propagation, explainable risk scoring, readiness assessment,
personalised solution generation, and prioritisation.

### The API

Authorization is resolved server-side from the session cookie and the membership
table. No handler reads an identity from a request body or header. A non-member
and a non-existent organization return the same 404, so an outsider cannot use
the response to confirm an id exists.

### The interface

One page answers one question. The workspace leads with a single sentence about
what matters right now, and everything else is disclosed underneath it.

---

## Commands

```bash
npm test                                  # every workspace
npm test --workspace @core/engine         # 95 unit tests, no database needed
npm test --workspace @core/api            # 20 integration tests, needs Postgres
npm run typecheck                         # strict TypeScript across the repo
npm run build                             # engine, then web, then api
npm run migrate --workspace @core/api     # apply pending migrations
```

---

## Documentation

- [DEPLOYMENT.md](DEPLOYMENT.md) — pushing to GitHub, deploying on Render, and rollback
- [ARCHITECTURE.md](ARCHITECTURE.md) — why the system is shaped this way
- [SECURITY.md](SECURITY.md) — authentication, tenancy, and what is deliberately not done
- [TESTING.md](TESTING.md) — what is covered and what is not
- [docs/ROADMAP.md](docs/ROADMAP.md) — honest status: what is built, what is not

---

## Status

Working end to end: accounts and verification, organizations and roles, the
model, assessment, solutions, scenarios, actions, incidents with timelines, and
the audit trail.

Not built: exercise mode, after-action review, PDF and CSV export, the CLI, and
the Google authorization-code exchange. `docs/ROADMAP.md` is kept honest about
this; nothing in the interface pretends these exist.
