import type { Locale } from "@rabaed/domain";
import type { MailMessage } from "./mailer.ts";

/** A reset link's email as the outbox handler hands it over (@rabaed/auth PasswordResetEmail). */
export interface PasswordResetEmailContent {
  to: string;
  language: Locale;
  token: string;
  validMinutes: number;
}

/**
 * A password reset email as the mailer sends it (RP-1058): in the Member's language, linking to
 * reset-password on the customer web (`webUrl`) with the token in the URL fragment, which browsers
 * never send to a server, so no web log holds it.
 */
export function passwordResetMessage({ to, language, token, validMinutes }: PasswordResetEmailContent, webUrl: string): MailMessage<"password-reset"> {
  const link = new URL(`/${language}/reset-password`, webUrl);
  link.hash = new URLSearchParams({ token }).toString();
  return { to, template: "password-reset", locale: language, values: { link: link.href, validMinutes } };
}
