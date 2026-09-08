# Build roadmap

Honest status. Anything not listed as built is not built, and nothing in the
interface pretends otherwise.

---

## Built and verified

### The engine — `packages/engine`

Deterministic, no I/O, 95 tests.

- Organization graph with typed dependencies, fallbacks and alternates
- Structural validation: dangling references, duplicate ids, self-dependencies,
  unusable fallbacks, recovery targets that cannot meet their own tolerance, and
  dependency cycles (iterative, so deep graphs cannot blow the stack)
- Failure propagation in waves, honouring fallbacks, alternates and optional
  dependencies, with a worst-case mode
- Weakness detection: concentration in a person, vendor, system, credential or
  location — defined in terms of the propagation engine itself — plus hygiene
  detectors for missing owners, missing procedures, unproven recovery and
  missing recovery targets
- Explainable risk across five dimensions with two hard override rules
- Readiness with three-valued checks
- Solution generation personalised to the actual organization, with trade-offs,
  a recommendation, a stated rationale, concrete actions and verification
- Prioritisation into FIX FIRST / FIX NEXT / MONITOR, capped, with a cheapness
  term so a low-cost fix can outrank an expensive one of equal severity

### The API — `apps/api`

PostgreSQL, tenant isolation, 40 integration tests.

- Immutable plain-SQL migrations, applied at startup before the port binds
- Email and password authentication with scrypt, mandatory verification, opaque
  server-side sessions, password reset, and responses that do not enumerate
  accounts
- Roles (ADMIN / LEADER / OPERATOR / VIEWER) enforced server-side
- Organizations, membership with add/remove/role change, and a labelled demo
  organization
- The model: entities, dependencies, transactional import, data-quality report
- Assessment, readiness, solutions, scenarios with stored runs
- Actions with a real state machine and a database-enforced completion time
- Incidents with chronological timelines
- Exercises, after-action review, and the improvement register
- Reports in JSON, CSV, HTML and PDF, stored as issued
- Google sign-in (authorization-code flow, server side)
- Append-only audit trail with before and after
- `/health` and `/readiness`

### The interface — `apps/web`

- Cinematic introduction: canvas network that assembles, fails, propagates and
  reorganises; an original procedural score built from oscillators; skip control;
  a still composition under reduced motion; shown once per browser
- Authentication: sign in, create account, verify, with the server's own wording
- Organization setup and demo entry
- Workspace leading with one sentence about what matters now
- A model editor: add, edit and remove the things the organization depends on
  and the dependencies between them, paste in a JSON import, and see data
  quality problems as they arise
- People and roles, with the last-administrator guard visible in the interface
- Finding detail: risk reasons with confidence, options with trade-offs, the
  recommendation and why, the plan, and one click to create tracked actions
- Scenario runner showing impact in waves
- Readiness with expandable per-check detail
- Actions, incidents with timelines, audit trail
- Light and dark, keyboard operable, status never carried by colour alone

### Rehearsal and learning — `apps/api`, `apps/web`

- Exercises: plan, start, record, complete. Starting freezes the engine's
  expectation so the review compares against what was predicted at the time,
  not against a model the exercise itself changed.
- After-action review generated from the difference between expectation and
  what participants recorded: timing against objective, what worked, what did
  not, what was missing, and **what surprised us** — anything observed that the
  model did not predict, which is a gap in the model itself.
- An improvement register, separate from actions, with its own state machine.
  A review's recommendations are accepted into it as an explicit decision.

### Reports — `apps/api`, `apps/web`

- Six report kinds built as one neutral document model and rendered to **JSON,
  CSV, HTML and PDF**. The PDF is generated server-side with PDFKit, so the file
  is identical for everyone who downloads it.
- Generated reports are stored and reopened exactly as issued, so two people
  holding "the same report" cannot disagree.
- Every report states its own assumptions and limits.

### The command line — `apps/cli`

`migrate`, `orgs`, `validate`, `assess`, `readiness`, `scenario`, `solve`,
`report`, `seed-demo`. Calls the same services as the HTTP API, so a CLI answer
and a browser answer cannot diverge.

### Delivery

- Multi-stage Dockerfile; one image serves the API and the web app from one
  origin. **Built and verified: migrations ran, all six smoke checks passed.**
- `render.yaml` blueprint for a web service plus managed PostgreSQL
- GitHub Actions CI: typecheck, both test suites, builds, and an image build
- `scripts/smoke.sh` for post-deployment verification

---

## Not built

These are absent, not partial:

- **Replay and point-in-time reconstruction** (§36). The audit trail records what
  changed, but nothing reconstructs a past organization state from it. An
  exercise's expectation is frozen at its start, which covers the case that
  matters most, but the general capability does not exist.
- **Natural-language interaction** (§42). Everything is driven through explicit
  professional controls. The spec allows this — it says natural language must not
  be the only way to operate the system — but the natural-language surface itself
  is not there.
- **Email invitations.** An administrator adds a colleague by address, and that
  colleague must already have a verified account. Issuing invitation tokens to
  addresses nobody has proven they control would leak an organization's name and
  membership, and doing it properly needs more than one endpoint.

---

## Known limitations in what is built

- Assessment is computed per request with no caching. Correct and always
  current; will need caching before organizations get large.
- Concentration detection is quadratic, bounded by `maxEntitiesForConcentration`.
  Above the bound, hygiene detectors still run.
- Entity listings are unpaginated.
- No Content-Security-Policy header and no CSRF token; see SECURITY.md.
- No end-to-end browser test suite and no accessibility audit; see TESTING.md.

---

## Decisions worth knowing

- **Monorepo, npm workspaces, TypeScript throughout**, so the API, the web app
  and the CLI share one language and one engine.
- **The engine is pure.** Every other layer may fail or be slow; a risk
  conclusion must not depend on that.
- **AI is absent from the core.** Nothing in the analysis path calls a model.
  Should that change, it must not determine permissions, facts, or risk.
