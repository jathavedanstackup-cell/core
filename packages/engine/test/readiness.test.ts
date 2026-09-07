import { describe, expect, it } from 'vitest';

import { assessOrganizationReadiness, assessReadiness } from '../src/readiness.js';
import { daysAgo, graphOf, northwind, NOW } from './fixtures.js';

function assess(entityId: string) {
  const result = assessReadiness(northwind, entityId, { now: NOW });
  if (result === null) throw new Error(`no readiness for ${entityId}`);
  return result;
}

describe('assessReadiness', () => {
  it('rates a well-run function with no alternative as PARTIAL', () => {
    const readiness = assess('bf-orders');
    expect(readiness.state).toBe('PARTIAL');
    expect(readiness.passedCount).toBe(9);
    expect(readiness.applicableCount).toBe(10);
    expect(readiness.summary).toContain('An alternative exists');
  });

  it('rates an undocumented, untested, unsubstitutable process as CRITICAL', () => {
    const readiness = assess('proc-payroll-run');
    expect(readiness.state).toBe('CRITICAL');
  });

  it('distinguishes "checked and no" from "nobody recorded an answer"', () => {
    const readiness = assess('proc-payroll-run');

    const procedure = readiness.checks.find((c) => c.code === 'procedure_exists');
    expect(procedure?.passed).toBe(false);
    expect(procedure?.unknown).toBe(false);
    expect(procedure?.detail).toContain('no written procedure');

    const tested = readiness.checks.find((c) => c.code === 'recently_tested');
    expect(tested?.unknown).toBe(true);
    expect(tested?.detail).toContain('no record');

    expect(readiness.unknownCount).toBeGreaterThan(0);
  });

  it('never counts an unknown as a pass', () => {
    const readiness = assess('proc-payroll-run');
    for (const check of readiness.checks) {
      if (check.unknown) expect(check.passed).toBe(false);
    }
  });

  it('omits checks that do not apply to the kind of entity', () => {
    const person = assess('p-asha');
    const codes = person.checks.map((c) => c.code);
    expect(codes).not.toContain('owner_exists');
    expect(codes).not.toContain('recovery_target_exists');
  });

  it('only asks a business function about recovery targets', () => {
    expect(assess('bf-orders').checks.map((c) => c.code)).toContain('recovery_target_exists');
    expect(assess('db-core').checks.map((c) => c.code)).not.toContain('recovery_target_exists');
  });

  it('fails a function whose recovery target exceeds what the business can tolerate', () => {
    const graph = graphOf([
      {
        id: 'fn',
        kind: 'business_function',
        name: 'Fn',
        criticality: 'HIGH',
        mtdMinutes: 60,
        rtoMinutes: 240,
      },
    ]);
    const readiness = assessReadiness(graph, 'fn', { now: NOW });
    const check = readiness?.checks.find((c) => c.code === 'recovery_target_achievable');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('exceeds');
  });

  it('reports READY only when every applicable check passes with nothing unknown', () => {
    const graph = graphOf(
      [
        { id: 'owner', kind: 'person', name: 'Owner', alternateIds: ['deputy'] },
        { id: 'deputy', kind: 'person', name: 'Deputy' },
        { id: 'dep', kind: 'service', name: 'Downstream' },
        {
          id: 'svc',
          kind: 'service',
          name: 'Well-run service',
          ownerId: 'owner',
          alternateIds: ['dep'],
          procedureDocumented: true,
          lastTestedAt: daysAgo(10),
          contactsVerifiedAt: daysAgo(10),
          accessVerifiedAt: daysAgo(10),
        },
      ],
      [{ id: 'd', dependentId: 'svc', providerId: 'dep', type: 'requires' }],
    );
    const readiness = assessReadiness(graph, 'svc', { now: NOW });
    expect(readiness?.state).toBe('READY');
    expect(readiness?.unknownCount).toBe(0);
  });

  it('forces CRITICAL when something important has no owner and no alternative', () => {
    const graph = graphOf(
      [
        { id: 'fn', kind: 'business_function', name: 'Fn', criticality: 'CRITICAL' },
        {
          id: 'svc',
          kind: 'service',
          name: 'Unowned but otherwise tidy',
          procedureDocumented: true,
          lastTestedAt: daysAgo(5),
          contactsVerifiedAt: daysAgo(5),
          accessVerifiedAt: daysAgo(5),
        },
      ],
      [{ id: 'd', dependentId: 'fn', providerId: 'svc', type: 'requires' }],
    );
    expect(assessReadiness(graph, 'svc', { now: NOW })?.state).toBe('CRITICAL');
  });

  it('returns null for an entity that does not exist', () => {
    expect(assessReadiness(northwind, 'ghost', { now: NOW })).toBeNull();
  });
});

describe('assessOrganizationReadiness', () => {
  it('covers every entity and lists the worst first', () => {
    const all = assessOrganizationReadiness(northwind, { now: NOW });
    expect(all).toHaveLength(northwind.entities.length);

    const rank = { CRITICAL: 0, AT_RISK: 1, PARTIAL: 2, READY: 3 } as const;
    for (let i = 1; i < all.length; i += 1) {
      const previous = all[i - 1];
      const current = all[i];
      if (previous === undefined || current === undefined) continue;
      expect(rank[previous.state]).toBeLessThanOrEqual(rank[current.state]);
    }
  });
});
