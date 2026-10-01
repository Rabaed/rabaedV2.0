// Seam 1: a Rabaed Engineer signs in to Rabaed Admin with a password and a
// one-time code sent by email; lockout, idle sign-out and the new-device
// alert (ADR 0010, RP-254).
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { afterAll, describe, expect, it } from "vitest";
import { createTestAdmin, DEFAULT_PASSWORD, MINUTE, uniqueEmail } from "./support/harness.ts";

const admin = await createTestAdmin();
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await admin.close();
  await adminDb.destroy();
});

const events = async (engineerId: string) =>
  (
    await adminDb.selectFrom("engineer_sign_in_event").select("event").where("engineer_id", "=", engineerId).orderBy("at").orderBy("id").execute()
  ).map((e) => e.event);

describe("signing in", () => {
  it("needs the emailed code after the password: the password alone gives no session", async () => {
    const engineer = await admin.newEngineer();
    const browser = admin.browser();
    const res = await browser.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ codeSentTo: engineer.email });
    expect((await browser.get("/v1/me")).statusCode).toBe(401);

    const code = admin.outbox.lastCode(engineer.email);
    expect(code).toMatch(/^\d{6}$/);
    expect((await browser.post("/v1/sign-in/code", { code })).statusCode).toBe(204);
    const me = await browser.get("/v1/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ engineer: { id: engineer.id, email: engineer.email, fullName: "Test Engineer" } });
  });

  it("answers a wrong password and an unknown email alike, and sends no code", async () => {
    const engineer = await admin.newEngineer();
    const wrong = await admin.browser().post("/v1/sign-in", { email: engineer.email, password: "not the password" });
    const unknown = await admin.browser().post("/v1/sign-in", { email: uniqueEmail("nobody"), password: DEFAULT_PASSWORD });
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "invalid_credentials" });
    }
    expect(admin.outbox.to(engineer.email)).toEqual([]);
  });

  it("does not let a Member sign in", async () => {
    // Members live in the customer app; Rabaed Admin knows only Engineers.
    const res = await admin.browser().post("/v1/sign-in", { email: "hafiz.hamdan@tmc.demo.rabaed.test", password: DEFAULT_PASSWORD });
    expect(res.statusCode).toBe(401);
  });

  it("uses each code once", async () => {
    const engineer = await admin.newEngineer();
    const browser = admin.browser();
    await browser.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    const challenge = browser.cookie("rabaed_admin_challenge");
    const code = admin.outbox.lastCode(engineer.email);
    expect((await browser.post("/v1/sign-in/code", { code })).statusCode).toBe(204);
    expect((await browser.delete("/v1/session")).statusCode).toBe(204);

    // Replaying the same challenge and code signs no one in.
    browser.setCookie("rabaed_admin_challenge", challenge);
    const again = await browser.post("/v1/sign-in/code", { code });
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: "invalid_code" });
    expect((await browser.get("/v1/me")).statusCode).toBe(401);
  });

  it("takes only the newest code: asking again voids the earlier one", async () => {
    const engineer = await admin.newEngineer();
    const first = admin.browser();
    await first.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    const firstCode = admin.outbox.lastCode(engineer.email);
    const second = admin.browser();
    await second.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    expect((await first.post("/v1/sign-in/code", { code: firstCode })).statusCode).toBe(401);
    expect((await second.post("/v1/sign-in/code", { code: admin.outbox.lastCode(engineer.email) })).statusCode).toBe(204);
  });

  it("takes the code only in the browser that gave the password", async () => {
    const engineer = await admin.newEngineer();
    await admin.browser().post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    const other = admin.browser();
    expect((await other.post("/v1/sign-in/code", { code: admin.outbox.lastCode(engineer.email) })).statusCode).toBe(401);
    expect((await other.get("/v1/me")).statusCode).toBe(401);
  });

  it("expires the code after ten minutes", async () => {
    const engineer = await admin.newEngineer();
    const browser = admin.browser();
    await browser.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    admin.advanceClock(10 * MINUTE + 1000);
    expect((await browser.post("/v1/sign-in/code", { code: admin.outbox.lastCode(engineer.email) })).statusCode).toBe(401);
  });

  it("gives up on a code after three wrong tries, even if the right one comes next", async () => {
    const engineer = await admin.newEngineer();
    const browser = admin.browser();
    await browser.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    const code = admin.outbox.lastCode(engineer.email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect((await browser.post("/v1/sign-in/code", { code: wrong })).statusCode).toBe(401);
    expect((await browser.post("/v1/sign-in/code", { code })).statusCode).toBe(401);
  });

  it("sends at most three codes in fifteen minutes", async () => {
    const engineer = await admin.newEngineer();
    for (let i = 0; i < 3; i++) {
      expect((await admin.browser().post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD })).statusCode).toBe(202);
    }
    const fourth = await admin.browser().post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json()).toEqual({ error: "too_many_codes" });
    expect(admin.outbox.to(engineer.email).filter((m) => m.template === "sign-in-code")).toHaveLength(3);

    admin.advanceClock(15 * MINUTE + 1000);
    expect((await admin.browser().post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD })).statusCode).toBe(202);
  });

  it("sets HttpOnly, Secure, SameSite=Strict cookies", async () => {
    const engineer = await admin.newEngineer();
    const browser = admin.browser();
    const challenge = await browser.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    const signedIn = await browser.post("/v1/sign-in/code", { code: admin.outbox.lastCode(engineer.email) });
    for (const cookie of [...challenge.cookies, ...signedIn.cookies]) {
      expect(cookie, cookie.name).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });
    }
    expect(signedIn.cookies.map((c) => c.name)).toContain("rabaed_admin_session");
  });
});

