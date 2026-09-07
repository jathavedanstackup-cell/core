/**
 * Graph indexing, validation and traversal.
 *
 * The organization arrives as two flat lists. Every analysis needs the same
 * adjacency lookups, so they are built once into a `GraphIndex` and passed
 * around. Building the index is the only place that walks the raw lists.
 */

import {
  CRITICALITY_RANK,
  type Criticality,
  type Dependency,
  type Entity,
  type OrganizationGraph,
} from './types.js';

export interface GraphIndex {
  readonly graph: OrganizationGraph;
  /** id -> entity */
  readonly entityById: ReadonlyMap<string, Entity>;
  /** dependent id -> the dependencies it declares (things it needs) */
  readonly outgoing: ReadonlyMap<string, readonly Dependency[]>;
  /** provider id -> the dependencies pointing at it (things that need it) */
  readonly incoming: ReadonlyMap<string, readonly Dependency[]>;
}

export type GraphIssueSeverity = 'error' | 'warning';

export interface GraphIssue {
  readonly severity: GraphIssueSeverity;
  readonly code: string;
  readonly message: string;
  /** The entity or dependency id the issue is about. */
  readonly subjectId: string;
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Build the adjacency index.
 *
 * Dependencies referencing unknown entities are kept in the index rather than
 * dropped, so that {@link validateGraph} can report them instead of the graph
 * silently analysing a smaller organization than the user thinks they have.
 */
export function buildIndex(graph: OrganizationGraph): GraphIndex {
  const entityById = new Map<string, Entity>();
  for (const entity of graph.entities) {
    entityById.set(entity.id, entity);
  }

  const outgoing = new Map<string, Dependency[]>();
  const incoming = new Map<string, Dependency[]>();
  for (const dependency of graph.dependencies) {
    pushInto(outgoing, dependency.dependentId, dependency);
    pushInto(incoming, dependency.providerId, dependency);
  }

  return { graph, entityById, outgoing, incoming };
}

/**
 * Report structural problems. Callers decide whether to refuse the data or
 * analyse it anyway; §15 of the product spec requires that bad data is never
 * silently accepted, so the API layer surfaces these to the user.
 */
export function validateGraph(graph: OrganizationGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const seenEntityIds = new Set<string>();

  for (const entity of graph.entities) {
    if (seenEntityIds.has(entity.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_entity_id',
        subjectId: entity.id,
        message: `More than one entity uses the id "${entity.id}". Ids must be unique.`,
      });
      continue;
    }
    seenEntityIds.add(entity.id);

    if (entity.name.trim() === '') {
      issues.push({
        severity: 'error',
        code: 'entity_missing_name',
        subjectId: entity.id,
        message: `Entity "${entity.id}" has no name.`,
      });
    }
  }

  const seenDependencyIds = new Set<string>();
  for (const dependency of graph.dependencies) {
    if (seenDependencyIds.has(dependency.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_dependency_id',
        subjectId: dependency.id,
        message: `More than one dependency uses the id "${dependency.id}".`,
      });
    }
    seenDependencyIds.add(dependency.id);

    if (!seenEntityIds.has(dependency.dependentId)) {
      issues.push({
        severity: 'error',
        code: 'dangling_dependent',
        subjectId: dependency.id,
        message: `Dependency "${dependency.id}" refers to unknown dependent "${dependency.dependentId}".`,
      });
    }
    if (!seenEntityIds.has(dependency.providerId)) {
      issues.push({
        severity: 'error',
        code: 'dangling_provider',
        subjectId: dependency.id,
        message: `Dependency "${dependency.id}" refers to unknown provider "${dependency.providerId}".`,
      });
    }
    if (dependency.dependentId === dependency.providerId) {
      issues.push({
        severity: 'error',
        code: 'self_dependency',
        subjectId: dependency.id,
        message: `Entity "${dependency.dependentId}" is recorded as depending on itself.`,
      });
    }

    for (const fallbackId of dependency.fallbackProviderIds ?? []) {
      if (!seenEntityIds.has(fallbackId)) {
        issues.push({
          severity: 'error',
          code: 'dangling_fallback',
          subjectId: dependency.id,
          message: `Dependency "${dependency.id}" names unknown fallback provider "${fallbackId}".`,
        });
      }
      if (fallbackId === dependency.providerId) {
        issues.push({
          severity: 'warning',
          code: 'fallback_is_primary',
          subjectId: dependency.id,
          message: `Dependency "${dependency.id}" lists its own primary provider as a fallback, which offers no protection.`,
        });
      }
    }
  }

  for (const entity of graph.entities) {
    for (const alternateId of entity.alternateIds ?? []) {
      if (!seenEntityIds.has(alternateId)) {
        issues.push({
          severity: 'error',
          code: 'dangling_alternate',
          subjectId: entity.id,
          message: `"${entity.name}" names unknown alternate "${alternateId}".`,
        });
      }
    }
    if (entity.ownerId != null && !seenEntityIds.has(entity.ownerId)) {
      issues.push({
        severity: 'error',
        code: 'dangling_owner',
        subjectId: entity.id,
        message: `"${entity.name}" names unknown owner "${entity.ownerId}".`,
      });
    }
    if (
      entity.mtdMinutes != null &&
      entity.rtoMinutes != null &&
      entity.rtoMinutes > entity.mtdMinutes
    ) {
      issues.push({
        severity: 'warning',
        code: 'rto_exceeds_mtd',
        subjectId: entity.id,
        message: `"${entity.name}" has a recovery target of ${entity.rtoMinutes} minutes but can only tolerate ${entity.mtdMinutes} minutes of downtime. The plan cannot meet the need.`,
      });
    }
  }

  for (const cycle of findCycles(graph)) {
    issues.push({
      severity: 'warning',
      code: 'dependency_cycle',
      subjectId: cycle[0] ?? '',
      message: `Circular dependency: ${cycle.join(' -> ')}. Impact analysis still runs, but recovery ordering cannot be derived automatically.`,
    });
  }

  return issues;
}

