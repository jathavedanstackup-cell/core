import { describe, expect, it } from 'vitest';

import { detectFindings } from '../src/findings.js';
import { buildIndex } from '../src/graph.js';
import { generateSolutions } from '../src/solutions.js';
import { graphOf, northwind, NOW } from './fixtures.js';
import type { Finding } from '../src/types.js';

const index = buildIndex(northwind);
const findings = detectFindings(northwind, { now: NOW });

function findingById(id: string): Finding {
  const finding = findings.find((f) => f.id === id);
  if (finding === undefined) throw new Error(`fixture produced no finding "${id}"`);
  return finding;
}

describe('generateSolutions', () => {
  it('names the actual colleague who could be cross-trained', () => {
    const solutions = generateSolutions(index, findingById('single_person:p-asha'));
    const crossTrain = solutions.options.find((o) => o.id === 'cross_train');
    expect(crossTrain).toBeDefined();
    expect(crossTrain?.title).toContain('Cara Lindqvist');
    expect(crossTrain?.title).toContain('Asha Rao');
  });

  it('does not offer cross-training when the organization has no colleague to train', () => {
    const graph = graphOf(
      [
        { id: 'fn', kind: 'business_function', name: 'Fn', criticality: 'CRITICAL' },
        { id: 'solo', kind: 'person', name: 'Solo Operator' },
      ],
      [{ id: 'd', dependentId: 'fn', providerId: 'solo', type: 'staffs' }],
    );
    const soloIndex = buildIndex(graph);
    const soloFinding = detectFindings(graph, { now: NOW }).find(
      (f) => f.id === 'single_person:solo',
    );
    if (soloFinding === undefined) throw new Error('expected a single_person finding');

    const solutions = generateSolutions(soloIndex, soloFinding);
    expect(solutions.options.map((o) => o.id)).not.toContain('cross_train');
    // It must still offer something actionable rather than nothing.
    expect(solutions.options.length).toBeGreaterThan(0);
  });

  it('prefers the cheapest option among those that remove the most risk', () => {
    const solutions = generateSolutions(index, findingById('single_person:p-asha'));
    // Cross-training and automation both score 3; cross-training costs far less.
    expect(solutions.recommendedOptionId).toBe('cross_train');
    expect(solutions.recommendationRationale).toContain('costs the least');
  });

  it('mentions a supplier the organization already works with', () => {
    const solutions = generateSolutions(index, findingById('single_vendor:vendor-payflow'));
    const secondSource = solutions.options.find((o) => o.id === 'second_source');
    expect(secondSource?.description).toContain('BillWise');
  });

  it('states why the recommendation was chosen, not just what it is', () => {
    const solutions = generateSolutions(index, findingById('single_vendor:vendor-payflow'));
    expect(solutions.recommendationRationale.length).toBeGreaterThan(20);
    expect(solutions.recommendedOptionId).toBe('second_source');
  });

  it('explains why the problem matters in business terms', () => {
    const solutions = generateSolutions(index, findingById('single_system:db-core'));
    expect(solutions.whyItMatters).toContain('business function');
    expect(solutions.whyItMatters).toMatch(/Pay staff|Take customer orders/);
  });

  it('gives every option trade-offs, at least one action, and a way to verify it worked', () => {
    for (const finding of findings) {
      const solutions = generateSolutions(index, finding);
      expect(solutions.options.length).toBeGreaterThan(0);
      for (const option of solutions.options) {
        expect(option.actions.length).toBeGreaterThan(0);
        expect(option.verification.length).toBeGreaterThan(0);
        expect(option.tradeOffs.cost).toBeDefined();
        expect(option.riskReduction).toBeGreaterThanOrEqual(0);
        for (const action of option.actions) {
          expect(action.title.length).toBeGreaterThan(0);
          expect(action.ownerHint.length).toBeGreaterThan(0);
          expect(action.verification.length).toBeGreaterThan(0);
        }
      }
      const recommended = solutions.options.find(
        (o) => o.id === solutions.recommendedOptionId,
      );
      expect(recommended).toBeDefined();
    }
  });

  it('produces a different shape of answer for different kinds of problem', () => {
    const person = generateSolutions(index, findingById('single_person:p-asha'));
    const vendor = generateSolutions(index, findingById('single_vendor:vendor-payflow'));
    const target = generateSolutions(index, findingById('missing_recovery_target:bf-support'));

    expect(person.options.map((o) => o.id)).not.toEqual(vendor.options.map((o) => o.id));
    expect(target.options.map((o) => o.id)).toEqual(['agree_targets']);
  });

  it('orders options with the most effective first', () => {
    const solutions = generateSolutions(index, findingById('single_system:db-core'));
    for (let i = 1; i < solutions.options.length; i += 1) {
      const previous = solutions.options[i - 1];
      const current = solutions.options[i];
      if (previous === undefined || current === undefined) continue;
      expect(previous.riskReduction).toBeGreaterThanOrEqual(current.riskReduction);
    }
  });

  it('refuses to invent a subject that is not in the organization', () => {
    const ghost: Finding = {
      ...findingById('single_person:p-asha'),
      subjectId: 'ghost',
    };
    expect(() => generateSolutions(index, ghost)).toThrow(/unknown entity/);
  });

  it('is deterministic', () => {
    const first = generateSolutions(index, findingById('single_person:p-asha'));
    const second = generateSolutions(index, findingById('single_person:p-asha'));
    expect(first).toEqual(second);
  });
});
