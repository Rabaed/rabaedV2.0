import { locales, notificationEmailKinds } from "@rabaed/domain";
import { deadlineWordInCopy } from "@rabaed/eslint-plugin/matchers";
import { describe, expect, it } from "vitest";
import { renderEmail, emailTemplates, notificationEmailTemplate, type EmailTemplateValues } from "./templates.ts";

const DOC = "TWR-MAR-01-0001";
const item = {
  link: "https://rabaed.test/ar/work-items/0190a1b2-0000-7000-8000-000000000001",
  workItemId: "0190a1b2-0000-7000-8000-000000000001",
  documentNumber: DOC,
  subject: "Cable trays <Level 2>",
  step: null,
  event: null,
};
const k1 = { en: "Khatib Consultants", ar: "الخطيب للاستشارات" };
const khalid = { en: "Khalid Signer", ar: "خالد الموقّع" };
const codeB = { type: "issue_code", transition: { en: "Issue Code B", ar: "إصدار الرمز B" }, outcome: "B", companyName: k1, signerName: khalid } as const;

const examples: EmailTemplateValues = {
  "sign-in-code": { code: "482913", validMinutes: 10 },
  invitation: { companyName: "Al Bina <Contracting> & Sons", link: "https://rabaed.test/ar/accept-invitation#token=abc" },
  "new-device-sign-in": { when: "2026-10-02 09:15 UTC", ip: "203.0.113.7" },
  "sign-in-locked": { minutes: 15 },
  "notification-step-reached": { ...item, step: { en: "Contractor review", ar: "مراجعة المقاول" } },
  "notification-watched-event": { ...item, event: codeB },
  "notification-sent-back": {
    ...item,
    event: { type: "transition", transition: { en: "Send Back", ar: "إرجاع" }, outcome: null, companyName: k1, signerName: null },
  },
  "notification-vacancy": { ...item, step: { en: "Internal review", ar: "المراجعة الداخلية" } },
};

const notificationTemplates = emailTemplates.filter((t) => t.startsWith("notification-"));

describe("every template", () => {
  it.each(emailTemplates.flatMap((template) => locales.map((locale) => [template, locale] as const)))(
    "%s in %s has a subject, a text and an HTML body",
    (template, locale) => {
      const email = renderEmail(template, locale, examples[template]);
      expect(email.subject.trim()).not.toBe("");
      expect(email.text.trim()).not.toBe("");
      expect(email.html).toContain("<html");
    },
  );

  it.each(emailTemplates)("%s sets the language and direction: English left to right, Arabic right to left", (template) => {
    expect(renderEmail(template, "en", examples[template]).html).toMatch(/<html lang="en" dir="ltr">/);
    expect(renderEmail(template, "ar", examples[template]).html).toMatch(/<html lang="ar" dir="rtl">/);
  });

  it.each(emailTemplates)("%s is translated: the Arabic subject differs from the English one", (template) => {
    expect(renderEmail(template, "ar", examples[template]).subject).not.toBe(renderEmail(template, "en", examples[template]).subject);
  });

  it.each(emailTemplates.flatMap((template) => locales.map((locale) => [template, locale] as const)))(
    "%s in %s uses Latin digits only and no deadline words",
    (template, locale) => {
      const { subject, text, html } = renderEmail(template, locale, examples[template]);
      for (const part of [subject, text, html]) {
        // Arabic-Indic and Extended Arabic-Indic digits.
        expect(part).not.toMatch(/[٠-٩۰-۹]/);
        expect(deadlineWordInCopy(part)).toBeNull();
      }
    },
  );
});

describe("sign-in code", () => {
  it("shows the code, kept left to right inside Arabic", () => {
    const en = renderEmail("sign-in-code", "en", examples["sign-in-code"]);
    const ar = renderEmail("sign-in-code", "ar", examples["sign-in-code"]);
    expect(en.text).toContain("482913");
    expect(ar.text).toContain("482913");
    expect(ar.html).toContain('<bdi dir="ltr"');
    expect(ar.html).toContain("482913");
  });

  it("says how many minutes it works, in Latin digits in both languages", () => {
    expect(renderEmail("sign-in-code", "en", examples["sign-in-code"]).text).toContain("10");
    expect(renderEmail("sign-in-code", "ar", examples["sign-in-code"]).text).toContain("10");
  });
});

describe("invitation", () => {
  it("names the Company and links to the invitation, in both languages", () => {
    for (const locale of locales) {
      const email = renderEmail("invitation", locale, examples.invitation);
      expect(email.text).toContain("Al Bina <Contracting> & Sons");
      expect(email.text).toContain(examples.invitation.link);
      expect(email.html).toContain(`href="${examples.invitation.link}"`);
    }
  });

  it("escapes values in the HTML body", () => {
    const { html } = renderEmail("invitation", "en", examples.invitation);
    expect(html).toContain("Al Bina &lt;Contracting&gt; &amp; Sons");
    expect(html).not.toContain("<Contracting>");
  });

  it("refuses a link that is not https or http", () => {
    expect(() => renderEmail("invitation", "en", { ...examples.invitation, link: "javascript:alert(1)" })).toThrow();
  });
});

