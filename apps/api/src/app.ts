/**
 * Fastify application factory.
 *
 * Kept separate from the process entry point so tests can build an instance,
 * drive it through `inject`, and tear it down without binding a port.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { loadConfig } from './config.js';
import { AppError } from './lib/errors.js';
import { configuredOrigin } from './lib/origin.js';
import { registerContext } from './plugins/context.js';
import { registerActionRoutes } from './routes/actions.js';
import { registerAssessmentRoutes } from './routes/assessment.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerExerciseRoutes } from './routes/exercises.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImprovementRoutes } from './routes/improvements.js';
import { registerIncidentRoutes } from './routes/incidents.js';
import { registerModelRoutes } from './routes/model.js';
import { registerOrganizationRoutes } from './routes/organizations.js';
import { registerReportRoutes } from './routes/reports.js';

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.code',
        ],
        censor: '[redacted]',
      },
    },
    // Fastify generates a request id already; make it visible to clients so a
    // user can quote it when something goes wrong.
    genReqId: () => crypto.randomUUID(),
    trustProxy: config.isProduction,
    bodyLimit: 5 * 1024 * 1024,
  });

  // Production serves the web app from this same origin, so cross-origin
  // requests are not part of the design: only the service's own configured
  // origin is allowed. Development allows any origin for the Vite dev server.
  await app.register(cors, {
    origin: config.isProduction ? (configuredOrigin() ?? false) : true,
    credentials: true,
  });

  await app.register(cookie, {
    ...(config.SESSION_SECRET === undefined ? {} : { secret: config.SESSION_SECRET }),
  });

  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    return undefined;
  });

  await registerContext(app);

  /*
   * Authentication runs before input validation, everywhere under /api/v1.
   *
   * Handlers parse their parameters with Zod and only then call requireOrg, so
   * an anonymous caller sending a malformed id got a 400 describing the
   * validation failure instead of a 401. That is feedback about a protected
   * endpoint given to someone with no credentials, and it made the API answer
   * inconsistently — 401 for a well-formed id, 400 for a malformed one.
   *
   * This gate closes that: no session, no answer, whatever the payload looks
   * like. The /api/v1/auth routes are exempt because signing in is how a
   * session is obtained in the first place; each of those handles its own
   * authorization.
   */
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/v1/')) return;
    if (path.startsWith('/api/v1/auth/')) return;
    if (request.auth !== null) return;

    // Only guard routes that actually exist. Fastify runs preHandler hooks for
    // the not-found handler too, and answering 401 for a route that is not
    // there would be a lie — it implies signing in would produce something.
    // The source is public anyway, so the route map is not a secret worth
    // keeping.
    if (request.routeOptions.url === undefined) return;

    void reply.status(401).send({
      error: { code: 'unauthorized', message: 'You need to sign in to do that.' },
      requestId: request.id,
    });
  });

  // Error handling is installed BEFORE the routes. Awaiting `register`
  // loads each plugin immediately, and a child context copies whatever
  // error handler the parent has at the moment it is created -- so
  // registering routes first would leave them on Fastify's default
  // handler and leak its error shape to clients.
  // In production the API also serves the built web app. One origin means the
  // session cookie is first-party and CORS never enters the picture.
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const servingWeb = existsSync(join(webRoot, 'index.html'));
  if (servingWeb) {
    await app.register(fastifyStatic, { root: webRoot, index: false, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    // Anything that is not an API route and not a file is a client-side route,
    // so hand back the app shell and let the router resolve it.
    //
    // HEAD as well as GET: uptime monitors and link checkers routinely use HEAD,
    // and answering 404 to those while GET returns the app would have the site
    // reported as down while it was serving perfectly. Node omits the body on a
    // HEAD response by itself, so the same handler is correct for both.
    if (
      servingWeb &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      !request.url.startsWith('/api/') &&
      request.url !== '/health' &&
      request.url !== '/readiness'
    ) {
      void reply.type('text/html').sendFile('index.html');
      return;
    }

    void reply.status(404).send({
      error: { code: 'not_found', message: `No route for ${request.method} ${request.url}.` },
      requestId: request.id,
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
        requestId: request.id,
      });
      return;
    }

    if (error instanceof ZodError) {
      void reply.status(400).send({
        error: {
          code: 'validation_failed',
          message: 'Some of the information sent was not valid.',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
        requestId: request.id,
      });
      return;
    }

    if (error.statusCode === 429) {
      void reply.status(429).send({
        error: { code: 'too_many_requests', message: 'Too many attempts. Try again shortly.' },
        requestId: request.id,
      });
      return;
    }

    // Anything unrecognised is a bug. Log it in full, tell the client nothing
    // beyond an id they can quote.
    request.log.error({ err: error }, 'unhandled error');
    void reply.status(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side. Quote the request id if you report this.',
      },
      requestId: request.id,
    });
  });


  await app.register(registerHealthRoutes);
  await app.register(registerAuthRoutes, { prefix: '/api/v1/auth' });
  await app.register(registerOrganizationRoutes, { prefix: '/api/v1/organizations' });
  await app.register(registerModelRoutes, { prefix: '/api/v1/model' });
  await app.register(registerAssessmentRoutes, { prefix: '/api/v1' });
  await app.register(registerActionRoutes, { prefix: '/api/v1/actions' });
  await app.register(registerIncidentRoutes, { prefix: '/api/v1/incidents' });
  await app.register(registerExerciseRoutes, { prefix: '/api/v1/exercises' });
  await app.register(registerImprovementRoutes, { prefix: '/api/v1/improvements' });
  await app.register(registerReportRoutes, { prefix: '/api/v1/reports' });
  await app.register(registerAuditRoutes, { prefix: '/api/v1/audit' });

  return app;
}
