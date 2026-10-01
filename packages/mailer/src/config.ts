import { z } from "zod";
import { catcherTransport } from "./catcher.ts";
import { createMailer, type Mailer } from "./mailer.ts";
import { sesTransport } from "./ses.ts";

export interface ConfiguredMailer extends Mailer {
  /** Which transport the environment chose. */
  transport: "ses" | "catcher";
}

/**
 * The mailer the environment sets up. In AWS the task gets
 * MAIL_SES_CONFIGURATION_SET (app stack); locally and in CI, MAIL_CATCHER_URL
 * (.env.example, ci.yml). Exactly one of them, never both, so a run cannot
 * fall back to real email by accident. MAIL_FROM is config, never in the repo.
 *
 * In AWS, MAIL_FROM is empty until the setup wizard has verified the sender,
 * and this throws. Build the mailer when a service first sends, not at
 * start-up, so an environment without a sender yet still starts.
 */
export function mailerFromEnv(source: NodeJS.ProcessEnv = process.env): ConfiguredMailer {
  const env = z
    .object({
      MAIL_FROM: z.email(),
      MAIL_SES_CONFIGURATION_SET: z.string().min(1).optional(),
      MAIL_CATCHER_URL: z.url().optional(),
    })
    .parse(source);
  const ses = env.MAIL_SES_CONFIGURATION_SET;
  const catcher = env.MAIL_CATCHER_URL;
  if (ses && catcher) throw new Error("Set MAIL_SES_CONFIGURATION_SET or MAIL_CATCHER_URL, not both");
  if (!ses && !catcher) throw new Error("No mail transport: set MAIL_SES_CONFIGURATION_SET (AWS) or MAIL_CATCHER_URL (local, CI)");
  const transport = ses ? sesTransport({ configurationSet: ses }) : catcherTransport({ url: catcher! });
  return { ...createMailer({ from: env.MAIL_FROM, transport }), transport: ses ? "ses" : "catcher" };
}
