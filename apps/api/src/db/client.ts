/**
 * Database connection.
 *
 * One pool per process. The pool is created lazily so that importing a module
 * for a unit test does not open a socket.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { loadConfig, type Config } from '../config.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

/**
 * TLS settings for the database connection.
 *
 * Production verifies the server certificate. A managed provider's CA can be
 * supplied through DATABASE_CA_CERT; verification is only skipped when someone
 * explicitly asks for it, and that choice is announced at startup so it cannot
 * quietly become permanent.
 */
function resolveSsl(config: Config): pg.PoolConfig['ssl'] {
  if (!config.isProduction) return false;

  if (config.DATABASE_SSL_INSECURE_SKIP_VERIFY) {
    console.warn(
      '[db] TLS certificate verification is DISABLED for the database connection. ' +
        'The connection is encrypted but not authenticated, so it can be intercepted. ' +
        'Set DATABASE_CA_CERT to the provider CA and remove DATABASE_SSL_INSECURE_SKIP_VERIFY.',
    );
    return { rejectUnauthorized: false };
  }

  if (config.DATABASE_CA_CERT !== undefined && config.DATABASE_CA_CERT.length > 0) {
    return { rejectUnauthorized: true, ca: config.DATABASE_CA_CERT };
  }

  return { rejectUnauthorized: true };
}

let pool: pg.Pool | null = null;
let database: Database | null = null;

export function getPool(): pg.Pool {
  if (pool === null) {
    const config = loadConfig();
    pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: resolveSsl(config),
    });

    pool.on('error', (error) => {
      // An idle client erroring must not take the process down.
      console.error('[db] idle client error', error.message);
    });
  }
  return pool;
}

export function getDb(): Database {
  if (database === null) {
    database = drizzle(getPool(), { schema });
  }
  return database;
}

export async function closeDb(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
    database = null;
  }
}

/** True when the database answers a trivial query. Used by /readiness. */
export async function pingDatabase(): Promise<boolean> {
  try {
    const result = await getPool().query('SELECT 1 AS ok');
    return result.rows.length === 1;
  } catch {
    return false;
  }
}
