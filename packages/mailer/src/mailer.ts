import type { Locale, NotificationDigest, NotificationEmail } from "@rabaed/domain";
import { z } from "zod";
import { notificationEmailTemplate, renderEmail, type RenderedEmail, type EmailTemplate, type EmailTemplateValues } from "./templates.ts";

/** What a caller asks to send: a template, in the recipient's locale, with its values. */
export interface MailMessage<T extends EmailTemplate = EmailTemplate> {
  to: string;
  template: T;
  locale: Locale;
  values: EmailTemplateValues[T];
}

/** A rendered email on its way out, as a transport receives it. */
export interface OutgoingEmail extends RenderedEmail {
  /** The configured From address, bare (no display name). */
  from: string;
  to: string;
  template: EmailTemplate;
}

/** Delivers one rendered email: SES in the cloud, the local catcher everywhere else. */
export type MailTransport = (email: OutgoingEmail) => Promise<void>;

export interface Mailer {
  send<T extends EmailTemplate>(message: MailMessage<T>): Promise<void>;
}

/** Every email shows this sender name. */
export const SENDER_NAME = "Rabaed";

const oneAddress = z.email();

/**
 * A notification email as the mailer sends it: its kind's template, in the
 * recipient's language, linking to the item on the customer web (`webUrl`).
 */
export function notificationMessage({ to, language, kind, content }: NotificationEmail, webUrl: string): MailMessage {
  const link = new URL(`/${language}/work-items/${encodeURIComponent(content.workItemId)}`, webUrl).href;
  return { to, template: notificationEmailTemplate[kind], locale: language, values: { ...content, link } };
}

/**
 * The daily digest as the mailer sends it (RP-358): in the recipient's
 * language, each item linking to itself on the customer web (`webUrl`).
 */
export function notificationDigestMessage({ to, language, projects }: NotificationDigest, webUrl: string): MailMessage<"daily-digest"> {
  return {
    to,
    template: "daily-digest",
    locale: language,
    values: {
      projects: projects.map(({ name, items }) => ({
        name,
        items: items.map((item) => ({ ...item, link: new URL(`/${language}/work-items/${encodeURIComponent(item.workItemId)}`, webUrl).href })),
      })),
    },
  };
}

export function createMailer({ from, transport }: { from: string; transport: MailTransport }): Mailer {
  return {
    async send({ to, template, locale, values }) {
      oneAddress.parse(to);
      await transport({ from, to, template, ...renderEmail(template, locale, values) });
    },
  };
}
