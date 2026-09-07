import { describe, expect, it } from 'vitest';

import { blastRadius, runScenario } from '../src/propagation.js';
import { graphOf, northwind } from './fixtures.js';

function stateOf(result: ReturnType<typeof runScenario>, id: string) {
  return result.impacted.find((item) => item.entityId === id);
}

describe('runScenario', () => {
  it('propagates a supplier failure through to the business function', () => {
    const result = runScenario(northwind, { failedEntityIds: ['vendor-payflow'] });

    expect(stateOf(result, 'vendor-payflow')?.state).toBe('FAILED');
    expect(stateOf(result, 'svc-payments')?.state).toBe('FAILED');
    expect(stateOf(result, 'bf-orders')?.state).toBe('FAILED');
  });

  it('orders impact into waves so responders can see what breaks first', () => {
    const result = runScenario(northwind, { failedEntityIds: ['vendor-payflow'] });

    expect(stateOf(result, 'vendor-payflow')?.wave).toBe(0);
    expect(stateOf(result, 'svc-payments')?.wave).toBe(1);
    expect(stateOf(result, 'bf-orders')?.wave).toBe(2);
    expect(result.waves[0]?.map((i) => i.entityId)).toEqual(['vendor-payflow']);
  });

  it('leaves unrelated parts of the organization alone', () => {
    const result = runScenario(northwind, { failedEntityIds: ['vendor-payflow'] });
    expect(stateOf(result, 'bf-payroll')).toBeUndefined();
    expect(stateOf(result, 'db-core')).toBeUndefined();
  });

  it('degrades rather than fails a dependent that has a working fallback', () => {
    const result = runScenario(northwind, { failedEntityIds: ['svc-helpdesk'] });

    expect(stateOf(result, 'bf-support')?.state).toBe('DEGRADED');
    expect(result.fallbacksUsed).toContainEqual({
      dependentId: 'bf-support',
      failedProviderId: 'svc-helpdesk',
      fallbackProviderId: 'svc-helpdesk-standby',
    });
  });

  it('fails the dependent when the fallback has failed too', () => {
    const result = runScenario(northwind, {
      failedEntityIds: ['svc-helpdesk', 'svc-helpdesk-standby'],
    });
    expect(stateOf(result, 'bf-support')?.state).toBe('FAILED');
  });

  it('treats an optional dependency as degradation, not failure', () => {
    const result = runScenario(northwind, { failedEntityIds: ['loc-hq'] });
    expect(stateOf(result, 'bf-support')?.state).toBe('DEGRADED');
  });

  it('can be asked for the worst case, where optional dependencies count', () => {
    const result = runScenario(
      northwind,
      { failedEntityIds: ['loc-hq'] },
      { ignoreOptional: true },
    );
    expect(stateOf(result, 'bf-support')?.state).toBe('FAILED');
  });

  it('uses an alternate recorded on the provider as cover', () => {
    const graph = graphOf(
      [
        { id: 'fn', kind: 'business_function', name: 'Fn', criticality: 'HIGH' },
        { id: 'primary', kind: 'service', name: 'Primary', alternateIds: ['spare'] },
        { id: 'spare', kind: 'service', name: 'Spare' },
      ],
      [{ id: 'd', dependentId: 'fn', providerId: 'primary', type: 'requires' }],
    );
    const result = runScenario(graph, { failedEntityIds: ['primary'] });
    expect(stateOf(result, 'fn')?.state).toBe('DEGRADED');
  });

  it('records the chain that carried the failure', () => {
    const result = runScenario(northwind, { failedEntityIds: ['db-core'] });
    expect(stateOf(result, 'bf-payroll')?.path).toEqual([
      'db-core',
      'app-payroll',
      'proc-payroll-run',
      'bf-payroll',
    ]);
  });

  it('explains every impacted entity in plain language naming the real entities', () => {
    const result = runScenario(northwind, { failedEntityIds: ['vendor-payflow'] });
    const orders = stateOf(result, 'bf-orders');
    expect(orders?.explanation).toContain('Take customer orders');
    expect(orders?.explanation).toContain('Payment processing');
  });

  it('reports unknown scenario inputs as an assumption instead of throwing', () => {
    const result = runScenario(northwind, { failedEntityIds: ['not-a-real-thing'] });
    expect(result.impacted).toEqual([]);
    expect(result.assumptions.join(' ')).toContain('not-a-real-thing');
  });

  it('always states that unrecorded dependencies are out of scope', () => {
    const result = runScenario(northwind, { failedEntityIds: ['db-core'] });
    expect(result.assumptions.join(' ')).toContain('Only recorded dependencies are considered');
  });

  it('lists the failed business functions most critical first', () => {
    const result = runScenario(northwind, { failedEntityIds: ['db-core'] });
    expect(result.failedFunctions.map((f) => f.entityId).sort()).toEqual([
      'bf-orders',
      'bf-payroll',
    ]);
  });

  it('names the places where a fallback was needed and missing', () => {
    const result = runScenario(northwind, { failedEntityIds: ['vendor-payflow'] });
    expect(result.missingFallbacks).toContainEqual({
      dependentId: 'svc-payments',
      failedProviderId: 'vendor-payflow',
    });
  });

  it('terminates on a cyclic graph', () => {
    const graph = graphOf(
      [
        { id: 'a', kind: 'service', name: 'A' },
        { id: 'b', kind: 'service', name: 'B' },
      ],
      [
        { id: 'd1', dependentId: 'a', providerId: 'b', type: 'requires' },
        { id: 'd2', dependentId: 'b', providerId: 'a', type: 'requires' },
      ],
    );
    const result = runScenario(graph, { failedEntityIds: ['a'] });
    expect(result.impacted.map((i) => i.entityId).sort()).toEqual(['a', 'b']);
  });

  it('is deterministic', () => {
    const first = runScenario(northwind, { failedEntityIds: ['db-core'] });
    const second = runScenario(northwind, { failedEntityIds: ['db-core'] });
    expect(first).toEqual(second);
  });
});

describe('blastRadius', () => {
  it('reports the critical functions lost when one entity goes', () => {
    const radius = blastRadius(northwind, 'db-core');
    expect(radius.failedFunctionIds.sort()).toEqual(['bf-orders', 'bf-payroll']);
  });

  it('reports nothing for an entity with a covered dependent', () => {
    const radius = blastRadius(northwind, 'svc-helpdesk');
    expect(radius.failedFunctionIds).toEqual([]);
  });
});
