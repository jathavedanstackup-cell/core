/**
 * Demo organization.
 *
 * A deliberately coherent mid-size company: enough structure that the analysis
 * has something real to say, small enough to read on one screen. Every weakness
 * in it is a genuine consequence of the recorded data, not a scripted result.
 *
 * Demo organizations are flagged `is_demo` and never mixed with real ones.
 */

import type { EntityKind } from '@core/engine';

export interface SeedEntity {
  ref: string;
  kind: EntityKind;
  name: string;
  description?: string;
  criticality?: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  ownerRef?: string;
  alternateRefs?: string[];
  procedureDocumented?: boolean;
  /** Days before "now". Converted to an instant at seed time. */
  lastTestedDaysAgo?: number;
  contactsVerifiedDaysAgo?: number;
  accessVerifiedDaysAgo?: number;
  mtdMinutes?: number;
  rtoMinutes?: number;
  rpoMinutes?: number;
}

export interface SeedDependency {
  ref: string;
  dependentRef: string;
  providerRef: string;
  type: 'requires' | 'operates' | 'hosts' | 'supplies' | 'staffs' | 'stores' | 'authenticates';
  optional?: boolean;
  fallbackProviderRefs?: string[];
}

export const DEMO_ORG_NAME = 'Meridian Logistics (Demo)';
export const DEMO_ORG_REGION = 'United Kingdom';

export const demoEntities: SeedEntity[] = [
  // People
  { ref: 'p-priya', kind: 'person', name: 'Priya Raman', contactsVerifiedDaysAgo: 14, accessVerifiedDaysAgo: 14 },
  { ref: 'p-tomas', kind: 'person', name: 'Tomas Weber', alternateRefs: ['p-lena'], contactsVerifiedDaysAgo: 9, accessVerifiedDaysAgo: 9 },
  { ref: 'p-lena', kind: 'person', name: 'Lena Fischer', contactsVerifiedDaysAgo: 9, accessVerifiedDaysAgo: 30 },
  { ref: 'p-david', kind: 'person', name: 'David Okonkwo', contactsVerifiedDaysAgo: 200, accessVerifiedDaysAgo: 240 },

  // Teams
  { ref: 'team-finance', kind: 'team', name: 'Finance', ownerRef: 'p-priya' },
  { ref: 'team-ops', kind: 'team', name: 'Operations', ownerRef: 'p-tomas' },

  // Business functions
  {
    ref: 'bf-dispatch',
    kind: 'business_function',
    name: 'Dispatch customer shipments',
    description: 'Accepting, routing and releasing shipments to carriers.',
    criticality: 'CRITICAL',
    ownerRef: 'p-tomas',
    mtdMinutes: 240,
    rtoMinutes: 120,
    rpoMinutes: 15,
    procedureDocumented: true,
    lastTestedDaysAgo: 45,
    contactsVerifiedDaysAgo: 45,
    accessVerifiedDaysAgo: 45,
  },
  {
    ref: 'bf-payroll',
    kind: 'business_function',
    name: 'Pay staff',
    description: 'Monthly payroll for 400 employees.',
    criticality: 'CRITICAL',
    ownerRef: 'p-priya',
    mtdMinutes: 4320,
    rtoMinutes: 2880,
    procedureDocumented: true,
    lastTestedDaysAgo: 500,
  },
  {
    ref: 'bf-invoicing',
    kind: 'business_function',
    name: 'Invoice customers',
    criticality: 'HIGH',
    ownerRef: 'p-priya',
    procedureDocumented: true,
    lastTestedDaysAgo: 120,
    contactsVerifiedDaysAgo: 60,
    accessVerifiedDaysAgo: 60,
  },
  {
    ref: 'bf-support',
    kind: 'business_function',
    name: 'Answer customer enquiries',
    criticality: 'MODERATE',
    ownerRef: 'p-lena',
    mtdMinutes: 960,
    rtoMinutes: 480,
    procedureDocumented: true,
    lastTestedDaysAgo: 60,
    contactsVerifiedDaysAgo: 60,
    accessVerifiedDaysAgo: 60,
  },

  // Processes
  {
    ref: 'proc-payroll-run',
    kind: 'process',
    name: 'Monthly payroll run',
    description: 'Collate hours, apply deductions, submit the bank file.',
    ownerRef: 'p-priya',
    procedureDocumented: false,
  },
  {
    ref: 'proc-route-planning',
    kind: 'process',
    name: 'Route planning',
    ownerRef: 'p-tomas',
    procedureDocumented: true,
    lastTestedDaysAgo: 40,
    contactsVerifiedDaysAgo: 40,
    accessVerifiedDaysAgo: 40,
  },

  // Systems
  {
    ref: 'app-tms',
    kind: 'application',
    name: 'Transport management system',
    ownerRef: 'p-tomas',
    procedureDocumented: true,
    lastTestedDaysAgo: 90,
    contactsVerifiedDaysAgo: 30,
    accessVerifiedDaysAgo: 30,
  },
  {
    ref: 'app-payroll',
    kind: 'application',
    name: 'Payroll system',
    ownerRef: 'p-priya',
    procedureDocumented: true,
    lastTestedDaysAgo: 620,
  },
  {
    ref: 'db-primary',
    kind: 'data_asset',
    name: 'Primary database cluster',
    ownerRef: 'p-david',
    procedureDocumented: true,
    lastTestedDaysAgo: 70,
    contactsVerifiedDaysAgo: 70,
    accessVerifiedDaysAgo: 70,
  },
  {
    ref: 'svc-identity',
    kind: 'service',
    name: 'Single sign-on',
    ownerRef: 'p-david',
    procedureDocumented: false,
  },
  {
    ref: 'svc-helpdesk',
    kind: 'service',
    name: 'Helpdesk platform',
    ownerRef: 'p-lena',
    alternateRefs: ['svc-helpdesk-fallback'],
    procedureDocumented: true,
    lastTestedDaysAgo: 25,
    contactsVerifiedDaysAgo: 25,
    accessVerifiedDaysAgo: 25,
  },
  {
    ref: 'svc-helpdesk-fallback',
    kind: 'service',
    name: 'Shared support mailbox',
    ownerRef: 'p-lena',
    procedureDocumented: true,
    lastTestedDaysAgo: 25,
  },

  // Suppliers
  { ref: 'vendor-payflow', kind: 'vendor', name: 'PayFlow (payments)', ownerRef: 'p-priya' },
  { ref: 'vendor-northbank', kind: 'vendor', name: 'Northbank', ownerRef: 'p-priya' },
  {
    ref: 'vendor-cloud',
    kind: 'vendor',
    name: 'Cloud hosting provider',
    ownerRef: 'p-david',
    procedureDocumented: true,
    lastTestedDaysAgo: 70,
    contactsVerifiedDaysAgo: 70,
    accessVerifiedDaysAgo: 70,
  },

  // Places
  { ref: 'loc-depot', kind: 'location', name: 'Midlands depot', ownerRef: 'p-tomas' },
  { ref: 'loc-office', kind: 'location', name: 'Head office', ownerRef: 'p-lena' },
];

