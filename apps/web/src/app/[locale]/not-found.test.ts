import { readFileSync } from "node:fs";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import NotFound from "./not-found.tsx";

// Scenario RP-520-1 (docs/visibility.md, 404 never 403). Every 404 in the web app,
// a missing page, a Project or an item the viewer may not see, reaches this one
// page. Rendered on the server as Next renders it, with the locale's real messages:
// it says the same thing whatever was asked for, and offers the Projects page.
// (The api's half, byte-identical 404s for Nasser: apps/api/test/demo-seed.test.ts.)

const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
const request = vi.hoisted(() => ({ locale: "en" }));

// next-intl's server half only runs under React Server Components; outside them it
// is the same translator over the same messages, for the locale being rendered.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: request.locale, messages: messages(request.locale), namespace }),
}));
vi.mock("@/i18n/navigation", async () => import("../../i18n/navigation.ts"));

async function renderNotFound(locale: "en" | "ar"): Promise<string> {
  request.locale = locale;
  const page = await NotFound();
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messages(locale), children: page }));
}

describe("the not-found page", () => {
  it("says, under one heading, that the page may not exist or may not be theirs to open, and offers Projects (English)", async () => {
    const html = await renderNotFound("en");
    expect(html).toMatch(
      /<h1[^>]*>We can&#x27;t find this page\. It may not exist, or you may not have access to it\. Ask the person who sent you the link\.<\/h1>/,
    );
    expect(html).toMatch(/<a[^>]*href="\/en\/projects"[^>]*>Projects<\/a>/);
  });

  it("says the same in Arabic, its button to the Arabic Projects page", async () => {
    const html = await renderNotFound("ar");
    expect(html).toMatch(
      /<h1[^>]*>تعذّر العثور على هذه الصفحة\. قد لا تكون موجودة، أو قد لا تملك صلاحية الوصول إليها\. اطلب المساعدة ممن أرسل إليك الرابط\.<\/h1>/,
    );
    expect(html).toMatch(/<a[^>]*href="\/ar\/projects"[^>]*>المشاريع<\/a>/);
  });

  it("is the same page every time: it takes nothing from the request, so a hidden Project or item reads like a made-up URL", async () => {
    expect(NotFound.length).toBe(0);
    expect(await renderNotFound("en")).toBe(await renderNotFound("en"));
  });
});
