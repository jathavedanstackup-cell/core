/**
 * Exercises, improvements and reports.
 *
 * The behaviours worth protecting here are the ones a refactor could quietly
 * break: that the expectation is frozen at the start, that the review actually
 * compares expected against actual, that every export format produces a real
 * file, and that the PDF is a PDF rather than an error page with the wrong
 * content type.
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
import { memberships, organizations, sessions, users } from '../src/db/schema.js';
import { demoDependencies, demoEntities } from '../src/services/demo.js';
import { seedModel } from '../src/services/seed.js';

let app: FastifyInstance;
let cookie: string;
let orgId: string;
const cookieName = loadConfig().SESSION_COOKIE_NAME;
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

beforeAll(async () => {
  await runMigrations();
  app = await buildApp();
  await app.ready();

  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({
      email: `exercise-${randomUUID()}@core.test`,
      name: 'Exercise Tester',
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
  cookie = `${cookieName}=${token}`;

  const [org] = await db
    .insert(organizations)
    .values({ name: `Exercise Org ${randomUUID().slice(0, 8)}` })
    .returning();
  if (org === undefined) throw new Error('org insert failed');
  orgId = org.id;
  createdOrgIds.push(org.id);

  await db.insert(memberships).values({ orgId: org.id, userId: user.id, role: 'ADMIN' });
  await db.transaction(async (tx) => {
    await seedModel(tx, org.id, demoEntities, demoDependencies);
  });
}, 60_000);

afterAll(async () => {
  await app.close();
  const db = getDb();
  for (const id of createdOrgIds) await db.delete(organizations).where(eq(organizations.id, id));
  for (const id of createdUserIds) await db.delete(users).where(eq(users.id, id));
  await closeDb();
});

async function createExercise(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/exercises/${orgId}`,
    headers: { cookie },
    payload: { title: 'Cloud outage rehearsal', scenarioRefs: ['vendor-cloud'] },
  });
  expect(response.statusCode).toBe(201);
  return response.json().exercise.id as string;
}

describe('exercises', () => {
  it('refuses a scenario naming nothing it recognises', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}`,
      headers: { cookie },
      payload: { title: 'Nonsense', scenarioRefs: ['not-a-thing'] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('captures the engine expectation when it starts, and not before', async () => {
    const id = await createExercise();

    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/exercises/${orgId}/${id}`,
      headers: { cookie },
    });
    expect(before.json().exercise.status).toBe('PLANNED');
    expect(before.json().expected).toBeNull();

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/start`,
      headers: { cookie },
    });
    expect(started.statusCode).toBe(200);

    const body = started.json();
    expect(body.exercise.status).toBe('RUNNING');
    // Tightest recovery objective among the functions predicted to stop.
    expect(body.exercise.expectedRecoveryMinutes).toBe(120);
    const names = body.expected.failedFunctions.map((f: { name: string }) => f.name);
    expect(names).toContain('Pay staff');
    expect(names).toContain('Dispatch customer shipments');
  });

  it('cannot be started twice', async () => {
    const id = await createExercise();
    await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/start`,
      headers: { cookie },
    });
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/start`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(409);
  });

  it('refuses events on an exercise that is not running', async () => {
    const id = await createExercise();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/events`,
      headers: { cookie },
      payload: { kind: 'note', description: 'too early' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('produces a review that compares what was expected against what happened', async () => {
    const id = await createExercise();
    await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/start`,
      headers: { cookie },
    });

    for (const event of [
      { kind: 'decision', description: 'Declared a major incident.' },
      { kind: 'gap', description: 'Nobody knew who could authorise the manual process.' },
    ]) {
      const recorded = await app.inject({
        method: 'POST',
        url: `/api/v1/exercises/${orgId}/${id}/events`,
        headers: { cookie },
        payload: event,
      });
      expect(recorded.statusCode).toBe(201);
    }

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/complete`,
      headers: { cookie },
      payload: { actualRecoveryMinutes: 185 },
    });
    expect(completed.statusCode).toBe(200);

    const review = completed.json().review;
    // 185 actual against a 120 objective: missed, by 65.
    expect(review.timing.expectedMinutes).toBe(120);
    expect(review.timing.actualMinutes).toBe(185);
    expect(review.timing.deltaMinutes).toBe(65);
    expect(review.timing.metTarget).toBe(false);

    expect(review.whatDidNot.join(' ')).toContain('authorise the manual process');
    expect(review.missing.length).toBeGreaterThan(0);
    expect(review.recommendedImprovements.length).toBeGreaterThan(0);
    expect(review.assumptions.join(' ')).toContain('when the exercise started');
  });

  it('says plainly when an exercise demonstrated nothing', async () => {
    const id = await createExercise();
    await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/start`,
      headers: { cookie },
    });
    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/complete`,
      headers: { cookie },
      payload: {},
    });
    // The start injection is the only event, and no recovery time was given.
    const review = completed.json().review;
    expect(review.timing.metTarget).not.toBe(true);
    expect(review.missing.join(' ') + review.summary).toMatch(/no actions|could not be assessed|not recover/i);
  });

  it('accepts the review recommendations into the improvement register', async () => {
    const id = await createExercise();
    await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/start`,
      headers: { cookie },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/complete`,
      headers: { cookie },
      payload: { actualRecoveryMinutes: 400 },
    });

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/exercises/${orgId}/${id}/improvements`,
      headers: { cookie },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().created).toBeGreaterThan(0);

    const register = await app.inject({
      method: 'GET',
      url: `/api/v1/improvements/${orgId}`,
      headers: { cookie },
    });
    expect(register.json().improvements.length).toBeGreaterThan(0);
    expect(register.json().improvements[0].sourceExerciseId).toBeTruthy();
  });
});

describe('improvements', () => {
  it('enforces its own state machine', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/improvements/${orgId}`,
      headers: { cookie },
      payload: { title: 'Write the manual dispatch procedure', priority: 'P1' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().improvement.id;
    expect(created.json().improvement.status).toBe('PROPOSED');

    // PROPOSED cannot jump straight to COMPLETED.
    const illegal = await app.inject({
      method: 'PATCH',
      url: `/api/v1/improvements/${orgId}/${id}`,
      headers: { cookie },
      payload: { status: 'COMPLETED' },
    });
    expect(illegal.statusCode).toBe(400);

    for (const status of ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED']) {
      const step = await app.inject({
        method: 'PATCH',
        url: `/api/v1/improvements/${orgId}/${id}`,
        headers: { cookie },
        payload: { status },
      });
      expect(step.statusCode).toBe(200);
    }

    const finished = await app.inject({
      method: 'GET',
      url: `/api/v1/improvements/${orgId}`,
      headers: { cookie },
    });
    const item = finished
      .json()
      .improvements.find((candidate: { id: string }) => candidate.id === id);
    // Completion always records when, enforced by the database constraint.
    expect(item.completedAt).not.toBeNull();
  });
});

describe('reports', () => {
  it('generates a risk report and keeps it', async () => {
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/reports/${orgId}/risk`,
      headers: { cookie },
    });
    expect(generated.statusCode).toBe(201);

    const document = generated.json().document;
    expect(document.title).toBe('Risk assessment');
    expect(document.sections.length).toBeGreaterThan(1);
    expect(document.assumptions.join(' ')).toContain('not a probability');

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${orgId}`,
      headers: { cookie },
    });
    expect(listed.json().reports.length).toBeGreaterThan(0);
  });

  it('produces a real file in every format', async () => {
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/reports/${orgId}/readiness`,
      headers: { cookie },
    });
    const id = generated.json().report.id;

    const json = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${orgId}/${id}/download?format=json`,
      headers: { cookie },
    });
    expect(json.statusCode).toBe(200);
    expect(json.json().kind).toBe('readiness');

    const csv = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${orgId}/${id}/download?format=csv`,
      headers: { cookie },
    });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\r\n')[0]).toContain('Continuity readiness');

    const html = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${orgId}/${id}/download?format=html`,
      headers: { cookie },
    });
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.body).toContain('<!doctype html>');
    // Self-contained: no external stylesheet or font to fetch.
    expect(html.body).not.toContain('<link rel="stylesheet"');

    const pdf = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${orgId}/${id}/download?format=pdf`,
      headers: { cookie },
    });
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const bytes = pdf.rawPayload;
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF');
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('escapes CSV cells that contain quotes and commas', async () => {
    const { toCsv } = await import('../src/services/reports.js');
    const csv = toCsv({
      kind: 'risk',
      title: 'T',
      subtitle: 'S',
      organization: 'O',
      generatedAt: new Date().toISOString(),
      sections: [
        {
          heading: 'H',
          table: { columns: ['a'], rows: [['has "quotes", and a comma']] },
        },
      ],
      assumptions: [],
    });
    expect(csv).toContain('"has ""quotes"", and a comma"');
  });

  it('offers a download name that identifies the report', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${orgId}/preview/dependencies?format=csv&download=true`,
      headers: { cookie },
    });
    expect(response.headers['content-disposition']).toContain('core-critical-dependencies-');
    expect(response.headers['content-disposition']).toContain('.csv');
  });

  it('keeps a generated report as it was, not as the data now is', async () => {
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/reports/${orgId}/improvements`,
      headers: { cookie },
    });
    const id = generated.json().report.id;
    const at = generated.json().document.generatedAt;

    // Change the underlying data.
    await app.inject({
      method: 'POST',
      url: `/api/v1/improvements/${orgId}`,
      headers: { cookie },
      payload: { title: 'Something added after the report was issued' },
    });

    const reopened = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/${orgId}/${id}/download?format=json`,
      headers: { cookie },
    });
    expect(reopened.json().generatedAt).toBe(at);
    expect(JSON.stringify(reopened.json())).not.toContain('Something added after');
  });

  it('refuses a report for an organization the caller is not in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/reports/${randomUUID()}/risk`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
