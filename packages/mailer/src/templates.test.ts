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

const LIST = "https://rabaed.test/en/projects/0190a1b2-0000-7000-8000-00000000000a/work-items?stage=draft%2Cpending_approval";
const OLDEST = `${LIST}&stepAgeMin=4`;
/** A weekly Step Age report: one item 4+ weeks with K1, one 2 weeks at the reader's own Step, one Draft with no number yet. */
const report: EmailTemplateValues["step-age-report"] = {
  projectName: { en: "Tower <A>", ar: "البرج أ" },
  link: LIST,
  oldestLink: OLDEST,
  items: [
    {
      workItemId: "0190a1b2-0000-7000-8000-000000000001",
      documentNumber: DOC,
      subject: "Cable trays <Level 2>",
      stage: { en: "Pending approval", ar: "بانتظار الاعتماد" },
      with: { kind: "company", companyName: k1 },
      stepAgeWeeks: 6,
    },
    {
      workItemId: "0190a1b2-0000-7000-8000-000000000002",
      documentNumber: "TWR-MAR-01-0002",
      subject: "Pumps",
      stage: { en: "Internal review", ar: "المراجعة الداخلية" },
      with: { kind: "own", step: { en: "Contractor review", ar: "مراجعة المقاول" } },
      stepAgeWeeks: 2,
    },
    {
      workItemId: "0190a1b2-0000-7000-8000-000000000003",
      documentNumber: null,
      subject: "Valves",
      stage: { en: "Draft", ar: "مسودة" },
      with: { kind: "own", step: { en: "Draft", ar: "مسودة" } },
      stepAgeWeeks: 1,
    },
  ],
};

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
  "daily-digest": {
    projects: [
      {
        name: { en: "Tower <A>", ar: "البرج أ" },
        items: [
          {
            workItemId: item.workItemId,
            documentNumber: DOC,
            subject: "Cable trays <Level 2>",
            link: item.link,
            entries: [
              { kind: "step_reached", step: { en: "Contractor review", ar: "مراجعة المقاول" }, event: null },
              { kind: "watched_event", step: null, event: codeB },
            ],
          },
          {
            workItemId: "0190a1b2-0000-7000-8000-000000000002",
            documentNumber: null,
            subject: "Pumps (Revision in Draft)",
            link: "https://rabaed.test/ar/work-items/0190a1b2-0000-7000-8000-000000000002",
            entries: [{ kind: "watched_event", step: null, event: { type: "revision_created", transition: null, outcome: null, companyName: null, signerName: null } }],
          },
        ],
      },
      {
        name: { en: "Clinic", ar: "العيادة" },
        items: [
          {
            workItemId: "0190a1b2-0000-7000-8000-000000000003",
            documentNumber: "CLN-SUB-02-0007",
            subject: "Doors",
            link: "https://rabaed.test/ar/work-items/0190a1b2-0000-7000-8000-000000000003",
            entries: [
              {
                kind: "sent_back",
                step: null,
                event: { type: "transition", transition: { en: "Send Back", ar: "إرجاع" }, outcome: null, companyName: k1, signerName: null },
              },
            ],
          },
        ],
      },
    ],
  },
  "step-age-report": report,
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
      expect(parts[0]).toBe(`\u2066${DOC}\u2069`);
      expect(parts[1]).toBe("Cable trays <Level 2>");
    },
  );

  it.each(notificationTemplates.flatMap((template) => locales.map((locale) => [template, locale] as const)))(
    "%s in %s: the body shows the Document Number left to right and links to the item",
    (template, locale) => {
      const { text, html } = renderEmail(template, locale, examples[template]);
      expect(html).toContain(`<bdi dir="ltr">${DOC}</bdi>`);
      expect(text).toContain(`\u2066${DOC}\u2069`);
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
      `\u2066${DOC}\u2069 · Cable trays <Level 2> · Reached you at Contractor review`,
    );
    expect(renderEmail("notification-step-reached", "ar", examples["notification-step-reached"]).subject).toBe(
      `\u2066${DOC}\u2069 · Cable trays <Level 2> · وصلك في مراجعة المقاول`,
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

  it("Sent Back says what happened", () => {
    expect(renderEmail("notification-sent-back", "en", examples["notification-sent-back"]).subject.split(" · ")[2]).toBe("Sent Back to you");
  });
});

