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

import type { FastifyInstance } from 'fastify';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { checkCode, issueCode } from '../auth/codes.js';
import {
  buildAuthorizationUrl,
  exchangeCode,
  STATE_COOKIE,
  stateMatches,
} from '../auth/google.js';
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
import { AppError, badRequest, notImplemented, unauthorized } from '../lib/errors.js';
import { publicOrigin } from '../lib/origin.js';
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

/**
 * An arbitrary but fixed key identifying the bootstrap lock.
 *
 * Advisory locks are namespaced only by this number, so it must not collide
 * with any other advisory lock the application takes. It is currently the only
 * one.
 */
const BOOTSTRAP_LOCK_KEY = 4_207_310_001;

/**
 * Claim the single bootstrap account, atomically.
 *
 * Returns the verified row if this caller won, or null if somebody had already
 * verified — including a request that arrived microseconds earlier.
 *
 * The advisory lock is what makes this safe. Reading "has anybody verified?"
 * and then writing would be a time-of-check-to-time-of-use race, and here the
 * race matters: two concurrent registrations could each see an empty table and
 * each be granted a verified account, which is exactly the one thing this
 * feature promises cannot happen. The lock serialises the path across every
 * connection and every instance, and Postgres releases it when the transaction
 * ends, including on error.
 *
 * Counting *verified* accounts rather than rows is deliberate: an abandoned
 * half-finished signup, or a stranger poking at the URL, must not lock the
 * operator out of their own fresh deployment.
 */
