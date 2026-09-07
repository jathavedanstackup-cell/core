/**
 * Failure propagation.
 *
 * Given a set of entities assumed unavailable, work out what else stops working
 * and in what order. This is the mechanism behind both "what happens if X
 * fails?" and the severity half of single-point-of-failure detection.
 *
 * The traversal is breadth-first over waves, so wave 1 is what breaks first,
 * wave 2 is what breaks next, and so on. That ordering is what a responder
 * actually needs: it tells them where the front line is.
 */

import {
  buildIndex,
  criticalBusinessFunctions,
  type GraphIndex,
} from './graph.js';
import {
  CRITICALITY_RANK,
  type Dependency,
  type ImpactedEntity,
  type ImpactState,
  type OrganizationGraph,
  type ScenarioInput,
  type ScenarioResult,
} from './types.js';

interface MutableImpact {
  entityId: string;
  state: ImpactState;
  wave: number;
  path: string[];
  explanation: string;
}

interface FallbackUse {
  dependentId: string;
  failedProviderId: string;
  fallbackProviderId: string;
}

interface MissingFallback {
  dependentId: string;
  failedProviderId: string;
}

/**
 * Decide whether a dependent can survive losing one of its providers.
 *
 * Two things can save it: a fallback named on the dependency itself, or an
 * alternate recorded against the failed provider. Either must itself still be
 * available — a fallback that has also failed is not a fallback.
 */
function findAvailableCover(
  index: GraphIndex,
  dependency: Dependency,
  unavailable: ReadonlySet<string>,
): string | null {
  for (const fallbackId of dependency.fallbackProviderIds ?? []) {
    if (fallbackId === dependency.providerId) continue;
    if (!index.entityById.has(fallbackId)) continue;
    if (!unavailable.has(fallbackId)) return fallbackId;
  }

  const provider = index.entityById.get(dependency.providerId);
  for (const alternateId of provider?.alternateIds ?? []) {
    if (alternateId === dependency.providerId) continue;
    if (!index.entityById.has(alternateId)) continue;
    if (!unavailable.has(alternateId)) return alternateId;
  }

  return null;
}

export interface PropagationOptions {
  /**
   * Treat optional dependencies as hard requirements. Useful for a worst-case
   * exercise where you want to know the floor, not the expected case.
   */
  readonly ignoreOptional?: boolean;
}

/**
 * Run the propagation and produce a full scenario result.
 *
 * Unknown entity ids in the input are reported as an assumption rather than
 * throwing, because scenario input often comes from free text and a partially
 * recognised scenario is still worth answering.
 */
