import { SENDER_NAME, type MailTransport } from "./mailer.ts";

/**
 * Hands each email to Mailpit (docker-compose.yml, and a service in CI)
 * through its send API, so local and CI runs never send real email. Mailpit
 * keeps it to read at the catcher's URL. Only a catcher on this machine is
 * accepted, so a wrong setting cannot relay mail anywhere else.
 */
export function catcherTransport({ url }: { url: string }): MailTransport {
  const base = new URL(url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
    throw new Error(`The mail catcher must run on this machine, not ${base.hostname}`);
  }
  const endpoint = new URL("/api/v1/send", base);
  return async ({ from, to, template, subject, text, html }) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ From: { Email: from, Name: SENDER_NAME }, To: [{ Email: to }], Subject: subject, Text: text, HTML: html, Tags: [template] }),
    });
    if (!response.ok) throw new Error(`The mail catcher refused the email: ${response.status} ${await response.text()}`);
  };
}
