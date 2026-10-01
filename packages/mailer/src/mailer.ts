import type { Locale } from "@rabaed/domain";
import { z } from "zod";
import { renderEmail, type RenderedEmail, type EmailTemplate, type EmailTemplateValues } from "./templates.ts";

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

export function createMailer({ from, transport }: { from: string; transport: MailTransport }): Mailer {
  return {
    async send({ to, template, locale, values }) {
      oneAddress.parse(to);
      await transport({ from, to, template, ...renderEmail(template, locale, values) });
    },
  };
}
