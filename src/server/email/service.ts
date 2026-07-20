export type EmailMessage = {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
};

export interface EmailService {
  send(message: EmailMessage): Promise<EmailSendResult>;
  isHealthy(): Promise<boolean>;
}