describe("the daily digest (RP-358)", () => {
  const digest = examples["daily-digest"];

  it("has a subject that names nothing: no Document Number, Subject, Project or Company", () => {
    expect(renderEmail("daily-digest", "en", digest).subject).toBe("Your Rabaed daily digest");
    expect(renderEmail("daily-digest", "ar", digest).subject).toBe("ملخصك اليومي من ربائد");
  });

  it.each(locales)("in %s: groups by Project, then item, in order, with what happened to each", (locale) => {
    const { text } = renderEmail("daily-digest", locale, digest);
    const order = [
      locale === "en" ? "Tower <A>" : "البرج أ",
      DOC,
      locale === "en" ? "Reached you at Contractor review" : "وصلك في مراجعة المقاول",
      locale === "en" ? "Code B" : "الرمز B",
      "Pumps (Revision in Draft)",
      locale === "en" ? "New Revision" : "مراجعة جديدة",
      locale === "en" ? "Clinic" : "العيادة",
      "CLN-SUB-02-0007",
      locale === "en" ? "Sent Back to you" : "أُرجع إليكم",
    ];
    const positions = order.map((part) => text.indexOf(part));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it.each(locales)("in %s: every Document Number is left to right, and every item links to itself", (locale) => {
    const { text, html } = renderEmail("daily-digest", locale, digest);
    for (const number of [DOC, "CLN-SUB-02-0007"]) {
      expect(text).toContain(`\u2066${number}\u2069`);
      expect(html).toContain(`<bdi dir="ltr">${number}</bdi>`);
    }
    for (const project of digest.projects) {
      for (const { link } of project.items) {
        expect(text).toContain(link);
        expect(html).toContain(`href="${link}"`);
      }
    }
  });

  it("names another Company only by name, with the signer of a final Code (V14)", () => {
    for (const locale of locales) {
      const { text } = renderEmail("daily-digest", locale, digest);
      expect(text).toContain(k1[locale]);
      expect(text).toContain(khalid[locale]);
    }
  });

  it("escapes values in the HTML body", () => {
    const { html } = renderEmail("daily-digest", "en", digest);
    expect(html).toContain("Tower &lt;A&gt;");
    expect(html).toContain("Cable trays &lt;Level 2&gt;");
    expect(html).not.toContain("<Level 2>");
  });
});

describe("sign-in locked", () => {
  it("says for how many minutes, in Latin digits in both languages", () => {
    for (const locale of locales) expect(renderEmail("sign-in-locked", locale, examples["sign-in-locked"]).text).toContain("15");
  });
});

describe("weekly Step Age report", () => {
  const en = () => renderEmail("step-age-report", "en", report);
  const ar = () => renderEmail("step-age-report", "ar", report);

  it("has a subject of the report's name and the Project only: nothing of any item", () => {
    expect(en().subject).toBe("Weekly Step Age report · Tower <A>");
    expect(ar().subject).toBe("تقرير عمر الخطوة الأسبوعي · البرج أ");
    for (const { subject } of [en(), ar()]) {
      for (const secret of [DOC, "Cable trays", k1.en, k1.ar, "Pumps"]) expect(subject).not.toContain(secret);
    }
  });

  it("groups the items by Step Age, 4+ weeks first, leaving out an empty group", () => {
    const { text } = en();
    const at = (s: string) => text.indexOf(s);
    expect(at("4+ weeks (1)")).toBeGreaterThan(-1);
    expect(at("2 weeks (1)")).toBeGreaterThan(at("4+ weeks (1)"));
    expect(at("1 week (1)")).toBeGreaterThan(at("2 weeks (1)"));
    expect(text).not.toContain("3 weeks");
    expect(at("Cable trays")).toBeGreaterThan(at("4+ weeks"));
    expect(at("Cable trays")).toBeLessThan(at("2 weeks"));
    expect(at("Valves")).toBeGreaterThan(at("1 week"));
    expect(ar().text).toContain("4+ أسابيع (1)");
  });

  it("shows each item's Document Number left to right, its Subject and Stage, and another Company by name only", () => {
    for (const locale of locales) {
      const { text, html } = renderEmail("step-age-report", locale, report);
      expect(text).toContain(`\u2066${DOC}\u2069 · Cable trays <Level 2>`);
      expect(html).toContain(`<bdi dir="ltr">${DOC}</bdi>`);
      expect(html).toContain("Cable trays &lt;Level 2&gt;");
      expect(html).not.toContain("<Level 2>");
      expect(text).toContain(k1[locale]);
      expect(text).toContain(locale === "en" ? "Contractor review" : "مراجعة المقاول");
      expect(text).toContain(locale === "en" ? "Pending approval" : "بانتظار الاعتماد");
    }
    expect(en().text).toContain("With Khatib Consultants");
  });

  it("links to the List of the report's items, and of those 4 weeks or more", () => {
    for (const locale of locales) {
      const { text, html } = renderEmail("step-age-report", locale, report);
      expect(text).toContain(LIST);
      expect(text).toContain(OLDEST);
      expect(html).toContain(`href="${LIST.replaceAll("&", "&amp;")}"`);
      expect(html).toContain(`href="${OLDEST.replaceAll("&", "&amp;")}"`);
    }
  });

  it("leaves out the 4+ weeks link when no item is that old", () => {
    const young = { ...report, items: report.items.slice(1) };
    expect(renderEmail("step-age-report", "en", young).text).not.toContain(OLDEST);
  });
});
