import { invitationTokenOf, type MailMessage, type Mailer } from "@rabaed/mailer";
import type { ApiConfig } from "../config.ts";

/**
 * The api's config for seeding: its invitation emails stay in the DemoMailbox, so
 * where they link matters to no one, and an environment without WEB_URL still seeds.
 */
export function seedingConfig(config: ApiConfig): ApiConfig {
  return { ...config, webUrl: config.webUrl ?? "https://demo.rabaed.test" };
}

/**
 * The demo seed's mailer: it keeps the api's emails and sends none (the demo's
 * addresses are made up), so the seed can accept each invitation it makes at once.
 */
export interface DemoMailbox {
  mailer: Mailer;
  /** The token in the newest invitation emailed to `email`. */
  invitationToken(email: string): string;
}

export function demoMailbox(): DemoMailbox {
  const messages: MailMessage[] = [];
  return {
    mailer: { send: async (message) => void messages.push(message as MailMessage) },
    invitationToken(email) {
      const last = messages.filter((m): m is MailMessage<"invitation"> => m.to === email && m.template === "invitation").at(-1);
      if (!last) throw new Error(`Demo seed: no invitation emailed to ${email}`);
      return invitationTokenOf(last);
    },
  };
}
