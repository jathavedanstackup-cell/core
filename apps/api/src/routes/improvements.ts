/**
 * The improvement register.
 *
 * An improvement answers "how do we make this less likely next time?", which is
 * a different question from an action's "how do we close this weakness now?".
 * Keeping them apart stops the action list — which should be short and current —
 * filling up with long-horizon work.
 */

import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { improvements } from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requireOrg } from '../plugins/context.js';

const orgParams = z.object({ orgId: z.string().uuid() });

const STATUSES = ['PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'] as const;
type Status = (typeof STATUSES)[number];

/** A proposal can be accepted or declined; work can start, finish, or stop. */
const ALLOWED: Readonly<Record<Status, readonly Status[]>> = Object.freeze({
  PROPOSED: ['ACCEPTED', 'DECLINED'],
  ACCEPTED: ['IN_PROGRESS', 'DECLINED'],
  IN_PROGRESS: ['COMPLETED', 'ACCEPTED', 'DECLINED'],
  COMPLETED: [],
  DECLINED: ['PROPOSED'],
});

function serialise(row: typeof improvements.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    rationale: row.rationale,
    expectedBenefit: row.expectedBenefit,
    verification: row.verification,
    priority: row.priority,
    status: row.status,
    ownerHint: row.ownerHint,
    sourceExerciseId: row.sourceExerciseId,
    sourceFindingRef: row.sourceFindingRef,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerImprovementRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:orgId', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    const query = z
      .object({ status: z.enum(STATUSES).optional() })
      .parse(request.query);
    await requireOrg(request, orgId);

    const where =
      query.status === undefined
        ? eq(improvements.orgId, orgId)
        : and(eq(improvements.orgId, orgId), eq(improvements.status, query.status));

    const rows = await getDb()
      .select()
      .from(improvements)
      .where(where)
      .orderBy(desc(improvements.createdAt))
      .limit(200);

    return {
      improvements: rows.map(serialise),
      counts: {
        total: rows.length,
        open: rows.filter((row) => row.status !== 'COMPLETED' && row.status !== 'DECLINED').length,
      },
    };
  });

  app.post('/:orgId', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const context = await requireOrg(request, orgId, 'OPERATOR');
    const input = z
      .object({
        title: z.string().trim().min(1).max(500),
        rationale: z.string().trim().max(4000).optional(),
        expectedBenefit: z.string().trim().max(2000).optional(),
        verification: z.string().trim().max(2000).optional(),
        priority: z.enum(['P1', 'P2', 'P3']).default('P2'),
        ownerHint: z.string().trim().max(200).optional(),
        sourceFindingRef: z.string().trim().max(300).optional(),
        dueAt: z.string().datetime().optional(),
      })
      .parse(request.body);

    const [created] = await getDb()
      .insert(improvements)
      .values({
        orgId,
        title: input.title,
        rationale: input.rationale ?? null,
        expectedBenefit: input.expectedBenefit ?? null,
        verification: input.verification ?? null,
        priority: input.priority,
        ownerHint: input.ownerHint ?? null,
        sourceFindingRef: input.sourceFindingRef ?? null,
        dueAt: input.dueAt === undefined ? null : new Date(input.dueAt),
        createdBy: context.user.id,
      })
      .returning();

    await recordAudit({
      orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'improvement',
      entityId: created?.id ?? null,
      action: 'create',
      after: { title: input.title, priority: input.priority },
      requestId: String(request.id),
    });

    void reply.status(201);
    return { improvement: created === undefined ? null : serialise(created) };
  });

  app.patch('/:orgId/:improvementId', async (request) => {
    const params = orgParams.extend({ improvementId: z.string().uuid() }).parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');
    const input = z
      .object({
        status: z.enum(STATUSES).optional(),
        priority: z.enum(['P1', 'P2', 'P3']).optional(),
        ownerHint: z.string().trim().max(200).optional(),
        dueAt: z.string().datetime().nullable().optional(),
      })
      .parse(request.body);

    const rows = await getDb()
      .select()
      .from(improvements)
      .where(
        and(eq(improvements.orgId, params.orgId), eq(improvements.id, params.improvementId)),
      )
      .limit(1);
    const before = rows[0];
    if (before === undefined) throw notFound('No such improvement in this organization.');

    if (input.status !== undefined && input.status !== before.status) {
      const allowed = ALLOWED[before.status as Status];
      if (!allowed.includes(input.status)) {
        throw badRequest(
          `An improvement that is ${before.status} cannot become ${input.status}.` +
            (allowed.length === 0 ? ' It is already finished.' : ` It can become: ${allowed.join(', ')}.`),
        );
      }
    }

    const becomingCompleted = input.status === 'COMPLETED' && before.status !== 'COMPLETED';

    const [updated] = await getDb()
      .update(improvements)
      .set({
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.ownerHint === undefined ? {} : { ownerHint: input.ownerHint }),
        ...(input.dueAt === undefined
          ? {}
          : { dueAt: input.dueAt === null ? null : new Date(input.dueAt) }),
        ...(becomingCompleted ? { completedAt: new Date() } : {}),
        ...(input.status !== undefined && input.status !== 'COMPLETED'
          ? { completedAt: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(improvements.id, before.id))
      .returning();

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'improvement',
      entityId: before.id,
      action: 'update',
      before: { status: before.status, priority: before.priority },
      after: { status: updated?.status, priority: updated?.priority },
      requestId: String(request.id),
    });

    return { improvement: updated === undefined ? null : serialise(updated) };
  });
}
