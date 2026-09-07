/**
 * Weakness detection.
 *
 * Two families of detector run over the organization:
 *
 *  - Concentration detectors ask "if this one thing went away, would something
 *    else stop?". They are defined in terms of the propagation engine rather
 *    than a hand-rolled heuristic, so a single point of failure means exactly
 *    what it means everywhere else in the product.
 *
 *  - Hygiene detectors ask "is this properly looked after?" — owner, procedure,
 *    proven recovery, recovery targets.
 *
 * Detectors are plain functions in a list. Adding a new kind of finding means
 * adding a function, not editing a switch.
 */

import {
  buildIndex,
  criticalBusinessFunctions,
  transitiveDependents,
  type GraphIndex,
} from './graph.js';
import { runScenario } from './propagation.js';
import { assessEntityRisk, TEST_FRESHNESS_DAYS } from './risk.js';
import {
  CRITICALITY_RANK,
  type Entity,
  type EntityKind,
  type Finding,
  type FindingKind,
  type OrganizationGraph,
  type RiskAssessment,
} from './types.js';

export interface DetectOptions {
  /** Instant to assess against. Passed in so results are reproducible. */
  readonly now?: Date;
  /**
   * Skip concentration analysis above this entity count. Concentration
   * detection simulates the loss of every entity in turn, so it is quadratic in
   * the worst case; very large graphs should analyse a scoped subset instead.
   */
  readonly maxEntitiesForConcentration?: number;
}

const DEFAULT_MAX_ENTITIES_FOR_CONCENTRATION = 2_000;

/** Which finding kind a concentration in this kind of entity represents. */
function concentrationKindFor(entity: Entity, index: GraphIndex): FindingKind {
  switch (entity.kind) {
    case 'person':
    case 'team':
      return 'single_person';
    case 'vendor':
      return 'single_vendor';
    case 'location':
    case 'facility':
      return 'single_location';
    default: {
      const authenticates = (index.incoming.get(entity.id) ?? []).some(
        (dependency) => dependency.type === 'authenticates',
      );
      return authenticates ? 'single_credential' : 'single_system';
    }
  }
}

function humanKind(kind: EntityKind): string {
  return kind.replace(/_/g, ' ');
}

function findingId(kind: FindingKind, subjectId: string): string {
  return `${kind}:${subjectId}`;
}

function buildFinding(
  index: GraphIndex,
  subject: Entity,
  kind: FindingKind,
  dependentIds: readonly string[],
  summary: string,
  risk: RiskAssessment,
): Finding {
  const criticalDependentIds = criticalBusinessFunctions(index, dependentIds).map((e) => e.id);
  return {
    id: findingId(kind, subject.id),
    kind,
    subjectId: subject.id,
    subjectName: subject.name,
    subjectKind: subject.kind,
    dependentIds: [...dependentIds],
    criticalDependentIds,
    risk,
    summary,
  };
}

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (iso == null) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
}

function isImportant(index: GraphIndex, entity: Entity): boolean {
  const declared = entity.criticality;
  if (declared !== undefined && CRITICALITY_RANK[declared] >= CRITICALITY_RANK.HIGH) return true;
  return criticalBusinessFunctions(index, transitiveDependents(index, entity.id)).length > 0;
}

/**
 * Concentration: losing this entity stops other things, and nothing stands
 * behind it.
 *
 * Uses the real propagation engine rather than a separate rule so that what the
 * finding claims and what a scenario would show can never diverge.
 */
function detectConcentration(
  graph: OrganizationGraph,
  index: GraphIndex,
  now: Date,
  maxEntities: number,
): Finding[] {
  if (graph.entities.length > maxEntities) return [];

  const findings: Finding[] = [];
  for (const entity of graph.entities) {
    // A person is not a single point of failure for the org just by existing;
    // something has to actually stop when they are unavailable.
    const result = runScenario(graph, { failedEntityIds: [entity.id] });
    const collapsed = result.impacted.filter(
      (item) => item.state === 'FAILED' && item.entityId !== entity.id,
    );
    if (collapsed.length === 0) continue;

    const kind = concentrationKindFor(entity, index);
    const risk = assessEntityRisk({ index, subject: entity, findingKind: kind, now });
    const collapsedIds = collapsed.map((item) => item.entityId);
    const criticalNames = criticalBusinessFunctions(index, collapsedIds)
      .slice(0, 3)
      .map((e) => `"${e.name}"`);

    const summary =
      criticalNames.length > 0
        ? `If ${humanKind(entity.kind)} "${entity.name}" is unavailable, ${criticalNames.join(', ')} stop${criticalNames.length === 1 ? 's' : ''}, and there is no recorded alternative.`
        : `If ${humanKind(entity.kind)} "${entity.name}" is unavailable, ${collapsed.length} other recorded item(s) stop, and there is no recorded alternative.`;

    findings.push(buildFinding(index, entity, kind, collapsedIds, summary, risk));
  }
  return findings;
}

