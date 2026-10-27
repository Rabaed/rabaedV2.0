import { readFileSync } from "node:fs";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReadFailed } from "./read-failed.tsx";

// RP-1049: a slow or failed read shows this, never the not-found page (docs/visibility.md,
// Direct URL row). Like the not-found page it reads nothing about the request, so it names no
// item, Project or Company (Errors row).

const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));
const request = vi.hoisted(() => ({ locale: "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: request.locale, messages: messages(request.locale), namespace }),
}));
// The button refreshes through the App Router, which a static render has no mount for.
vi.mock("./try-again-button.tsx", () => ({
  TryAgainButton: ({ label }: { label: string }) => createElement("button", { type: "button" }, label),
}));

async function render(locale: "en" | "ar"): Promise<string> {
  request.locale = locale;
  const page = await ReadFailed();
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: messages(locale), children: page }));
}

describe("the error state of a page whose read failed", () => {
  it("says the page couldn't be loaded, as an alert, and offers Try again (English)", async () => {
    const html = await render("en");
    expect(html).toMatch(/role="alert"/);
    expect(html).toMatch(/<h2[^>]*>This page couldn&#x27;t be loaded<\/h2>/);
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
  });

  it("says the same in Arabic", async () => {
    const html = await render("ar");
    expect(html).toMatch(/<h2[^>]*>تعذّر تحميل هذه الصفحة<\/h2>/);
    expect(html).toMatch(/<button[^>]*>حاول مرة أخرى<\/button>/);
  });

  it("is not the not-found page: it never says the page may not exist or may not be theirs", async () => {
    const html = await render("en");
    expect(html).not.toMatch(/can&#x27;t find|may not exist|access/i);
    expect(html).not.toMatch(/data-testid="not-found"/);
  });

  it("is the same every time: it takes nothing from the request", async () => {
    expect(ReadFailed.length).toBe(0);
    expect(await render("en")).toBe(await render("en"));
  });
});