async function claimBootstrapAccount(userId: string): Promise<UserRow | null> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);

    const alreadyVerified = await tx
      .select({ id: users.id })
      .from(users)
      .where(isNotNull(users.emailVerifiedAt))
      .limit(1);
    if (alreadyVerified.length > 0) return null;

    const [claimed] = await tx
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    return claimed ?? null;
  });
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

    /*
     * The account this registration is about, or undefined when there is
     * nothing to do.
     *
     * A brand new address creates a row. An address that exists but was never
     * verified is picked up rather than duplicated — somebody abandoning a
     * signup and starting again is ordinary, not an error. An address that is
     * already verified yields nothing: the response is identical either way, so
     * this endpoint cannot be used to discover who has an account.
     *
     * Resolving the account before deciding what to do with it is deliberate.
     * The first version only reached the bootstrap when it had just inserted a
     * row, so the one person most likely to need it — the operator, who had
     * already tried once and given up at the verification screen — could never
     * get it.
     */
    let account: UserRow | undefined;

    if (existing === undefined) {
      const [created] = await getDb()
        .insert(users)
        .values({
          email: input.email,
          name: input.name,
          passwordHash: await hashPassword(input.password),
        })
        .returning();

      account = created;

      if (created !== undefined) {
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
      account = existing;
    }

    if (account !== undefined) {
      /*
       * The bootstrap account.
       *
       * A fresh deployment has a circular problem: verifying an address needs
       * email, and configuring email needs somebody signed in to do it. This
       * breaks the circle exactly once.
       *
       * Three conditions, all required. The operator has switched it on
       * deliberately; nobody has verified yet, so there is no account to
       * impersonate and no data to reach; and the person registering is
       * therefore whoever just deployed this. The second condition makes it
       * self-disabling — once this account exists, it can never fire again,
       * whether or not the flag is left on.
       *
       * "Check, then write" is a race here, and the race defeats the entire
       * point: two registrations arriving together could both read an empty
       * table and both be verified. So the read and the write happen inside
       * one transaction holding an advisory lock, which serialises this path
       * across every connection and every instance. The loser of the race
       * sees the winner's row and falls through to an ordinary code.
       */
      const claimed = config.BOOTSTRAP_FIRST_ACCOUNT
        ? await claimBootstrapAccount(account.id)
        : null;

      if (claimed !== null) {
        const session = await createSession(account.id, request.headers['user-agent']);
        void reply.setCookie(
          cookieName,
          session.token,
          sessionCookieOptions(config.SESSION_TTL_HOURS * 3600),
        );

        request.log.warn(
          { email: account.email },
          'BOOTSTRAP_FIRST_ACCOUNT: this deployment had no verified accounts, so this one was ' +
            'verified without a code and signed in. No further account can use this path. ' +
            'Remove BOOTSTRAP_FIRST_ACCOUNT and configure SMTP.',
        );

        await recordAudit({
          actorId: account.id,
          actorEmail: account.email,
          entityType: 'user',
          entityId: account.id,
          action: 'bootstrap_first_account',
          requestId: String(request.id),
        });

        void reply.status(201);
        return {
          status: 'signed_in',
          bootstrapped: true,
          message:
            'This deployment had no verified accounts, so yours was account and signed in ' +
            'directly. Nobody else can use that route — everyone from here on needs a code.',
          user: publicUser(claimed),
          emailDeliveryConfigured: config.realEmailEnabled,
        };
      }

    // Not bootstrapped: the ordinary path. Issuing a new code consumes any
    // outstanding one, so a second attempt never leaves two codes live.
    const code = await issueCode(account.id, 'email_verification');
    await sendVerificationCode(account.email, account.name, code);
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
        // The client needs this to tell the user where the code actually went.
        emailDeliveryConfigured: config.realEmailEnabled,
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
  app.get('/google/start', async (request, reply) => {
    if (!config.googleEnabled) {
      throw notImplemented(
        'Google sign-in is not configured on this deployment. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.',
      );
    }

    const { url, state } = buildAuthorizationUrl(config, publicOrigin(request));

    // The state is held in a short-lived httpOnly cookie and compared on the
    // way back, so a forged callback cannot sign anybody in.
    void reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      path: '/api/v1/auth',
      maxAge: 600,
    });

    return { url };
  });

  app.get('/google/callback', async (request, reply) => {
    const back = (message: string): void => {
      // Errors return the person to the sign-in page with something readable,
      // rather than leaving them on a bare API response.
      const target = new URL('/welcome', publicOrigin(request));
      target.searchParams.set('step', 'sign-in');
      target.searchParams.set('error', message);
      void reply.redirect(target.toString(), 303);
    };

    if (!config.googleEnabled) {
      back('Google sign-in is not configured on this deployment.');
      return;
    }

    const query = z
      .object({
        code: z.string().min(1).optional(),
        state: z.string().min(1).optional(),
        error: z.string().optional(),
      })
      .parse(request.query);

    void reply.clearCookie(STATE_COOKIE, { path: '/api/v1/auth' });

    if (query.error !== undefined) {
      back('Google sign-in was cancelled.');
      return;
    }

    const expected = request.cookies[STATE_COOKIE];
    if (
      query.state === undefined ||
      expected === undefined ||
      !stateMatches(query.state, expected)
    ) {
      back('That sign-in link has expired. Try again.');
      return;
    }
    if (query.code === undefined) {
      back('Google did not return an authorization code.');
      return;
    }

    let identity;
    try {
      identity = await exchangeCode(config, query.code, publicOrigin(request));
    } catch (error) {
      back(error instanceof AppError ? error.message : 'Google sign-in failed. Try again.');
      return;
    }

    const db = getDb();
    let user = (
      await db.select().from(users).where(eq(users.googleSubject, identity.subject)).limit(1)
    )[0];

    if (user === undefined) {
      // Link to an existing account with the same address. Safe because Google
      // has told us the address is verified, and we refuse it otherwise.
      const existing = await findByEmail(identity.email);
      if (existing !== undefined) {
        const [linked] = await db
          .update(users)
          .set({
            googleSubject: identity.subject,
            emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning();
        user = linked ?? existing;
      } else {
        const [created] = await db
          .insert(users)
          .values({
            email: identity.email,
            name: identity.name,
            googleSubject: identity.subject,
            emailVerifiedAt: new Date(),
          })
          .returning();
        user = created;
      }
    }

    if (user === undefined) {
      back('Could not create an account for that Google profile.');
      return;
    }

    const session = await createSession(user.id, request.headers['user-agent']);
    void reply.setCookie(
      cookieName,
      session.token,
      sessionCookieOptions(config.SESSION_TTL_HOURS * 3600),
    );

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      entityType: 'user',
      entityId: user.id,
      action: 'login_google',
      requestId: String(request.id),
    });

    void reply.redirect(publicOrigin(request), 303);
  });

  // -------------------------------------------------------------------------
  app.post('/sessions/revoke-others', async (request) => {
    const user = requireUser(request);
    const token = request.cookies[cookieName];
    await destroyUserSessions(user.id, token);
    return { status: 'revoked', message: 'Every other signed-in device has been signed out.' };
  });
}
