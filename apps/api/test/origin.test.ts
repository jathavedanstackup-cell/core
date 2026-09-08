/**
 * The service's own public origin.
 *
 * This exists because an earlier version derived the origin from the request,
 * which behind a proxy means the `X-Forwarded-Host` header — something a caller
 * controls. It fed OAuth redirect URIs and two `reply.redirect` targets, so it
 * was a latent open redirect and an attacker-chosen `redirect_uri`.
 *
 * These tests hold the corrected behaviour in place.
 */

import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, resetConfigForTests } from '../src/config.js';
import { configuredOrigin, publicOrigin } from '../src/lib/origin.js';

/** Minimal stand-in carrying the fields the helper reads. */
function requestFrom(host: string, protocol = 'https'): FastifyRequest {
  return { host, protocol, headers: { host } } as unknown as FastifyRequest;
}

const BASE_ENV = {
  DATABASE_URL: 'postgresql://core:core@localhost:5433/core',
  SESSION_SECRET: 'a-secret-long-enough-to-satisfy-the-minimum-length',
};

afterEach(() => {
  // Other suites share this process and expect the real environment.
  resetConfigForTests();
  loadConfig();
});

describe('the configured origin', () => {
  it('uses APP_URL when it is set', () => {
    resetConfigForTests();
    loadConfig({ ...BASE_ENV, NODE_ENV: 'production', APP_URL: 'https://core.example.com' });
    expect(configuredOrigin()).toBe('https://core.example.com');
  });

  it('falls back to the platform-supplied URL, which no caller can influence', () => {
    resetConfigForTests();
    loadConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      RENDER_EXTERNAL_URL: 'https://core-abc.onrender.com',
    });
    expect(configuredOrigin()).toBe('https://core-abc.onrender.com');
  });

  it('prefers an explicit APP_URL over the platform value', () => {
    resetConfigForTests();
    loadConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      APP_URL: 'https://core.example.com',
      RENDER_EXTERNAL_URL: 'https://core-abc.onrender.com',
    });
    expect(configuredOrigin()).toBe('https://core.example.com');
  });

  it('trims a trailing slash, so redirect URIs never double up', () => {
    resetConfigForTests();
    loadConfig({ ...BASE_ENV, NODE_ENV: 'production', APP_URL: 'https://core.example.com/' });
    expect(configuredOrigin()).toBe('https://core.example.com');
  });
});

describe('production startup', () => {
  it('refuses to start with no origin configured, rather than guessing from a header', () => {
    resetConfigForTests();
    expect(() => loadConfig({ ...BASE_ENV, NODE_ENV: 'production' })).toThrow(/APP_URL must be set/);
  });

  it('names the platform variable in the message, so the fix is obvious', () => {
    resetConfigForTests();
    expect(() => loadConfig({ ...BASE_ENV, NODE_ENV: 'production' })).toThrow(
      /RENDER_EXTERNAL_URL/,
    );
  });
});

describe('host header injection', () => {
  it('ignores a spoofed forwarded host in production', () => {
    resetConfigForTests();
    loadConfig({ ...BASE_ENV, NODE_ENV: 'production', APP_URL: 'https://core.example.com' });

    // This is what an attacker sends: their own hostname, which a proxy may
    // pass through untouched as X-Forwarded-Host.
    const spoofed = requestFrom('evil.example.net');

    expect(publicOrigin(spoofed)).toBe('https://core.example.com');
    expect(publicOrigin(spoofed)).not.toContain('evil');
  });

  it('is not influenced by the host even when the platform variable supplied the origin', () => {
    resetConfigForTests();
    loadConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      RENDER_EXTERNAL_URL: 'https://core-abc.onrender.com',
    });
    expect(publicOrigin(requestFrom('evil.example.net'))).toBe('https://core-abc.onrender.com');
  });

  it('uses the request only in development, where nothing sits in front', () => {
    resetConfigForTests();
    loadConfig({ ...BASE_ENV, NODE_ENV: 'development' });
    expect(publicOrigin(requestFrom('localhost:5173', 'http'))).toBe('http://localhost:5173');
  });
});
