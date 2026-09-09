/**
 * Liveness and readiness.
 *
 * /health says the process is running and must never touch the database, so a
 * database outage does not cause the orchestrator to kill otherwise healthy
 * instances. /readiness says the process can actually serve traffic, and does
 * check its dependencies.
 */

import type { FastifyInstance } from 'fastify';

import { loadConfig } from '../config.js';
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

    /*
     * Which optional integrations this instance actually has.
     *
     * Booleans only, and only about configuration this deployment's operator
     * chose — no secrets, no counts, nothing about who has an account. Without
     * it there is no way to tell from outside whether a setting reached the
     * running process, which turns every configuration problem into guesswork
     * against a black box.
     */
    const config = loadConfig();
    const configured = {
      email: config.realEmailEnabled,
      googleSignIn: config.googleEnabled,
      demoMode: config.DEMO_MODE_ENABLED,
      firstAccountBootstrap: config.BOOTSTRAP_FIRST_ACCOUNT,
    };

    void reply.status(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not_ready',
      checks,
      configured,
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
