/**
 * Exercises.
 *
 * The flow is deliberately explicit: plan, start, record, complete. Starting is
 * what freezes the engine's expectation, so it cannot be run after the fact
 * against a model the exercise itself changed.
 */

import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import {
  entities as entityTable,
  exerciseEvents,
  exercises,
  improvements,
  users,
} from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { requireOrg } from '../plugins/context.js';
import { buildReview, expectedRecoveryMinutes } from '../services/exercises.js';
import { runOrganizationScenario } from '../services/orgGraph.js';

const orgParams = z.object({ orgId: z.string().uuid() });
const withId = orgParams.extend({ exerciseId: z.string().uuid() });

const EVENT_KINDS = [
  'injection',
  'decision',
  'action',
  'observation',
  'gap',
  'recovery',
  'note',
] as const;

function serialise(row: typeof exercises.$inferSelect) {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    objective: row.objective,
    scenarioRefs: row.scenarioRefs,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    expectedRecoveryMinutes: row.expectedRecoveryMinutes,
    actualRecoveryMinutes: row.actualRecoveryMinutes,
    hasReview: row.review !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function nextReference(orgId: string): Promise<string> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(exercises)
    .where(eq(exercises.orgId, orgId));
  return `EX-${String((row?.count ?? 0) + 1).padStart(4, '0')}`;
}

async function entityNameMap(orgId: string): Promise<Map<string, string>> {
  const rows = await getDb()
    .select({ ref: entityTable.ref, name: entityTable.name })
    .from(entityTable)
    .where(eq(entityTable.orgId, orgId));
  return new Map(rows.map((row) => [row.ref, row.name]));
}

