// Seam 1 for a Member's language (RP-1174, owner decision 2026-11-01): Rabaed opens in Arabic and
// remembers a switch to English on the Member, never the browser's language. The Member language is
// the one that sets the language of their emails (RP-355); it is given back with who they are
// (`/v1/me`), so the web app opens in it on the next sign-in or visit, and `PUT /v1/me/language`
// keeps it from the language switch. It is theirs alone (RLS).
import { type SignedInMember } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, DEFAULT_PASSWORD, type Caller } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

let a: Caller;
let other: Caller;

const me = async (by: Caller) => (await by.get("/v1/me")).json() as SignedInMember;
const language = async (by: Caller) => (await me(by)).member.language;
const choose = (by: Caller, body: unknown) => by.request("PUT", "/v1/me/language", body);
/** A Member of the Authorized Person's Company, invited in `locale` and signed in; each test builds its own. */
const invitedIn = async (locale: "ar" | "en") => {
  const invited = await api.inviteMember(a, { locale });
  return { email: invited.email, caller: await api.acceptInvitation(invited.invitationToken) };
};

beforeAll(async () => {
  a = (await api.authorizedPerson()).caller;
  other = (await api.authorizedPerson()).caller;
});

describe("a Member's language (scenario RP-1174-1)", () => {
  it("is the one they were invited in, given back with who they are", async () => {
    expect(await language((await invitedIn("ar")).caller)).toBe("ar");
    expect(await language((await invitedIn("en")).caller)).toBe("en");
  });

  it("is not changed by the browser's language at sign-in", async () => {
    const arabic = await invitedIn("ar");
    expect(await language(await api.signIn(arabic.email, DEFAULT_PASSWORD, "en"))).toBe("ar");
  });

  it("is kept for the Member who switched, and opens the next sign-in", async () => {
    const arabic = await invitedIn("ar");
    const res = await choose(arabic.caller, { locale: "en" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ locale: "en" });
    expect(await language(arabic.caller)).toBe("en");
    expect(await language(await api.signIn(arabic.email, DEFAULT_PASSWORD, "ar"))).toBe("en");
    expect((await choose(arabic.caller, { locale: "ar" })).statusCode).toBe(200);
    expect(await language(await api.signIn(arabic.email, DEFAULT_PASSWORD))).toBe("ar");
  });

  it("is the language of their emails too: the settings show the same one", async () => {
    const arabic = await invitedIn("ar");
    await choose(arabic.caller, { locale: "en" });
    const settings = (await arabic.caller.get("/v1/notification-settings")).json() as { preferredLanguage: string };
    expect(settings.preferredLanguage).toBe("en");
  });

  it("is saved alone: the Member's other email settings stay as they were", async () => {
    const paused = (await invitedIn("en")).caller;
    const view = (await paused.get("/v1/notification-settings")).json() as { settings: unknown };
    expect((await paused.request("PUT", "/v1/notification-settings", { settings: view.settings, emailPaused: true, preferredLanguage: "en" })).statusCode).toBe(204);
    expect((await choose(paused, { locale: "ar" })).statusCode).toBe(200);
    const after = (await paused.get("/v1/notification-settings")).json() as { emailPaused: boolean; preferredLanguage: string };
    expect(after).toMatchObject({ emailPaused: true, preferredLanguage: "ar" });
  });

  it("is nobody else's: a colleague and another Company's Member keep their own", async () => {
    const switcher = (await invitedIn("ar")).caller;
    const colleague = (await invitedIn("ar")).caller;
    expect((await choose(other, { locale: "ar" })).statusCode).toBe(200);
    expect((await choose(switcher, { locale: "en" })).statusCode).toBe(200);
    expect(await language(colleague)).toBe("ar");
    expect(await language(a)).toBe("en");
    expect(await language(other)).toBe("ar");
  });

  it("refuses a language the app doesn't offer", async () => {
    for (const body of [{ locale: "fr" }, { locale: "" }, {}, { locale: null }]) {
      expect((await choose(a, body)).statusCode).toBe(400);
    }
    expect(await language(a)).toBe("en");
  });

  it("needs a signed-in Member", async () => {
    expect((await choose(api.anonymous(), { locale: "ar" })).statusCode).toBe(401);
  });
});