describe("lockout", () => {
  it("locks sign-in for fifteen minutes after five failures, and emails the Engineer", async () => {
    const engineer = await admin.newEngineer();
    for (let i = 0; i < 5; i++) {
      expect((await admin.browser().post("/v1/sign-in", { email: engineer.email, password: `wrong ${i}` })).statusCode).toBe(401);
    }
    expect(admin.outbox.to(engineer.email).map((m) => m.template)).toEqual(["sign-in-locked"]);

    // Even the right password is refused, looking like any failure, and no code is sent.
    const locked = await admin.browser().post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    expect(locked.statusCode).toBe(401);
    expect(locked.json()).toEqual({ error: "invalid_credentials" });
    expect(admin.outbox.to(engineer.email).map((m) => m.template)).toEqual(["sign-in-locked"]);

    admin.advanceClock(15 * MINUTE + 1000);
    await admin.signIn(admin.browser(), engineer.email);
  });

  it("holds when many guesses arrive at once", async () => {
    const engineer = await admin.newEngineer();
    const guesses = Array.from({ length: 8 }, (_, i) => admin.browser().post("/v1/sign-in", { email: engineer.email, password: `wrong ${i}` }));
    for (const res of await Promise.all(guesses)) expect(res.statusCode).toBe(401);
    expect((await admin.browser().post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD })).statusCode).toBe(401);
    expect(admin.outbox.to(engineer.email).map((m) => m.template)).toEqual(["sign-in-locked"]);
    admin.advanceClock(15 * MINUTE + 1000);
  });

  it("counts wrong codes too", async () => {
    const engineer = await admin.newEngineer();
    for (let i = 0; i < 2; i++) {
      const browser = admin.browser();
      await browser.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
      const code = admin.outbox.lastCode(engineer.email);
      const wrong = code === "000000" ? "111111" : "000000";
      await browser.post("/v1/sign-in/code", { code: wrong });
      await browser.post("/v1/sign-in/code", { code: wrong });
    }
    admin.advanceClock(15 * MINUTE + 1000); // past the code-sending limit, not the lockout window
    const browser = admin.browser();
    await browser.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    const code = admin.outbox.lastCode(engineer.email);
    // The fifth failure locks it.
    expect((await browser.post("/v1/sign-in/code", { code: code === "000000" ? "111111" : "000000" })).statusCode).toBe(401);
    expect((await browser.post("/v1/sign-in/code", { code })).statusCode).toBe(401);
    expect(admin.outbox.to(engineer.email).at(-1)?.template).toBe("sign-in-locked");
  });

  it("starts the count afresh after a successful sign-in", async () => {
    const engineer = await admin.newEngineer();
    for (let i = 0; i < 4; i++) await admin.browser().post("/v1/sign-in", { email: engineer.email, password: "wrong" });
    await admin.signIn(admin.browser(), engineer.email);
    for (let i = 0; i < 4; i++) await admin.browser().post("/v1/sign-in", { email: engineer.email, password: "wrong" });
    expect((await admin.browser().post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD })).statusCode).toBe(202);
  });
});

