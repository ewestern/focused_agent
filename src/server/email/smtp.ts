import nodemailer, { type Transporter } from "nodemailer";

import type {
  EmailMessage,
  EmailSendResult,
  EmailService,
} from "@/server/email/service";
import { getServerEnv, type ServerEnv } from "@/server/env";

export class SmtpEmailService implements EmailService {
  constructor(private readonly transporter: Transporter) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const result = await this.transporter.sendMail(message);
    return {
      messageId: result.messageId,
      accepted: result.accepted.map(String),
      rejected: result.rejected.map(String),
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await this.transporter.verify();
    } catch {
      return false;
    }
  }
}

export function createSmtpEmailService(
  env: ServerEnv = getServerEnv(),
): SmtpEmailService {
  return new SmtpEmailService(
    nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
    }),
  );
}

let sharedEmailService: SmtpEmailService | undefined;

export function getEmailService(): SmtpEmailService {
  sharedEmailService ??= createSmtpEmailService();
  return sharedEmailService;
}
