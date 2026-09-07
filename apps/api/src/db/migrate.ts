/**
 * Migration runner.
 *
 * Plain .sql files applied in filename order, each inside its own transaction
 * and recorded in `_migrations`. Deliberately hand-rolled and small: the
 * production database schema is something a reviewer should be able to read in
 * full, and a generated migration graph makes that harder, not easier.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { closeDb, getPool } from './client.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export interface MigrationOutcome {
  readonly applied: string[];
  readonly skipped: string[];
}

export async function runMigrations(): Promise<MigrationOutcome> {
  await ensureMigrationsTable();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const { rows } = await getPool().query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM _migrations',
  );
  const alreadyApplied = new Map(rows.map((row) => [row.name, row.checksum]));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const name of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = alreadyApplied.get(name);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `Migration "${name}" has changed since it was applied. Migrations are immutable once ` +
            'they have run; add a new migration instead of editing this one.',
        );
      }
      skipped.push(name);
      continue;
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name, checksum) VALUES ($1, $2)', [
        name,
        checksum,
      ]);
      await client.query('COMMIT');
      applied.push(name);
    } catch (error) {
      await client.query('ROLLBACK');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration "${name}" failed and was rolled back: ${message}`);
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}

/** True when no migration file is still waiting to run. Used by /readiness. */
export async function migrationsAreUpToDate(): Promise<boolean> {
  try {
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql'));
    const { rows } = await getPool().query<{ count: string }>('SELECT count(*) FROM _migrations');
    return Number(rows[0]?.count ?? 0) >= files.length;
  } catch {
    return false;
  }
}

// pathToFileURL rather than string interpolation: on Windows a path such as
// C:\a\b has to become file:///C:/a/b, which naive concatenation gets wrong.
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  runMigrations()
    .then(async (outcome) => {
      for (const name of outcome.applied) console.log(`applied  ${name}`);
      for (const name of outcome.skipped) console.log(`current  ${name}`);
      console.log(
        outcome.applied.length === 0
          ? 'Database is already up to date.'
          : `Applied ${outcome.applied.length} migration(s).`,
      );
      await closeDb();
    })
    .catch(async (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      await closeDb();
      process.exit(1);
    });
}
