/**
 * Google sign-in.
 *
 * The authorization-code flow, server side.
 *
 * On verifying the ID token: it is fetched by this server directly from
 * Google's token endpoint over TLS, in a request authenticated with our client
 * secret. Google's own guidance is that a token obtained that way does not need
 * its signature checked, because the transport already establishes who sent it.
 * We still validate the claims that matter — issuer, audience, expiry, and that
 * the address is verified — since those describe the token's *content* rather
 * than its origin.
 *
 * A signature check would be required if the token arrived from the browser.
 * It never does here.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Config } from '../config.js';
import { badRequest } from '../lib/errors.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export const STATE_COOKIE = 'core_oauth_state';

export interface GoogleIdentity {
  readonly subject: string;
  readonly email: string;
  readonly name: string;
  readonly emailVerified: boolean;
}

export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/v1/auth/google/callback`;
}

/** A random state value plus the URL to send the browser to. */
export function buildAuthorizationUrl(
  config: Config,
  origin: string,
): { url: string; state: string } {
  const state = randomBytes(24).toString('base64url');
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    // Google returns no refresh token without this, and we do not need one:
    // sessions are ours, not Google's.
    access_type: 'online',
  });
  return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state };
}

/** Constant-time comparison of the returned state against the one we issued. */
export function stateMatches(returned: string, expected: string): boolean {
  const a = createHash('sha256').update(returned).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

interface TokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  exp?: number;
}

function decodeIdToken(idToken: string): IdTokenClaims {
  const payload = idToken.split('.')[1];
  if (payload === undefined) throw badRequest('Google returned a malformed token.');
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IdTokenClaims;
  } catch {
    throw badRequest('Google returned a token that could not be read.');
  }
}

/**
 * Exchange the authorization code for an identity.
 *
 * Throws a user-facing error on anything unexpected; the caller turns that into
 * a redirect carrying a message rather than a raw error page.
 */
export async function exchangeCode(
  config: Config,
  code: string,
  origin: string,
): Promise<GoogleIdentity> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID ?? '',
      client_secret: config.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri(origin),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const body = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok || body.id_token === undefined) {
    // Google's error text can name the client; keep it out of the user's view.
    throw badRequest(
      'Google could not complete the sign-in. Try again, or use an email address and password.',
    );
  }

  const claims = decodeIdToken(body.id_token);

  if (claims.iss === undefined || !ISSUERS.has(claims.iss)) {
    throw badRequest('That sign-in did not come from Google.');
  }
  if (claims.aud !== config.GOOGLE_CLIENT_ID) {
    throw badRequest('That sign-in was issued for a different application.');
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) {
    throw badRequest('That sign-in has expired. Try again.');
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw badRequest('Google did not identify the account.');
  }
  if (typeof claims.email !== 'string' || claims.email.length === 0) {
    throw badRequest('That Google account has no email address available.');
  }

  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (!emailVerified) {
    // Accepting an unverified address would let anyone claiming it take over a
    // C.O.R.E. account registered with the same address.
    throw badRequest('That Google account has an unverified email address.');
  }

  return {
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === 'string' && claims.name.length > 0 ? claims.name : claims.email,
    emailVerified,
  };
}