export const demoDependencies: SeedDependency[] = [
  // Dispatch
  { ref: 'd-dispatch-route', dependentRef: 'bf-dispatch', providerRef: 'proc-route-planning', type: 'requires' },
  { ref: 'd-dispatch-depot', dependentRef: 'bf-dispatch', providerRef: 'loc-depot', type: 'requires' },
  { ref: 'd-route-tms', dependentRef: 'proc-route-planning', providerRef: 'app-tms', type: 'requires' },
  { ref: 'd-tms-db', dependentRef: 'app-tms', providerRef: 'db-primary', type: 'requires' },
  { ref: 'd-tms-sso', dependentRef: 'app-tms', providerRef: 'svc-identity', type: 'authenticates' },

  // Payroll — one person, one system, one supplier, nothing behind any of them.
  { ref: 'd-payroll-proc', dependentRef: 'bf-payroll', providerRef: 'proc-payroll-run', type: 'requires' },
  { ref: 'd-payrollproc-person', dependentRef: 'proc-payroll-run', providerRef: 'p-priya', type: 'staffs' },
  { ref: 'd-payrollproc-app', dependentRef: 'proc-payroll-run', providerRef: 'app-payroll', type: 'requires' },
  { ref: 'd-payrollapp-db', dependentRef: 'app-payroll', providerRef: 'db-primary', type: 'requires' },
  { ref: 'd-payrollproc-bank', dependentRef: 'proc-payroll-run', providerRef: 'vendor-northbank', type: 'supplies' },

  // Invoicing
  { ref: 'd-invoice-pay', dependentRef: 'bf-invoicing', providerRef: 'vendor-payflow', type: 'supplies' },
  { ref: 'd-invoice-db', dependentRef: 'bf-invoicing', providerRef: 'db-primary', type: 'requires' },

  // Support — genuinely covered, so it should degrade rather than stop.
  {
    ref: 'd-support-helpdesk',
    dependentRef: 'bf-support',
    providerRef: 'svc-helpdesk',
    type: 'requires',
    fallbackProviderRefs: ['svc-helpdesk-fallback'],
  },
  { ref: 'd-support-office', dependentRef: 'bf-support', providerRef: 'loc-office', type: 'requires', optional: true },

  // Infrastructure
  { ref: 'd-db-cloud', dependentRef: 'db-primary', providerRef: 'vendor-cloud', type: 'hosts' },
  { ref: 'd-sso-cloud', dependentRef: 'svc-identity', providerRef: 'vendor-cloud', type: 'hosts' },

  // Teams
  { ref: 'd-finance-priya', dependentRef: 'team-finance', providerRef: 'p-priya', type: 'staffs' },
  { ref: 'd-finance-lena', dependentRef: 'team-finance', providerRef: 'p-lena', type: 'staffs' },
  { ref: 'd-ops-tomas', dependentRef: 'team-ops', providerRef: 'p-tomas', type: 'staffs' },
  { ref: 'd-ops-david', dependentRef: 'team-ops', providerRef: 'p-david', type: 'staffs' },
];
