import { stepAgeReportQuery, workItemSearchParams, type Locale, type NotificationEmail, type StepAgeReport } from "@rabaed/domain";
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
 * A weekly Step Age report as the mailer sends it, in the recipient's language,
 * linking to the List of the Project's open items, and of those 4 weeks or more
 * at their Step (stepAgeReportQuery): the same items the report lists.
 */
export function stepAgeReportMessage({ to, language, projectId, projectName, openStageKeys, items }: StepAgeReport, webUrl: string): MailMessage<"step-age-report"> {
  const list = (query: URLSearchParams) => {
    const url = new URL(`/${language}/projects/${encodeURIComponent(projectId)}/work-items`, webUrl);
    url.search = query.toString();
    return url.href;
  };
  return {
    to,
    template: "step-age-report",
    locale: language,
    values: {
      projectName,
      items,
      link: list(workItemSearchParams(stepAgeReportQuery(openStageKeys))),
      oldestLink: list(workItemSearchParams(stepAgeReportQuery(openStageKeys, 4))),
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
