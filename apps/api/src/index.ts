/**
 * Process entry point.
 *
 * Migrations run before the server starts listening, so an instance never
 * accepts traffic against a schema it does not understand. Shutdown drains
 * in-flight requests before closing the database.
 */

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closeDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const outcome = await runMigrations();
  if (outcome.applied.length > 0) {
    console.log(`[startup] applied ${outcome.applied.length} migration(s)`);
  }

  const app = await buildApp();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => closeDb())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown');
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    {
      env: config.NODE_ENV,
      googleSignIn: config.googleEnabled,
      emailDelivery: config.realEmailEnabled ? 'smtp' : 'log-only',
      demoMode: config.DEMO_MODE_ENABLED,
    },
    'C.O.R.E. API ready',
  );
}

main().catch((error: unknown) => {
  console.error('[startup] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
