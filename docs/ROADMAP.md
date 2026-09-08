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

PostgreSQL, tenant isolation, 20 integration tests.

- Immutable plain-SQL migrations, applied at startup before the port binds
- Email and password authentication with scrypt, mandatory verification, opaque
  server-side sessions, password reset, and responses that do not enumerate
  accounts
- Roles (ADMIN / LEADER / OPERATOR / VIEWER) enforced server-side
- Organizations, membership, and a labelled demo organization
- The model: entities, dependencies, transactional import, data-quality report
- Assessment, readiness, solutions, scenarios with stored runs
- Actions with a real state machine and a database-enforced completion time
- Incidents with chronological timelines
- Append-only audit trail with before and after
- `/health` and `/readiness`

### The interface — `apps/web`

- Cinematic introduction: canvas network that assembles, fails, propagates and
  reorganises; an original procedural score built from oscillators; skip control;
  a still composition under reduced motion; shown once per browser
- Authentication: sign in, create account, verify, with the server's own wording
- Organization setup and demo entry
- Workspace leading with one sentence about what matters now
- Finding detail: risk reasons with confidence, options with trade-offs, the
  recommendation and why, the plan, and one click to create tracked actions
- Scenario runner showing impact in waves
- Readiness with expandable per-check detail
- Actions, incidents with timelines, audit trail
- Light and dark, keyboard operable, status never carried by colour alone

### Delivery

- Multi-stage Dockerfile; one image serves the API and the web app from one
  origin. **Built and verified: migrations ran, all six smoke checks passed.**
- `render.yaml` blueprint for a web service plus managed PostgreSQL
- GitHub Actions CI: typecheck, both test suites, builds, and an image build
- `scripts/smoke.sh` for post-deployment verification

---

## Not built

These are absent, not partial:

- **Exercise mode** and **after-action review** (spec §32–34). The incident
  timeline and action tracking are the foundation for them, but neither exists.
- **Report generation and export** (§39–40, §98–99). No PDF, no CSV. Reports
  would be assembled from data that is already there, but nothing generates them.
- **The CLI** (§67). The service layer is structured so a CLI can call the same
  logic, but no CLI exists.
- **Google sign-in.** The routes exist and report honestly that the
  authorization-code exchange is not implemented; they do not half-work.
- **Replay and point-in-time reconstruction** (§36). The audit trail records
  changes, but nothing reconstructs a past state from them.
- **Natural-language interaction** (§42). Everything is driven through explicit
  professional controls.
- **Preventive improvements as first-class records** (§27). Solutions produce
  actions; there is no separate improvement register.

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
  and a future CLI share one language and one engine.
- **The engine is pure.** Every other layer may fail or be slow; a risk
  conclusion must not depend on that.
- **AI is absent from the core.** Nothing in the analysis path calls a model.
  Should that change, it must not determine permissions, facts, or risk.
