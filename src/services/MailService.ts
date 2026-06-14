import { MailtrapClient } from "mailtrap";
import handlebars from "handlebars";
import { notificationRepository } from "@/repositories/NotificationRepository";

/**
 * MailService - Direct integration with Mailtrap SDK
 */
export const MailService = {
  /**
   * Internal helper to get configured client
   */
  _getClient() {
    const token = process.env.MAILTRAP_API_KEY || process.env.MAILTRAP_TOKEN || "";
    return new MailtrapClient({ token });
  },

  /**
   * Internal helper to get sender
   */
  _getSender() {
    return {
      email: process.env.MAIL_FROM || "orders@neverbe.lk",
      name: process.env.MAIL_FROM_NAME || "Neverbe",
    };
  },

  /**
   * Send a direct email using a rendered template
   */
  async sendEmail(to: string[], subject: string, html: string) {
    try {
      const client = this._getClient();
      const sender = this._getSender();

      const response = await client.send({
        from: sender,
        to: to.map((email) => ({ email })),
        subject: subject,
        html: html,
        category: "Notification",
      });
      return { success: true, response };
    } catch (error) {
      console.error(`[MailService] Error sending email:`, error);
      return { success: false, error };
    }
  },

  /**
   * Send an email using a stored template in Firestore
   */
  async sendTemplateEmail(
    to: string[],
    templateId: string,
    templateData: any
  ) {
    try {
      // 1. Get template from database
      const template = await notificationRepository.getMailTemplate(templateId);
      if (!template) {
        throw new Error(`Email template '${templateId}' not found in database.`);
      }

      // 2. Render HTML and Subject with Handlebars
      const renderedHtml = handlebars.compile(template.html)(templateData);
      const renderedSubject = handlebars.compile(template.subject)(templateData);

      // 3. Send via Mailtrap
      return await this.sendEmail(to, renderedSubject, renderedHtml);
    } catch (error) {
      console.error(`[MailService] Failed to send template email:`, error);
      return { success: false, error };
    }
  },
};
