import { describe, expect, it } from "vitest";
import type { OutgoingEmail } from "./mailer.ts";
import { sendgridTransport } from "./sendgrid.ts";
import { emailTemplates } from "./templates.ts";

const apiKey = "SG.test-key-not-real";

/** A stand-in for SendGrid's Mail Send API: keeps each request and answers with `status`. */
function stubSendGrid(status = 202, body = "") {
  const requests: { url: string; init: RequestInit; payload: Record<string, unknown> }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init!, payload: JSON.parse(String(init!.body)) });
    return new Response(body || null, { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const email: OutgoingEmail = {
  from: "no-reply@rabaed.test",
  to: "engineer@rabaed.test",
  template: "invitation",
  subject: "دعوة",
  text: "Accept: https://uat.rabaed.test/ar/accept-invitation#token=abc",
  html: '<a href="https://uat.rabaed.test/ar/accept-invitation#token=abc">Accept</a>',
};

describe("sendgridTransport", () => {
  it("posts one message to SendGrid's Mail Send API with the key, the sender, the recipient, the subject, both bodies and the template as a category", async () => {
    const sendgrid = stubSendGrid();
    await sendgridTransport({ apiKey, fetch: sendgrid.fetch })(email);

    expect(sendgrid.requests).toHaveLength(1);
    const [{ url, init, payload }] = sendgrid.requests as [(typeof sendgrid.requests)[number]];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(payload).toMatchObject({
      personalizations: [{ to: [{ email: "engineer@rabaed.test" }] }],
      from: { email: "no-reply@rabaed.test", name: "Rabaed" },
      subject: "دعوة",
      content: [
        { type: "text/plain", value: email.text },
        { type: "text/html", value: email.html },
      ],
      categories: ["invitation"],
    });
  });

  // A tracked link would go through a SendGrid redirect, and invitation and reset
  // links carry their token in the URL (apps/admin/src/routes/companies.ts).
  it.each(emailTemplates)("turns click, open and subscription tracking off on a %s email", async (template) => {
    const sendgrid = stubSendGrid();
    await sendgridTransport({ apiKey, fetch: sendgrid.fetch })({ ...email, template });

    expect(sendgrid.requests[0]!.payload.tracking_settings).toEqual({
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
      subscription_tracking: { enable: false },
    });
  });

  it.each([400, 401, 429, 500])("throws on a %i answer, so the outbox tries again, saying SendGrid's reason but never the key", async (status) => {
    const sendgrid = stubSendGrid(status, '{"errors":[{"message":"The from address does not match a verified Sender Identity."}]}');
    const sending = sendgridTransport({ apiKey, fetch: sendgrid.fetch })(email);

    const error = await sending.then(
      () => expect.unreachable("a refused email must throw"),
      (thrown: unknown) => thrown as Error,
    );
    expect(error.message).toContain(String(status));
    expect(error.message).toContain("verified Sender Identity");
    expect(error.message).not.toContain(apiKey);
  });

  it("does not echo the key when SendGrid's answer contains it", async () => {
    const sendgrid = stubSendGrid(401, `{"errors":[{"message":"bad key ${apiKey}"}]}`);
    await expect(sendgridTransport({ apiKey, fetch: sendgrid.fetch })(email)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(apiKey) }),
    );
  });
});
