/**
 * Assessment, solutions and scenarios.
 *
 * Every number here comes from the engine reading the organization's own data.
 * Nothing is cached across requests: an assessment always reflects the model as
 * it stands right now, and a stored scenario run keeps the result it produced
 * at the time so a past run can be reopened unchanged.
 */

import { groupByTier } from '@core/engine';
import type { FastifyInstance } from 'fastify';
import { desc, eq, and } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { entities as entityTable, scenarioRuns } from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { noStore, requireOrg } from '../plugins/context.js';
import {
  assessOrganization,
  readinessFor,
  runOrganizationScenario,
  solutionsForFinding,
} from '../services/orgGraph.js';

const orgParams = z.object({ orgId: z.string().uuid() });

export async function registerAssessmentRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  app.get('/:orgId/assessment', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    await requireOrg(request, orgId);
    noStore(reply);

    const { findings, prioritized, dataIssues, graph } = await assessOrganization(orgId);
    const tiers = groupByTier(prioritized);

    return {
      generatedAt: new Date().toISOString(),
      model: {
        entityCount: graph.entities.length,
        dependencyCount: graph.dependencies.length,
      },
      summary: {
        total: findings.length,
        critical: findings.filter((f) => f.risk.band === 'CRITICAL').length,
        high: findings.filter((f) => f.risk.band === 'HIGH').length,
        moderate: findings.filter((f) => f.risk.band === 'MODERATE').length,
        low: findings.filter((f) => f.risk.band === 'LOW').length,
      },
      tiers: {
        FIX_FIRST: tiers.FIX_FIRST.map(serialisePrioritized),
        FIX_NEXT: tiers.FIX_NEXT.map(serialisePrioritized),
        MONITOR: tiers.MONITOR.map(serialisePrioritized),
      },
      dataIssues,
    };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId/readiness', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    await requireOrg(request, orgId);
    noStore(reply);

    const assessments = await readinessFor(orgId);
    const counts = {
      READY: 0,
      PARTIAL: 0,
      AT_RISK: 0,
      CRITICAL: 0,
    };
    for (const item of assessments) counts[item.state] += 1;

    return { counts, assessments };
  });

  // -------------------------------------------------------------------------
  // The finding id contains a colon, so it travels as a query parameter rather
  // than a path segment.
  app.get('/:orgId/solutions', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const { finding: findingId } = z
      .object({ finding: z.string().min(1).max(300) })
      .parse(request.query);
    await requireOrg(request, orgId);
    noStore(reply);

    const { finding, solutions } = await solutionsForFinding(orgId, findingId);
    return { finding, solutions };
  });

  // -------------------------------------------------------------------------
  const scenarioSchema = z.object({
    failedRefs: z.array(z.string().min(1).max(120)).min(1, 'Choose at least one thing to fail.').max(50),
    description: z.string().trim().max(500).optional(),
  });

  app.post('/:orgId/scenarios', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const context = await requireOrg(request, orgId, 'OPERATOR');
    const input = scenarioSchema.parse(request.body);

    const known = await getDb()
      .select({ ref: entityTable.ref, name: entityTable.name })
      .from(entityTable)
      .where(eq(entityTable.orgId, orgId));
    const nameByRef = new Map(known.map((row) => [row.ref, row.name]));

    const unknown = input.failedRefs.filter((ref) => !nameByRef.has(ref));
    if (unknown.length === input.failedRefs.length) {
      throw badRequest(
        'None of those are recorded in this organization, so there is nothing to analyse.',
        { unknown },
      );
    }

    const description =
      input.description ??
      `What happens if ${input.failedRefs.map((ref) => nameByRef.get(ref) ?? ref).join(', ')} becomes unavailable?`;

    const result = await runOrganizationScenario(orgId, input.failedRefs, description);

    const [saved] = await getDb()
      .insert(scenarioRuns)
      .values({
        orgId,
        createdBy: context.user.id,
        description,
        failedEntityRefs: input.failedRefs,
        result,
      })
      .returning();

    await recordAudit({
      orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'scenario_run',
      entityId: saved?.id ?? null,
      action: 'run',
      after: { failedRefs: input.failedRefs },
      requestId: String(request.id),
    });

    void reply.status(201);
    return {
      run: {
        id: saved?.id,
        description,
        createdAt: saved?.createdAt.toISOString(),
      },
      result,
    };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId/scenarios', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(request.query);
    await requireOrg(request, orgId);

    const rows = await getDb()
      .select({
        id: scenarioRuns.id,
        description: scenarioRuns.description,
        failedEntityRefs: scenarioRuns.failedEntityRefs,
        createdAt: scenarioRuns.createdAt,
      })
      .from(scenarioRuns)
      .where(eq(scenarioRuns.orgId, orgId))
      .orderBy(desc(scenarioRuns.createdAt))
      .limit(limit);

    return {
      runs: rows.map((row) => ({
        id: row.id,
        description: row.description,
        failedRefs: row.failedEntityRefs,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId/scenarios/:runId', async (request) => {
    const params = orgParams.extend({ runId: z.string().uuid() }).parse(request.params);
    await requireOrg(request, params.orgId);

    const rows = await getDb()
      .select()
      .from(scenarioRuns)
      .where(and(eq(scenarioRuns.orgId, params.orgId), eq(scenarioRuns.id, params.runId)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) throw notFound('No such scenario run in this organization.');

    return {
      run: {
        id: row.id,
        description: row.description,
        failedRefs: row.failedEntityRefs,
        createdAt: row.createdAt.toISOString(),
      },
      result: row.result,
    };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId/search', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    const { q } = z.object({ q: z.string().trim().min(1).max(200) }).parse(request.query);
    await requireOrg(request, orgId);

    const rows = await getDb().select().from(entityTable).where(eq(entityTable.orgId, orgId));
    const needle = q.toLowerCase();

    const matches = rows
      .filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          row.ref.toLowerCase().includes(needle) ||
          (row.description ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 50)
      .map((row) => ({
        ref: row.ref,
        kind: row.kind,
        name: row.name,
        criticality: row.criticality,
      }));

    return { query: q, matches };
  });
}

function serialisePrioritized(item: {
  finding: { id: string; kind: string; subjectName: string; subjectKind: string; summary: string; risk: unknown; criticalDependentIds: readonly string[] };
  tier: string;
  rationale: string;
}) {
  return {
    id: item.finding.id,
    kind: item.finding.kind,
    subjectName: item.finding.subjectName,
    subjectKind: item.finding.subjectKind,
    summary: item.finding.summary,
    risk: item.finding.risk,
    criticalDependents: item.finding.criticalDependentIds.length,
    tier: item.tier,
    rationale: item.rationale,
  };
}
