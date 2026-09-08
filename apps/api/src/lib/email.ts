/**
 * Outbound email.
 *
 * Without SMTP credentials the transport writes to the log instead of silently
 * dropping the message. Verification then still works end to end in local
 * development, and the log line says plainly that no email was actually sent.
 */

import nodemailer, { type Transporter } from 'nodemailer';

import { loadConfig } from '../config.js';

export interface Message {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailTransport {
  readonly kind: 'smtp' | 'log';
  send(message: Message): Promise<void>;
}

let transport: EmailTransport | null = null;
let smtpClient: Transporter | null = null;

/**
 * Prove the SMTP credentials work, at startup rather than at the first signup.
 *
 * Without this a wrong password is invisible until somebody tries to register,
 * and then it looks like the product is broken. Never throws: mail being down
 * is not a reason to refuse to serve the application.
 */
export async function verifyEmailTransport(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  getEmailTransport();
  if (smtpClient === null) return { ok: false, reason: 'no SMTP configured' };

  try {
    await smtpClient.verify();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Gmail's rejection is famously opaque; say what it actually means.
    const hint = /invalid login|username and password not accepted|535/i.test(message)
      ? ' Gmail rejects a normal account password here — it needs a 16-character App Password, ' +
        'which requires 2-step verification to be switched on.'
      : '';
    return { ok: false, reason: message + hint };
  }
}

export function getEmailTransport(): EmailTransport {
  if (transport !== null) return transport;
  const config = loadConfig();

  if (config.realEmailEnabled) {
    // A full connection string wins when given; otherwise assemble from the
    // discrete settings, which is the path that avoids URL-escaping mistakes.
    const client: Transporter =
      config.SMTP_URL !== undefined && config.SMTP_URL.length > 0
        ? nodemailer.createTransport(config.SMTP_URL)
        : nodemailer.createTransport({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            // 465 is implicit TLS; 587 upgrades with STARTTLS.
            secure: config.SMTP_PORT === 465,
            auth: {
              user: config.SMTP_USER ?? '',
              // Providers show app passwords in spaced groups of four, and
              // people paste them that way. The spaces are presentation only.
              pass: (config.SMTP_PASS ?? '').replace(/\s+/g, ''),
            },
          });

    smtpClient = client;
    transport = {
      kind: 'smtp',
      async send(message) {
        await client.sendMail({
          from: config.MAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
      },
    };
    return transport;
  }

  transport = {
    kind: 'log',
    async send(message) {
      console.warn(
        [
          '',
          '  ┌─ EMAIL NOT SENT (no SMTP_URL configured) ─────────────────',
          `  │ To:      ${message.to}`,
          `  │ Subject: ${message.subject}`,
          '  │',
          ...message.text.split('\n').map((line) => `  │ ${line}`),
          '  └───────────────────────────────────────────────────────────',
          '',
        ].join('\n'),
      );
    },
  };
  return transport;
}

export async function sendVerificationCode(to: string, name: string, code: string): Promise<void> {
  await getEmailTransport().send({
    to,
    subject: 'Your C.O.R.E. verification code',
    text: [
      `Hello ${name},`,
      '',
      'Your verification code is:',
      '',
      `    ${code}`,
      '',
      'It expires in 15 minutes. If you did not create a C.O.R.E. account, you can',
      'ignore this message and no account will be activated.',
      '',
      'C.O.R.E. — Continuity, Operations, Risk & Execution',
    ].join('\n'),
  });
}

export async function sendPasswordResetCode(to: string, name: string, code: string): Promise<void> {
  await getEmailTransport().send({
    to,
    subject: 'Reset your C.O.R.E. password',
    text: [
      `Hello ${name},`,
      '',
      'Use this code to set a new password:',
      '',
      `    ${code}`,
      '',
      'It expires in 15 minutes. If you did not ask to reset your password, you can',
      'ignore this message; your current password will keep working.',
      '',
      'C.O.R.E. — Continuity, Operations, Risk & Execution',
    ].join('\n'),
  });
}

export function resetEmailTransportForTests(): void {
  transport = null;
  smtpClient = null;
}
