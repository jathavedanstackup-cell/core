/**
 * Mail configuration.
 *
 * The failure this guards against is a half-filled form: a host typed in but no
 * password, say. Treating that as "email is configured" would make every signup
 * fail at the send, which looks like a broken product. Treating it as absent
 * writes the code to the log instead, which the interface explains on screen.
 */

import { describe, expect, it, afterEach } from 'vitest';

import { loadConfig, resetConfigForTests } from '../src/config.js';
import { getEmailTransport, resetEmailTransportForTests } from '../src/lib/email.js';

const BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://core:pw@localhost:5433/core',
  SESSION_SECRET: 'x'.repeat(48),
  APP_URL: 'https://core.example.com',
};

function load(extra: Record<string, string>) {
  resetConfigForTests();
  resetEmailTransportForTests();
  return loadConfig({ ...BASE, ...extra } as NodeJS.ProcessEnv);
}

afterEach(() => {
  resetConfigForTests();
  resetEmailTransportForTests();
  loadConfig();
});

describe('deciding whether email can be sent', () => {
  it('is off when nothing is set', () => {
    expect(load({}).realEmailEnabled).toBe(false);
    expect(getEmailTransport().kind).toBe('log');
  });

  it('is on with the four discrete Gmail settings', () => {
    const config = load({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_USER: 'someone@gmail.com',
      SMTP_PASS: 'abcdefghijklmnop',
    });
    expect(config.realEmailEnabled).toBe(true);
    expect(getEmailTransport().kind).toBe('smtp');
  });

  it('is on with a connection string alone', () => {
    const config = load({ SMTP_URL: 'smtps://u%40x.com:p@smtp.example.com:465' });
    expect(config.realEmailEnabled).toBe(true);
    expect(getEmailTransport().kind).toBe('smtp');
  });

  // Each of these is a plausible half-finished configuration. None of them may
  // count as working, or every signup breaks at the send.
  for (const [label, partial] of [
    ['host only', { SMTP_HOST: 'smtp.gmail.com' }],
    ['host and user, no password', { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'a@b.com' }],
    ['user and password, no host', { SMTP_USER: 'a@b.com', SMTP_PASS: 'secret' }],
    ['blank strings', { SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' }],
  ] as const) {
    it(`falls back to the log with ${label}`, () => {
      expect(load(partial).realEmailEnabled).toBe(false);
      expect(getEmailTransport().kind).toBe('log');
    });
  }

  it('lets a connection string win over the discrete settings', () => {
    const config = load({
      SMTP_URL: 'smtps://u%40x.com:p@smtp.example.com:465',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'someone@gmail.com',
      SMTP_PASS: 'abcdefghijklmnop',
    });
    expect(config.realEmailEnabled).toBe(true);
    expect(config.SMTP_URL).toContain('smtp.example.com');
  });

  it('defaults the port to implicit TLS', () => {
    expect(load({}).SMTP_PORT).toBe(465);
  });
});
