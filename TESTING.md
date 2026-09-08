# Testing

170 tests. None of them exist to raise a number; each asserts a behaviour the
product would be wrong without.

```bash
npm test --workspace @core/engine   # 95 tests, ~3s, no database
npm test --workspace @core/api      # 75 tests, ~30s, needs PostgreSQL
```

---

## Engine — 95 unit tests

Pure functions, no infrastructure, so they run in about three seconds and can be
kept in a watch loop.

| Area | What is asserted |
| --- | --- |
| `graph` | Dangling references, duplicate ids, self-dependencies, unusable fallbacks, recovery targets that cannot meet their own tolerance, cycle detection, and that a 5,000-node chain does not blow the stack |
| `propagation` | Failure spreads in the right order and stops in the right places; fallbacks and provider alternates prevent failure; optional dependencies degrade rather than stop; a worst-case mode ignores optional; cyclic graphs terminate |
| `risk` | Band, score and reasons for known inputs; both override rules; that contributions sum to the score; that a recorded alternative lowers the score; determinism |
| `findings` | Each detector fires on the right shape and, critically, that something with a working fallback is **not** reported as a single point of failure |
| `readiness` | Pass, fail and unknown are distinguished; unknown never counts as a pass; checks that do not apply to an entity kind are omitted rather than auto-passed |
| `solutions` | Options are personalised to the real organization; cross-training is offered only when a colleague exists; the cheapest of the equally effective options is recommended; every option carries actions and a verification |
| `prioritize` | Tiers are capped; LOW risk never enters an actionable tier; a cheap fix outranks an expensive one of equal severity |

Two tests exist purely to hold the product to its own claims:

- **No fabricated percentages.** Every reason statement across several
  assessments is checked for a percentage. There must be none.
- **The score is fully explained.** The reasons' contributions must sum exactly
  to the score, so a band can never be reached by arithmetic the reader cannot
  see.

---

## API — 75 integration tests

Real PostgreSQL, real Fastify via `inject`. Deliberately not mocked: tenant
isolation, authorization and database constraints are exactly the things a mock
would wave through.

| Area | What is asserted |
| --- | --- |
| Health | `/health` answers without touching the database; `/readiness` reports the database and migration state |
| Enumeration | Registering an existing address returns an identical response to a new one, and creates no duplicate row; an unknown address and a wrong password produce the same sign-in failure |
| Credentials | Stored passwords are scrypt hashes containing no plaintext; the stored session value is a 64-character hash, not the cookie |
| Sessions | Sign-out genuinely ends the session — the next request is 401 |
| Tenancy | Another organization and a non-existent one return the same 404 with the same wording; a member gets in; one organization's entities never appear in another's listing |
| Roles | A viewer is refused operator-only writes and the leader-only audit trail, with a message naming the role required |
| Analysis | A seeded organization yields the expected finding, and the recommended solution names the actual colleague |
| Scenarios | Failure propagates through to the right business functions; a scenario naming nothing recognisable is refused |
| Actions | The state machine rejects illegal transitions in both directions; completion always records a time |
| Imports | A dependency referencing something absent from the file aborts the whole import, leaving nothing behind |
| Errors | A stable shape with a request id, and never a stack trace |
| Exercises | The expectation is captured at start and not before; an exercise cannot start twice; events are refused unless it is running; the review compares expected against actual; recommendations reach the improvement register |
| Improvements | Its own state machine, and a completion that always carries a time |
| Reports | Every format produces a real file; the PDF really is a PDF (`%PDF-` header, `%%EOF` trailer); CSV escapes quotes and commas; a stored report is reopened as issued, not regenerated from newer data |
| Membership | A colleague is invisible to an organization before being added and can see it immediately after; an address with no account is refused rather than invented; a non-admin cannot add anyone; the last administrator can be neither demoted nor removed; a removed member loses access at once |
| Building from nothing | The whole path a real user takes — create an organization, add items one at a time, set criticality and recovery targets, connect them, and get an assessment and a report that name what was entered. Guards the case the demo organization cannot: that the product works for data somebody actually typed in. |
| Auth before validation | A protected route answers 401 whether the id is malformed or well-formed, so an anonymous caller learns nothing from the difference; unknown routes still answer an honest 404 |
| Mail configuration | A half-filled SMTP config counts as none, so codes fall back to the log rather than every signup failing at the send |
| HEAD/GET parity | The two methods never disagree on a client route |

Three of these exist because the live deployment was audited after it shipped,
and each records a defect that was actually there rather than one imagined in
advance.

One of these caught a real defect while being written. An exercise where nobody
recorded a recovery time was falling back to the moment someone clicked
"complete", which credited it with a near-zero recovery and a met objective —
precisely the fabricated success the product forbids. The fallback now only
accepts a recorded recovery event, and reports "could not assess" otherwise.

---

## Manual verification performed

Beyond the automated suite, this was exercised by hand:

- The full flow in a browser: sign in, workspace, finding detail with reasons
  and options, readiness with expanded checks, actions moving through states,
  audit trail showing before and after
- The production Docker image against PostgreSQL — migrations ran at startup,
  the single-page app was served from the API origin, and `scripts/smoke.sh`
  passed all six checks
- The introduction: sequence, text beats, skip control

---

## Not tested

Stated plainly:

- **No end-to-end browser suite.** No Playwright. The flow was verified by hand,
  which is not the same as verified continuously.
- **No accessibility audit.** Focus rings, keyboard operation, reduced motion and
  non-colour status encoding were all built in deliberately, but no axe run or
  screen-reader pass has been done.
- **No load or large-data testing.** Concentration detection is quadratic and
  bounded; the bound has not been tuned against real data volumes, and there is
  no pagination on entity listings.
- **No mutation testing**, so the suite's own sensitivity is unmeasured.
- **The web app has no unit tests.** Its logic is thin — the substance lives in
  the engine, which is heavily covered — but the components themselves are
  unverified except by hand.
- **Google sign-in is untested end to end.** The flow is implemented and its
  claim validation is straightforward to read, but exercising it needs real
  Google credentials, which this project does not have. Treat it as unproven
  until someone runs it against a real client id.
- **The CLI has no automated tests.** Its commands were exercised by hand
  against the demo organization; they delegate to services the API tests cover.
- **The introduction's audio** is unverifiable automatically and was checked only
  by listening.

---

## Running against your own database

```bash
docker compose up -d
DATABASE_URL=postgresql://core:core_local_dev@localhost:5433/core \
  npm test --workspace @core/api
```

The API tests create their own users and organizations with unique identifiers
and remove them afterwards, so they can run against a database with other data
in it — though a scratch database is still the sensible choice.
