/**
 * Environment configuration, validated once at startup.
 *
 * The process refuses to start on invalid configuration rather than failing
 * later on the first request that happens to need the missing value. Optional
 * integrations (Google sign-in, real email delivery) are genuinely optional:
 * absent credentials disable the feature and say so, rather than pretending.
 */

import { z } from 'zod';

// Load a local .env when one exists, using node's own loader rather than a
// dependency. In production the platform injects the environment directly and
// there is no file, which is not an error.
try {
  process.loadEnvFile?.();
} catch {
  // No .env present. Validation below will report anything genuinely missing.
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid postgres:// URL' }),

  /**
   * PEM certificate authority for the database connection. Managed providers
   * publish one; supplying it lets us verify the server properly instead of
   * trusting whatever answers on the other end.
   */
  DATABASE_CA_CERT: z.string().optional(),

  /**
   * Escape hatch for a provider that only offers a self-signed certificate and
   * no downloadable CA. Deliberately verbose: turning off verification exposes
   * the connection to interception, so it must be a conscious choice that shows
   * up in a config review, and it is logged loudly at startup.
   */
  DATABASE_SSL_INSECURE_SKIP_VERIFY: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * Public origin of the deployment, e.g. https://core.example.com.
   *
   * Used to build OAuth redirect URIs and redirect targets, so it must come
   * from configuration rather than from a request header — see lib/origin.ts.
   * Required in production unless RENDER_EXTERNAL_URL supplies it.
   */
  APP_URL: z.string().url().optional(),

  /**
   * Injected by Render for a web service, and not influenced by any caller.
   * Present only so a Render deployment needs no configuration of its own
   * address; APP_URL takes precedence anywhere else.
   */
  RENDER_EXTERNAL_URL: z.string().url().optional(),

  /**
   * Secret used to derive the session cookie signature. Must be set explicitly
   * in production; a generated value would invalidate every session on restart.
   */
  SESSION_SECRET: z.string().min(32).optional(),

  SESSION_COOKIE_NAME: z.string().default('core_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 14),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /**
   * SMTP as a single connection string, e.g.
   * `smtps://user%40example.com:password@smtp.example.com:465`.
   *
   * Fine when you already have one. The discrete settings below exist because
   * hand-assembling this string is where people lose twenty minutes: the
   * username is itself an email address, and passwords contain characters that
   * mean something inside a URL.
   */
  SMTP_URL: z.string().optional(),

  /** Discrete SMTP settings. Used when SMTP_URL is not set. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65_535).default(465),
  SMTP_USER: z.string().optional(),
  /** Paste the provider's password or app password exactly as given. */
  SMTP_PASS: z.string().optional(),

  MAIL_FROM: z.string().default('C.O.R.E. <no-reply@core.local>'),

  /**
   * One-time escape from the chicken-and-egg problem on a fresh deployment:
   * verification needs email, and configuring email needs someone signed in.
   *
   * When this is on, the first account to register on a deployment where
   * nobody has verified yet is verified immediately and signed in. It stops
   * applying the moment any account is verified, so it cannot be used twice,
   * and it is off unless deliberately switched on.
   *
   * Turn it on, register, then remove it. It is not a substitute for
   * configuring email — everyone after the first account still needs a code.
   */
  BOOTSTRAP_FIRST_ACCOUNT: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  /** Allows anyone signed in to create the labelled demo organization. */
  DEMO_MODE_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = Readonly<z.infer<typeof schema>> & {
  readonly isProduction: boolean;
  readonly googleEnabled: boolean;
  readonly realEmailEnabled: boolean;
};

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached !== null) return cached;

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const value = parsed.data;
  const isProduction = value.NODE_ENV === 'production';

  if (
    isProduction &&
    value.APP_URL === undefined &&
    value.RENDER_EXTERNAL_URL === undefined
  ) {
    // Refuse to start rather than fall back to the Host header: that header is
    // caller-controlled behind a proxy, and it feeds OAuth redirect URIs.
    throw new Error(
      'APP_URL must be set in production, e.g. APP_URL=https://core.example.com. ' +
        'It is the address browsers reach this service on, and it cannot safely be ' +
        'guessed from a request header. On Render it is supplied automatically as ' +
        'RENDER_EXTERNAL_URL, so no setting is needed there.',
    );
  }

  if (isProduction && value.SESSION_SECRET === undefined) {
    throw new Error(
      'SESSION_SECRET must be set in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }

  const googleEnabled =
    typeof value.GOOGLE_CLIENT_ID === 'string' &&
    value.GOOGLE_CLIENT_ID.length > 0 &&
    typeof value.GOOGLE_CLIENT_SECRET === 'string' &&
    value.GOOGLE_CLIENT_SECRET.length > 0;

  // Either a full connection string, or host + user + password. Anything less
  // is treated as absent, so a half-filled configuration degrades to writing
  // codes to the log rather than failing every signup.
  const hasSmtpUrl = typeof value.SMTP_URL === 'string' && value.SMTP_URL.length > 0;
  const hasSmtpParts =
    typeof value.SMTP_HOST === 'string' &&
    value.SMTP_HOST.length > 0 &&
    typeof value.SMTP_USER === 'string' &&
    value.SMTP_USER.length > 0 &&
    typeof value.SMTP_PASS === 'string' &&
    value.SMTP_PASS.length > 0;
  const realEmailEnabled = hasSmtpUrl || hasSmtpParts;

  cached = Object.freeze({
    ...value,
    isProduction,
    googleEnabled,
    realEmailEnabled,
  });
  return cached;
}

/** Test helper: forget the memoised config so a new environment can be loaded. */
export function resetConfigForTests(): void {
  cached = null;
}
