import { describe, expect, it } from 'vitest';

import { buildIndex } from '../src/graph.js';
import { assessEntityRisk, assessEntityRiskById, MAX_SCORE, worstBand } from '../src/risk.js';
import { graphOf, northwind, NOW } from './fixtures.js';

const index = buildIndex(northwind);

function assess(entityId: string, kind: Parameters<typeof assessEntityRiskById>[2]) {
  const result = assessEntityRiskById(index, entityId, kind, NOW);
  if (result === null) throw new Error(`no assessment for ${entityId}`);
  return result;
}

describe('assessEntityRisk', () => {
  it('rates the sole trained owner of a critical function as CRITICAL', () => {
    const risk = assess('p-asha', 'single_person');
    expect(risk.band).toBe('CRITICAL');
    expect(risk.score).toBe(9);
    expect(risk.maxScore).toBe(MAX_SCORE);
  });

  it('explains the band by naming the real entities involved', () => {
    const risk = assess('p-asha', 'single_person');
    const impact = risk.reasons.find((r) => r.code === 'impact.function');
    expect(impact?.statement).toContain('Asha Rao');
    expect(impact?.statement).toContain('Pay staff');
    expect(impact?.statement).toContain('CRITICAL');
  });

  it('accounts for every point of the score in its reasons', () => {
    const risk = assess('p-asha', 'single_person');
    const total = risk.reasons.reduce((sum, reason) => sum + reason.contribution, 0);
    expect(total).toBe(risk.score);
  });

  it('never produces a percentage, because it has no calibrated probability model', () => {
    const subjects = ['p-asha', 'db-core', 'vendor-payflow', 'svc-helpdesk'] as const;
    for (const id of subjects) {
      const risk = assess(id, 'single_system');
      for (const reason of risk.reasons) {
        expect(reason.statement).not.toMatch(/\d\s*%/);
      }
    }
  });

  it('marks inherited criticality as ESTIMATED rather than KNOWN', () => {
    const risk = assess('db-core', 'single_system');
    const impact = risk.reasons.find((r) => r.code === 'impact.function');
    expect(impact?.confidence).toBe('ESTIMATED');
    expect(impact?.statement).toContain('inherits');
  });

  it('marks a never-tested recovery as UNKNOWN, not as a passing check', () => {
    const risk = assess('p-asha', 'single_person');
    const tested = risk.reasons.find((r) => r.code === 'recoverability.never_tested');
    expect(tested?.confidence).toBe('UNKNOWN');
  });

  it('credits a recorded alternative by reducing the score', () => {
    const withoutAlternate = graphOf(
      [
        { id: 'fn', kind: 'business_function', name: 'Fn', criticality: 'HIGH' },
        { id: 'svc', kind: 'service', name: 'Svc' },
      ],
      [{ id: 'd', dependentId: 'fn', providerId: 'svc', type: 'requires' }],
    );
    const withAlternate = graphOf(
      [
        { id: 'fn', kind: 'business_function', name: 'Fn', criticality: 'HIGH' },
        { id: 'svc', kind: 'service', name: 'Svc', alternateIds: ['spare'] },
        { id: 'spare', kind: 'service', name: 'Spare' },
      ],
      [{ id: 'd', dependentId: 'fn', providerId: 'svc', type: 'requires' }],
    );

    const before = assessEntityRiskById(buildIndex(withoutAlternate), 'svc', 'single_system', NOW);
    const after = assessEntityRiskById(buildIndex(withAlternate), 'svc', 'single_system', NOW);
    expect(after?.score).toBeLessThan(before?.score ?? 0);
  });

  it('forces CRITICAL when a critical function has nothing standing behind it', () => {
    const graph = graphOf(
      [
        { id: 'fn', kind: 'business_function', name: 'Settle trades', criticality: 'CRITICAL' },
        {
          id: 'svc',
          kind: 'service',
          name: 'Settlement engine',
          contactsVerifiedAt: NOW.toISOString(),
          accessVerifiedAt: NOW.toISOString(),
        },
      ],
      [{ id: 'd', dependentId: 'fn', providerId: 'svc', type: 'requires' }],
    );
    const risk = assessEntityRiskById(buildIndex(graph), 'svc', 'single_system', NOW);
    expect(risk?.score).toBe(7); // arithmetic alone would land on HIGH
    expect(risk?.band).toBe('CRITICAL');
    expect(risk?.overrideRule).toContain('no proven recovery');
  });

  it('caps risk at LOW when nothing depends on the entity, however stale its records', () => {
    const graph = graphOf([{ id: 'v', kind: 'vendor', name: 'Unused supplier' }]);
    const risk = assessEntityRiskById(buildIndex(graph), 'v', 'single_vendor', NOW);
    expect(risk?.score).toBe(5); // arithmetic alone would land on MODERATE
    expect(risk?.band).toBe('LOW');
    expect(risk?.overrideRule).toContain('Nothing recorded depends on this');
  });

  it('adds a point for weaknesses that cannot be substituted at short notice', () => {
    const asPerson = assess('db-core', 'single_person');
    const asSystem = assess('db-core', 'single_system');
    expect(asPerson.score).toBe(asSystem.score + 1);
    expect(asPerson.reasons.some((r) => r.code === 'sharpness.kind')).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const a = assess('db-core', 'single_system');
    const b = assess('db-core', 'single_system');
    expect(a).toEqual(b);
  });

  it('returns null for an entity that does not exist', () => {
    expect(assessEntityRiskById(index, 'ghost', 'single_system', NOW)).toBeNull();
  });

  it('treats a stale test as unproven rather than as never tested', () => {
    const subject = index.entityById.get('app-payroll');
    if (subject === undefined) throw new Error('fixture missing app-payroll');
    const risk = assessEntityRisk({ index, subject, findingKind: 'single_system', now: NOW });
    const stale = risk.reasons.find((r) => r.code === 'recoverability.stale_test');
    expect(stale?.confidence).toBe('UNVERIFIED');
    expect(stale?.statement).toContain('500');
  });
});

describe('worstBand', () => {
  it('keeps the more severe of two bands', () => {
    expect(worstBand('LOW', 'HIGH')).toBe('HIGH');
    expect(worstBand('CRITICAL', 'MODERATE')).toBe('CRITICAL');
    expect(worstBand('LOW', 'LOW')).toBe('LOW');
  });
});
