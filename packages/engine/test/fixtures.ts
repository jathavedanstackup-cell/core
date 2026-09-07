/**
 * A small but realistic organization used across the engine tests.
 *
 * It is deliberately shaped to contain the situations the product claims to
 * detect: a person nobody can cover, a supplier with no second source, a
 * database two systems sit on, a service that does have a fallback, and some
 * paperwork that is merely out of date rather than missing.
 */

import type { Dependency, Entity, OrganizationGraph } from '../src/types.js';

/** All time-dependent assertions are made against this instant. */
export const NOW = new Date('2026-09-07T00:00:00.000Z');

/** Helper to express "n days before NOW" as an ISO string. */
export function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

const entities: Entity[] = [
  // --- people ---------------------------------------------------------------
  {
    id: 'p-asha',
    kind: 'person',
    name: 'Asha Rao',
    contactsVerifiedAt: daysAgo(20),
    accessVerifiedAt: daysAgo(20),
  },
  {
    id: 'p-cara',
    kind: 'person',
    name: 'Cara Lindqvist',
    contactsVerifiedAt: daysAgo(20),
    accessVerifiedAt: daysAgo(20),
  },
  {
    id: 'p-ben',
    kind: 'person',
    name: 'Ben Osei',
    alternateIds: ['p-cara'],
    contactsVerifiedAt: daysAgo(10),
    accessVerifiedAt: daysAgo(10),
  },

  // --- teams ----------------------------------------------------------------
  { id: 'team-finance', kind: 'team', name: 'Finance', ownerId: 'p-asha' },

  // --- business functions ---------------------------------------------------
  {
    id: 'bf-payroll',
    kind: 'business_function',
    name: 'Pay staff',
    criticality: 'CRITICAL',
    ownerId: 'p-asha',
    mtdMinutes: 2880,
    rtoMinutes: 1440,
    procedureDocumented: true,
    lastTestedAt: daysAgo(400),
  },
  {
    id: 'bf-orders',
    kind: 'business_function',
    name: 'Take customer orders',
    criticality: 'CRITICAL',
    ownerId: 'p-ben',
    mtdMinutes: 240,
    rtoMinutes: 120,
    procedureDocumented: true,
    lastTestedAt: daysAgo(30),
    contactsVerifiedAt: daysAgo(30),
    accessVerifiedAt: daysAgo(30),
  },
  {
    // HIGH criticality with no recovery targets recorded at all.
    id: 'bf-support',
    kind: 'business_function',
    name: 'Answer customer support',
    criticality: 'HIGH',
    ownerId: 'p-ben',
    procedureDocumented: true,
  },

  // --- processes, systems, suppliers ---------------------------------------
  {
    id: 'proc-payroll-run',
    kind: 'process',
    name: 'Monthly payroll run',
    ownerId: 'p-asha',
    procedureDocumented: false,
  },
  {
    id: 'app-payroll',
    kind: 'application',
    name: 'Payroll system',
    ownerId: 'p-asha',
    procedureDocumented: true,
    lastTestedAt: daysAgo(500),
  },
  {
    id: 'db-core',
    kind: 'data_asset',
    name: 'Core database',
    ownerId: 'p-ben',
    procedureDocumented: true,
    lastTestedAt: daysAgo(45),
    contactsVerifiedAt: daysAgo(45),
    accessVerifiedAt: daysAgo(45),
  },
  {
    id: 'svc-payments',
    kind: 'service',
    name: 'Payment processing',
    ownerId: 'p-ben',
    procedureDocumented: true,
    lastTestedAt: daysAgo(60),
  },
  {
    id: 'vendor-payflow',
    kind: 'vendor',
    name: 'PayFlow',
    ownerId: 'p-ben',
  },
  {
    // A second supplier exists in the organization but nothing is wired to it,
    // which is exactly the situation the vendor solution builder should notice.
    id: 'vendor-billwise',
    kind: 'vendor',
    name: 'BillWise',
    ownerId: 'p-ben',
  },
  {
    id: 'svc-helpdesk',
    kind: 'service',
    name: 'Helpdesk platform',
    ownerId: 'p-ben',
    procedureDocumented: true,
    lastTestedAt: daysAgo(15),
    contactsVerifiedAt: daysAgo(15),
    accessVerifiedAt: daysAgo(15),
  },
  {
    id: 'svc-helpdesk-standby',
    kind: 'service',
    name: 'Helpdesk standby',
    ownerId: 'p-ben',
    procedureDocumented: true,
    lastTestedAt: daysAgo(15),
  },

  // --- places ---------------------------------------------------------------
  { id: 'loc-hq', kind: 'location', name: 'Head office', ownerId: 'p-ben' },
];

const dependencies: Dependency[] = [
  // Paying staff needs the payroll run, which needs the system and Asha.
  { id: 'd1', dependentId: 'bf-payroll', providerId: 'proc-payroll-run', type: 'requires' },
  { id: 'd2', dependentId: 'proc-payroll-run', providerId: 'app-payroll', type: 'requires' },
  { id: 'd3', dependentId: 'proc-payroll-run', providerId: 'p-asha', type: 'staffs' },
  { id: 'd4', dependentId: 'app-payroll', providerId: 'db-core', type: 'requires' },

  // Orders need payments, which come from a single supplier.
  { id: 'd5', dependentId: 'bf-orders', providerId: 'svc-payments', type: 'requires' },
  { id: 'd6', dependentId: 'svc-payments', providerId: 'vendor-payflow', type: 'supplies' },
  { id: 'd7', dependentId: 'svc-payments', providerId: 'db-core', type: 'requires' },

  // Support has a genuine fallback, so it should survive losing the helpdesk.
  {
    id: 'd8',
    dependentId: 'bf-support',
    providerId: 'svc-helpdesk',
    type: 'requires',
    fallbackProviderIds: ['svc-helpdesk-standby'],
  },

  // The finance team is made of Asha and Cara.
  { id: 'd9', dependentId: 'team-finance', providerId: 'p-asha', type: 'staffs' },
  { id: 'd10', dependentId: 'team-finance', providerId: 'p-cara', type: 'staffs' },

  // The office is nice to have for support, but not required.
  { id: 'd11', dependentId: 'bf-support', providerId: 'loc-hq', type: 'requires', optional: true },
];

export const northwind: OrganizationGraph = { entities, dependencies };

/** A minimal graph for tests that need a specific shape. */
export function graphOf(
  entityList: readonly Entity[],
  dependencyList: readonly Dependency[] = [],
): OrganizationGraph {
  return { entities: entityList, dependencies: dependencyList };
}
