/**
 * Authentication.
 *
 * Email and password with mandatory verification, plus optional Google sign-in.
 *
 * Two behaviours are deliberate and are covered by tests:
 *  - Registration and password reset never reveal whether an address is already
 *    registered. Both always report success; the difference is which email is
 *    sent.
 *  - Sign-in reports one message for an unknown address and a wrong password
 *    alike, so the endpoint cannot be used to enumerate accounts.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { checkCode, issueCode } from '../auth/codes.js';
import { hashPassword, passwordProblems, verifyPassword } from '../auth/password.js';
import {
  createSession,
  destroySession,
  destroyUserSessions,
  sessionCookieOptions,
} from '../auth/session.js';
import { loadConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { users, type UserRow } from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { sendPasswordResetCode, sendVerificationCode } from '../lib/email.js';
import { badRequest, notImplemented, unauthorized } from '../lib/errors.js';
import { listMemberships, requireUser } from '../plugins/context.js';

const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase());

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  email: emailSchema,
  password: z.string().min(1, 'Enter a password.').max(512),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(512),
});

const codeSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'The code is six digits.'),
});

const resetSchema = codeSchema.extend({
  password: z.string().min(1).max(512),
});

function publicUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

async function findByEmail(email: string): Promise<UserRow | undefined> {
  const rows = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig();
  const cookieName = config.SESSION_COOKIE_NAME;

  const strictLimit = {
    rateLimit: { max: 10, timeWindow: '5 minutes' },
  } as const;

  // -------------------------------------------------------------------------
  app.post('/register', { config: strictLimit }, async (request, reply) => {
    const input = registerSchema.parse(request.body);

    const problems = passwordProblems(input.password, input.email, input.name);
    if (problems.length > 0) {
      throw badRequest('That password is not strong enough.', { password: problems });
    }

    const existing = await findByEmail(input.email);

    if (existing === undefined) {
      const [created] = await getDb()
        .insert(users)
        .values({
          email: input.email,
          name: input.name,
          passwordHash: await hashPassword(input.password),
        })
        .returning();

      if (created !== undefined) {
        const code = await issueCode(created.id, 'email_verification');
        await sendVerificationCode(created.email, created.name, code);
        await recordAudit({
          actorId: created.id,
          actorEmail: created.email,
          entityType: 'user',
          entityId: created.id,
          action: 'register',
          requestId: String(request.id),
        });
      }
    } else if (existing.emailVerifiedAt === null) {
      // Unverified account: reissue rather than create a duplicate.
      const code = await issueCode(existing.id, 'email_verification');
      await sendVerificationCode(existing.email, existing.name, code);
    }
    // A verified account already exists: send nothing, say the same thing.

    void reply.status(202);
    return {
      status: 'verification_sent',
      message: `If ${input.email} can be registered, a six-digit code is on its way. It expires in 15 minutes.`,
      emailDeliveryConfigured: config.realEmailEnabled,
    };
  });

  // -------------------------------------------------------------------------
  app.post('/verify', { config: strictLimit }, async (request, reply) => {
    const input = codeSchema.parse(request.body);
    const user = await findByEmail(input.email);

    // Same failure shape whether or not the address exists.
    if (user === undefined) {
      throw badRequest('That code is not valid. Ask for a new one.');
    }

    if (user.emailVerifiedAt !== null) {
      return { status: 'already_verified', user: publicUser(user) };
    }

    const result = await checkCode(user.id, 'email_verification', input.code);
    if (!result.ok) {
      const message =
        result.reason === 'expired'
          ? 'That code has expired. Ask for a new one.'
          : result.reason === 'too_many_attempts'
            ? 'Too many incorrect attempts. Ask for a new code.'
            : 'That code is not valid. Check it and try again.';
      throw badRequest(message);
    }

    const [verified] = await getDb()
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();

    const session = await createSession(user.id, request.headers['user-agent']);
    void reply.setCookie(cookieName, session.token, sessionCookieOptions(config.SESSION_TTL_HOURS * 3600));

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      entityType: 'user',
      entityId: user.id,
      action: 'verify_email',
      requestId: String(request.id),
    });

    return { status: 'verified', user: publicUser(verified ?? user) };
  });

  // -------------------------------------------------------------------------
  app.post('/resend', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request) => {
    const { email } = z.object({ email: emailSchema }).parse(request.body);
    const user = await findByEmail(email);

    if (user !== undefined && user.emailVerifiedAt === null) {
      const code = await issueCode(user.id, 'email_verification');
      await sendVerificationCode(user.email, user.name, code);
    }

    return {
      status: 'sent',
      message: 'If that address needs verifying, a new code is on its way.',
      emailDeliveryConfigured: config.realEmailEnabled,
    };
  });

  // -------------------------------------------------------------------------
  app.post('/login', { config: strictLimit }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await findByEmail(input.email);

    const stored = user?.passwordHash ?? null;
    // Always run a verification so the response time does not reveal whether
    // the address exists.
    const decoyHash = 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const passwordOk = await verifyPassword(input.password, stored ?? decoyHash);

    if (user === undefined || stored === null || !passwordOk) {
      throw unauthorized('That email address and password do not match.');
    }

    if (user.emailVerifiedAt === null) {
      const code = await issueCode(user.id, 'email_verification');
      await sendVerificationCode(user.email, user.name, code);
      void reply.status(403);
      return {
        error: {
          code: 'email_unverified',
          message: 'Verify your email address to continue. We have sent you a new code.',
        },
        email: user.email,
      };
    }

    const session = await createSession(user.id, request.headers['user-agent']);
    void reply.setCookie(cookieName, session.token, sessionCookieOptions(config.SESSION_TTL_HOURS * 3600));

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      entityType: 'user',
      entityId: user.id,
      action: 'login',
      requestId: String(request.id),
    });

    return { status: 'signed_in', user: publicUser(user) };
  });

  // -------------------------------------------------------------------------
  app.post('/logout', async (request, reply) => {
    const token = request.cookies[cookieName];
    if (token !== undefined) await destroySession(token);
    void reply.clearCookie(cookieName, sessionCookieOptions());
    return { status: 'signed_out' };
  });

  // -------------------------------------------------------------------------
  app.get('/me', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (request.auth === null) {
      void reply.status(401);
      return { error: { code: 'unauthorized', message: 'Not signed in.' } };
    }
    const user = request.auth.user;
    const orgs = await listMemberships(user.id);
    return {
      user: publicUser(user),
      organizations: orgs.map(({ org, role }) => ({
        id: org.id,
        name: org.name,
        isDemo: org.isDemo,
        timezone: org.timezone,
        role,
      })),
      capabilities: {
        googleSignIn: config.googleEnabled,
        emailDelivery: config.realEmailEnabled,
        demoMode: config.DEMO_MODE_ENABLED,
      },
    };
  });

  // -------------------------------------------------------------------------
  app.post('/forgot-password', { config: strictLimit }, async (request) => {
    const { email } = z.object({ email: emailSchema }).parse(request.body);
    const user = await findByEmail(email);

    if (user !== undefined) {
      const code = await issueCode(user.id, 'password_reset');
      await sendPasswordResetCode(user.email, user.name, code);
    }

    return {
      status: 'sent',
      message: 'If that address has an account, a reset code is on its way.',
      emailDeliveryConfigured: config.realEmailEnabled,
    };
  });

  // -------------------------------------------------------------------------
  app.post('/reset-password', { config: strictLimit }, async (request) => {
    const input = resetSchema.parse(request.body);
    const user = await findByEmail(input.email);
    if (user === undefined) throw badRequest('That code is not valid. Ask for a new one.');

    const problems = passwordProblems(input.password, input.email, user.name);
    if (problems.length > 0) {
      throw badRequest('That password is not strong enough.', { password: problems });
    }

    const result = await checkCode(user.id, 'password_reset', input.code);
    if (!result.ok) {
      throw badRequest(
        result.reason === 'expired'
          ? 'That code has expired. Ask for a new one.'
          : 'That code is not valid. Check it and try again.',
      );
    }

    await getDb()
      .update(users)
      .set({
        passwordHash: await hashPassword(input.password),
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // A password change signs out every device, including this one.
    await destroyUserSessions(user.id);

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      entityType: 'user',
      entityId: user.id,
      action: 'reset_password',
      requestId: String(request.id),
    });

    return { status: 'password_reset', message: 'Your password has been changed. Sign in again.' };
  });

  // -------------------------------------------------------------------------
  // Google sign-in. Present in the routing table whether or not it is
  // configured, so the client gets an honest answer rather than a 404.
  app.get('/google/start', async () => {
    if (!config.googleEnabled) {
      throw notImplemented(
        'Google sign-in is not configured on this deployment. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.',
      );
    }
    const state = randomUUID();
    const params = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: `${config.APP_URL}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state };
  });

  app.get('/google/callback', async () => {
    if (!config.googleEnabled) {
      throw notImplemented(
        'Google sign-in is not configured on this deployment. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.',
      );
    }
    throw notImplemented(
      'Google sign-in is not finished. The authorization code exchange is not implemented yet, so this deployment cannot complete a Google sign-in.',
    );
  });

  // -------------------------------------------------------------------------
  app.post('/sessions/revoke-others', async (request) => {
    const user = requireUser(request);
    const token = request.cookies[cookieName];
    await destroyUserSessions(user.id, token);
    return { status: 'revoked', message: 'Every other signed-in device has been signed out.' };
  });
}
