import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Scenario RP-520-1. A Project or item the viewer may not see is a 404 that reads
// exactly like a URL that was never there (docs/visibility.md, 404 never 403). Every
// 404 in the web app reaches one page, built from nothing but its two strings and a
// link to the Projects page, so it cannot say which of the two it is. The made-up
// URL and the hidden one then differ only by their path.
const here = (path: string) => new URL(path, import.meta.url);
const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));

describe("the not-found page's words", () => {
  it("are the ones the product owner approved, in English and Arabic", () => {
    expect(messages("en").notFoundPage).toEqual({
      message: "We can't find this page. It may not exist, or you may not have access to it. Ask the person who sent you the link.",
      projects: "Projects",
    });
    expect(messages("ar").notFoundPage).toEqual({
      message: "تعذّر العثور على هذه الصفحة. قد لا تكون موجودة، أو قد لا تملك صلاحية الوصول إليها. اطلب المساعدة ممن أرسل إليك الرابط.",
      projects: "المشاريع",
    });
  });
});

describe("the not-found page", () => {
  it("exists in the locale layout, so every 404 shows it inside the app shell", () => {
    expect(existsSync(here("./not-found.tsx"))).toBe(true);
  });

  it("reads nothing about the request: no path, parameters, headers or cookies", () => {
    const source = readFileSync(here("./not-found.tsx"), "utf8");
    expect(source).not.toMatch(/params|usePathname|headers\(|cookies\(|searchParams|getMe|fetch/);
    expect(source).toMatch(/getTranslations\("notFoundPage"\)/);
  });

  it("is also what a URL that matches no route shows", () => {
    const catchAll = here("./[...rest]/page.tsx");
    expect(existsSync(catchAll)).toBe(true);
    expect(readFileSync(catchAll, "utf8")).toMatch(/notFound\(\)/);
  });
});
