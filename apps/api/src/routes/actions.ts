/**
 * Actions.
 *
 * Actions are real persisted records, not UI state. A status of COMPLETED
 * always carries the instant it completed — the database constraint enforces
 * that, so nothing in the system can claim success without a time behind it.
 */

import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { actions } from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requireOrg } from '../plugins/context.js';
import { solutionsForFinding } from '../services/orgGraph.js';

const orgParams = z.object({ orgId: z.string().uuid() });

const STATUSES = ['READY', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
type Status = (typeof STATUSES)[number];

/** Which transitions make sense. Guards against a client sending nonsense. */
const ALLOWED_TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = Object.freeze({
  READY: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  BLOCKED: ['READY', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['READY', 'IN_PROGRESS', 'CANCELLED'],
  CANCELLED: ['READY'],
});

function serialise(row: typeof actions.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    ownerHint: row.ownerHint,
    findingRef: row.findingRef,
    optionRef: row.optionRef,
    verification: row.verification,
    notes: row.notes,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerActionRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  app.get('/:orgId', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    const query = z
      .object({
        status: z.enum(STATUSES).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .parse(request.query);
    await requireOrg(request, orgId);

    const where =
      query.status === undefined
        ? eq(actions.orgId, orgId)
        : and(eq(actions.orgId, orgId), eq(actions.status, query.status));

    const rows = await getDb()
      .select()
      .from(actions)
      .where(where)
      .orderBy(desc(actions.createdAt))
      .limit(query.limit);

    const open = rows.filter((row) => row.status !== 'COMPLETED' && row.status !== 'CANCELLED');
    return {
      actions: rows.map(serialise),
      counts: { total: rows.length, open: open.length },
    };
  });

  // -------------------------------------------------------------------------
  const createSchema = z.object({
    title: z.string().trim().min(1).max(500),
    priority: z.enum(['P1', 'P2', 'P3']).default('P2'),
    ownerHint: z.string().trim().max(200).optional(),
    verification: z.string().trim().max(1000).optional(),
    notes: z.string().trim().max(4000).optional(),
    findingRef: z.string().trim().max(300).optional(),
    dueAt: z.string().datetime().optional(),
  });

  app.post('/:orgId', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const context = await requireOrg(request, orgId, 'OPERATOR');
    const input = createSchema.parse(request.body);

    const [created] = await getDb()
      .insert(actions)
      .values({
        orgId,
        title: input.title,
        priority: input.priority,
        ownerHint: input.ownerHint ?? null,
        verification: input.verification ?? null,
        notes: input.notes ?? null,
        findingRef: input.findingRef ?? null,
        dueAt: input.dueAt === undefined ? null : new Date(input.dueAt),
        createdBy: context.user.id,
      })
      .returning();

    await recordAudit({
      orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'action',
      entityId: created?.id ?? null,
      action: 'create',
      after: { title: input.title, priority: input.priority },
      requestId: String(request.id),
    });

    void reply.status(201);
    return { action: created === undefined ? null : serialise(created) };
  });

  // -------------------------------------------------------------------------
  /**
   * Turn a recommended solution into a tracked plan.
   *
   * The actions come from the engine's option, so what the user was shown and
   * what gets tracked cannot drift apart.
   */
  app.post('/:orgId/from-solution', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const context = await requireOrg(request, orgId, 'OPERATOR');
    const input = z
      .object({
        findingId: z.string().min(1).max(300),
        optionId: z.string().min(1).max(120).optional(),
      })
      .parse(request.body);

    const { solutions } = await solutionsForFinding(orgId, input.findingId);
    const optionId = input.optionId ?? solutions.recommendedOptionId;
    const option = solutions.options.find((candidate) => candidate.id === optionId);
    if (option === undefined) {
      throw badRequest(`That solution option is not part of this finding.`, {
        available: solutions.options.map((candidate) => candidate.id),
      });
    }

    const existing = await getDb()
      .select({ id: actions.id })
      .from(actions)
      .where(and(eq(actions.orgId, orgId), eq(actions.findingRef, input.findingId)));

    const created = await getDb()
      .insert(actions)
      .values(
        option.actions.map((template) => ({
          orgId,
          title: template.title,
          priority: template.priority,
          ownerHint: template.ownerHint,
          verification: template.verification,
          findingRef: input.findingId,
          optionRef: option.id,
          createdBy: context.user.id,
        })),
      )
      .returning();

    await recordAudit({
      orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'action_plan',
      entityId: input.findingId,
      action: 'create_from_solution',
      after: { optionId: option.id, actionsCreated: created.length },
      requestId: String(request.id),
    });

    void reply.status(201);
    return {
      option: { id: option.id, title: option.title, verification: option.verification },
      actions: created.map(serialise),
      note:
        existing.length > 0
          ? `${existing.length} action(s) already existed for this finding; these were added alongside them.`
          : undefined,
    };
  });

  // -------------------------------------------------------------------------
  app.patch('/:orgId/:actionId', async (request) => {
    const params = orgParams.extend({ actionId: z.string().uuid() }).parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');
    const input = z
      .object({
        status: z.enum(STATUSES).optional(),
        notes: z.string().trim().max(4000).optional(),
        priority: z.enum(['P1', 'P2', 'P3']).optional(),
        dueAt: z.string().datetime().nullable().optional(),
      })
      .parse(request.body);

    const rows = await getDb()
      .select()
      .from(actions)
      .where(and(eq(actions.orgId, params.orgId), eq(actions.id, params.actionId)))
      .limit(1);
    const before = rows[0];
    if (before === undefined) throw notFound('No such action in this organization.');

    if (input.status !== undefined && input.status !== before.status) {
      const allowed = ALLOWED_TRANSITIONS[before.status as Status];
      if (!allowed.includes(input.status)) {
        throw badRequest(
          `An action that is ${before.status} cannot become ${input.status}.` +
            (allowed.length === 0
              ? ' It is already finished.'
              : ` It can become: ${allowed.join(', ')}.`),
        );
      }
    }

    const becomingCompleted = input.status === 'COMPLETED' && before.status !== 'COMPLETED';

    const [updated] = await getDb()
      .update(actions)
      .set({
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.dueAt === undefined
          ? {}
          : { dueAt: input.dueAt === null ? null : new Date(input.dueAt) }),
        // Completion always records when. Reopening clears it again.
        ...(becomingCompleted ? { completedAt: new Date() } : {}),
        ...(input.status !== undefined && input.status !== 'COMPLETED'
          ? { completedAt: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(actions.id, before.id))
      .returning();

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'action',
      entityId: before.id,
      action: 'update',
      before: { status: before.status, priority: before.priority },
      after: { status: updated?.status, priority: updated?.priority },
      requestId: String(request.id),
    });

    return { action: updated === undefined ? null : serialise(updated) };
  });
}
