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

export function getEmailTransport(): EmailTransport {
  if (transport !== null) return transport;
  const config = loadConfig();

  if (config.realEmailEnabled && config.SMTP_URL !== undefined) {
    const client: Transporter = nodemailer.createTransport(config.SMTP_URL);
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
}
