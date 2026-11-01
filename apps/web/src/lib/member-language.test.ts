import { describe, expect, it, vi } from "vitest";
import { memberLanguage, saveMemberLanguage } from "./member-language.ts";

// RP-1174: the language switch is kept on the Member, and signing in opens the app in it.

describe("the language a signed-in Member opens in", () => {
  it("is the language the api has for them", async () => {
    const fetcher = vi.fn(async () => Response.json({ member: { language: "en" } }));
    expect(await memberLanguage("ar", fetcher)).toBe("en");
    expect(fetcher).toHaveBeenCalledWith("/api/v1/me", expect.objectContaining({ cache: "no-store" }));
  });

  it("is the page's own when the api can't say", async () => {
    expect(await memberLanguage("ar", async () => new Response(null, { status: 401 }))).toBe("ar");
    expect(await memberLanguage("en", async () => Response.json({ member: { language: "fr" } }))).toBe("en");
    expect(await memberLanguage("ar", async () => { throw new TypeError("fetch failed"); })).toBe("ar");
  });
});

describe("saving the language a Member switched to", () => {
  it("sends it to the api as theirs", async () => {
    const fetcher = vi.fn(async () => Response.json({ locale: "en" }));
    await saveMemberLanguage("en", fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/me/language", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
  });

  it("does not stop the switch when the api can't be reached", async () => {
    await expect(saveMemberLanguage("en", async () => { throw new TypeError("fetch failed"); })).resolves.toBeUndefined();
  });
});
