import { Injectable, Logger } from "@nestjs/common";

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
  notificationId: string;
}

// Dev transport: logs instead of speaking SMTP. This interface is where a real
// provider (SES, Postmark, nodemailer) plugs in later — nothing upstream
// changes. Recipients whose address starts with "fail-" throw deliberately so
// queue retries and permanent failure can be exercised end-to-end.
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  async send(mail: OutgoingMail): Promise<void> {
    if (mail.to.startsWith("fail-")) {
      throw new Error(`simulated mail failure for ${mail.to}`);
    }
    this.logger.log(`MAIL to=${mail.to} notification=${mail.notificationId} subject="${mail.subject}"`);
  }
}
