import { optionalSecret } from "@rabaed/domain";
import { z } from "zod";
import { catcherTransport } from "./catcher.ts";
import { createMailer, type Mailer, type MailTransport } from "./mailer.ts";
import { sendgridTransport } from "./sendgrid.ts";

export interface ConfiguredMailer extends Mailer {
  /** Which transport the environment chose. */
  transport: "catcher" | "sendgrid";
}

/**
 * The mailer the environment sets up. On Vercel (the UAT, ADR 0026), SENDGRID_API_KEY;
 * locally and in CI, MAIL_CATCHER_URL (.env.example, ci.yml). Exactly one of them, never
 * two, so a run cannot fall back to real email by accident. MAIL_FROM and the key are
 * config, never in the repo.
 *
 * Amazon SES is gone (RP-1230): a leftover MAIL_SES_CONFIGURATION_SET is refused by name,
 * so an environment that still asks for SES fails here instead of sending another way.
 *
 * Build the mailer when a service first sends, not at start-up, so an environment
 * without a sender yet still starts.
 */
export function mailerFromEnv(source: NodeJS.ProcessEnv = process.env): ConfiguredMailer {
  const env = z
    .object({
      MAIL_FROM: z.email(),
      // Not a transport any more: only read to refuse it (RP-1230).
      MAIL_SES_CONFIGURATION_SET: optionalSecret,
      MAIL_CATCHER_URL: z.url().optional(),
      // .env.example leaves it empty: a blank key is no key.
      SENDGRID_API_KEY: optionalSecret,
    })
    .parse(source);
  if (env.MAIL_SES_CONFIGURATION_SET) {
    throw new Error(
      "MAIL_SES_CONFIGURATION_SET is set, but Amazon SES is no longer a mail transport (RP-1230): unset it, and set SENDGRID_API_KEY (Vercel) or MAIL_CATCHER_URL (local, CI)",
    );
  }
  const chosen: { name: ConfiguredMailer["transport"]; build: () => MailTransport }[] = [];
  if (env.MAIL_CATCHER_URL) chosen.push({ name: "catcher", build: () => catcherTransport({ url: env.MAIL_CATCHER_URL! }) });
  if (env.SENDGRID_API_KEY) chosen.push({ name: "sendgrid", build: () => sendgridTransport({ apiKey: env.SENDGRID_API_KEY! }) });
  if (chosen.length > 1) throw new Error("Set one of SENDGRID_API_KEY or MAIL_CATCHER_URL, not two");
  const [only] = chosen;
  if (!only) throw new Error("No mail transport: set SENDGRID_API_KEY (Vercel) or MAIL_CATCHER_URL (local, CI)");
  return { ...createMailer({ from: env.MAIL_FROM, transport: only.build() }), transport: only.name };
}