/** Something important with nobody accountable for it. */
function detectMissingOwner(index: GraphIndex, now: Date): Finding[] {
  const findings: Finding[] = [];
  for (const entity of index.graph.entities) {
    if (entity.kind === 'person') continue;
    if (entity.ownerId != null && index.entityById.has(entity.ownerId)) continue;
    if (!isImportant(index, entity)) continue;

    const dependentIds = transitiveDependents(index, entity.id);
    const risk = assessEntityRisk({ index, subject: entity, findingKind: 'no_owner', now });
    findings.push(
      buildFinding(
        index,
        entity,
        'no_owner',
        dependentIds,
        entity.ownerId == null
          ? `No one is recorded as accountable for "${entity.name}", so there is nobody to call when it fails.`
          : `"${entity.name}" names an owner who does not exist in the organization, so accountability is unclear.`,
        risk,
      ),
    );
  }
  return findings;
}

/** A recovery capability that exists on paper but has never been proven. */
function detectUntestedRecovery(index: GraphIndex, now: Date): Finding[] {
  const findings: Finding[] = [];
  for (const entity of index.graph.entities) {
    if (!isImportant(index, entity)) continue;

    const hasRecoveryStory =
      (entity.alternateIds ?? []).length > 0 || entity.procedureDocumented === true;
    if (!hasRecoveryStory) continue;

    const age = daysSince(entity.lastTestedAt, now);
    if (age !== null && age <= TEST_FRESHNESS_DAYS) continue;

    const dependentIds = transitiveDependents(index, entity.id);
    const risk = assessEntityRisk({ index, subject: entity, findingKind: 'untested_recovery', now });
    findings.push(
      buildFinding(
        index,
        entity,
        'untested_recovery',
        dependentIds,
        age === null
          ? `Recovery for "${entity.name}" is written down but has never been tested, so it is unproven.`
          : `Recovery for "${entity.name}" was last tested ${age} days ago, so it can no longer be considered proven.`,
        risk,
      ),
    );
  }
  return findings;
}

/** Something important that nobody has written down how to run or recover. */
function detectMissingProcedure(index: GraphIndex, now: Date): Finding[] {
  const findings: Finding[] = [];
  for (const entity of index.graph.entities) {
    if (entity.kind === 'person') continue;
    if (entity.procedureDocumented === true) continue;
    if (!isImportant(index, entity)) continue;

    const dependentIds = transitiveDependents(index, entity.id);
    const risk = assessEntityRisk({ index, subject: entity, findingKind: 'no_procedure', now });
    findings.push(
      buildFinding(
        index,
        entity,
        'no_procedure',
        dependentIds,
        entity.procedureDocumented === false
          ? `There is no written procedure for "${entity.name}", so recovery depends on whoever happens to remember it.`
          : `Nobody has recorded whether a written procedure exists for "${entity.name}".`,
        risk,
      ),
    );
  }
  return findings;
}

/** An important business function with no agreed recovery target. */
function detectMissingRecoveryTarget(index: GraphIndex, now: Date): Finding[] {
  const findings: Finding[] = [];
  for (const entity of index.graph.entities) {
    if (entity.kind !== 'business_function') continue;
    const criticality = entity.criticality ?? 'LOW';
    if (CRITICALITY_RANK[criticality] < CRITICALITY_RANK.HIGH) continue;
    if (entity.rtoMinutes != null && entity.mtdMinutes != null) continue;

    const missing: string[] = [];
    if (entity.mtdMinutes == null) missing.push('maximum tolerable downtime');
    if (entity.rtoMinutes == null) missing.push('recovery time objective');

    const dependentIds = transitiveDependents(index, entity.id);
    const risk = assessEntityRisk({
      index,
      subject: entity,
      findingKind: 'missing_recovery_target',
      now,
    });
    findings.push(
      buildFinding(
        index,
        entity,
        'missing_recovery_target',
        dependentIds,
        `"${entity.name}" is a ${criticality} business function with no agreed ${missing.join(' or ')}, so there is no standard to recover against.`,
        risk,
      ),
    );
  }
  return findings;
}

/**
 * Run every detector.
 *
 * Results are sorted worst first so that a caller rendering the top N shows the
 * things that matter, and deduplicated by finding id.
 */
export function detectFindings(
  graph: OrganizationGraph,
  options: DetectOptions = {},
): Finding[] {
  const index = buildIndex(graph);
  const now = options.now ?? new Date();
  const maxEntities =
    options.maxEntitiesForConcentration ?? DEFAULT_MAX_ENTITIES_FOR_CONCENTRATION;

  const findings = [
    ...detectConcentration(graph, index, now, maxEntities),
    ...detectMissingOwner(index, now),
    ...detectUntestedRecovery(index, now),
    ...detectMissingProcedure(index, now),
    ...detectMissingRecoveryTarget(index, now),
  ];

  const byId = new Map<string, Finding>();
  for (const finding of findings) {
    if (!byId.has(finding.id)) byId.set(finding.id, finding);
  }

  const RANK = { CRITICAL: 3, HIGH: 2, MODERATE: 1, LOW: 0 } as const;
  return [...byId.values()].sort(
    (a, b) =>
      RANK[b.risk.band] - RANK[a.risk.band] ||
      b.risk.score - a.risk.score ||
      b.criticalDependentIds.length - a.criticalDependentIds.length ||
      a.subjectName.localeCompare(b.subjectName),
  );
}
