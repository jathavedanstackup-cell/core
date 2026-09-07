/**
 * Audit trail, read side.
 *
 * Read-only by design: there is no endpoint that edits or deletes an audit
 * event, because a trail that can be rewritten is not a trail.
 */

import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { noStore, requireOrg } from '../plugins/context.js';

const orgParams = z.object({ orgId: z.string().uuid() });

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:orgId', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        /** Keyset pagination: pass the createdAt of the last row you saw. */
        before: z.string().datetime().optional(),
        entityType: z.string().trim().max(60).optional(),
      })
      .parse(request.query);

    // Reading the audit trail is a leadership concern, not a general one.
    await requireOrg(request, orgId, 'LEADER');
    noStore(reply);

    const clauses = [eq(auditEvents.orgId, orgId)];
    if (query.before !== undefined) {
      clauses.push(lt(auditEvents.createdAt, new Date(query.before)));
    }
    if (query.entityType !== undefined) {
      clauses.push(eq(auditEvents.entityType, query.entityType));
    }

    const rows = await getDb()
      .select()
      .from(auditEvents)
      .where(and(...clauses))
      .orderBy(desc(auditEvents.createdAt))
      .limit(query.limit);

    return {
      events: rows.map((row) => ({
        id: row.id,
        actor: row.actorEmail,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        before: row.before,
        after: row.after,
        createdAt: row.createdAt.toISOString(),
      })),
      nextBefore: rows.length === query.limit ? rows[rows.length - 1]?.createdAt.toISOString() : null,
    };
  });
}
