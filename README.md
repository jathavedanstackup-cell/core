# C.O.R.E.

**Continuity, Operations, Risk & Execution** — organizational resilience and decision support.

C.O.R.E. answers seven questions about an organization:

1. What is happening?
2. What does it affect?
3. What should we do?
4. What is the best solution?
5. Who needs to act?
6. Did it work?
7. How do we prevent it next time?

## Status

Under active construction. See `docs/ROADMAP.md` for what is built and what is not.

| Component | State |
| --- | --- |
| `packages/engine` — deterministic resilience engine | Built and tested (95 tests) |
| `apps/api` — HTTP API, auth, persistence | Not started |
| `apps/web` — product interface | Not started |
| `apps/cli` — operational CLI | Not started |

## The engine

`packages/engine` is the heart of the product and deliberately has no I/O: no
database, no network, no language model, and no implicit clock reads. Given the
same organization and the same `now`, it returns the same answer every time.

That constraint is what lets C.O.R.E. claim its conclusions are explainable and
auditable. Two rules follow from it and are enforced by tests:

- **No invented numbers.** Risk is an ordinal band (LOW / MODERATE / HIGH /
  CRITICAL), never a percentage, because there is no calibrated probability
  model behind it and presenting one would be a fabricated fact.
- **Every conclusion is attributable.** Each band carries the reasons that
  produced it, each naming the real entities involved, and the contributions sum
  to the score.

It also distinguishes *checked and no* from *nobody recorded an answer*. A
missing procedure and an unrecorded procedure are different problems with
different fixes, and an unknown is never counted as a pass.

## Development

```bash
npm install
npm test
npm run typecheck
```

## Licence

Not yet determined.
