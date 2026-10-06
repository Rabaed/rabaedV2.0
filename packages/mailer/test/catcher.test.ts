import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mailerFromEnv, notificationDigestMessage, renderEmail, stepAgeReportMessage } from "../src/index.ts";

// Sends through the real mailer, as the services will, to the local Mailpit
// (docker-compose.yml; a service in CI), and reads it back through
// Mailpit's API. Each test mails its own address, so runs never mix.
const catcherUrl = process.env.MAIL_CATCHER_URL;
if (!catcherUrl) throw new Error("MAIL_CATCHER_URL is not set: start Mailpit (docker compose up -d mailpit) and see .env.example");

interface CaughtMessage {
  From: { Name: string; Address: string };
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
  Tags: string[];
}

async function caught(to: string): Promise<CaughtMessage[]> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(new URL(`/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`, catcherUrl));
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      return Promise.all(messages.map(async ({ ID }) => (await fetch(new URL(`/api/v1/message/${ID}`, catcherUrl))).json() as Promise<CaughtMessage>));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}

const recipient = () => `test-${randomUUID()}@rabaed.test`;

describe("the mailer, against the local catcher", () => {
  const mailer = mailerFromEnv({ ...process.env, MAIL_FROM: "no-reply@rabaed.test", MAIL_SES_CONFIGURATION_SET: undefined });

  it("chooses the catcher, never SES, when MAIL_CATCHER_URL is set", () => {
    expect(mailer.transport).toBe("catcher");
  });

  it("delivers an English sign-in code with its subject, both bodies and the sender", async () => {
    const to = recipient();
    const values = { code: "482913", validMinutes: 10 };
    await mailer.send({ to, template: "sign-in-code", locale: "en", values });

    const [message, ...more] = await caught(to);
    const expected = renderEmail("sign-in-code", "en", values);
    expect(more).toEqual([]);
    expect(message).toMatchObject({
      From: { Name: "Rabaed", Address: "no-reply@rabaed.test" },
      To: [{ Address: to }],
      Subject: expected.subject,
      Tags: ["sign-in-code"],
    });
    expect(message!.Text.trim()).toBe(expected.text.trim());
    expect(message!.HTML).toContain("482913");
  });

  it.each(["en", "ar"] as const)("delivers the daily digest in %s intact, its Document Numbers left to right (RP-358)", async (language) => {
    const to = recipient();
    const message = notificationDigestMessage(
      {
        to,
        language,
        projects: [
          {
            projectId: randomUUID(),
            name: { en: "Tower", ar: "البرج" },
            items: [
              {
                workItemId: randomUUID(),
                documentNumber: "TWR-MAR-01-0001",
                subject: "Cable trays",
                entries: [
                  { kind: "step_reached", step: { en: "Contractor review", ar: "مراجعة المقاول" }, event: null },
                  { kind: "sent_back", step: null, event: { type: "transition", transition: null, outcome: null, companyName: { en: "Khatib", ar: "الخطيب" }, signerName: null } },
                ],
              },
              { workItemId: randomUUID(), documentNumber: "TWR-MAR-01-0002", subject: "Pumps", entries: [{ kind: "vacancy", step: { en: "Review", ar: "المراجعة" }, event: null }] },
            ],
          },
        ],
      },
      "http://127.0.0.1:3000",
    );
    await mailer.send(message);

    const [caughtMessage, ...more] = await caught(to);
    const expected = renderEmail("daily-digest", language, message.values as never);
    expect(more).toEqual([]);
    expect(caughtMessage).toMatchObject({ Subject: expected.subject, Tags: ["daily-digest"] });
    expect(caughtMessage!.HTML).toContain(`<html lang="${language}" dir="${language === "ar" ? "rtl" : "ltr"}">`);
    for (const number of ["TWR-MAR-01-0001", "TWR-MAR-01-0002"]) {
      expect(caughtMessage!.HTML).toContain(`<bdi dir="ltr">${number}</bdi>`);
      expect(caughtMessage!.Text).toContain(`\u2066${number}\u2069`);
    }
    expect(caughtMessage!.Text).toContain(language === "ar" ? "الخطيب" : "Khatib");
  });

  it("delivers an Arabic invitation intact: Arabic subject, right-to-left body, the link", async () => {
    const to = recipient();
    const values = { companyName: "شركة البناء", link: "http://127.0.0.1:3000/ar/accept-invitation#token=abc" };
    await mailer.send({ to, template: "invitation", locale: "ar", values });

    const [message] = await caught(to);
    expect(message?.Subject).toBe(renderEmail("invitation", "ar", values).subject);
    expect(message?.HTML).toContain('<html lang="ar" dir="rtl">');
    expect(message?.HTML).toContain(`href="${values.link}"`);
  });

  it.each(["en", "ar"] as const)("delivers a weekly Step Age report in %s intact: subject, direction, the item's number left to right, the List link", async (language) => {
    const to = recipient();
    const message = stepAgeReportMessage(
      {
        to,
        language,
        projectId: "0190a1b2-0000-7000-8000-00000000000a",
        projectName: { en: "Tower", ar: "البرج" },
        openStageKeys: ["draft", "internal_review", "pending_approval"],
        items: [
          {
            workItemId: "0190a1b2-0000-7000-8000-000000000001",
            documentNumber: "TWR-MAR-01-0001",
            subject: "Cable trays",
            stage: { en: "Pending approval", ar: "بانتظار الاعتماد" },
            with: { kind: "company", companyName: { en: "Khatib Consultants", ar: "الخطيب للاستشارات" } },
            stepAgeWeeks: 5,
          },
        ],
      },
      "http://127.0.0.1:3000",
    );
    await mailer.send(message);

    const [caughtMessage, ...more] = await caught(to);
    const expected = renderEmail("step-age-report", language, message.values);
    expect(more).toEqual([]);
    expect(caughtMessage).toMatchObject({ Subject: expected.subject, Tags: ["step-age-report"] });
    // Line ends as the transport encoded them.
    expect(caughtMessage!.Text.replaceAll("\r\n", "\n").trim()).toBe(expected.text.trim());
    expect(caughtMessage!.HTML).toContain(`<html lang="${language}" dir="${language === "ar" ? "rtl" : "ltr"}">`);
    expect(caughtMessage!.HTML).toContain('<bdi dir="ltr">TWR-MAR-01-0001</bdi>');
    expect(caughtMessage!.Text).toContain(`http://127.0.0.1:3000/${language}/projects/0190a1b2-0000-7000-8000-00000000000a/work-items?stage=`);
  });
});
