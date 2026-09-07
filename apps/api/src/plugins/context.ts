/**
 * Request context: who is calling, and which organization they are acting in.
 *
 * Authorization is resolved here from the session cookie and the membership
 * table. Nothing downstream ever reads a user id or an organization id from the
 * request body or a header, because a client can set those to anything.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';

import { loadConfig } from '../config.js';
import { resolveSession } from '../auth/session.js';
import { getDb } from '../db/client.js';
import { memberships, organizations, type OrganizationRow, type UserRow } from '../db/schema.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';

export type Role = 'ADMIN' | 'LEADER' | 'OPERATOR' | 'VIEWER';

/** Higher number means more capability. Used for "at least this role" checks. */
const ROLE_RANK: Readonly<Record<Role, number>> = Object.freeze({
  VIEWER: 0,
  OPERATOR: 1,
  LEADER: 2,
  ADMIN: 3,
});

export interface AuthContext {
  readonly user: UserRow;
  readonly sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export async function registerContext(app: FastifyInstance): Promise<void> {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const config = loadConfig();
    const token = request.cookies[config.SESSION_COOKIE_NAME];
    if (token === undefined || token.length === 0) {
      request.auth = null;
      return;
    }
    const resolved = await resolveSession(token);
    request.auth =
      resolved === null ? null : { user: resolved.user, sessionId: resolved.sessionId };
  });
}

/** The signed-in user, or 401. */
export function requireUser(request: FastifyRequest): UserRow {
  if (request.auth === null) throw unauthorized();
  return request.auth.user;
}

/**
 * The signed-in and email-verified user, or 401/403.
 *
 * Protected resources require verification; the verification endpoints
 * themselves deliberately use {@link requireUser} instead.
 */
export function requireVerifiedUser(request: FastifyRequest): UserRow {
  const user = requireUser(request);
  if (user.emailVerifiedAt === null) {
    throw forbidden('Verify your email address before using the workspace.');
  }
  return user;
}

export interface OrgContext {
  readonly user: UserRow;
  readonly org: OrganizationRow;
  readonly role: Role;
}

/**
 * Resolve the organization named in the route and confirm the caller belongs to
 * it. A non-member and a non-existent organization both produce 404, so an
 * outsider cannot use the response to learn that an id is real.
 */
export async function requireOrg(
  request: FastifyRequest,
  orgId: string,
  minimumRole: Role = 'VIEWER',
): Promise<OrgContext> {
  const user = requireVerifiedUser(request);
  const db = getDb();

  const rows = await db
    .select({ org: organizations, membership: memberships })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(and(eq(memberships.userId, user.id), eq(memberships.orgId, orgId)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    throw notFound('That organization does not exist, or you are not a member of it.');
  }

  const role = row.membership.role as Role;
  if (ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
    throw forbidden(
      `This needs the ${minimumRole} role or higher. Your role in this organization is ${role}.`,
    );
  }

  return { user, org: row.org, role };
}

/** Every organization the caller belongs to, with their role in each. */
export async function listMemberships(
  userId: string,
): Promise<{ org: OrganizationRow; role: Role }[]> {
  const rows = await getDb()
    .select({ org: organizations, membership: memberships })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, userId));

  return rows.map((row) => ({ org: row.org, role: row.membership.role as Role }));
}

/** Convenience for handlers that only need to know the caller is allowed. */
export function assertRole(context: OrgContext, minimumRole: Role): void {
  if (ROLE_RANK[context.role] < ROLE_RANK[minimumRole]) {
    throw forbidden(
      `This needs the ${minimumRole} role or higher. Your role in this organization is ${context.role}.`,
    );
  }
}

export function noStore(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store');
}
