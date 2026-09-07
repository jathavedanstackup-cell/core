/**
 * @core/engine — the deterministic resilience engine behind C.O.R.E.
 *
 * Nothing in this package performs I/O, reads the clock implicitly, calls a
 * network, or consults a language model. Given the same organization graph and
 * the same `now`, it returns the same answer every time. That property is what
 * lets the product claim its risk conclusions are explainable and auditable.
 */

export * from './types.js';

export {
  buildIndex,
  criticalBusinessFunctions,
  directDependents,
  directProviders,
  effectiveCriticality,
  findCycles,
  getEntity,
  transitiveDependents,
  validateGraph,
  type GraphIndex,
  type GraphIssue,
  type GraphIssueSeverity,
} from './graph.js';

export { blastRadius, runScenario, type PropagationOptions } from './propagation.js';

export {
  assessEntityRisk,
  assessEntityRiskById,
  worstBand,
  CURRENCY_FRESHNESS_DAYS,
  MAX_SCORE,
  TEST_FRESHNESS_DAYS,
  type EntityRiskInput,
} from './risk.js';

export { detectFindings, type DetectOptions } from './findings.js';

export {
  assessOrganizationReadiness,
  assessReadiness,
  assessReadinessWithIndex,
  type ReadinessOptions,
} from './readiness.js';

export { generateSolutions } from './solutions.js';

export {
  groupByTier,
  prioritize,
  TIER_LIMITS,
  type PrioritizeOptions,
} from './prioritize.js';
