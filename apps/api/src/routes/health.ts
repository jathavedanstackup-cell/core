/**
 * Liveness and readiness.
 *
 * /health says the process is running and must never touch the database, so a
 * database outage does not cause the orchestrator to kill otherwise healthy
 * instances. /readiness says the process can actually serve traffic, and does
 * check its dependencies.
 */

import type { FastifyInstance } from 'fastify';

import { pingDatabase } from '../db/client.js';
import { migrationsAreUpToDate } from '../db/migrate.js';

const startedAt = Date.now();

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    };
  });

  app.get('/readiness', async (_request, reply) => {
    reply.header('cache-control', 'no-store');

    const [database, migrations] = await Promise.all([pingDatabase(), migrationsAreUpToDate()]);
    const checks = { database, migrations };
    const ready = database && migrations;

    void reply.status(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not_ready',
      checks,
      ...(ready
        ? {}
        : {
            detail: !database
              ? 'The database is not reachable.'
              : 'Migrations have not all been applied. Run: npm run migrate --workspace @core/api',
          }),
    };
  });
}