export function runScenario(
  graph: OrganizationGraph,
  input: ScenarioInput,
  options: PropagationOptions = {},
): ScenarioResult {
  const index = buildIndex(graph);
  const impacts = new Map<string, MutableImpact>();
  const unavailable = new Set<string>();
  const fallbacksUsed: FallbackUse[] = [];
  const missingFallbacks: MissingFallback[] = [];
  const assumptions: string[] = [];
  const unknownIds: string[] = [];

  const seeds: string[] = [];
  for (const id of input.failedEntityIds) {
    const entity = index.entityById.get(id);
    if (entity === undefined) {
      unknownIds.push(id);
      continue;
    }
    if (unavailable.has(id)) continue;
    unavailable.add(id);
    impacts.set(id, {
      entityId: id,
      state: 'FAILED',
      wave: 0,
      path: [id],
      explanation: `"${entity.name}" is the starting point of this scenario and is assumed unavailable.`,
    });
    seeds.push(id);
  }

  // Breadth-first by wave. Only a transition to FAILED enqueues further work,
  // so every entity is expanded at most once and the loop always terminates.
  let frontier = seeds;
  let wave = 0;
  while (frontier.length > 0) {
    wave += 1;
    const nextFrontier: string[] = [];

    for (const failedId of frontier) {
      const failedImpact = impacts.get(failedId);
      if (failedImpact === undefined) continue;

      for (const dependency of index.incoming.get(failedId) ?? []) {
        const dependentId = dependency.dependentId;
        const dependent = index.entityById.get(dependentId);
        if (dependent === undefined) continue;

        const existing = impacts.get(dependentId);
        if (existing !== undefined && existing.state === 'FAILED') continue;

        const cover = findAvailableCover(index, dependency, unavailable);
        const provider = index.entityById.get(failedId);
        const providerName = provider?.name ?? failedId;

        if (cover !== null) {
          const coverName = index.entityById.get(cover)?.name ?? cover;
          fallbacksUsed.push({
            dependentId,
            failedProviderId: failedId,
            fallbackProviderId: cover,
          });
          if (existing === undefined) {
            impacts.set(dependentId, {
              entityId: dependentId,
              state: 'DEGRADED',
              wave,
              path: [...failedImpact.path, dependentId],
              explanation: `"${dependent.name}" lost "${providerName}" but can continue on "${coverName}".`,
            });
          }
          continue;
        }

        const isOptional = dependency.optional === true && options.ignoreOptional !== true;
        if (isOptional) {
          missingFallbacks.push({ dependentId, failedProviderId: failedId });
          if (existing === undefined) {
            impacts.set(dependentId, {
              entityId: dependentId,
              state: 'DEGRADED',
              wave,
              path: [...failedImpact.path, dependentId],
              explanation: `"${dependent.name}" depends on "${providerName}" but records that dependency as non-essential, so it continues in a reduced state.`,
            });
          }
          continue;
        }

        missingFallbacks.push({ dependentId, failedProviderId: failedId });
        unavailable.add(dependentId);
        impacts.set(dependentId, {
          entityId: dependentId,
          state: 'FAILED',
          wave,
          path: [...failedImpact.path, dependentId],
          explanation: `"${dependent.name}" requires "${providerName}" and has no available alternative, so it stops as well.`,
        });
        nextFrontier.push(dependentId);
      }
    }

    frontier = nextFrontier;
  }

  const impacted = [...impacts.values()]
    .map<ImpactedEntity>((impact) => {
      const entity = index.entityById.get(impact.entityId);
      return {
        entityId: impact.entityId,
        name: entity?.name ?? impact.entityId,
        kind: entity?.kind ?? 'service',
        state: impact.state,
        wave: impact.wave,
        path: impact.path,
        explanation: impact.explanation,
      };
    })
    .sort((a, b) => a.wave - b.wave || a.name.localeCompare(b.name));

  const maxWave = impacted.reduce((max, item) => Math.max(max, item.wave), 0);
  const waves: ImpactedEntity[][] = [];
  for (let w = 0; w <= maxWave; w += 1) {
    waves.push(impacted.filter((item) => item.wave === w));
  }

  const failedFunctions = impacted
    .filter((item) => item.state === 'FAILED' && item.kind === 'business_function')
    .sort((a, b) => {
      const aCriticality = index.entityById.get(a.entityId)?.criticality ?? 'LOW';
      const bCriticality = index.entityById.get(b.entityId)?.criticality ?? 'LOW';
      return (
        CRITICALITY_RANK[bCriticality] - CRITICALITY_RANK[aCriticality] ||
        a.wave - b.wave ||
        a.name.localeCompare(b.name)
      );
    });

  if (unknownIds.length > 0) {
    assumptions.push(
      `${unknownIds.length} item(s) named in the scenario are not recorded in the organization and were left out: ${unknownIds.join(', ')}.`,
    );
  }
  if (fallbacksUsed.length > 0) {
    const untested = countUntestedCovers(index, fallbacksUsed);
    assumptions.push(
      `${fallbacksUsed.length} fallback(s) are assumed to work as recorded.` +
        (untested > 0
          ? ` ${untested} of them have no recorded successful test, so that assumption is unverified.`
          : ''),
    );
  }
  assumptions.push(
    'Only recorded dependencies are considered. Anything the organization has not written down cannot be included in this analysis.',
  );

  const result: ScenarioResult = {
    input,
    impacted,
    waves,
    failedFunctions,
    fallbacksUsed,
    missingFallbacks: dedupeMissing(missingFallbacks),
    assumptions,
  };
  return result;
}

function countUntestedCovers(index: GraphIndex, uses: readonly FallbackUse[]): number {
  const coverIds = new Set(uses.map((use) => use.fallbackProviderId));
  let untested = 0;
  for (const id of coverIds) {
    const entity = index.entityById.get(id);
    if (entity?.lastTestedAt == null) untested += 1;
  }
  return untested;
}

function dedupeMissing(items: readonly MissingFallback[]): MissingFallback[] {
  const seen = new Set<string>();
  const out: MissingFallback[] = [];
  for (const item of items) {
    const key = `${item.dependentId}|${item.failedProviderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * The blast radius of losing a single entity, expressed as the critical
 * business functions that would stop. Used by risk scoring, where running a
 * full scenario per candidate would be wasteful but the failed-function count
 * is exactly what determines impact.
 */
export function blastRadius(
  graph: OrganizationGraph,
  entityId: string,
): { failedFunctionIds: string[]; failedEntityIds: string[] } {
  const result = runScenario(graph, { failedEntityIds: [entityId] });
  const index = buildIndex(graph);
  const failedEntityIds = result.impacted
    .filter((item) => item.state === 'FAILED' && item.entityId !== entityId)
    .map((item) => item.entityId);
  const failedFunctionIds = criticalBusinessFunctions(index, failedEntityIds).map((e) => e.id);
  return { failedFunctionIds, failedEntityIds };
}