describe("new-device sign-in alert", () => {
  it("says when and from where, kept left to right inside Arabic", () => {
    for (const locale of locales) {
      const email = renderEmail("new-device-sign-in", locale, examples["new-device-sign-in"]);
      expect(email.text).toContain("2026-10-02 09:15 UTC");
      expect(email.text).toContain("203.0.113.7");
    }
    expect(renderEmail("new-device-sign-in", "ar", examples["new-device-sign-in"]).html).toContain('<bdi dir="ltr">203.0.113.7</bdi>');
  });
});

describe("notification emails", () => {
  it("there is one for every kind of notification that can be emailed", () => {
    expect(notificationEmailKinds.map((kind) => notificationEmailTemplate[kind]).sort()).toEqual([...notificationTemplates].sort());
  });

  it.each(notificationTemplates.flatMap((template) => locales.map((locale) => [template, locale] as const)))(
    "%s in %s: the subject is the Document Number, kept left to right, the Subject and what happened, nothing else",
    (template, locale) => {
      const { subject } = renderEmail(template, locale, examples[template]);
      const parts = subject.split(" · ");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe(`⁦${DOC}⁩`);
      expect(parts[1]).toBe("Cable trays <Level 2>");
    },
  );

  it.each(notificationTemplates.flatMap((template) => locales.map((locale) => [template, locale] as const)))(
    "%s in %s: the body shows the Document Number left to right and links to the item",
    (template, locale) => {
      const { text, html } = renderEmail(template, locale, examples[template]);
      expect(html).toContain(`<bdi dir="ltr">${DOC}</bdi>`);
      expect(text).toContain(`⁦${DOC}⁩`);
      expect(text).toContain(item.link);
      expect(html).toContain(`href="${item.link}"`);
      expect(html).toContain("Cable trays &lt;Level 2&gt;");
      expect(html).not.toContain("<Level 2>");
    },
  );

  it("leaves the Document Number out while the item has none", () => {
    const email = renderEmail("notification-step-reached", "en", { ...examples["notification-step-reached"], documentNumber: null });
    expect(email.subject).toBe("Cable trays <Level 2> · Reached you at Contractor review");
  });

  it("a Step reached: names the recipient's own Step", () => {
    expect(renderEmail("notification-step-reached", "en", examples["notification-step-reached"]).subject).toBe(
      `⁦${DOC}⁩ · Cable trays <Level 2> · Reached you at Contractor review`,
    );
    expect(renderEmail("notification-step-reached", "ar", examples["notification-step-reached"]).subject).toBe(
      `⁦${DOC}⁩ · Cable trays <Level 2> · وصلك في مراجعة المقاول`,
    );
  });

  it("a Code on a watched item (scenario 69): the subject says only the Code; the body names the Company and the Code's signer", () => {
    for (const locale of locales) {
      const email = renderEmail("notification-watched-event", locale, examples["notification-watched-event"]);
      expect(email.subject.split(" · ")[2]).toBe(locale === "en" ? "Code B" : "الرمز B");
      expect(email.subject).not.toContain(k1[locale]);
      expect(email.text).toContain(k1[locale]);
      expect(email.text).toContain(khalid[locale]);
    }
  });

  it("a watched item's other events: an Inspection Result, a Transition, a new Revision, a cancel", () => {
    const watched = (event: Partial<typeof codeB> | Record<string, unknown>) =>
      renderEmail("notification-watched-event", "en", { ...item, event: { ...codeB, signerName: null, ...event } as never }).subject.split(" · ")[2];
    expect(watched({ outcome: "passed_with_comments" })).toBe("Passed with Comments");
    expect(watched({ type: "transition", outcome: null, transition: { en: "Submit", ar: "تقديم" } })).toBe("Submit");
    expect(watched({ type: "revision_created", outcome: null, transition: null, companyName: null })).toBe("New Revision");
    expect(watched({ type: "cancelled", outcome: "cancelled", transition: null })).toBe("Cancelled");
  });

  it("Sent Back and a Vacancy say what happened", () => {
    expect(renderEmail("notification-sent-back", "en", examples["notification-sent-back"]).subject.split(" · ")[2]).toBe("Sent Back to you");
    expect(renderEmail("notification-vacancy", "en", examples["notification-vacancy"]).subject.split(" · ")[2]).toBe("Vacancy at Internal review");
  });
});

describe("sign-in locked", () => {
  it("says for how many minutes, in Latin digits in both languages", () => {
    for (const locale of locales) expect(renderEmail("sign-in-locked", locale, examples["sign-in-locked"]).text).toContain("15");
  });
});
