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
   * Optional. Production serves the web app and the API from one origin, so
   * this is only needed to override what the request itself reports — behind a
   * proxy that rewrites the host, or when the browser reaches the service on a
   * different name than the proxy passes through. Leaving it unset makes a
   * deployment work with no configuration at all.
   */
  APP_URL: z.string().url().optional(),

  /**
   * Secret used to derive the session cookie signature. Must be set explicitly
   * in production; a generated value would invalidate every session on restart.
   */
  SESSION_SECRET: z.string().min(32).optional(),

  SESSION_COOKIE_NAME: z.string().default('core_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 14),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /** SMTP connection string. Without it, verification codes go to the log. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('C.O.R.E. <no-reply@core.local>'),

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

  const realEmailEnabled = typeof value.SMTP_URL === 'string' && value.SMTP_URL.length > 0;

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
