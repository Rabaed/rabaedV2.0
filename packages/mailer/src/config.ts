import { optionalSecret } from "@rabaed/domain";
import { z } from "zod";
import { catcherTransport } from "./catcher.ts";
import { createMailer, type Mailer, type MailTransport } from "./mailer.ts";
import { sendgridTransport } from "./sendgrid.ts";
import { sesTransport } from "./ses.ts";

export interface ConfiguredMailer extends Mailer {
  /** Which transport the environment chose. */
  transport: "ses" | "catcher" | "sendgrid";
}

/**
 * The mailer the environment sets up. In AWS the task gets
 * MAIL_SES_CONFIGURATION_SET (app stack); on Vercel (the UAT, ADR 0026),
 * SENDGRID_API_KEY; locally and in CI, MAIL_CATCHER_URL (.env.example, ci.yml).
 * Exactly one of them, never two, so a run cannot fall back to real email by
 * accident. MAIL_FROM and the key are config, never in the repo.
 *
 * In AWS, MAIL_FROM is empty until the setup wizard has verified the sender,
 * and this throws. Build the mailer when a service first sends, not at
 * start-up, so an environment without a sender yet still starts.
 */
export function mailerFromEnv(source: NodeJS.ProcessEnv = process.env): ConfiguredMailer {
  const env = z
    .object({
      MAIL_FROM: z.email(),
      MAIL_SES_CONFIGURATION_SET: optionalSecret,
      MAIL_CATCHER_URL: z.url().optional(),
      // .env.example leaves it empty: a blank key is no key.
      SENDGRID_API_KEY: optionalSecret,
    })
    .parse(source);
  const chosen: { name: ConfiguredMailer["transport"]; build: () => MailTransport }[] = [];
  if (env.MAIL_SES_CONFIGURATION_SET) chosen.push({ name: "ses", build: () => sesTransport({ configurationSet: env.MAIL_SES_CONFIGURATION_SET! }) });
  if (env.MAIL_CATCHER_URL) chosen.push({ name: "catcher", build: () => catcherTransport({ url: env.MAIL_CATCHER_URL! }) });
  if (env.SENDGRID_API_KEY) chosen.push({ name: "sendgrid", build: () => sendgridTransport({ apiKey: env.SENDGRID_API_KEY! }) });
  if (chosen.length > 1) throw new Error("Set one of MAIL_SES_CONFIGURATION_SET, SENDGRID_API_KEY or MAIL_CATCHER_URL, not two");
  const [only] = chosen;
  if (!only) throw new Error("No mail transport: set MAIL_SES_CONFIGURATION_SET (AWS), SENDGRID_API_KEY (Vercel) or MAIL_CATCHER_URL (local, CI)");
  return { ...createMailer({ from: env.MAIL_FROM, transport: only.build() }), transport: only.name };
}
