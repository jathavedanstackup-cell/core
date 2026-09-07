/**
 * Seeding an organization's model from a plain description.
 *
 * Shared by the demo builder and by import, so both go through the same
 * validation and the same two-pass reference resolution: entities are inserted
 * first, then owner references are resolved, because an owner is itself an
 * entity and may appear later in the list.
 */

import { eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { dependencies as dependencyTable, entities as entityTable } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import type { SeedDependency, SeedEntity } from './demo.js';

function instantFromDaysAgo(days: number | undefined, now: Date): Date | null {
  if (days === undefined) return null;
  return new Date(now.getTime() - days * 86_400_000);
}

export interface SeedSummary {
  readonly entitiesCreated: number;
  readonly dependenciesCreated: number;
}

/**
 * Insert entities and dependencies for an organization inside the caller's
 * transaction. Throws on a reference that cannot be resolved, so a partial
 * organization is never committed.
 */
export async function seedModel(
  tx: Database,
  orgId: string,
  seedEntities: readonly SeedEntity[],
  seedDependencies: readonly SeedDependency[],
  now = new Date(),
): Promise<SeedSummary> {
  if (seedEntities.length === 0) {
    return { entitiesCreated: 0, dependenciesCreated: 0 };
  }

  const refs = new Set(seedEntities.map((entity) => entity.ref));

  // Pass 1: insert without owners, which may point forwards.
  await tx.insert(entityTable).values(
    seedEntities.map((entity) => ({
      orgId,
      ref: entity.ref,
      kind: entity.kind,
      name: entity.name,
      description: entity.description ?? null,
      criticality: entity.criticality ?? null,
      alternateIds: (entity.alternateRefs ?? []).filter((ref) => refs.has(ref)),
      procedureDocumented: entity.procedureDocumented ?? null,
      lastTestedAt: instantFromDaysAgo(entity.lastTestedDaysAgo, now),
      contactsVerifiedAt: instantFromDaysAgo(entity.contactsVerifiedDaysAgo, now),
      accessVerifiedAt: instantFromDaysAgo(entity.accessVerifiedDaysAgo, now),
      mtdMinutes: entity.mtdMinutes ?? null,
      rtoMinutes: entity.rtoMinutes ?? null,
      rpoMinutes: entity.rpoMinutes ?? null,
    })),
  );

  // Pass 2: resolve owner refs to the ids just created.
  const inserted = await tx
    .select({ id: entityTable.id, ref: entityTable.ref })
    .from(entityTable)
    .where(eq(entityTable.orgId, orgId));
  const idByRef = new Map(inserted.map((row) => [row.ref, row.id]));

  for (const entity of seedEntities) {
    if (entity.ownerRef === undefined) continue;
    const ownerId = idByRef.get(entity.ownerRef);
    if (ownerId === undefined) {
      throw badRequest(`"${entity.name}" names an owner "${entity.ownerRef}" that does not exist.`);
    }
    const selfId = idByRef.get(entity.ref);
    if (selfId === undefined) continue;
    await tx.update(entityTable).set({ ownerId }).where(eq(entityTable.id, selfId));
  }

  let dependenciesCreated = 0;
  if (seedDependencies.length > 0) {
    for (const dependency of seedDependencies) {
      if (!refs.has(dependency.dependentRef)) {
        throw badRequest(
          `Dependency "${dependency.ref}" refers to "${dependency.dependentRef}", which is not one of the items provided.`,
        );
      }
      if (!refs.has(dependency.providerRef)) {
        throw badRequest(
          `Dependency "${dependency.ref}" refers to "${dependency.providerRef}", which is not one of the items provided.`,
        );
      }
    }

    await tx.insert(dependencyTable).values(
      seedDependencies.map((dependency) => ({
        orgId,
        ref: dependency.ref,
        dependentRef: dependency.dependentRef,
        providerRef: dependency.providerRef,
        type: dependency.type,
        optional: dependency.optional ?? false,
        fallbackProviderRefs: (dependency.fallbackProviderRefs ?? []).filter((ref) => refs.has(ref)),
      })),
    );
    dependenciesCreated = seedDependencies.length;
  }

  return { entitiesCreated: seedEntities.length, dependenciesCreated };
}
