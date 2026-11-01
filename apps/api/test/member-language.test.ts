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
let arabic: { email: string; caller: Caller };
let colleague: Caller;
let other: Caller;

const me = async (by: Caller) => (await by.get("/v1/me")).json() as SignedInMember;
const language = async (by: Caller) => (await me(by)).member.language;
const choose = (by: Caller, body: unknown) => by.request("PUT", "/v1/me/language", body);

beforeAll(async () => {
  const company = await api.authorizedPerson();
  a = company.caller;
  const invited = await api.inviteMember(a, { locale: "ar" });
  arabic = { email: invited.email, caller: await api.acceptInvitation(invited.invitationToken) };
  colleague = (await api.inviteMember(a, { locale: "ar" }).then((m) => api.acceptInvitation(m.invitationToken)));
  other = (await api.authorizedPerson()).caller;
});

describe("a Member's language (scenario RP-1174-1)", () => {
  it("is the one they were invited in, given back with who they are", async () => {
    expect(await language(arabic.caller)).toBe("ar");
    expect(await language(a)).toBe("en");
  });

  it("is not changed by the browser's language at sign-in", async () => {
    const fromEnglishBrowser = await api.signIn(arabic.email, DEFAULT_PASSWORD, "en");
    expect(await language(fromEnglishBrowser)).toBe("ar");
  });

  it("is kept for the Member who switched, and opens the next sign-in", async () => {
    const res = await choose(arabic.caller, { locale: "en" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ locale: "en" });
    expect(await language(arabic.caller)).toBe("en");
    expect(await language(await api.signIn(arabic.email, DEFAULT_PASSWORD, "ar"))).toBe("en");
    expect((await choose(arabic.caller, { locale: "ar" })).statusCode).toBe(200);
    expect(await language(await api.signIn(arabic.email, DEFAULT_PASSWORD))).toBe("ar");
  });

  it("is the language of their emails too: the settings show the same one", async () => {
    await choose(arabic.caller, { locale: "en" });
    const settings = (await arabic.caller.get("/v1/notification-settings")).json() as { preferredLanguage: string };
    expect(settings.preferredLanguage).toBe("en");
    await choose(arabic.caller, { locale: "ar" });
  });

  it("is saved alone: the Member's other email settings stay as they were", async () => {
    const paused = (await api.inviteMember(a).then((m) => api.acceptInvitation(m.invitationToken)));
    const view = (await paused.get("/v1/notification-settings")).json() as { settings: unknown };
    expect((await paused.request("PUT", "/v1/notification-settings", { settings: view.settings, emailPaused: true, preferredLanguage: "en" })).statusCode).toBe(204);
    expect((await choose(paused, { locale: "ar" })).statusCode).toBe(200);
    const after = (await paused.get("/v1/notification-settings")).json() as { emailPaused: boolean; preferredLanguage: string };
    expect(after).toMatchObject({ emailPaused: true, preferredLanguage: "ar" });
  });

  it("is nobody else's: a colleague and another Company's Member keep their own", async () => {
    expect((await choose(other, { locale: "ar" })).statusCode).toBe(200);
    expect((await choose(arabic.caller, { locale: "en" })).statusCode).toBe(200);
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
