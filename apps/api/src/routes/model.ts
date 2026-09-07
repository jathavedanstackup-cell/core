/**
 * The organization model: entities, dependencies, import and data quality.
 *
 * Import is transactional and reports what it did. Bad data is rejected with
 * an explanation rather than quietly accepted, and a rejected row never leaves
 * a half-built organization behind.
 */

import { validateGraph } from '@core/engine';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { dependencies as dependencyTable, entities as entityTable } from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { requireOrg } from '../plugins/context.js';
import { loadOrganizationGraph } from '../services/orgGraph.js';
import { seedModel } from '../services/seed.js';

const ENTITY_KINDS = [
  'business_function',
  'process',
  'application',
  'service',
  'vendor',
  'team',
  'person',
  'location',
  'facility',
  'data_asset',
] as const;

const DEPENDENCY_TYPES = [
  'requires',
  'operates',
  'hosts',
  'supplies',
  'staffs',
  'stores',
  'authenticates',
] as const;

const refSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'Use letters, numbers, dots, dashes and underscores.');

const orgParams = z.object({ orgId: z.string().uuid() });

const entityInput = z.object({
  ref: refSchema,
  kind: z.enum(ENTITY_KINDS),
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  criticality: z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']).optional(),
  ownerRef: refSchema.optional(),
  alternateRefs: z.array(refSchema).max(50).optional(),
  procedureDocumented: z.boolean().optional(),
  lastTestedAt: z.string().datetime().optional(),
  contactsVerifiedAt: z.string().datetime().optional(),
  accessVerifiedAt: z.string().datetime().optional(),
  mtdMinutes: z.number().int().min(0).max(525_600).optional(),
  rtoMinutes: z.number().int().min(0).max(525_600).optional(),
  rpoMinutes: z.number().int().min(0).max(525_600).optional(),
});

const dependencyInput = z.object({
  ref: refSchema,
  dependentRef: refSchema,
  providerRef: refSchema,
  type: z.enum(DEPENDENCY_TYPES).default('requires'),
  optional: z.boolean().default(false),
  fallbackProviderRefs: z.array(refSchema).max(20).default([]),
  toleranceMinutes: z.number().int().min(0).max(525_600).optional(),
});

