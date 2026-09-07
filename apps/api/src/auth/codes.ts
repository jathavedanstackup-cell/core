/**
 * One-time codes for email verification and password reset.
 *
 * Codes are six digits, stored only as a SHA-256, expire, and are limited to a
 * small number of attempts. Issuing a new code invalidates the previous one so
 * that a user who clicks "resend" three times does not leave three live codes.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import { verificationCodes } from '../db/schema.js';

export type CodePurpose = 'email_verification' | 'password_reset';

export const CODE_TTL_MINUTES = 15;
export const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Issue a fresh code, invalidating any outstanding one for the same purpose.
 * Returns the plain code; it must go straight into an email and never be
 * logged, returned by an API, or stored.
 */
export async function issueCode(userId: string, purpose: CodePurpose): Promise<string> {
  const db = getDb();

  await db
    .update(verificationCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.purpose, purpose),
        isNull(verificationCodes.consumedAt),
      ),
    );

  const code = generateCode();
  await db.insert(verificationCodes).values({
    userId,
    purpose,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
  });

  return code;
}

export type CodeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'no_code' | 'expired' | 'too_many_attempts' | 'incorrect' };

/**
 * Check a submitted code and consume it on success.
 *
 * Every failure path increments the attempt counter on the outstanding code, so
 * guessing is bounded regardless of which failure the caller triggers.
 */
export async function checkCode(
  userId: string,
  purpose: CodePurpose,
  submitted: string,
): Promise<CodeCheck> {
  const db = getDb();

  const rows = await db
    .select()
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.userId, userId),
        eq(verificationCodes.purpose, purpose),
        isNull(verificationCodes.consumedAt),
      ),
    )
    .orderBy(desc(verificationCodes.createdAt))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return { ok: false, reason: 'no_code' };

  if (row.expiresAt.getTime() <= Date.now()) {
    await db
      .update(verificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(verificationCodes.id, row.id));
    return { ok: false, reason: 'expired' };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' };
  }

  await db
    .update(verificationCodes)
    .set({ attempts: row.attempts + 1 })
    .where(eq(verificationCodes.id, row.id));

  const expected = Buffer.from(row.codeHash, 'hex');
  const actual = Buffer.from(hashCode(submitted.trim()), 'hex');
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) return { ok: false, reason: 'incorrect' };

  await db
    .update(verificationCodes)
    .set({ consumedAt: new Date() })
    .where(eq(verificationCodes.id, row.id));

  return { ok: true };
}
