import { SENDER_NAME, type MailTransport } from "./mailer.ts";

export interface SendGridTransportOptions {
  /** SENDGRID_API_KEY: config from the deploy's secrets, never in the repo. */
  apiKey: string;
  /** Stands in for SendGrid in tests; the global fetch otherwise. */
  fetch?: typeof globalThis.fetch;
  /** How long one send may wait for SendGrid before it fails (and its outbox row is retried); 10 s by default. */
  timeoutMs?: number;
}

/** Well inside a cron pass's budget (RP-1039): a hung send never runs the api function past its maxDuration. */
const SEND_TIMEOUT_MS = 10_000;

const MAIL_SEND_URL = "https://api.sendgrid.com/v3/mail/send";

/**
 * Sends through SendGrid's v3 Mail Send API (the UAT on Vercel, ADR 0026),
 * with fetch rather than SendGrid's client package. Payload and answers:
 * https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
 * (text/plain must come before text/html in `content`; 202 means accepted).
 */
export function sendgridTransport({ apiKey, fetch: send, timeoutMs = SEND_TIMEOUT_MS }: SendGridTransportOptions): MailTransport {
  return async ({ from, to, template, subject, text, html }) => {
    const response = await (send ?? fetch)(MAIL_SEND_URL, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: SENDER_NAME },
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
        categories: [template],
        // Every link goes out as written, never through a SendGrid redirect:
        // invitation and reset links carry their token in the URL. No pixel, no
        // unsubscribe footer either. Per message, whatever the account's settings.
        tracking_settings: {
          click_tracking: { enable: false, enable_text: false },
          open_tracking: { enable: false },
          subscription_tracking: { enable: false },
        },
      }),
    });
    // A throw leaves the outbox row to be tried again, and its message lands in
    // outbox.last_error: the status and SendGrid's error messages only, never
    // the raw answer (it may quote the recipient), with the key cut out should
    // it ever be echoed back.
    if (!response.ok) {
      const reason = sendgridReason(await response.text()).replaceAll(apiKey, "[SENDGRID_API_KEY]");
      const message = `SendGrid refused the email: ${response.status}${reason ? ` ${reason}` : ""}`;
      throw new Error(message.length > MAX_REASON_LENGTH ? `${message.slice(0, MAX_REASON_LENGTH - 1)}…` : message);
    }
  };
}

/** Long enough for a few of SendGrid's errors; outbox.last_error stays short. */
const MAX_REASON_LENGTH = 500;

/** SendGrid's `errors[]` as `field: message` (`message` alone without a field), or "" for any other answer. */
function sendgridReason(answer: string): string {
  let errors: unknown;
  try {
    errors = (JSON.parse(answer) as { errors?: unknown }).errors;
  } catch {
    return "";
  }
  if (!Array.isArray(errors)) return "";
  return errors
    .map((e: { message?: unknown; field?: unknown }) => {
      if (typeof e?.message !== "string") return "";
      return typeof e.field === "string" && e.field !== "" ? `${e.field}: ${e.message}` : e.message;
    })
    .filter((s) => s !== "")
    .join("; ");
}
