/**
 * Database schema.
 *
 * Two rules run through every table that holds organizational data:
 *
 *  - Every such row carries `orgId`, and every query filters on it. Tenant
 *    isolation is enforced at the query layer, never inferred from the client.
 *  - Instants are `timestamptz` and stored in UTC. Display timezone is a
 *    presentation concern and never touches the database.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** Null for accounts that only ever sign in through an identity provider. */
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    googleSubject: text('google_subject'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_key').on(table.email),
    uniqueIndex('users_google_subject_key').on(table.googleSubject),
  ],
);

/**
 * Opaque server-side sessions rather than self-contained tokens, so that a
 * logout genuinely ends the session instead of waiting for an expiry.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the cookie value. The raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
  ],
);

export const verificationCodes = pgTable(
  'verification_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the code. The code itself only ever exists in the email. */
    codeHash: text('code_hash').notNull(),
    purpose: text('purpose').notNull(), // 'email_verification' | 'password_reset'
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verification_codes_user_purpose_idx').on(table.userId, table.purpose)],
);

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  primaryRegion: text('primary_region'),
  /** Demo organizations are clearly labelled and never mixed with real data. */
  isDemo: boolean('is_demo').notNull().default(false),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** ADMIN | LEADER | OPERATOR | VIEWER */
    role: text('role').notNull().default('VIEWER'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('memberships_org_user_key').on(table.orgId, table.userId),
    index('memberships_user_idx').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// The organization model
// ---------------------------------------------------------------------------

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Stable human-facing key, unique within the organization. */
    ref: text('ref').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    criticality: text('criticality'),
    ownerId: uuid('owner_id'),
    alternateIds: jsonb('alternate_ids').$type<string[]>().notNull().default([]),
    procedureDocumented: boolean('procedure_documented'),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    contactsVerifiedAt: timestamp('contacts_verified_at', { withTimezone: true }),
    accessVerifiedAt: timestamp('access_verified_at', { withTimezone: true }),
    mtdMinutes: integer('mtd_minutes'),
    rtoMinutes: integer('rto_minutes'),
    rpoMinutes: integer('rpo_minutes'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('entities_org_ref_key').on(table.orgId, table.ref),
    index('entities_org_kind_idx').on(table.orgId, table.kind),
  ],
);

export const dependencies = pgTable(
  'dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ref: text('ref').notNull(),
    dependentRef: text('dependent_ref').notNull(),
    providerRef: text('provider_ref').notNull(),
    type: text('type').notNull().default('requires'),
    optional: boolean('optional').notNull().default(false),
    fallbackProviderRefs: jsonb('fallback_provider_refs').$type<string[]>().notNull().default([]),
    toleranceMinutes: integer('tolerance_minutes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('dependencies_org_ref_key').on(table.orgId, table.ref),
    index('dependencies_org_provider_idx').on(table.orgId, table.providerRef),
    index('dependencies_org_dependent_idx').on(table.orgId, table.dependentRef),
  ],
);

// ---------------------------------------------------------------------------
// Working records
// ---------------------------------------------------------------------------

export const scenarioRuns = pgTable(
  'scenario_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    failedEntityRefs: jsonb('failed_entity_refs').$type<string[]>().notNull(),
    /** The full engine result, kept so a past run can be reopened unchanged. */
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scenario_runs_org_created_idx').on(table.orgId, table.createdAt)],
);

export const actions = pgTable(
  'actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** READY | IN_PROGRESS | BLOCKED | COMPLETED | FAILED | CANCELLED */
    status: text('status').notNull().default('READY'),
    priority: text('priority').notNull().default('P2'),
    ownerHint: text('owner_hint'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    /** Which finding and solution option this action came from, if any. */
    findingRef: text('finding_ref'),
    optionRef: text('option_ref'),
    verification: text('verification'),
    notes: text('notes'),
    incidentId: uuid('incident_id'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('actions_org_status_idx').on(table.orgId, table.status),
    index('actions_org_finding_idx').on(table.orgId, table.findingRef),
  ],
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** SEV1 | SEV2 | SEV3 | SEV4 */
    severity: text('severity').notNull().default('SEV3'),
    /** OPEN | INVESTIGATING | CONTAINED | RECOVERING | RESOLVED | CLOSED */
    status: text('status').notNull().default('OPEN'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    affectedEntityRefs: jsonb('affected_entity_refs').$type<string[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('incidents_org_reference_key').on(table.orgId, table.reference),
    index('incidents_org_status_idx').on(table.orgId, table.status),
  ],
);

export const incidentEvents = pgTable(
  'incident_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    /** trigger | detection | decision | action | delay | recovery | verification | note */
    kind: text('kind').notNull(),
    description: text('description').notNull(),
    /** The real instant the thing happened, which may precede when it was typed. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('incident_events_incident_occurred_idx').on(table.incidentId, table.occurredAt)],
);

/**
 * Append-only record of who changed what.
 *
 * Never holds secrets: the writer records field names and business values, and
 * password hashes, tokens and codes are excluded at the call site.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_org_created_idx').on(table.orgId, table.createdAt),
    index('audit_events_entity_idx').on(table.entityType, table.entityId),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  memberships: many(memberships),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  entities: many(entities),
  dependencies: many(dependencies),
}));

export const incidentsRelations = relations(incidents, ({ many }) => ({
  events: many(incidentEvents),
}));

export type UserRow = typeof users.$inferSelect;
export type OrganizationRow = typeof organizations.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type EntityRow = typeof entities.$inferSelect;
export type DependencyRow = typeof dependencies.$inferSelect;
export type ActionRow = typeof actions.$inferSelect;
export type IncidentRow = typeof incidents.$inferSelect;
export type IncidentEventRow = typeof incidentEvents.$inferSelect;
export type ScenarioRunRow = typeof scenarioRuns.$inferSelect;
