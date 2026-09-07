# Build roadmap

Honest status of C.O.R.E. against its specification. Anything not listed as
built is not built.

## Built

### Phase 1 — deterministic engine (`packages/engine`)

- Organization graph: entities, typed dependencies, fallbacks, alternates.
- Structural validation: dangling references, duplicate ids, self-dependencies,
  unusable fallbacks, recovery targets that cannot meet the stated tolerance,
  and dependency cycles (iterative traversal, so deep graphs cannot blow the
  stack).
- Failure propagation in waves, honouring dependency fallbacks, provider
  alternates and optional dependencies; a worst-case mode that ignores optional.
- Weakness detection: concentration (person, vendor, system, credential,
  location) defined in terms of the propagation engine itself, plus hygiene
  detectors for missing owners, missing procedures, unproven recovery and
  missing recovery targets.
- Explainable risk scoring across five dimensions with two hard override rules.
- Readiness assessment with three-valued checks (pass / fail / unknown).
- Solution generation personalised to the actual organization, with trade-offs,
  a recommendation, a stated rationale, concrete actions and verification.
- Prioritisation into FIX FIRST / FIX NEXT / MONITOR, with capped tiers and a
  cheapness term so a low-cost fix can outrank an expensive one of equal
  severity.

95 tests, covering behaviour rather than line count.

## Not built

### Phase 2 — persistence and API (`apps/api`)
PostgreSQL schema and migrations, organization isolation, roles, authentication
(email/password, Google, verification, sessions), audit trail, change history,
imports with validation, health and readiness endpoints.

### Phase 3 — product interface (`apps/web`)
Design system, cinematic introduction, authentication experience, organization
setup, workspace, adaptive response interface, accessibility, responsive layout.

### Phase 4 — operational surfaces
Incidents, exercises, after-action review, reports and exports, CLI.

### Phase 5 — delivery
Integration / end-to-end / security / failure tests, performance work,
containerisation, CI, deployment, smoke verification, handoff.

## Decisions taken

- **Monorepo, npm workspaces, TypeScript throughout.** One language across
  engine, API, web and CLI; the CLI can call the real logic rather than
  reimplementing it, which the specification requires.
- **The engine is pure.** Every other layer may fail, be slow, or be
  unavailable; risk conclusions must not depend on any of that.
- **AI is not in the engine.** Core correctness is deterministic. Language
  models may later assist with interpreting free text and drafting prose, but
  they will not determine permissions, facts, or risk.
