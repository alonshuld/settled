import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Sends through Resend when RESEND_API_KEY is set, otherwise through Mailpit's HTTP API. */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(mail: Mail): Promise<void> {
    const from = this.config.get('EMAIL_FROM', { infer: true });
    const key = this.config.get('RESEND_API_KEY', { infer: true });
    const res = key
      ? await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
        })
      : await fetch(`${this.config.get('MAILPIT_URL', { infer: true })}/api/v1/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            From: { Email: 'no-reply@settled.local', Name: 'Shulam' },
            To: [{ Email: mail.to }],
            Subject: mail.subject,
            Text: mail.text,
          }),
        });
    if (!res.ok) {
      this.logger.error(`email send failed: ${res.status}`);
      throw new Error(`Email delivery failed (${res.status})`);
    }
  }

  sendLoginCode(to: string, code: string) {
    return this.send({
      to,
      subject: `${code} is your Shulam code · הקוד שלך לשולם`,
      text: `Your Shulam login code is ${code}. It expires in 10 minutes.\n\nקוד ההתחברות שלך לשולם הוא ${code}. תקף ל-10 דקות.`,
    });
  }
}
