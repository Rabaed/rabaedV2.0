import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { SENDER_NAME, type MailTransport } from "./mailer.ts";

export interface SesTransportOptions {
  /** Bounces and complaints are published through it (packages/infra, app stack). */
  configurationSet: string;
  /** The region and credentials come from the task's environment and role. */
  client?: { send(command: SendEmailCommand): Promise<unknown> };
}

/**
 * Sends through Amazon SES. The task role may send only from the configured
 * From address (packages/infra/src/app-stack.ts).
 */
export function sesTransport({ configurationSet, client = new SESv2Client({}) }: SesTransportOptions): MailTransport {
  const utf8 = (Data: string) => ({ Data, Charset: "UTF-8" });
  return async ({ from, to, template, subject, text, html }) => {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: `${SENDER_NAME} <${from}>`,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: utf8(subject), Body: { Text: utf8(text), Html: utf8(html) } } },
        ConfigurationSetName: configurationSet,
        // The bounce and complaint metrics are split by this tag.
        EmailTags: [{ Name: "template", Value: template }],
      }),
    );
  };
}
