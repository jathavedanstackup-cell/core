/**
 * Incidents and their timelines.
 *
 * A timeline event records when the thing actually happened, which is often not
 * when somebody got round to typing it. Events are therefore ordered by
 * `occurredAt`, oldest first, and a late entry lands in its true place rather
 * than at the bottom.
 */

import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { incidentEvents, incidents, users } from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requireOrg } from '../plugins/context.js';

const orgParams = z.object({ orgId: z.string().uuid() });

const STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'CONTAINED',
  'RECOVERING',
  'RESOLVED',
  'CLOSED',
] as const;

const EVENT_KINDS = [
  'trigger',
  'detection',
  'decision',
  'action',
  'delay',
  'recovery',
  'verification',
  'note',
] as const;

function serialise(row: typeof incidents.$inferSelect) {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    affectedRefs: row.affectedEntityRefs,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Next reference for this organization, e.g. INC-0007. */
async function nextReference(orgId: string): Promise<string> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(incidents)
    .where(eq(incidents.orgId, orgId));
  const next = (row?.count ?? 0) + 1;
  return `INC-${String(next).padStart(4, '0')}`;
}

export async function registerIncidentRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  app.get('/:orgId', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    const query = z
      .object({
        status: z.enum(STATUSES).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    await requireOrg(request, orgId);

    const where =
      query.status === undefined
        ? eq(incidents.orgId, orgId)
        : and(eq(incidents.orgId, orgId), eq(incidents.status, query.status));

    const rows = await getDb()
      .select()
      .from(incidents)
      .where(where)
      .orderBy(desc(incidents.startedAt))
      .limit(query.limit);

    return {
      incidents: rows.map(serialise),
      counts: {
        total: rows.length,
        open: rows.filter((row) => row.status !== 'RESOLVED' && row.status !== 'CLOSED').length,
      },
    };
  });

  // -------------------------------------------------------------------------
  const createSchema = z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).optional(),
    severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']).default('SEV3'),
    startedAt: z.string().datetime().optional(),
    affectedRefs: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  });

  app.post('/:orgId', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const context = await requireOrg(request, orgId, 'OPERATOR');
    const input = createSchema.parse(request.body);

    const startedAt = input.startedAt === undefined ? new Date() : new Date(input.startedAt);
    if (startedAt.getTime() > Date.now() + 60_000) {
      throw badRequest('An incident cannot start in the future.');
    }

    const created = await getDb().transaction(async (tx) => {
      const reference = await nextReference(orgId);
      const [incident] = await tx
        .insert(incidents)
        .values({
          orgId,
          reference,
          title: input.title,
          description: input.description ?? null,
          severity: input.severity,
          startedAt,
          affectedEntityRefs: input.affectedRefs,
          ownerId: context.user.id,
          createdBy: context.user.id,
        })
        .returning();
      if (incident === undefined) throw new Error('incident insert returned nothing');

      // Every incident begins with the moment it began.
      await tx.insert(incidentEvents).values({
        orgId,
        incidentId: incident.id,
        kind: 'trigger',
        description: input.title,
        occurredAt: startedAt,
        actorId: context.user.id,
      });

      return incident;
    });

    await recordAudit({
      orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'incident',
      entityId: created.id,
      action: 'create',
      after: { reference: created.reference, severity: created.severity },
      requestId: String(request.id),
    });

    void reply.status(201);
    return { incident: serialise(created) };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId/:incidentId', async (request) => {
    const params = orgParams.extend({ incidentId: z.string().uuid() }).parse(request.params);
    await requireOrg(request, params.orgId);

    const rows = await getDb()
      .select()
      .from(incidents)
      .where(and(eq(incidents.orgId, params.orgId), eq(incidents.id, params.incidentId)))
      .limit(1);
    const incident = rows[0];
    if (incident === undefined) throw notFound('No such incident in this organization.');

    const events = await getDb()
      .select({ event: incidentEvents, actor: users })
      .from(incidentEvents)
      .leftJoin(users, eq(incidentEvents.actorId, users.id))
      .where(eq(incidentEvents.incidentId, incident.id))
      .orderBy(asc(incidentEvents.occurredAt), asc(incidentEvents.createdAt));

    return {
      incident: serialise(incident),
      timeline: events.map((row) => ({
        id: row.event.id,
        kind: row.event.kind,
        description: row.event.description,
        occurredAt: row.event.occurredAt.toISOString(),
        recordedAt: row.event.createdAt.toISOString(),
        actor: row.actor === null ? null : { id: row.actor.id, name: row.actor.name },
      })),
    };
  });

  // -------------------------------------------------------------------------
  app.patch('/:orgId/:incidentId', async (request) => {
    const params = orgParams.extend({ incidentId: z.string().uuid() }).parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');
    const input = z
      .object({
        status: z.enum(STATUSES).optional(),
        severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']).optional(),
        description: z.string().trim().max(4000).optional(),
      })
      .parse(request.body);

    const rows = await getDb()
      .select()
      .from(incidents)
      .where(and(eq(incidents.orgId, params.orgId), eq(incidents.id, params.incidentId)))
      .limit(1);
    const before = rows[0];
    if (before === undefined) throw notFound('No such incident in this organization.');

    const becomingResolved =
      (input.status === 'RESOLVED' || input.status === 'CLOSED') &&
      before.resolvedAt === null;

    const [updated] = await getDb()
      .update(incidents)
      .set({
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(becomingResolved ? { resolvedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(incidents.id, before.id))
      .returning();

    // A status change is itself part of the story, so it goes on the timeline.
    if (input.status !== undefined && input.status !== before.status) {
      await getDb().insert(incidentEvents).values({
        orgId: params.orgId,
        incidentId: before.id,
        kind: input.status === 'RESOLVED' || input.status === 'CLOSED' ? 'recovery' : 'decision',
        description: `Status changed from ${before.status} to ${input.status}.`,
        occurredAt: new Date(),
        actorId: context.user.id,
      });
    }

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'incident',
      entityId: before.id,
      action: 'update',
      before: { status: before.status, severity: before.severity },
      after: { status: updated?.status, severity: updated?.severity },
      requestId: String(request.id),
    });

    return { incident: updated === undefined ? null : serialise(updated) };
  });

  // -------------------------------------------------------------------------
  app.post('/:orgId/:incidentId/events', async (request, reply) => {
    const params = orgParams.extend({ incidentId: z.string().uuid() }).parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');
    const input = z
      .object({
        kind: z.enum(EVENT_KINDS),
        description: z.string().trim().min(1).max(2000),
        occurredAt: z.string().datetime().optional(),
      })
      .parse(request.body);

    const rows = await getDb()
      .select({ id: incidents.id, startedAt: incidents.startedAt })
      .from(incidents)
      .where(and(eq(incidents.orgId, params.orgId), eq(incidents.id, params.incidentId)))
      .limit(1);
    const incident = rows[0];
    if (incident === undefined) throw notFound('No such incident in this organization.');

    const occurredAt = input.occurredAt === undefined ? new Date() : new Date(input.occurredAt);
    if (occurredAt.getTime() < incident.startedAt.getTime() - 60_000) {
      throw badRequest('That is before the incident started. Check the time.');
    }

    const [created] = await getDb()
      .insert(incidentEvents)
      .values({
        orgId: params.orgId,
        incidentId: incident.id,
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
}