describe("sessions", () => {
  it("end after 30 minutes without a request", async () => {
    const { browser } = await admin.signedInEngineer();
    admin.advanceClock(29 * MINUTE);
    expect((await browser.get("/v1/me")).statusCode).toBe(200);
    // Each request starts the 30 minutes again.
    admin.advanceClock(29 * MINUTE);
    expect((await browser.get("/v1/me")).statusCode).toBe(200);
    admin.advanceClock(30 * MINUTE + 1000);
    expect((await browser.get("/v1/me")).statusCode).toBe(401);
  });

  it("end after twelve hours however busy", async () => {
    const { browser } = await admin.signedInEngineer();
    for (let i = 0; i < 25; i++) {
      admin.advanceClock(29 * MINUTE);
      await browser.get("/v1/me");
    }
    expect((await browser.get("/v1/me")).statusCode).toBe(401);
  });

  it("end on the server at sign-out", async () => {
    const { browser } = await admin.signedInEngineer();
    const token = browser.cookie("rabaed_admin_session");
    expect((await browser.delete("/v1/session")).statusCode).toBe(204);
    expect(browser.cookie("rabaed_admin_session")).toBeUndefined();
    browser.setCookie("rabaed_admin_session", token);
    expect((await browser.get("/v1/me")).statusCode).toBe(401);
  });

  it("are not the customer app's: a customer session cookie means nothing here", async () => {
    const browser = admin.browser();
    browser.setCookie("rabaed_session", "anything");
    expect((await browser.get("/v1/me")).statusCode).toBe(401);
  });
});

describe("new device alert", () => {
  it("emails the Engineer on a sign-in from a browser not seen before, and only then", async () => {
    const engineer = await admin.newEngineer();
    const alerts = () => admin.outbox.to(engineer.email).filter((m) => m.template === "new-device-sign-in");

    const laptop = admin.browser();
    await admin.signIn(laptop, engineer.email);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.values).toEqual({ when: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/), ip: "127.0.0.1" });

    await laptop.delete("/v1/session");
    await admin.signIn(laptop, engineer.email);
    expect(alerts()).toHaveLength(1);

    await admin.signIn(admin.browser(), engineer.email);
    expect(alerts()).toHaveLength(2);
  });
});

describe("the sign-in log", () => {
  it("records every sign-in, failure and sign-out", async () => {
    const engineer = await admin.newEngineer();
    const browser = admin.browser();
    await browser.post("/v1/sign-in", { email: engineer.email, password: "wrong" });
    await browser.post("/v1/sign-in", { email: engineer.email, password: DEFAULT_PASSWORD });
    const code = admin.outbox.lastCode(engineer.email);
    await browser.post("/v1/sign-in/code", { code: code === "000000" ? "111111" : "000000" });
    await browser.post("/v1/sign-in/code", { code });
    await browser.delete("/v1/session");
    const logged = await events(engineer.id);
    expect(logged.slice(0, 3)).toEqual(["password_failed", "code_sent", "code_failed"]);
    // Logged at the same instant, so in either order.
    expect(logged.slice(3, 5).sort()).toEqual(["new_device", "signed_in"]);
    expect(logged.slice(5)).toEqual(["signed_out"]);
  });

  it("records the address the load balancer saw, not one the client wrote into X-Forwarded-For", async () => {
    const email = uniqueEmail("nobody");
    await admin.app.inject({
      method: "POST",
      url: "/v1/sign-in",
      headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.7" },
      payload: { email, password: DEFAULT_PASSWORD },
    });
    const rows = await adminDb.selectFrom("engineer_sign_in_event").select("ip").where("email", "=", email).execute();
    expect(rows).toEqual([{ ip: "198.51.100.7" }]);
  });

  it("records a failure for an email that is no Engineer's", async () => {
    const email = uniqueEmail("nobody");
    await admin.browser().post("/v1/sign-in", { email, password: DEFAULT_PASSWORD });
    const rows = await adminDb.selectFrom("engineer_sign_in_event").select(["engineer_id", "event", "ip"]).where("email", "=", email).execute();
    expect(rows).toEqual([{ engineer_id: null, event: "password_failed", ip: "127.0.0.1" }]);
  });

  it("records an idle sign-out", async () => {
    const { id, browser } = await admin.signedInEngineer();
    admin.advanceClock(31 * MINUTE);
    await browser.get("/v1/me");
    expect((await events(id)).at(-1)).toBe("idle_signed_out");
  });
});