/**
 * Find dependency cycles using an iterative depth-first search.
 *
 * Iterative rather than recursive because a deep import of a large organization
 * would otherwise be able to blow the stack, and the input is user-supplied.
 */
export function findCycles(graph: OrganizationGraph): string[][] {
  const index = buildIndex(graph);
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const entity of graph.entities) colour.set(entity.id, WHITE);

  for (const entity of graph.entities) {
    if (colour.get(entity.id) !== WHITE) continue;

    // stack frames hold the node and how far through its providers we are
    const stack: { id: string; cursor: number }[] = [{ id: entity.id, cursor: 0 }];
    const pathIds: string[] = [entity.id];
    colour.set(entity.id, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;

      const providers = index.outgoing.get(frame.id) ?? [];
      if (frame.cursor >= providers.length) {
        colour.set(frame.id, BLACK);
        stack.pop();
        pathIds.pop();
        continue;
      }

      const dependency = providers[frame.cursor];
      frame.cursor += 1;
      if (dependency === undefined) continue;

      const nextId = dependency.providerId;
      if (!index.entityById.has(nextId)) continue;

      const nextColour = colour.get(nextId) ?? WHITE;
      if (nextColour === GREY) {
        const start = pathIds.indexOf(nextId);
        if (start >= 0) {
          const cycle = [...pathIds.slice(start), nextId];
          const key = canonicalCycleKey(cycle);
          if (!seenCycleKeys.has(key)) {
            seenCycleKeys.add(key);
            cycles.push(cycle);
          }
        }
      } else if (nextColour === WHITE) {
        colour.set(nextId, GREY);
        stack.push({ id: nextId, cursor: 0 });
        pathIds.push(nextId);
      }
    }
  }

  return cycles;
}

/** Rotation-independent key so the same cycle is not reported twice. */
function canonicalCycleKey(cycle: string[]): string {
  const ring = cycle.slice(0, -1);
  if (ring.length === 0) return '';
  let best: string | null = null;
  for (let offset = 0; offset < ring.length; offset += 1) {
    const rotated = [...ring.slice(offset), ...ring.slice(0, offset)].join('>');
    if (best === null || rotated < best) best = rotated;
  }
  return best ?? '';
}

export function getEntity(index: GraphIndex, id: string): Entity | undefined {
  return index.entityById.get(id);
}

/** Entities that directly depend on `providerId`. */
export function directDependents(index: GraphIndex, providerId: string): Dependency[] {
  return [...(index.incoming.get(providerId) ?? [])];
}

/** Dependencies `dependentId` declares on other entities. */
export function directProviders(index: GraphIndex, dependentId: string): Dependency[] {
  return [...(index.outgoing.get(dependentId) ?? [])];
}

/**
 * Everything that transitively depends on `providerId`, excluding itself.
 *
 * This answers "who feels it if this goes away", which is the question behind
 * both impact analysis and single-point-of-failure severity.
 */
export function transitiveDependents(index: GraphIndex, providerId: string): string[] {
  const found = new Set<string>();
  const queue: string[] = [providerId];
  const visited = new Set<string>([providerId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const dependency of index.incoming.get(current) ?? []) {
      const dependentId = dependency.dependentId;
      if (visited.has(dependentId)) continue;
      visited.add(dependentId);
      found.add(dependentId);
      queue.push(dependentId);
    }
  }

  return [...found];
}

/**
 * The criticality an entity effectively carries.
 *
 * A database nobody labelled is exactly as critical as the most critical thing
 * that depends on it. Declared criticality wins when it is higher, so an
 * explicitly CRITICAL entity is never quietly downgraded.
 */
export function effectiveCriticality(index: GraphIndex, entityId: string): Criticality {
  const entity = index.entityById.get(entityId);
  let best: Criticality = entity?.criticality ?? 'LOW';

  for (const dependentId of transitiveDependents(index, entityId)) {
    const declared = index.entityById.get(dependentId)?.criticality;
    if (declared === undefined) continue;
    if (CRITICALITY_RANK[declared] > CRITICALITY_RANK[best]) {
      best = declared;
    }
  }

  return best;
}

/** The business functions among a set of entity ids, most critical first. */
export function criticalBusinessFunctions(
  index: GraphIndex,
  entityIds: readonly string[],
): Entity[] {
  const functions: Entity[] = [];
  for (const id of entityIds) {
    const entity = index.entityById.get(id);
    if (entity === undefined) continue;
    if (entity.kind !== 'business_function') continue;
    const criticality = entity.criticality ?? 'LOW';
    if (CRITICALITY_RANK[criticality] >= CRITICALITY_RANK.HIGH) {
      functions.push(entity);
    }
  }
  return functions.sort(
    (a, b) =>
      CRITICALITY_RANK[b.criticality ?? 'LOW'] - CRITICALITY_RANK[a.criticality ?? 'LOW'] ||
      a.name.localeCompare(b.name),
  );
}