function toDate(value: string | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

export async function registerModelRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  app.get('/:orgId/entities', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    await requireOrg(request, orgId);

    const rows = await getDb().select().from(entityTable).where(eq(entityTable.orgId, orgId));
    const refById = new Map(rows.map((row) => [row.id, row.ref]));

    return {
      entities: rows
        .map((row) => ({
          ref: row.ref,
          kind: row.kind,
          name: row.name,
          description: row.description,
          criticality: row.criticality,
          ownerRef: row.ownerId === null ? null : (refById.get(row.ownerId) ?? null),
          alternateRefs: row.alternateIds,
          procedureDocumented: row.procedureDocumented,
          lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
          contactsVerifiedAt: row.contactsVerifiedAt?.toISOString() ?? null,
          accessVerifiedAt: row.accessVerifiedAt?.toISOString() ?? null,
          mtdMinutes: row.mtdMinutes,
          rtoMinutes: row.rtoMinutes,
          rpoMinutes: row.rpoMinutes,
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    };
  });

  // -------------------------------------------------------------------------
  app.post('/:orgId/entities', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const context = await requireOrg(request, orgId, 'OPERATOR');
    const input = entityInput.parse(request.body);

    const existing = await getDb()
      .select({ id: entityTable.id })
      .from(entityTable)
      .where(and(eq(entityTable.orgId, orgId), eq(entityTable.ref, input.ref)))
      .limit(1);
    if (existing.length > 0) {
      throw conflict(`Something with the reference "${input.ref}" already exists here.`);
    }

    let ownerId: string | null = null;
    if (input.ownerRef !== undefined) {
      const owner = await getDb()
        .select({ id: entityTable.id })
        .from(entityTable)
        .where(and(eq(entityTable.orgId, orgId), eq(entityTable.ref, input.ownerRef)))
        .limit(1);
      if (owner[0] === undefined) {
        throw badRequest(`No entity with reference "${input.ownerRef}" to be the owner.`);
      }
      ownerId = owner[0].id;
    }

    const [created] = await getDb()
      .insert(entityTable)
      .values({
        orgId,
        ref: input.ref,
        kind: input.kind,
        name: input.name,
        description: input.description ?? null,
        criticality: input.criticality ?? null,
        ownerId,
        alternateIds: input.alternateRefs ?? [],
        procedureDocumented: input.procedureDocumented ?? null,
        lastTestedAt: toDate(input.lastTestedAt),
        contactsVerifiedAt: toDate(input.contactsVerifiedAt),
        accessVerifiedAt: toDate(input.accessVerifiedAt),
        mtdMinutes: input.mtdMinutes ?? null,
        rtoMinutes: input.rtoMinutes ?? null,
        rpoMinutes: input.rpoMinutes ?? null,
      })
      .returning();

    await recordAudit({
      orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'entity',
      entityId: input.ref,
      action: 'create',
      after: input,
      requestId: String(request.id),
    });

    void reply.status(201);
    return { entity: { ref: created?.ref ?? input.ref } };
  });

  // -------------------------------------------------------------------------
  app.patch('/:orgId/entities/:ref', async (request) => {
    const params = orgParams.extend({ ref: refSchema }).parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');
    const input = entityInput.partial().omit({ ref: true }).parse(request.body);

    const rows = await getDb()
      .select()
      .from(entityTable)
      .where(and(eq(entityTable.orgId, params.orgId), eq(entityTable.ref, params.ref)))
      .limit(1);
    const before = rows[0];
    if (before === undefined) throw notFound('No such item in this organization.');

    let ownerId = before.ownerId;
    if (input.ownerRef !== undefined) {
      const owner = await getDb()
        .select({ id: entityTable.id })
        .from(entityTable)
        .where(and(eq(entityTable.orgId, params.orgId), eq(entityTable.ref, input.ownerRef)))
        .limit(1);
      if (owner[0] === undefined) {
        throw badRequest(`No entity with reference "${input.ownerRef}" to be the owner.`);
      }
      ownerId = owner[0].id;
    }

    await getDb()
      .update(entityTable)
      .set({
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.criticality === undefined ? {} : { criticality: input.criticality }),
        ...(input.ownerRef === undefined ? {} : { ownerId }),
        ...(input.alternateRefs === undefined ? {} : { alternateIds: input.alternateRefs }),
        ...(input.procedureDocumented === undefined
          ? {}
          : { procedureDocumented: input.procedureDocumented }),
        ...(input.lastTestedAt === undefined ? {} : { lastTestedAt: toDate(input.lastTestedAt) }),
        ...(input.contactsVerifiedAt === undefined
          ? {}
          : { contactsVerifiedAt: toDate(input.contactsVerifiedAt) }),
        ...(input.accessVerifiedAt === undefined
          ? {}
          : { accessVerifiedAt: toDate(input.accessVerifiedAt) }),
        ...(input.mtdMinutes === undefined ? {} : { mtdMinutes: input.mtdMinutes }),
        ...(input.rtoMinutes === undefined ? {} : { rtoMinutes: input.rtoMinutes }),
        ...(input.rpoMinutes === undefined ? {} : { rpoMinutes: input.rpoMinutes }),
        updatedAt: new Date(),
      })
      .where(eq(entityTable.id, before.id));

    // Change history: what it was, and what it became.
    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'entity',
      entityId: params.ref,
      action: 'update',
      before: {
        name: before.name,
        criticality: before.criticality,
        procedureDocumented: before.procedureDocumented,
        rtoMinutes: before.rtoMinutes,
        mtdMinutes: before.mtdMinutes,
      },
      after: input,
      requestId: String(request.id),
    });

    return { status: 'updated', ref: params.ref };
  });

  // -------------------------------------------------------------------------
  app.delete('/:orgId/entities/:ref', async (request) => {
    const params = orgParams.extend({ ref: refSchema }).parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');

    const referencing = await getDb()
      .select({ ref: dependencyTable.ref })
      .from(dependencyTable)
      .where(eq(dependencyTable.orgId, params.orgId));
    const blocking = referencing.filter((row) => row.ref.length > 0);

    const deps = await getDb()
      .select()
      .from(dependencyTable)
      .where(eq(dependencyTable.orgId, params.orgId));
    const inUse = deps.filter(
      (row) => row.dependentRef === params.ref || row.providerRef === params.ref,
    );
    if (inUse.length > 0) {
      throw conflict(
        `"${params.ref}" is still used by ${inUse.length} dependency/dependencies. Remove those first.`,
        { dependencies: inUse.map((row) => row.ref) },
      );
    }
    void blocking;

    const deleted = await getDb()
      .delete(entityTable)
      .where(and(eq(entityTable.orgId, params.orgId), eq(entityTable.ref, params.ref)))
      .returning({ ref: entityTable.ref });
    if (deleted.length === 0) throw notFound('No such item in this organization.');

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'entity',
      entityId: params.ref,
      action: 'delete',
      requestId: String(request.id),
    });

    return { status: 'deleted', ref: params.ref };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId/dependencies', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    await requireOrg(request, orgId);
    const rows = await getDb()
      .select()
      .from(dependencyTable)
      .where(eq(dependencyTable.orgId, orgId));
    return {
      dependencies: rows.map((row) => ({
        ref: row.ref,
        dependentRef: row.dependentRef,
        providerRef: row.providerRef,
        type: row.type,
        optional: row.optional,
        fallbackProviderRefs: row.fallbackProviderRefs,
        toleranceMinutes: row.toleranceMinutes,
      })),
    };
  });

  // -------------------------------------------------------------------------
  app.post('/:orgId/dependencies', async (request, reply) => {
    const { orgId } = orgParams.parse(request.params);
    const context = await requireOrg(request, orgId, 'OPERATOR');
    const input = dependencyInput.parse(request.body);

    if (input.dependentRef === input.providerRef) {
      throw badRequest('Something cannot depend on itself.');
    }

    const known = await getDb()
      .select({ ref: entityTable.ref })
      .from(entityTable)
      .where(eq(entityTable.orgId, orgId));
    const refs = new Set(known.map((row) => row.ref));
    for (const ref of [input.dependentRef, input.providerRef, ...input.fallbackProviderRefs]) {
      if (!refs.has(ref)) throw badRequest(`No entity with reference "${ref}" in this organization.`);
    }

    const existing = await getDb()
      .select({ id: dependencyTable.id })
      .from(dependencyTable)
      .where(and(eq(dependencyTable.orgId, orgId), eq(dependencyTable.ref, input.ref)))
      .limit(1);
    if (existing.length > 0) {
      throw conflict(`A dependency with the reference "${input.ref}" already exists here.`);
    }

    await getDb()
      .insert(dependencyTable)
      .values({
        orgId,
        ref: input.ref,
        dependentRef: input.dependentRef,
        providerRef: input.providerRef,
        type: input.type,
        optional: input.optional,
        fallbackProviderRefs: input.fallbackProviderRefs,
        toleranceMinutes: input.toleranceMinutes ?? null,
      });

    await recordAudit({
      orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'dependency',
      entityId: input.ref,
      action: 'create',
      after: input,
      requestId: String(request.id),
    });

    void reply.status(201);
    return { dependency: { ref: input.ref } };
  });

  // -------------------------------------------------------------------------
  app.delete('/:orgId/dependencies/:ref', async (request) => {
    const params = orgParams.extend({ ref: refSchema }).parse(request.params);
    const context = await requireOrg(request, params.orgId, 'OPERATOR');

    const deleted = await getDb()
      .delete(dependencyTable)
      .where(and(eq(dependencyTable.orgId, params.orgId), eq(dependencyTable.ref, params.ref)))
      .returning({ ref: dependencyTable.ref });
    if (deleted.length === 0) throw notFound('No such dependency in this organization.');

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'dependency',
      entityId: params.ref,
      action: 'delete',
      requestId: String(request.id),
    });

    return { status: 'deleted', ref: params.ref };
  });

  // -------------------------------------------------------------------------
  const importSchema = z.object({
    entities: z.array(entityInput).max(5000).default([]),
    dependencies: z.array(dependencyInput).max(20_000).default([]),
    /** Refuse rather than merge if the organization already has a model. */
    mode: z.enum(['replace', 'append']).default('append'),
  });

  app.post('/:orgId/import', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    const context = await requireOrg(request, orgId, 'OPERATOR');
    const input = importSchema.parse(request.body);

    const read = input.entities.length + input.dependencies.length;
    const warnings: string[] = [];
    const rejected: { row: string; reason: string }[] = [];

    // Duplicates inside the payload itself.
    const seenEntityRefs = new Set<string>();
    const acceptedEntities: typeof input.entities = [];
    for (const entity of input.entities) {
      if (seenEntityRefs.has(entity.ref)) {
        rejected.push({ row: entity.ref, reason: 'Duplicate reference within the file.' });
        continue;
      }
      seenEntityRefs.add(entity.ref);
      acceptedEntities.push(entity);
    }

    const seenDependencyRefs = new Set<string>();
    const acceptedDependencies: typeof input.dependencies = [];
    for (const dependency of input.dependencies) {
      if (seenDependencyRefs.has(dependency.ref)) {
        rejected.push({ row: dependency.ref, reason: 'Duplicate reference within the file.' });
        continue;
      }
      if (dependency.dependentRef === dependency.providerRef) {
        rejected.push({ row: dependency.ref, reason: 'Something cannot depend on itself.' });
        continue;
      }
      seenDependencyRefs.add(dependency.ref);
      acceptedDependencies.push(dependency);
    }

    const summary = await getDb().transaction(async (tx) => {
      if (input.mode === 'replace') {
        await tx.delete(dependencyTable).where(eq(dependencyTable.orgId, orgId));
        await tx.delete(entityTable).where(eq(entityTable.orgId, orgId));
      } else {
        const existing = await tx
          .select({ ref: entityTable.ref })
          .from(entityTable)
          .where(eq(entityTable.orgId, orgId));
        const existingRefs = new Set(existing.map((row) => row.ref));
        const clashes = acceptedEntities.filter((entity) => existingRefs.has(entity.ref));
        if (clashes.length > 0) {
          throw conflict(
            `${clashes.length} item(s) in the file already exist here. Use replace mode, or change their references.`,
            { refs: clashes.slice(0, 20).map((entity) => entity.ref) },
          );
        }
      }

      return seedModel(
        tx,
        orgId,
        acceptedEntities.map((entity) => ({
          ref: entity.ref,
          kind: entity.kind,
          name: entity.name,
          ...(entity.description === undefined ? {} : { description: entity.description }),
          ...(entity.criticality === undefined ? {} : { criticality: entity.criticality }),
          ...(entity.ownerRef === undefined ? {} : { ownerRef: entity.ownerRef }),
          ...(entity.alternateRefs === undefined ? {} : { alternateRefs: entity.alternateRefs }),
          ...(entity.procedureDocumented === undefined
            ? {}
            : { procedureDocumented: entity.procedureDocumented }),
          ...(entity.mtdMinutes === undefined ? {} : { mtdMinutes: entity.mtdMinutes }),
          ...(entity.rtoMinutes === undefined ? {} : { rtoMinutes: entity.rtoMinutes }),
          ...(entity.rpoMinutes === undefined ? {} : { rpoMinutes: entity.rpoMinutes }),
        })),
        acceptedDependencies.map((dependency) => ({
          ref: dependency.ref,
          dependentRef: dependency.dependentRef,
          providerRef: dependency.providerRef,
          type: dependency.type,
          optional: dependency.optional,
          fallbackProviderRefs: dependency.fallbackProviderRefs,
        })),
      );
    });

    // Report structural problems the import created but did not have to reject.
    const graph = await loadOrganizationGraph(orgId);
    for (const issue of validateGraph(graph)) {
      warnings.push(issue.message);
    }

    await recordAudit({
      orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'organization',
      entityId: orgId,
      action: 'import',
      after: { mode: input.mode, ...summary },
      requestId: String(request.id),
    });

    return {
      summary: {
        read,
        accepted: summary.entitiesCreated + summary.dependenciesCreated,
        rejected: rejected.length,
        duplicates: rejected.filter((r) => r.reason.startsWith('Duplicate')).length,
        entitiesCreated: summary.entitiesCreated,
        dependenciesCreated: summary.dependenciesCreated,
      },
      rejected,
      warnings,
    };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId/quality', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    await requireOrg(request, orgId);
    const graph = await loadOrganizationGraph(orgId);
    const issues = validateGraph(graph);
    return {
      issues,
      counts: {
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
      },
    };
  });
}
