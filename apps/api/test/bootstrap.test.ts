/**
 * The bootstrap account.
 *
 * A fresh deployment cannot verify anybody without email, and cannot be
 * configured for email without somebody signed in. This breaks that circle
 * once. Because it bypasses verification, the conditions matter more than the
 * feature does, so they are asserted directly:
 *
 *   - off unless deliberately switched on
 *   - fires only while nobody has verified
 *   - cannot fire twice, even if the flag is left on afterwards
 */

import { randomUUID } from 'node:crypto';

import { eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig, resetConfigForTests } from '../src/config.js';
import { closeDb, getDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { users } from '../src/db/schema.js';

let app: FastifyInstance;
const created: string[] = [];

/**
 * These tests need a database with no verified accounts. Rather than deleting
 * anyone else's rows, note which accounts were already verified, un-verify them
 * for the duration, and put them back afterwards.
 */
let parked: string[] = [];

const BASE_ENV = { ...process.env, BOOTSTRAP_FIRST_ACCOUNT: 'true', SMTP_URL: '' };

beforeAll(async () => {
  await runMigrations();
  resetConfigForTests();
  loadConfig(BASE_ENV as NodeJS.ProcessEnv);
  app = await buildApp();
  await app.ready();

  const db = getDb();
  const already = await db
    .select({ id: users.id })
    .from(users)
    .where(isNotNull(users.emailVerifiedAt));
  parked = already.map((row) => row.id);
  for (const id of parked) {
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, id));
  }
}, 60_000);

afterEach(async () => {
  // Each test needs a pristine "nobody has verified" starting point.
  const db = getDb();
  for (const id of created) await db.delete(users).where(eq(users.id, id));
  created.length = 0;
});

afterAll(async () => {
  const db = getDb();
  const now = new Date();
  for (const id of parked) {
    await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, id));
  }
  await app.close();
  resetConfigForTests();
  loadConfig();
  await closeDb();
});

/**
 * Registration is rate limited per client address. Every request here comes
 * from a distinct one, because otherwise the tests exhaust a shared budget and
 * start measuring the rate limiter rather than the behaviour under test — which
 * is precisely how the concurrency test below first failed, in 15ms, with every
 * request rejected before it did any work.
 */
let nextClient = 0;
function distinctClient(): string {
  nextClient += 1;
  return `10.${Math.floor(nextClient / 65_536) % 256}.${Math.floor(nextClient / 256) % 256}.${nextClient % 256}`;
}

async function register(app_: FastifyInstance) {
  const email = `bootstrap-${randomUUID()}@core.test`;
  const response = await app_.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress: distinctClient(),
    payload: { name: 'Bootstrap Tester', email, password: 'a-long-enough-password' },
  });
  const row = (
    await getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  )[0];
  if (row !== undefined) created.push(row.id);
  return { response, email };
}

describe('the bootstrap account', () => {
  it('verifies and signs in the first account, with no code', async () => {
    const { response } = await register(app);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.bootstrapped).toBe(true);
    expect(body.status).toBe('signed_in');
    expect(body.user.emailVerified).toBe(true);
    // A session cookie means they are actually in, not merely marked verified.
    expect(String(response.headers['set-cookie'])).toContain(
      loadConfig().SESSION_COOKIE_NAME,
    );
  });

  it('cannot fire a second time, even with the flag still on', async () => {
    const first = await register(app);
    expect(first.response.json().bootstrapped).toBe(true);

    // The flag is unchanged; the deployment simply is no longer unclaimed.
    const second = await register(app);
    expect(second.response.statusCode).toBe(202);
    expect(second.response.json().bootstrapped).toBeUndefined();
    expect(second.response.json().status).toBe('verification_sent');
  });

  it('leaves the second account genuinely unverified', async () => {
    await register(app);
    const second = await register(app);

    const row = (
      await getDb()
        .select({ verified: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.email, second.email))
        .limit(1)
    )[0];
    expect(row?.verified).toBeNull();
  });
});

describe('the race', () => {
  /**
   * The original implementation read "has anybody verified?" and then wrote,
   * which is a time-of-check-to-time-of-use race. Concurrent registrations
   * could each see an empty table and each be granted a verified account —
   * defeating the single guarantee the feature makes.
   *
   * This fires several registrations at once and insists exactly one wins.
   * It would pass by luck against the racy version often enough to be useless
   * at n=2, so it uses more, and asserts on the database rather than only on
   * the responses.
   */
  it('grants exactly one bootstrap when registrations arrive together', async () => {
    const emails = Array.from(
      { length: 6 },
      () => `race-${randomUUID()}@core.test`,
    );

    const responses = await Promise.all(
      emails.map((email) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          // Six different clients arriving together, which is what a real race
          // looks like and what the advisory lock has to survive.
          remoteAddress: distinctClient(),
          payload: { name: 'Race Tester', email, password: 'a-long-enough-password' },
        }),
      ),
    );

    const db = getDb();
    for (const email of emails) {
      const row = (
        await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      )[0];
      if (row !== undefined) created.push(row.id);
    }

    // Assert this first: a rate-limited or erroring request does no work, and
    // "nobody was bootstrapped" would otherwise look like a lock failure.
    for (const response of responses) {
      expect([201, 202]).toContain(response.statusCode);
    }

    const bootstrapped = responses.filter((r) => r.json().bootstrapped === true);
    expect(bootstrapped).toHaveLength(1);

    // And the database agrees: one verified account, not several.
    const verified = await db
      .select({ id: users.id })
      .from(users)
      .where(isNotNull(users.emailVerifiedAt));
    expect(verified).toHaveLength(1);
  });
});

describe('with the flag off', () => {
  let plainApp: FastifyInstance;

  beforeAll(async () => {
    resetConfigForTests();
    loadConfig({ ...BASE_ENV, BOOTSTRAP_FIRST_ACCOUNT: 'false' } as NodeJS.ProcessEnv);
    plainApp = await buildApp();
    await plainApp.ready();
  });

  afterAll(async () => {
    await plainApp.close();
    resetConfigForTests();
    loadConfig(BASE_ENV as NodeJS.ProcessEnv);
  });

  it('does not bypass verification, even on an unclaimed deployment', async () => {
    const { response, email } = await register(plainApp);

    expect(response.statusCode).toBe(202);
    expect(response.json().bootstrapped).toBeUndefined();

    const row = (
      await getDb()
        .select({ verified: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)
    )[0];
    expect(row?.verified).toBeNull();
  });
});
