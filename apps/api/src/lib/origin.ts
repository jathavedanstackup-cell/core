/**
 * The service's own public origin.
 *
 * This is used to build OAuth redirect URIs and redirect targets, so it must
 * never come from anything a caller controls. `trustProxy` is enabled in
 * production, which means `request.host` resolves from the `X-Forwarded-Host`
 * header — and a platform edge does not validate that header against the
 * service's real hostname. Deriving the origin from it would make two of the
 * sign-in redirects an open redirect, and would hand an attacker-chosen
 * `redirect_uri` to the OAuth exchange.
 *
 * So in production the origin comes only from configuration:
 *
 *   1. `APP_URL`, when someone has stated it explicitly.
 *   2. `RENDER_EXTERNAL_URL`, which the platform injects and a caller cannot
 *      influence. This is what keeps a Render deploy zero-configuration.
 *
 * If neither is present the process refuses to start, rather than falling back
 * to a header. Outside production the request is used, because there is no
 * proxy in front of a development server and the convenience is worth having.
 */

import type { FastifyRequest } from 'fastify';

import { loadConfig } from '../config.js';

function trim(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * The configured origin, or null when there is none.
 *
 * Exported so startup validation can demand it in production without repeating
 * the precedence rules.
 */
export function configuredOrigin(): string | null {
  const config = loadConfig();
  if (config.APP_URL !== undefined) return trim(config.APP_URL);
  if (config.RENDER_EXTERNAL_URL !== undefined) return trim(config.RENDER_EXTERNAL_URL);
  return null;
}

export function publicOrigin(request: FastifyRequest): string {
  const configured = configuredOrigin();
  if (configured !== null) return configured;

  // Production never reaches here: loadConfig refuses to start without one of
  // the two settings above. This branch exists for local development, where
  // nothing sits in front of the server and the Host header is the browser's.
  const host = request.host ?? request.headers.host ?? 'localhost';
  return `${request.protocol}://${host}`;
}
