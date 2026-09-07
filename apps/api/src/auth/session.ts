/**
 * Server-side sessions.
 *
 * The cookie holds a random opaque token; the database stores only its SHA-256.
 * A database leak therefore does not yield usable sessions, and logout really
 * ends the session rather than waiting for a token to expire.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { and, eq, lt } from 'drizzle-orm';

import { loadConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { sessions, users, type UserRow } from '../db/schema.js';

const TOKEN_BYTES = 32;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

export async function createSession(userId: string, userAgent?: string): Promise<IssuedSession> {
  const config = loadConfig();
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000);

  await getDb()
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ...(userAgent === undefined ? {} : { userAgent: userAgent.slice(0, 500) }),
    });

  return { token, expiresAt };
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly user: UserRow;
}

/**
 * Look up the session behind a cookie value.
 *
 * Expired sessions are deleted on sight rather than merely ignored, so the
 * table does not grow without bound on a busy instance.
 */
export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  if (token.length === 0) return null;
  const db = getDb();
  const tokenHash = hashToken(token);

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  if (row.session.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }

  // Constant-time compare of the stored hash, belt and braces alongside the
  // unique-index lookup above.
  const a = Buffer.from(row.session.tokenHash, 'hex');
  const b = Buffer.from(tokenHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Touch last-seen at most once a minute to avoid a write on every request.
  if (Date.now() - row.session.lastSeenAt.getTime() > 60_000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id));
  }

  return { sessionId: row.session.id, user: row.user };
}

export async function destroySession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Used when a password changes: every other device must be signed out. */
export async function destroyUserSessions(userId: string, exceptToken?: string): Promise<void> {
  const db = getDb();
  if (exceptToken === undefined) {
    await db.delete(sessions).where(eq(sessions.userId, userId));
    return;
  }
  const keep = hashToken(exceptToken);
  const rows = await db.select({ id: sessions.id, tokenHash: sessions.tokenHash }).from(sessions).where(eq(sessions.userId, userId));
  for (const row of rows) {
    if (row.tokenHash === keep) continue;
    await db.delete(sessions).where(eq(sessions.id, row.id));
  }
}

/** Housekeeping, safe to call periodically. */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await getDb()
    .delete(sessions)
    .where(and(lt(sessions.expiresAt, new Date())))
    .returning({ id: sessions.id });
  return result.length;
}

export interface CookieOptions {
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly path: string;
  readonly maxAge?: number;
}

export function sessionCookieOptions(maxAgeSeconds?: number): CookieOptions {
  const config = loadConfig();
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
  };
}