export async function registerExerciseRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  app.get('/:orgId', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    await requireOrg(request, orgId);

    const rows = await getDb()
      .select()
      .from(exercises)
      .where(eq(exercises.orgId, orgId))
      .orderBy(desc(exercises.createdAt))
      .limit(100);

    return {
      exercises: rows.map(serialise),
      counts: {
        total: rows.length,
        running: rows.filter((row) => row.status === 'RUNNING').length,
        completed: rows.filter((row) => row.status === 'COMPLETED').length,
      },
    };
  });

  // -------------------------------------------------------------------------
  app.post('/:orgId', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const context = await requireOrg(request, orgId, 'OPERATOR');
    const input = z
      .object({
        title: z.string().trim().min(1).max(300),
        objective: z.string().trim().max(2000).optional(),
        scenarioRefs: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
      })
      .parse(request.body);

    const known = await entityNameMap(orgId);
    const unknown = input.scenarioRefs.filter((ref) => !known.has(ref));
    if (unknown.length === input.scenarioRefs.length) {
      throw badRequest('None of those are recorded in this organization.', { unknown });
    }

    const [created] = await getDb()
      .insert(exercises)
      .values({
        orgId,
        reference: await nextReference(orgId),
        title: input.title,
        objective: input.objective ?? null,
        scenarioRefs: input.scenarioRefs,
        ownerId: context.user.id,
        createdBy: context.user.id,
      })
      .returning();

    await recordAudit({
      orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'exercise',
      entityId: created?.id ?? null,
      action: 'create',
      after: { title: input.title, scenarioRefs: input.scenarioRefs },
      requestId: String(request.id),
    });

    void reply.status(201);
    return { exercise: created === undefined ? null : serialise(created) };
  });

  // -------------------------------------------------------------------------
  /**
   * Starting freezes the expectation. Everything the review later compares
   * against is captured here, once.
   */
  app.post('/:orgId/:exerciseId/start', async (request) => {
    const params = withId.parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');

    const rows = await getDb()
      .select()
      .from(exercises)
      .where(and(eq(exercises.orgId, params.orgId), eq(exercises.id, params.exerciseId)))
      .limit(1);
    const exercise = rows[0];
    if (exercise === undefined) throw notFound('No such exercise in this organization.');
    if (exercise.status !== 'PLANNED') {
      throw conflict(`This exercise is already ${exercise.status.toLowerCase()}.`);
    }

    const expected = await runOrganizationScenario(
      params.orgId,
      exercise.scenarioRefs,
      exercise.title,
    );

    const rtoRows = await getDb()
      .select({ ref: entityTable.ref, rto: entityTable.rtoMinutes })
      .from(entityTable)
      .where(eq(entityTable.orgId, params.orgId));
    const rtoByRef = new Map(rtoRows.map((row) => [row.ref, row.rto]));

    const startedAt = new Date();
    const [updated] = await getDb()
      .update(exercises)
      .set({
        status: 'RUNNING',
        startedAt,
        expectedResult: expected,
        expectedRecoveryMinutes: expectedRecoveryMinutes(expected, rtoByRef),
        updatedAt: new Date(),
      })
      .where(eq(exercises.id, exercise.id))
      .returning();

    // The starting condition belongs on the timeline like anything else.
    await getDb().insert(exerciseEvents).values({
      orgId: params.orgId,
      exerciseId: exercise.id,
      kind: 'injection',
      description: `Exercise started. Assumed unavailable: ${exercise.scenarioRefs.join(', ')}.`,
      occurredAt: startedAt,
      actorId: context.user.id,
    });

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'exercise',
      entityId: exercise.id,
      action: 'start',
      requestId: String(request.id),
    });

    return {
      exercise: updated === undefined ? null : serialise(updated),
      expected,
    };
  });

  // -------------------------------------------------------------------------
  app.post('/:orgId/:exerciseId/events', async (request, reply) => {
    const params = withId.parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');
    const input = z
      .object({
        kind: z.enum(EVENT_KINDS),
        description: z.string().trim().min(1).max(2000),
        occurredAt: z.string().datetime().optional(),
      })
      .parse(request.body);

    const rows = await getDb()
      .select({ id: exercises.id, status: exercises.status, startedAt: exercises.startedAt })
      .from(exercises)
      .where(and(eq(exercises.orgId, params.orgId), eq(exercises.id, params.exerciseId)))
      .limit(1);
    const exercise = rows[0];
    if (exercise === undefined) throw notFound('No such exercise in this organization.');
    if (exercise.status !== 'RUNNING') {
      throw conflict('Events can only be recorded while an exercise is running.');
    }

    const occurredAt = input.occurredAt === undefined ? new Date() : new Date(input.occurredAt);
    if (exercise.startedAt !== null && occurredAt.getTime() < exercise.startedAt.getTime() - 60_000) {
      throw badRequest('That is before the exercise started. Check the time.');
    }

    const [created] = await getDb()
      .insert(exerciseEvents)
      .values({
        orgId: params.orgId,
        exerciseId: exercise.id,
        kind: input.kind,
        description: input.description,
        occurredAt,
        actorId: context.user.id,
      })
      .returning();

    void reply.status(201);
    return {
      event:
        created === undefined
          ? null
          : {
              id: created.id,
              kind: created.kind,
              description: created.description,
              occurredAt: created.occurredAt.toISOString(),
            },
    };
  });

  // -------------------------------------------------------------------------
  app.post('/:orgId/:exerciseId/complete', async (request) => {
    const params = withId.parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');
    const input = z
      .object({ actualRecoveryMinutes: z.number().int().min(0).max(525_600).optional() })
      .parse(request.body ?? {});

    const rows = await getDb()
      .select()
      .from(exercises)
      .where(and(eq(exercises.orgId, params.orgId), eq(exercises.id, params.exerciseId)))
      .limit(1);
    const exercise = rows[0];
    if (exercise === undefined) throw notFound('No such exercise in this organization.');
    if (exercise.status !== 'RUNNING') {
      throw conflict('Only a running exercise can be completed.');
    }

    const endedAt = new Date();
    const events = await getDb()
      .select()
      .from(exerciseEvents)
      .where(eq(exerciseEvents.exerciseId, exercise.id))
      .orderBy(asc(exerciseEvents.occurredAt));

    const withTiming = {
      ...exercise,
      endedAt,
      actualRecoveryMinutes: input.actualRecoveryMinutes ?? exercise.actualRecoveryMinutes,
    };
    const review = buildReview(withTiming, events, await entityNameMap(params.orgId));

    const [updated] = await getDb()
      .update(exercises)
      .set({
        status: 'COMPLETED',
        endedAt,
        ...(input.actualRecoveryMinutes === undefined
          ? {}
          : { actualRecoveryMinutes: input.actualRecoveryMinutes }),
        review,
        updatedAt: new Date(),
      })
      .where(eq(exercises.id, exercise.id))
      .returning();

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'exercise',
      entityId: exercise.id,
      action: 'complete',
      after: { metTarget: review.timing.metTarget, gaps: review.whatDidNot.length },
      requestId: String(request.id),
    });

    return { exercise: updated === undefined ? null : serialise(updated), review };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId/:exerciseId', async (request) => {
    const params = withId.parse(request.params);
    await requireOrg(request, params.orgId);

    const rows = await getDb()
      .select()
      .from(exercises)
      .where(and(eq(exercises.orgId, params.orgId), eq(exercises.id, params.exerciseId)))
      .limit(1);
    const exercise = rows[0];
    if (exercise === undefined) throw notFound('No such exercise in this organization.');

    const events = await getDb()
      .select({ event: exerciseEvents, actor: users })
      .from(exerciseEvents)
      .leftJoin(users, eq(exerciseEvents.actorId, users.id))
      .where(eq(exerciseEvents.exerciseId, exercise.id))
      .orderBy(asc(exerciseEvents.occurredAt), asc(exerciseEvents.createdAt));

    return {
      exercise: serialise(exercise),
      expected: exercise.expectedResult,
      review: exercise.review,
      timeline: events.map((row) => ({
        id: row.event.id,
        kind: row.event.kind,
        description: row.event.description,
        occurredAt: row.event.occurredAt.toISOString(),
        actor: row.actor === null ? null : { id: row.actor.id, name: row.actor.name },
      })),
    };
  });

  // -------------------------------------------------------------------------
  /**
   * Accept the review's recommendations into the improvement register.
   *
   * Deliberately a separate, explicit step: a review proposes, a person decides.
   */
  app.post('/:orgId/:exerciseId/improvements', async (request, reply) => {
    const params = withId.parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');

    const rows = await getDb()
      .select()
      .from(exercises)
      .where(and(eq(exercises.orgId, params.orgId), eq(exercises.id, params.exerciseId)))
      .limit(1);
    const exercise = rows[0];
    if (exercise === undefined) throw notFound('No such exercise in this organization.');

    const review = exercise.review as { recommendedImprovements?: unknown } | null;
    const proposed = Array.isArray(review?.recommendedImprovements)
      ? (review.recommendedImprovements as {
          title: string;
          rationale: string;
          expectedBenefit: string;
          verification: string;
          priority: 'P1' | 'P2' | 'P3';
        }[])
      : [];

    if (proposed.length === 0) {
      throw badRequest('This exercise has no recommended improvements to accept.');
    }

    const created = await getDb()
      .insert(improvements)
      .values(
        proposed.map((item) => ({
          orgId: params.orgId,
          title: item.title,
          rationale: item.rationale,
          expectedBenefit: item.expectedBenefit,
          verification: item.verification,
          priority: item.priority,
          sourceExerciseId: exercise.id,
          createdBy: context.user.id,
        })),
      )
      .returning();

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'improvement',
      entityId: exercise.id,
      action: 'accept_from_exercise',
      after: { count: created.length },
      requestId: String(request.id),
    });

    void reply.status(201);
    return { created: created.length };
  });
}
