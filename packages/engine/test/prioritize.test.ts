import { describe, expect, it } from 'vitest';

import { detectFindings } from '../src/findings.js';
import { buildIndex } from '../src/graph.js';
import { groupByTier, prioritize, TIER_LIMITS } from '../src/prioritize.js';
import { graphOf, northwind, NOW } from './fixtures.js';

const index = buildIndex(northwind);
const findings = detectFindings(northwind, { now: NOW });
const prioritized = prioritize(index, findings);
const grouped = groupByTier(prioritized);

describe('prioritize', () => {
  it('keeps every finding, losing none in the sort', () => {
    expect(prioritized).toHaveLength(findings.length);
    expect(new Set(prioritized.map((p) => p.finding.id)).size).toBe(findings.length);
  });

  it('does not overwhelm leadership: the actionable tiers are capped', () => {
    expect(grouped.FIX_FIRST.length).toBeLessThanOrEqual(TIER_LIMITS.FIX_FIRST);
    expect(grouped.FIX_NEXT.length).toBeLessThanOrEqual(TIER_LIMITS.FIX_NEXT);
    expect(grouped.FIX_FIRST.length).toBeGreaterThan(0);
  });

  it('ranks in descending order of value', () => {
    for (let i = 1; i < prioritized.length; i += 1) {
      const previous = prioritized[i - 1];
      const current = prioritized[i];
      if (previous === undefined || current === undefined) continue;
      expect(previous.valueScore).toBeGreaterThanOrEqual(current.valueScore);
    }
  });

  it('puts the critical single-person dependency in FIX_FIRST', () => {
    expect(grouped.FIX_FIRST.map((p) => p.finding.id)).toContain('single_person:p-asha');
  });

  it('never asks leadership to act on LOW risk', () => {
    for (const item of prioritized) {
      if (item.finding.risk.band === 'LOW') expect(item.tier).toBe('MONITOR');
    }
  });

  it('explains each ranking in terms a reader can challenge', () => {
    for (const item of prioritized) {
      expect(item.rationale).toMatch(/LOW|MODERATE|HIGH|CRITICAL/);
      expect(item.rationale.endsWith('.')).toBe(true);
    }
  });

  it('rewards a cheap fix over an expensive one at the same severity', () => {
    // Two identical organizations except that one weakness is a missing
    // document (cheap) and the other needs a second supplier (expensive).
    const graph = graphOf(
      [
        { id: 'fn1', kind: 'business_function', name: 'Fn one', criticality: 'HIGH' },
        { id: 'fn2', kind: 'business_function', name: 'Fn two', criticality: 'HIGH' },
        { id: 'proc', kind: 'process', name: 'Undocumented process', procedureDocumented: false },
        { id: 'vend', kind: 'vendor', name: 'Sole supplier' },
      ],
      [
        { id: 'd1', dependentId: 'fn1', providerId: 'proc', type: 'requires' },
        { id: 'd2', dependentId: 'fn2', providerId: 'vend', type: 'supplies' },
      ],
    );
    const localIndex = buildIndex(graph);
    const localFindings = detectFindings(graph, { now: NOW });
    const ranked = prioritize(localIndex, localFindings);

    const documentFix = ranked.find((p) => p.finding.id === 'no_procedure:proc');
    const supplierFix = ranked.find((p) => p.finding.id === 'single_vendor:vend');
    expect(documentFix).toBeDefined();
    expect(supplierFix).toBeDefined();
    // Same band, so the cheapness term should separate them.
    if (documentFix !== undefined && supplierFix !== undefined) {
      expect(documentFix.finding.risk.band).toBe(supplierFix.finding.risk.band);
      expect(documentFix.valueScore).toBeGreaterThan(supplierFix.valueScore);
    }
  });

  it('reuses pre-computed solutions when given them', () => {
    const withoutCache = prioritize(index, findings);
    const withCache = prioritize(index, findings, { solutions: new Map() });
    expect(withCache.map((p) => p.finding.id)).toEqual(withoutCache.map((p) => p.finding.id));
  });

  it('handles an organization with no findings', () => {
    expect(prioritize(index, [])).toEqual([]);
    expect(groupByTier([])).toEqual({ FIX_FIRST: [], FIX_NEXT: [], MONITOR: [] });
  });

  it('is deterministic', () => {
    expect(prioritize(index, findings)).toEqual(prioritized);
  });
});
