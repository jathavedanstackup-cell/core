/**
 * Organizations and membership.
 *
 * Creating an organization makes the creator its ADMIN. There is no default
 * organization and no hard-coded company: a fresh deployment contains nothing
 * until somebody creates something.
 */

import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { loadConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { memberships, organizations, users } from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { listMemberships, requireOrg, requireVerifiedUser } from '../plugins/context.js';
import { DEMO_ORG_NAME, DEMO_ORG_REGION, demoDependencies, demoEntities } from '../services/demo.js';
import { seedModel } from '../services/seed.js';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the organization a name.').max(200),
  primaryRegion: z.string().trim().max(200).optional(),
  timezone: z.string().trim().max(64).default('UTC'),
  /**
   * The setup form asks for a few important areas of the business. Each becomes
   * a business function the user can then build out; nothing else is invented.
   */
  importantAreas: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
});

function slugify(value: string, index: number): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length > 0 ? `bf-${base}` : `bf-area-${index + 1}`;
}

export async function registerOrganizationRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig();

  // -------------------------------------------------------------------------
  app.get('/', async (request) => {
    const user = requireVerifiedUser(request);
    const owned = await listMemberships(user.id);
    return {
      organizations: owned.map(({ org, role }) => ({
        id: org.id,
        name: org.name,
        primaryRegion: org.primaryRegion,
        isDemo: org.isDemo,
        timezone: org.timezone,
        role,
        createdAt: org.createdAt.toISOString(),
      })),
    };
  });

  // -------------------------------------------------------------------------
  app.post('/', async (request, reply) => {
    const user = requireVerifiedUser(request);
    const input = createSchema.parse(request.body);

    const created = await getDb().transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: input.name,
          primaryRegion: input.primaryRegion ?? null,
          timezone: input.timezone,
          isDemo: false,
        })
        .returning();

      if (org === undefined) throw new Error('organization insert returned nothing');

      await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: 'ADMIN' });

      // Turn the named areas into business functions, deduplicating refs.
      const seen = new Set<string>();
      const seeds = input.importantAreas.map((area, index) => {
        let ref = slugify(area, index);
        let suffix = 2;
        while (seen.has(ref)) ref = `${slugify(area, index)}-${suffix++}`;
        seen.add(ref);
        return { ref, kind: 'business_function' as const, name: area };
      });

      if (seeds.length > 0) await seedModel(tx, org.id, seeds, []);

      return { org, seeded: seeds.length };
    });

    await recordAudit({
      orgId: created.org.id,
      actorId: user.id,
      actorEmail: user.email,
      entityType: 'organization',
      entityId: created.org.id,
      action: 'create',
      after: { name: created.org.name, businessFunctionsSeeded: created.seeded },
      requestId: String(request.id),
    });

    void reply.status(201);
    return {
      organization: {
        id: created.org.id,
        name: created.org.name,
        primaryRegion: created.org.primaryRegion,
        timezone: created.org.timezone,
        isDemo: false,
        role: 'ADMIN',
      },
      businessFunctionsCreated: created.seeded,
    };
  });

  // -------------------------------------------------------------------------
  app.post('/demo', async (request, reply) => {
    const user = requireVerifiedUser(request);
    if (!config.DEMO_MODE_ENABLED) {
      throw forbidden('Demo mode is switched off on this deployment.');
    }

    const created = await getDb().transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: DEMO_ORG_NAME,
          primaryRegion: DEMO_ORG_REGION,
          timezone: 'Europe/London',
          isDemo: true,
        })
        .returning();
      if (org === undefined) throw new Error('organization insert returned nothing');

      await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: 'ADMIN' });
      const summary = await seedModel(tx, org.id, demoEntities, demoDependencies);
      return { org, summary };
    });

    await recordAudit({
      orgId: created.org.id,
      actorId: user.id,
      actorEmail: user.email,
      entityType: 'organization',
      entityId: created.org.id,
      action: 'create_demo',
      after: created.summary,
      requestId: String(request.id),
    });

    void reply.status(201);
    return {
      organization: {
        id: created.org.id,
        name: created.org.name,
        primaryRegion: created.org.primaryRegion,
        timezone: created.org.timezone,
        isDemo: true,
        role: 'ADMIN',
      },
      seeded: created.summary,
    };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId', async (request) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.params);
    const context = await requireOrg(request, orgId);
    return {
      organization: {
        id: context.org.id,
        name: context.org.name,
        primaryRegion: context.org.primaryRegion,
        timezone: context.org.timezone,
        isDemo: context.org.isDemo,
        role: context.role,
        createdAt: context.org.createdAt.toISOString(),
      },
    };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId/members', async (request) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(request.params);
    await requireOrg(request, orgId);

    const rows = await getDb()
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.orgId, orgId));

    return {
      members: rows.map((row) => ({
        userId: row.user.id,
        name: row.user.name,
        email: row.user.email,
        role: row.membership.role,
        joinedAt: row.membership.createdAt.toISOString(),
      })),
    };
  });

  // -------------------------------------------------------------------------
  app.patch('/:orgId/members/:userId', async (request) => {
    const params = z
      .object({ orgId: z.string().uuid(), userId: z.string().uuid() })
      .parse(request.params);
    const body = z
      .object({ role: z.enum(['ADMIN', 'LEADER', 'OPERATOR', 'VIEWER']) })
      .parse(request.body);

    const context = await requireOrg(request, params.orgId, 'ADMIN');

    // An admin must not be able to lock the organization out of administration
    // by demoting the last one, including themselves.
    if (body.role !== 'ADMIN') {
      const admins = await getDb()
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.orgId, params.orgId), eq(memberships.role, 'ADMIN')));
      if (admins.length === 1 && admins[0]?.userId === params.userId) {
        throw badRequest('This is the only administrator. Promote someone else first.');
      }
    }

    const [updated] = await getDb()
      .update(memberships)
      .set({ role: body.role })
      .where(and(eq(memberships.orgId, params.orgId), eq(memberships.userId, params.userId)))
      .returning();

    if (updated === undefined) throw notFound('That person is not a member of this organization.');

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'membership',
      entityId: params.userId,
      action: 'change_role',
      after: { role: body.role },
      requestId: String(request.id),
    });

    return { status: 'updated', role: updated.role };
  });
}
