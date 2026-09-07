/**
 * Audit trail.
 *
 * Append-only. Writes never throw into the caller: failing to record an audit
 * line must not roll back the business change that just succeeded, but it must
 * be loud in the log.
 *
 * Secrets are stripped here as a backstop. Call sites are expected not to pass
 * them, but a single missed field should not become a password in the database.
 */

import { getDb } from '../db/client.js';
import { auditEvents } from '../db/schema.js';

const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'tokenhash',
  'token_hash',
  'code',
  'codehash',
  'code_hash',
  'secret',
  'authorization',
  'cookie',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(nested, depth + 1);
  }
  return out;
}

export interface AuditInput {
  readonly orgId?: string | null;
  readonly actorId?: string | null;
  readonly actorEmail?: string | null;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly action: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly requestId?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await getDb()
      .insert(auditEvents)
      .values({
        orgId: input.orgId ?? null,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        action: input.action,
        before: input.before === undefined ? null : redact(input.before),
        after: input.after === undefined ? null : redact(input.after),
        requestId: input.requestId ?? null,
      });
  } catch (error) {
    console.error(
      '[audit] failed to record event',
      input.entityType,
      input.action,
      error instanceof Error ? error.message : error,
    );
  }
}
