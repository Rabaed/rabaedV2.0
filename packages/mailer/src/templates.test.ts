import { locales } from "@rabaed/domain";
import { deadlineWordInCopy } from "@rabaed/eslint-plugin/matchers";
import { describe, expect, it } from "vitest";
import { renderEmail, templateNames, type TemplateValues } from "./templates.ts";

const examples: TemplateValues = {
  "sign-in-code": { code: "482913", validMinutes: 10 },
  invitation: { companyName: "Al Bina <Contracting> & Sons", link: "https://rabaed.test/ar/accept-invitation#token=abc" },
};

describe("every template", () => {
  it.each(templateNames.flatMap((template) => locales.map((locale) => [template, locale] as const)))(
    "%s in %s has a subject, a text and an HTML body",
    (template, locale) => {
      const email = renderEmail(template, locale, examples[template]);
      expect(email.subject.trim()).not.toBe("");
      expect(email.text.trim()).not.toBe("");
      expect(email.html).toContain("<html");
    },
  );

  it.each(templateNames)("%s sets the language and direction: English left to right, Arabic right to left", (template) => {
    expect(renderEmail(template, "en", examples[template]).html).toMatch(/<html lang="en" dir="ltr">/);
    expect(renderEmail(template, "ar", examples[template]).html).toMatch(/<html lang="ar" dir="rtl">/);
  });

  it.each(templateNames)("%s is translated: the Arabic subject differs from the English one", (template) => {
    expect(renderEmail(template, "ar", examples[template]).subject).not.toBe(renderEmail(template, "en", examples[template]).subject);
  });

  it.each(templateNames.flatMap((template) => locales.map((locale) => [template, locale] as const)))(
    "%s in %s uses Latin digits only and no deadline words",
    (template, locale) => {
      const { subject, text, html } = renderEmail(template, locale, examples[template]);
      for (const part of [subject, text, html]) {
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
