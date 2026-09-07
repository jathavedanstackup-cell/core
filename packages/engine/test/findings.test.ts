import { describe, expect, it } from 'vitest';

import { detectFindings } from '../src/findings.js';
import { graphOf, northwind, NOW } from './fixtures.js';

const findings = detectFindings(northwind, { now: NOW });
const ids = findings.map((f) => f.id);

describe('detectFindings', () => {
  it('finds the person who is the only one able to run a critical function', () => {
    expect(ids).toContain('single_person:p-asha');
    const finding = findings.find((f) => f.id === 'single_person:p-asha');
    expect(finding?.risk.band).toBe('CRITICAL');
    expect(finding?.criticalDependentIds).toContain('bf-payroll');
  });

  it('finds the supplier with no second source', () => {
    expect(ids).toContain('single_vendor:vendor-payflow');
    const finding = findings.find((f) => f.id === 'single_vendor:vendor-payflow');
    expect(finding?.summary).toContain('Take customer orders');
  });

  it('finds the shared database two critical functions sit on', () => {
    const finding = findings.find((f) => f.id === 'single_system:db-core');
    expect(finding).toBeDefined();
    expect([...(finding?.criticalDependentIds ?? [])].sort()).toEqual(['bf-orders', 'bf-payroll']);
  });

  it('does not call something a single point of failure when it has a working fallback', () => {
    // Losing the helpdesk only degrades support, because a standby is recorded.
    expect(ids).not.toContain('single_system:svc-helpdesk');
  });

  it('does not flag an entity that nothing depends on', () => {
    expect(ids.some((id) => id.endsWith(':vendor-billwise'))).toBe(false);
  });

  it('finds a critical function with no agreed recovery target', () => {
    expect(ids).toContain('missing_recovery_target:bf-support');
  });

  it('finds recovery plans that exist on paper but are unproven', () => {
    expect(ids).toContain('untested_recovery:bf-payroll');
    expect(ids).toContain('untested_recovery:app-payroll');
    // Tested 30 days ago, so it should not be flagged.
    expect(ids).not.toContain('untested_recovery:bf-orders');
  });

  it('finds important work with no written procedure', () => {
    expect(ids).toContain('no_procedure:proc-payroll-run');
  });

  it('flags an important entity with nobody accountable', () => {
    const graph = graphOf(
      [
        { id: 'fn', kind: 'business_function', name: 'Fn', criticality: 'CRITICAL' },
        { id: 'svc', kind: 'service', name: 'Orphan service' },
      ],
      [{ id: 'd', dependentId: 'fn', providerId: 'svc', type: 'requires' }],
    );
    const orphanFindings = detectFindings(graph, { now: NOW });
    expect(orphanFindings.map((f) => f.id)).toContain('no_owner:svc');
  });

  it('sorts the worst findings first so a caller can show the top few', () => {
    expect(findings[0]?.risk.band).toBe('CRITICAL');
    const bandRank = { CRITICAL: 3, HIGH: 2, MODERATE: 1, LOW: 0 } as const;
    for (let i = 1; i < findings.length; i += 1) {
      const previous = findings[i - 1];
      const current = findings[i];
      if (previous === undefined || current === undefined) continue;
      expect(bandRank[previous.risk.band]).toBeGreaterThanOrEqual(bandRank[current.risk.band]);
    }
  });

  it('gives every finding a summary and an explained risk', () => {
    for (const finding of findings) {
      expect(finding.summary.length).toBeGreaterThan(0);
      expect(finding.risk.reasons.length).toBeGreaterThan(0);
    }
  });

  it('produces no duplicate finding ids', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds nothing to report in an empty organization', () => {
    expect(detectFindings(graphOf([]), { now: NOW })).toEqual([]);
  });

  it('is deterministic', () => {
    expect(detectFindings(northwind, { now: NOW })).toEqual(findings);
  });

  it('skips concentration analysis on graphs above the configured size', () => {
    const limited = detectFindings(northwind, { now: NOW, maxEntitiesForConcentration: 1 });
    expect(limited.some((f) => f.kind === 'single_person')).toBe(false);
    // Hygiene findings still run, so the caller is not left with nothing.
    expect(limited.some((f) => f.kind === 'missing_recovery_target')).toBe(true);
  });
});
