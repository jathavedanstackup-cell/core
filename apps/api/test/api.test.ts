/**
 * API integration tests.
 *
 * These run against a real PostgreSQL database and a real Fastify instance via
 * `inject`, because the things most worth testing here — tenant isolation,
 * authorization, the action state machine, database constraints — are exactly
 * the things a mock would let through.
 *
 * Each run works in its own schema-clean slice: rows are created with unique
 * emails and organizations, and removed afterwards.
 */

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { hashToken } from '../src/auth/session.js';
import { loadConfig } from '../src/config.js';
import { closeDb, getDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  memberships,
  organizations,
  sessions,
  users,
  type OrganizationRow,
  type UserRow,
} from '../src/db/schema.js';
import { demoDependencies, demoEntities } from '../src/services/demo.js';
import { seedModel } from '../src/services/seed.js';

let app: FastifyInstance;
const cookieName = loadConfig().SESSION_COOKIE_NAME;

interface Actor {
  user: UserRow;
  token: string;
  cookie: string;
}

const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

async function makeUser(role: string): Promise<Actor> {
  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({
      email: `${role.toLowerCase()}-${randomUUID()}@core.test`,
      name: `${role} Tester`,
      passwordHash: await hashPassword('a-long-enough-password'),
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (user === undefined) throw new Error('user insert failed');
  createdUserIds.push(user.id);

  const token = randomUUID() + randomUUID();
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  return { user, token, cookie: `${cookieName}=${token}` };
}

async function makeOrg(owner: Actor, role = 'ADMIN'): Promise<OrganizationRow> {
  const db = getDb();
  const [org] = await db
    .insert(organizations)
    .values({ name: `Org ${randomUUID().slice(0, 8)}` })
    .returning();
  if (org === undefined) throw new Error('org insert failed');
  createdOrgIds.push(org.id);

  await db.insert(memberships).values({ orgId: org.id, userId: owner.user.id, role });
  return org;
}

beforeAll(async () => {
  await runMigrations();
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  const db = getDb();
  for (const id of createdOrgIds) await db.delete(organizations).where(eq(organizations.id, id));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
  await closeDb();
});

// ---------------------------------------------------------------------------

describe('health and readiness', () => {
  it('reports liveness without touching the database', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('reports readiness including the database and migrations', async () => {
    const response = await app.inject({ method: 'GET', url: '/readiness' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: { database: true, migrations: true },
    });
  });
});

describe('authentication', () => {
  it('refuses an anonymous caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('does not reveal whether an address is already registered', async () => {
    const email = `duplicate-${randomUUID()}@core.test`;
    const body = { name: 'First Person', email, password: 'a-long-enough-password' };

    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: body });
    const second = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: body });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().message).toBe(first.json().message);

    const rows = await getDb().select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    const created = rows[0];
    if (created !== undefined) createdUserIds.push(created.id);
  });

  it('gives the same answer for an unknown address and a wrong password', async () => {
    const actor = await makeUser('VIEWER');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `nobody-${randomUUID()}@core.test`, password: 'a-long-enough-password' },
    });
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: actor.user.email, password: 'not-the-right-password' },
    });

    expect(unknown.statusCode).toBe(401);
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknown.json().error.message);
  });

  it('rejects a password that contains the email address', async () => {
    const email = `weak-${randomUUID()}@core.test`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Weak Password', email, password: email },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.password).toBeDefined();
  });

  it('never stores a password in a recoverable form', async () => {
    const actor = await makeUser('ADMIN');
    const rows = await getDb().select().from(users).where(eq(users.id, actor.user.id));
    const stored = rows[0]?.passwordHash ?? '';
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain('a-long-enough-password');
  });

  it('stores only a hash of the session token', async () => {
    const actor = await makeUser('ADMIN');
    const rows = await getDb().select().from(sessions).where(eq(sessions.userId, actor.user.id));
    expect(rows[0]?.tokenHash).not.toBe(actor.token);
    expect(rows[0]?.tokenHash).toHaveLength(64);
  });

  it('ends the session on sign out', async () => {
    const actor = await makeUser('ADMIN');
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: actor.cookie },
    });
    expect(before.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: actor.cookie },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: actor.cookie },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('organization isolation', () => {
  it('hides another organization behind the same 404 as one that does not exist', async () => {
    const insider = await makeUser('ADMIN');
    const outsider = await makeUser('ADMIN');
    const org = await makeOrg(insider);

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/${org.id}/assessment`,
      headers: { cookie: outsider.cookie },
    });
    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/${randomUUID()}/assessment`,
      headers: { cookie: outsider.cookie },
    });

    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(foreign.json().error.message).toBe(missing.json().error.message);
  });

  it('lets a member in', async () => {
    const actor = await makeUser('ADMIN');
    const org = await makeOrg(actor);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/${org.id}/assessment`,
      headers: { cookie: actor.cookie },
    });
    expect(response.statusCode).toBe(200);
  });

  it('never returns another organization’s entities', async () => {
    const a = await makeUser('ADMIN');
    const b = await makeUser('ADMIN');
    const orgA = await makeOrg(a);
    const orgB = await makeOrg(b);

    await getDb().transaction(async (tx) => {
      await seedModel(tx, orgA.id, demoEntities, demoDependencies);
    });

    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/model/${orgA.id}/entities`,
      headers: { cookie: a.cookie },
    });
    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/model/${orgB.id}/entities`,
      headers: { cookie: b.cookie },
    });

    expect(own.json().entities.length).toBeGreaterThan(0);
    expect(other.json().entities).toHaveLength(0);
  });
});

describe('roles', () => {
  it('refuses a viewer the operator-only actions', async () => {
    const actor = await makeUser('VIEWER');
    const org = await makeOrg(actor, 'VIEWER');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/model/${org.id}/entities`,
      headers: { cookie: actor.cookie },
      payload: { ref: 'svc-x', kind: 'service', name: 'Something' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('OPERATOR');
  });

  it('refuses a viewer the audit trail, which needs LEADER', async () => {
    const actor = await makeUser('VIEWER');
    const org = await makeOrg(actor, 'VIEWER');
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/${org.id}`,
      headers: { cookie: actor.cookie },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('assessment and solutions', () => {
  it('analyses a seeded organization and finds the single-person dependency', async () => {
    const actor = await makeUser('ADMIN');
    const org = await makeOrg(actor);
    await getDb().transaction(async (tx) => {
      await seedModel(tx, org.id, demoEntities, demoDependencies);
    });

    const assessment = await app.inject({
      method: 'GET',
      url: `/api/v1/${org.id}/assessment`,
      headers: { cookie: actor.cookie },
    });
    expect(assessment.statusCode).toBe(200);

    const body = assessment.json();
    const ids = [...body.tiers.FIX_FIRST, ...body.tiers.FIX_NEXT, ...body.tiers.MONITOR].map(
      (item: { id: string }) => item.id,
    );
    expect(ids).toContain('single_person:p-priya');

    const solutions = await app.inject({
      method: 'GET',
      url: `/api/v1/${org.id}/solutions?finding=${encodeURIComponent('single_person:p-priya')}`,
      headers: { cookie: actor.cookie },
    });
    expect(solutions.statusCode).toBe(200);
    const payload = solutions.json();
    expect(payload.solutions.recommendedOptionId).toBe('cross_train');
    // Personalised to the actual colleague, not a generic suggestion.
    expect(JSON.stringify(payload.solutions.options)).toContain('Lena Fischer');
  });

  it('propagates a failure through to the business function', async () => {
    const actor = await makeUser('ADMIN');
    const org = await makeOrg(actor);
    await getDb().transaction(async (tx) => {
      await seedModel(tx, org.id, demoEntities, demoDependencies);
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/${org.id}/scenarios`,
      headers: { cookie: actor.cookie },
      payload: { failedRefs: ['vendor-cloud'] },
    });

    expect(response.statusCode).toBe(201);
    const names = response.json().result.failedFunctions.map((f: { name: string }) => f.name);
    expect(names).toContain('Pay staff');
    expect(names).toContain('Dispatch customer shipments');
  });

  it('refuses a scenario naming nothing it recognises', async () => {
    const actor = await makeUser('ADMIN');
    const org = await makeOrg(actor);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/${org.id}/scenarios`,
      headers: { cookie: actor.cookie },
      payload: { failedRefs: ['not-a-thing'] },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('actions', () => {
  it('creates a plan from a solution and enforces the state machine', async () => {
    const actor = await makeUser('ADMIN');
    const org = await makeOrg(actor);
    await getDb().transaction(async (tx) => {
      await seedModel(tx, org.id, demoEntities, demoDependencies);
    });

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/actions/${org.id}/from-solution`,
      headers: { cookie: actor.cookie },
      payload: { findingId: 'single_person:p-priya' },
    });
    expect(created.statusCode).toBe(201);

    const first = created.json().actions[0];
    expect(first.status).toBe('READY');
    expect(first.completedAt).toBeNull();

    // READY cannot jump straight to COMPLETED.
    const illegal = await app.inject({
      method: 'PATCH',
      url: `/api/v1/actions/${org.id}/${first.id}`,
      headers: { cookie: actor.cookie },
      payload: { status: 'COMPLETED' },
    });
    expect(illegal.statusCode).toBe(400);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/actions/${org.id}/${first.id}`,
      headers: { cookie: actor.cookie },
      payload: { status: 'IN_PROGRESS' },
    });
    const completed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/actions/${org.id}/${first.id}`,
      headers: { cookie: actor.cookie },
      payload: { status: 'COMPLETED' },
    });

    expect(completed.statusCode).toBe(200);
    // Nothing may claim completion without a time behind it.
    expect(completed.json().action.completedAt).not.toBeNull();

    const reopen = await app.inject({
      method: 'PATCH',
      url: `/api/v1/actions/${org.id}/${first.id}`,
      headers: { cookie: actor.cookie },
      payload: { status: 'IN_PROGRESS' },
    });
    expect(reopen.statusCode).toBe(400);
  });
});

describe('data quality', () => {
  it('refuses an import that references something not in the file', async () => {
    const actor = await makeUser('ADMIN');
    const org = await makeOrg(actor);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/model/${org.id}/import`,
      headers: { cookie: actor.cookie },
      payload: {
        entities: [{ ref: 'a', kind: 'service', name: 'A' }],
        dependencies: [
          { ref: 'd1', dependentRef: 'a', providerRef: 'ghost', type: 'requires' },
        ],
      },
    });

    expect(response.statusCode).toBe(400);

    // The whole import rolled back; nothing partial was left behind.
    const entities = await app.inject({
      method: 'GET',
      url: `/api/v1/model/${org.id}/entities`,
      headers: { cookie: actor.cookie },
    });
    expect(entities.json().entities).toHaveLength(0);
  });
});

describe('error handling', () => {
  it('returns a stable shape and a request id, never a stack trace', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    const body = response.json();
    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('not_found');
    expect(body.requestId).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('at Object');
  });
});
