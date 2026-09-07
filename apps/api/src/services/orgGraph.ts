/**
 * Bridge between stored rows and the engine's organization graph.
 *
 * The engine works in terms of stable `ref` strings rather than database UUIDs,
 * so that a finding id such as `single_person:p-asha` stays meaningful in a
 * report, in an action record, and to a person reading it.
 */

import {
  detectFindings,
  buildIndex,
  generateSolutions,
  prioritize,
  assessOrganizationReadiness,
  validateGraph,
  runScenario,
  type Criticality,
  type Entity,
  type Dependency,
  type Finding,
  type GraphIndex,
  type OrganizationGraph,
  type PrioritizedFinding,
  type ScenarioResult,
  type SolutionSet,
} from '@core/engine';
import { eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { dependencies as dependencyTable, entities as entityTable } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * Load one organization as an engine graph.
 *
 * Owner references are translated from database ids back to refs so that the
 * engine and the API speak the same language throughout.
 */
export async function loadOrganizationGraph(orgId: string): Promise<OrganizationGraph> {
  const db = getDb();

  const [entityRows, dependencyRows] = await Promise.all([
    db.select().from(entityTable).where(eq(entityTable.orgId, orgId)),
    db.select().from(dependencyTable).where(eq(dependencyTable.orgId, orgId)),
  ]);

  const refById = new Map(entityRows.map((row) => [row.id, row.ref]));

  const entities: Entity[] = entityRows.map((row) => ({
    id: row.ref,
    kind: row.kind as Entity['kind'],
    name: row.name,
    ...(row.criticality === null ? {} : { criticality: row.criticality as Criticality }),
    ownerId: row.ownerId === null ? null : (refById.get(row.ownerId) ?? null),
    alternateIds: row.alternateIds,
    ...(row.procedureDocumented === null ? {} : { procedureDocumented: row.procedureDocumented }),
    lastTestedAt: toIso(row.lastTestedAt),
    contactsVerifiedAt: toIso(row.contactsVerifiedAt),
    accessVerifiedAt: toIso(row.accessVerifiedAt),
    mtdMinutes: row.mtdMinutes,
    rtoMinutes: row.rtoMinutes,
    rpoMinutes: row.rpoMinutes,
    tags: row.tags,
  }));

  const deps: Dependency[] = dependencyRows.map((row) => ({
    id: row.ref,
    dependentId: row.dependentRef,
    providerId: row.providerRef,
    type: row.type as Dependency['type'],
    optional: row.optional,
    fallbackProviderIds: row.fallbackProviderRefs,
    toleranceMinutes: row.toleranceMinutes,
  }));

  return { entities, dependencies: deps };
}

export interface Assessment {
  readonly graph: OrganizationGraph;
  readonly index: GraphIndex;
  readonly findings: readonly Finding[];
  readonly prioritized: readonly PrioritizedFinding[];
  readonly dataIssues: ReturnType<typeof validateGraph>;
}

/**
 * The standard analysis pass.
 *
 * `now` is threaded through so that a caller can reproduce a past assessment,
 * and so tests do not depend on the wall clock.
 */
export async function assessOrganization(orgId: string, now = new Date()): Promise<Assessment> {
  const graph = await loadOrganizationGraph(orgId);
  const index = buildIndex(graph);
  const findings = detectFindings(graph, { now });
  const prioritized = prioritize(index, findings);
  const dataIssues = validateGraph(graph);
  return { graph, index, findings, prioritized, dataIssues };
}

export async function readinessFor(orgId: string, now = new Date()) {
  const graph = await loadOrganizationGraph(orgId);
  return assessOrganizationReadiness(graph, { now });
}

export async function solutionsForFinding(
  orgId: string,
  findingId: string,
  now = new Date(),
): Promise<{ finding: Finding; solutions: SolutionSet }> {
  const { index, findings } = await assessOrganization(orgId, now);
  const finding = findings.find((item) => item.id === findingId);
  if (finding === undefined) {
    throw notFound('That finding is not present in the current assessment.');
  }
  return { finding, solutions: generateSolutions(index, finding) };
}

export async function runOrganizationScenario(
  orgId: string,
  failedRefs: readonly string[],
  description: string,
): Promise<ScenarioResult> {
  const graph = await loadOrganizationGraph(orgId);
  return runScenario(graph, { failedEntityIds: failedRefs, description });
}
