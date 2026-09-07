/**
 * Password hashing.
 *
 * scrypt from node's own crypto rather than a native dependency: it is memory
 * hard, it is in the standard library, and it needs no build toolchain on the
 * machines this has to run on.
 *
 * The stored format is `scrypt$N$r$p$salt$hash`, all base64url. Keeping the
 * parameters in the string means the cost can be raised later without
 * invalidating existing passwords.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Cost parameters. N=2^16 targets roughly 100ms on current server hardware. */
const PARAMS = { N: 65_536, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** scrypt needs headroom above 128 * N * r bytes or it refuses to run. */
const MAX_MEM = 256 * PARAMS.N * PARAMS.r;

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  });
  return [
    'scrypt',
    String(PARAMS.N),
    String(PARAMS.r),
    String(PARAMS.p),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for malformed stored values rather than throwing, so that a
 * corrupted row cannot be distinguished from a wrong password by an attacker
 * watching for a 500.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [scheme, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  if (scheme !== 'scrypt') return false;
  if (nRaw === undefined || rRaw === undefined || pRaw === undefined) return false;
  if (saltRaw === undefined || hashRaw === undefined) return false;

  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  let salt: Buffer;
  try {
    expected = Buffer.from(hashRaw, 'base64url');
    salt = Buffer.from(saltRaw, 'base64url');
  } catch {
    return false;
  }
  if (expected.length === 0 || salt.length === 0) return false;

  try {
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(MAX_MEM, 256 * N * r),
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Reasons a password is unacceptable, empty when it is fine. */
export function passwordProblems(password: string, email: string, name: string): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > 512) {
    problems.push('Use fewer than 512 characters.');
  }
  const lowered = password.toLowerCase();
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 3 && lowered.includes(localPart)) {
    problems.push('Do not include your email address.');
  }
  if (name.length >= 3 && lowered.includes(name.toLowerCase())) {
    problems.push('Do not include your name.');
  }
  return problems;
}
