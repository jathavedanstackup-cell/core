import { describe, expect, it } from 'vitest';

import {
  buildIndex,
  effectiveCriticality,
  findCycles,
  transitiveDependents,
  validateGraph,
} from '../src/graph.js';
import { graphOf, northwind } from './fixtures.js';

describe('validateGraph', () => {
  it('accepts a well-formed organization', () => {
    const issues = validateGraph(northwind);
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('reports a dependency pointing at an entity that does not exist', () => {
    const issues = validateGraph(
      graphOf(
        [{ id: 'a', kind: 'service', name: 'A' }],
        [{ id: 'd', dependentId: 'a', providerId: 'ghost', type: 'requires' }],
      ),
    );
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('dangling_provider');
  });

  it('reports duplicate entity ids rather than silently keeping the last one', () => {
    const issues = validateGraph(
      graphOf([
        { id: 'a', kind: 'service', name: 'First' },
        { id: 'a', kind: 'service', name: 'Second' },
      ]),
    );
    expect(issues.map((i) => i.code)).toContain('duplicate_entity_id');
  });

  it('reports an entity recorded as depending on itself', () => {
    const issues = validateGraph(
      graphOf(
        [{ id: 'a', kind: 'service', name: 'A' }],
        [{ id: 'd', dependentId: 'a', providerId: 'a', type: 'requires' }],
      ),
    );
    expect(issues.map((i) => i.code)).toContain('self_dependency');
  });

  it('warns when a recovery target cannot meet the tolerable downtime', () => {
    const issues = validateGraph(
      graphOf([
        {
          id: 'f',
          kind: 'business_function',
          name: 'Ship orders',
          mtdMinutes: 60,
          rtoMinutes: 240,
        },
      ]),
    );
    const issue = issues.find((i) => i.code === 'rto_exceeds_mtd');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('cannot meet the need');
  });

  it('warns when a fallback is the primary provider, which protects nothing', () => {
    const issues = validateGraph(
      graphOf(
        [
          { id: 'a', kind: 'service', name: 'A' },
          { id: 'b', kind: 'service', name: 'B' },
        ],
        [{ id: 'd', dependentId: 'a', providerId: 'b', type: 'requires', fallbackProviderIds: ['b'] }],
      ),
    );
    expect(issues.map((i) => i.code)).toContain('fallback_is_primary');
  });
});

describe('findCycles', () => {
  it('finds none in an acyclic organization', () => {
    expect(findCycles(northwind)).toEqual([]);
  });

  it('detects a cycle and reports it once regardless of where it is entered', () => {
    const cycles = findCycles(
      graphOf(
        [
          { id: 'a', kind: 'service', name: 'A' },
          { id: 'b', kind: 'service', name: 'B' },
          { id: 'c', kind: 'service', name: 'C' },
        ],
        [
          { id: 'd1', dependentId: 'a', providerId: 'b', type: 'requires' },
          { id: 'd2', dependentId: 'b', providerId: 'c', type: 'requires' },
          { id: 'd3', dependentId: 'c', providerId: 'a', type: 'requires' },
        ],
      ),
    );
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(4); // three nodes, returning to the start
  });

  it('surfaces the cycle as a graph issue without refusing to analyse', () => {
    const issues = validateGraph(
      graphOf(
        [
          { id: 'a', kind: 'service', name: 'A' },
          { id: 'b', kind: 'service', name: 'B' },
        ],
        [
          { id: 'd1', dependentId: 'a', providerId: 'b', type: 'requires' },
          { id: 'd2', dependentId: 'b', providerId: 'a', type: 'requires' },
        ],
      ),
    );
    const cycle = issues.find((i) => i.code === 'dependency_cycle');
    expect(cycle?.severity).toBe('warning');
  });

  it('does not blow the stack on a long dependency chain', () => {
    const count = 5_000;
    const entities = Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      kind: 'service' as const,
      name: `Node ${i}`,
    }));
    const dependencies = Array.from({ length: count - 1 }, (_, i) => ({
      id: `d${i}`,
      dependentId: `n${i}`,
      providerId: `n${i + 1}`,
      type: 'requires' as const,
    }));
    expect(() => findCycles(graphOf(entities, dependencies))).not.toThrow();
  });
});

describe('transitiveDependents', () => {
  it('returns everything that transitively relies on an entity', () => {
    const index = buildIndex(northwind);
    const dependents = transitiveDependents(index, 'db-core').sort();
    expect(dependents).toEqual(
      ['app-payroll', 'bf-orders', 'bf-payroll', 'proc-payroll-run', 'svc-payments'].sort(),
    );
  });

  it('excludes the entity itself', () => {
    const index = buildIndex(northwind);
    expect(transitiveDependents(index, 'db-core')).not.toContain('db-core');
  });

  it('returns nothing for an entity nothing depends on', () => {
    const index = buildIndex(northwind);
    expect(transitiveDependents(index, 'bf-payroll')).toEqual([]);
  });
});

describe('effectiveCriticality', () => {
  it('inherits criticality from what depends on it', () => {
    const index = buildIndex(northwind);
    // Nobody labelled the database, but two CRITICAL functions sit on it.
    expect(index.entityById.get('db-core')?.criticality).toBeUndefined();
    expect(effectiveCriticality(index, 'db-core')).toBe('CRITICAL');
  });

  it('takes the highest criticality among dependents, not the nearest', () => {
    const index = buildIndex(northwind);
    expect(effectiveCriticality(index, 'loc-hq')).toBe('HIGH');
  });

  it('never downgrades an explicitly declared criticality', () => {
    const index = buildIndex(
      graphOf([{ id: 'x', kind: 'service', name: 'X', criticality: 'CRITICAL' }]),
    );
    expect(effectiveCriticality(index, 'x')).toBe('CRITICAL');
  });
});
