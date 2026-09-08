# Architecture

Why the system is shaped the way it is. Each section states a decision and the
reason behind it, so a future reader can tell which parts are load-bearing and
which are preference.

---

## The engine is pure

`packages/engine` performs no I/O: no database, no network, no filesystem, no
model calls, and no implicit clock reads — every function that needs the current
time takes it as an argument.

**Why.** The product's central claim is that its conclusions are explainable and
reproducible. That claim is only true if the same inputs always produce the same
output. A pure engine also means the most important logic in the system is
testable without infrastructure, which is why it carries 95 tests that run in
under three seconds.

**Consequence.** Every other layer may be slow, fail, or be unavailable, and
none of that can change a risk conclusion.

---

## Risk is ordinal, never a percentage

The engine produces a band and the reasons that produced it. It never produces
`73% likely`.

**Why.** A percentage implies a calibrated probability model built on
incident-frequency data. This system has no such data. Emitting a number anyway
would be inventing a fact, and it would be the most persuasive fact on the
screen.

**How it is enforced.** `risk.ts` composes a score from five weighted dimensions
whose constants live together in one table so the rule can be reviewed as a
unit, plus two hard override rules. A test asserts that the reasons'
contributions sum to the score, and another asserts that no reason statement
ever contains a percentage.

---

## Single points of failure are defined by the propagation engine

A concentration finding is produced by simulating the loss of an entity and
asking whether anything else stopped — not by a separate heuristic.

**Why.** If detection and simulation were implemented separately they would
eventually disagree, and the product would tell a user that something is a
single point of failure while the scenario page showed it was survivable. Making
one the definition of the other removes that class of bug entirely.

**Cost.** Detection is quadratic in the worst case, so it is bounded by
`maxEntitiesForConcentration`. Above that limit the hygiene detectors still run,
so a very large organization gets a partial answer rather than nothing.

---

## Three-valued checks

Readiness checks return pass, fail, or unknown. Unknown is never counted as a
pass, and never silently as a fail either.

**Why.** "We checked and there is no procedure" and "nobody has ever recorded
whether there is a procedure" call for different work. Collapsing them loses the
distinction that tells a user which one they have.

---

## Refs, not UUIDs, in the domain

Entities carry a stable human-facing `ref` (`p-priya`, `app-payroll`) alongside
their database UUID. The engine works entirely in refs.

**Why.** A finding id of `single_person:p-priya` stays meaningful in a report, in
an action record, in an audit entry, and to a person reading it a year later. A
UUID does not. Refs are unique per organization, enforced by a composite unique
index.

---

## Sessions are opaque and server-side

The cookie holds a random token; the database stores only its SHA-256.

**Why.** Two reasons. A database leak yields no usable session, because the
stored value cannot be presented as a cookie. And logout genuinely ends a
session, rather than waiting for a self-contained token to expire — which is
what a user reasonably assumes "sign out" means.

**Cost.** One database lookup per authenticated request. Accepted: correctness
here is worth more than the microseconds.

---

## Authorization is resolved once, server-side

`plugins/context.ts` derives the caller and their role from the session cookie
and the membership table. No route handler reads an identity from a request body
or a header.

A non-member and a non-existent organization both return 404 with identical
wording, so the response cannot be used to confirm that an id exists.

---

## One origin in production

The API serves the built web app from `apps/api/public`, with a fallback that
returns the app shell for any non-API GET so client-side routes resolve.

**Why.** The session cookie is then first-party, which avoids third-party cookie
restrictions entirely, and there is no CORS surface in production at all. In
development the Vite proxy reproduces the same single-origin arrangement, so the
two environments behave identically.

---

## Migrations are plain SQL and immutable

`apps/api/drizzle/*.sql`, applied in filename order by a runner in
`src/db/migrate.ts`, each inside its own transaction, each recorded with a
checksum.

**Why plain SQL.** The production schema is something a reviewer should be able
to read in full. A generated migration graph makes that harder, not easier, and
the schema is where the integrity constraints live.

**Why immutable.** The runner refuses to start if a file that has already been
applied has since changed. Editing an applied migration produces environments
that silently disagree about their own schema.

**Why at startup, before binding the port.** An instance must never serve
traffic against a schema it does not understand.

---

## Constraints live in the database

Examples: an action whose status is `COMPLETED` must have a `completed_at`; a
dependency cannot reference itself; entity kinds and criticalities are checked;
recovery minutes cannot be negative.

**Why.** Application code is one bug away from writing a row that claims success
without a time behind it. The database is the last place that can refuse, and
"no fake success" is a product requirement, not a nicety.

---

## AI is absent from the core

There is no model call anywhere in the analysis path.

**Why.** Correctness must not depend on a service that can be slow, unavailable,
or wrong. Everything the product asserts about an organization is derived
deterministically from that organization's own recorded data.

If language-model assistance is added later — interpreting free-text scenario
descriptions, drafting report prose — it must sit outside this boundary and must
not determine permissions, facts, or risk.

---

## Known trade-offs

- **Assessment is computed per request, not cached.** Correct and always current;
  it will need caching before organizations get large. The engine's purity makes
  that cache safe to add later.
- **Concentration detection is quadratic.** Bounded rather than optimised,
  because the honest partial answer is better than a wrong fast one.
- **No pagination on entity listings.** Fine at demo and small-organization
  scale; needed before large imports.
