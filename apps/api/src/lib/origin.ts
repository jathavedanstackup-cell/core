/**
 * The origin a browser actually reached this service on.
 *
 * Production serves the web app and the API from one origin, so the request
 * already carries the answer. Deriving it means a deployment needs no
 * configuration to know its own address — which is one fewer thing to get wrong
 * on the day, and one fewer reason for a sign-in redirect to break silently.
 *
 * `trustProxy` is enabled in production, so Fastify resolves protocol and host
 * from the X-Forwarded-* headers a platform sets. APP_URL still wins when it is
 * set, for the case where the proxy rewrites the host to something the browser
 * never sees.
 */

import type { FastifyRequest } from 'fastify';

import { loadConfig } from '../config.js';

export function publicOrigin(request: FastifyRequest): string {
  const configured = loadConfig().APP_URL;
  if (configured !== undefined) return configured.replace(/\/$/, '');

  const host = request.host ?? request.headers.host ?? 'localhost';
  return `${request.protocol}://${host}`;
}
