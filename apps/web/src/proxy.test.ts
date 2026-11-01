import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import proxy from "./proxy.ts";

// RP-1174 (owner decision 2026-11-01): Rabaed opens in Arabic, whatever the browser asks for; a
// signed-in Member who switched to English opens in English next time. The browser's language
// (Accept-Language) and next-intl's NEXT_LOCALE cookie play no part.

const englishBrowser = { "accept-language": "en-US,en;q=0.9" };

function visit(path: string, headers: Record<string, string> = {}) {
  return proxy(new NextRequest(`http://web.test${path}`, { headers: { ...englishBrowser, ...headers } }));
}

/** The path a response sends the browser to, or null when it lets the request through. */
const redirectedTo = (response: Response) => {
  const location = response.headers.get("location");
  return location ? new URL(location).pathname : null;
};

/** The api answering `/v1/me` as a Member whose language is `language`; returns the calls it got. */
function apiAnswers(language: "ar" | "en" | "down") {
  const calls: { url: string; cookie: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, cookie: new Headers(init.headers).get("cookie") });
      if (language === "down") throw new TypeError("fetch failed");
      return Response.json({ member: { language } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("opening the app", () => {
  it("opens a signed-out visit in Arabic, though the browser asks for English", async () => {
    const calls = apiAnswers("en");
    expect(redirectedTo(await visit("/"))).toBe("/ar");
    expect(redirectedTo(await visit("/sign-in"))).toBe("/ar/sign-in");
    expect(calls).toEqual([]);
  });

  it("ignores the cookie next-intl used to remember the page's language in", async () => {
    expect(redirectedTo(await visit("/", { cookie: "NEXT_LOCALE=en" }))).toBe("/ar");
  });

  it("opens in the language a signed-in Member chose, whatever the browser asks for", async () => {
    const calls = apiAnswers("en");
    expect(redirectedTo(await visit("/", { cookie: "rabaed_session=t" }))).toBe("/en");
    expect(redirectedTo(await visit("/projects", { cookie: "rabaed_session=t" }))).toBe("/en/projects");
    expect(calls[0]).toMatchObject({ url: expect.stringMatching(/\/v1\/me$/), cookie: "rabaed_session=t" });
  });

  it("opens a Member whose language is Arabic in Arabic, though the browser asks for English", async () => {
    apiAnswers("ar");
    expect(redirectedTo(await visit("/", { cookie: "rabaed_session=t" }))).toBe("/ar");
  });

  it("opens in Arabic when the api can't say who the Member is", async () => {
    apiAnswers("down");
    expect(redirectedTo(await visit("/", { cookie: "rabaed_session=t" }))).toBe("/ar");
  });

  it("does not ask the api for a visitor with no session, only other cookies", async () => {
    const calls = apiAnswers("en");
    expect(redirectedTo(await visit("/", { cookie: "rabaed_appearance=x" }))).toBe("/ar");
    expect(calls).toEqual([]);
  });

  it("leaves a page whose address names a language in that language", async () => {
    const calls = apiAnswers("en");
    const arabic = await visit("/ar/projects", { cookie: "rabaed_session=t" });
    expect(redirectedTo(arabic)).toBeNull();
    expect(arabic.headers.get("x-middleware-request-x-next-intl-locale")).toBe("ar");
    expect(redirectedTo(await visit("/en/projects", { cookie: "rabaed_session=t" }))).toBeNull();
    expect(calls).toEqual([]);
  });
});
