// Seam 1: forgot password (RP-1058). A Member asks for a link by email; the answer is the same for
// any email, registered or not, and takes the same time; requests are limited per email and per
// visitor. The worker mints the link's token as it sends the email (only its hash is stored); the
// link works once, for 30 minutes, a new request voids the earlier one, and a reset signs the
// Member out everywhere else and is recorded. No token, password or email reaches the api's log.
import { randomInt } from "node:crypto";
import { Writable } from "node:stream";
import { hashToken } from "@rabaed/auth";
import { createDb, passwordResetHandler, processOutbox } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { PASSWORD_RESET, type PasswordResetEmail } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createTestApi, DEFAULT_PASSWORD, testConfig, uniqueEmail, type Caller } from "./support/harness.ts";

const api = await createTestApi();
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 2 });
const migrator = createDb(urls.migrator, { max: 1 });

/** Every reset email the worker sent. */
const sent: PasswordResetEmail[] = [];
const handler = passwordResetHandler(async (email) => void sent.push(email), api.now);
/** Sends every reset email due, as the worker does. */
async function drain() {
  for (;;) {
    const run = await processOutbox(worker, { handlers: { password_reset: handler }, kinds: ["password_reset"] });
    if (run.processed + run.failed + run.dead === 0) return;
  }
}
afterAll(async () => {
  await drain();
  await api.close();
  await Promise.all([worker.destroy(), migrator.destroy()]);
});

const NEW_PASSWORD = "a brand new long password";
/** A visitor of their own, so no test spends another's limit (the limit counts per address). */
const newAddress = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const newVisitor = (): Caller => api.visitor(newAddress());
const ask = (email: string, by: Caller = newVisitor()) => by.post("/v1/password-resets", { email });
const reset = (token: string, password = NEW_PASSWORD, by: Caller = api.anonymous()) =>
  by.post("/v1/password-resets/complete", { token, password });

/** A signed-in Member with a password, and their email; `locale` is their language. */
async function member(locale: "en" | "ar" = "en") {
  const email = uniqueEmail("forgetful");
  const company = await api.onboardCompany({ authorizedPerson: { email, fullName: { en: "Forgetful", ar: "كثير النسيان" }, locale } });
  const caller = await api.acceptInvitation(company.invitationToken);
  return { email, id: company.authorizedPerson.id, caller };
}

/** Asks for a link for `email` and returns the token the email carried. */
async function linkFor(email: string): Promise<string> {
  expect((await ask(email)).statusCode).toBe(202);
  await drain();
  const mine = sent.filter((m) => m.to === email);
  expect(mine.length).toBeGreaterThan(0);
  return mine.at(-1)!.token;
}

describe("asking for a link", () => {
  it("gives a registered and an unregistered email the same answer, in no less time", async () => {
    const { email } = await member();
    const invited = await api.onboardCompany();
    const answers = [];
    for (const who of [email, uniqueEmail("nobody"), invited.authorizedPerson.email]) {
      const started = performance.now();
      const res = await ask(who);
      answers.push({ status: res.statusCode, body: res.body, cookies: res.cookies, contentType: res.headers["content-type"] });
      expect(performance.now() - started).toBeGreaterThanOrEqual(PASSWORD_RESET.answerAfterMs - 5);
    }
    expect(answers[0]).toEqual({ status: 202, body: "", cookies: [], contentType: undefined });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("emails only a Member who can sign in, in their language, with a link that lasts 30 minutes", async () => {
    const en = await member("en");
    const ar = await member("ar");
    const nobody = uniqueEmail("nobody");
    const invited = await api.onboardCompany();
    for (const who of [en.email, ar.email, nobody, invited.authorizedPerson.email]) expect((await ask(who)).statusCode).toBe(202);
    await drain();
    expect(sent.filter((m) => m.to === en.email)).toEqual([{ to: en.email, language: "en", token: expect.any(String), validMinutes: 30 }]);
    expect(sent.filter((m) => m.to === ar.email)).toEqual([{ to: ar.email, language: "ar", token: expect.any(String), validMinutes: 30 }]);
    expect(sent.filter((m) => m.to === nobody || m.to === invited.authorizedPerson.email)).toEqual([]);
  });

  it("ignores the email's case and surrounding spaces", async () => {
    const { email } = await member();
    expect((await ask(`  ${email.toUpperCase()} `)).statusCode).toBe(202);
    await drain();
    expect(sent.filter((m) => m.to === email)).toHaveLength(1);
  });

  it("stores no token: only its hash, once the email is sent", async () => {
    const { email, id } = await member();
    const token = await linkFor(email);
    const { rows } = await sql<{ token_hash: Buffer }>`select token_hash from password_reset where member_id = ${id}::uuid`.execute(migrator);
    expect(rows).toEqual([{ token_hash: hashToken(token) }]);
    const outbox = await sql<{ payload: unknown }>`
      select payload from outbox where kind = 'password_reset' and payload::text like '%' || ${token} || '%'
    `.execute(migrator);
    expect(outbox.rows).toEqual([]);
  });

  it("refuses requests over the limit per email, from any visitor, registered or not", async () => {
    const { email } = await member();
    for (const who of [email, uniqueEmail("nobody")]) {
      const answers = await Promise.all(Array.from({ length: PASSWORD_RESET.perEmail + 1 }, () => ask(who)));
      const statuses = answers.map((r) => r.statusCode).sort();
      expect(statuses).toEqual([...Array<number>(PASSWORD_RESET.perEmail).fill(202), 429]);
      expect(answers.find((r) => r.statusCode === 429)!.json()).toEqual({ error: "too_many_attempts" });
    }
  });

  it("refuses requests over the limit per visitor, whatever the emails", async () => {
    const visitor = newVisitor();
    const answers = await Promise.all(Array.from({ length: PASSWORD_RESET.perVisitor + 1 }, () => ask(uniqueEmail("nobody"), visitor)));
    expect(answers.filter((r) => r.statusCode === 429)).toHaveLength(1);
    // Another visitor is not held back.
    expect((await ask(uniqueEmail("nobody"))).statusCode).toBe(202);
  });

  it("refuses a body that isn't an email, and needs no session", async () => {
    expect((await newVisitor().post("/v1/password-resets", { email: "not an email" })).statusCode).toBe(400);
  });
});

describe("using the link", () => {
  it("sets the new password and signs the Member in", async () => {
    const { email } = await member();
    const caller = api.anonymous();
    const res = await reset(await linkFor(email), NEW_PASSWORD, caller);
    expect(res.statusCode).toBe(204);
    expect(res.cookies).toEqual([expect.objectContaining({ name: "rabaed_session", httpOnly: true, secure: true })]);
    expect((await caller.get("/v1/me")).json()).toMatchObject({ member: { email } });
    expect((await api.anonymous().post("/v1/session", { email, password: DEFAULT_PASSWORD })).statusCode).toBe(401);
    expect((await api.anonymous().post("/v1/session", { email, password: NEW_PASSWORD })).statusCode).toBe(204);
  });

  it("works once", async () => {
    const { email } = await member();
    const token = await linkFor(email);
    expect((await reset(token)).statusCode).toBe(204);
    const again = await reset(token, "yet another long password");
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: "invalid_reset_link" });
    expect((await api.anonymous().post("/v1/session", { email, password: NEW_PASSWORD })).statusCode).toBe(204);
  });

  it("gives an unknown token the same answer", async () => {
    const res = await reset("made-up");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_reset_link" });
    expect(res.cookies).toEqual([]);
  });

  it("refuses a short password and leaves the link usable", async () => {
    const { email } = await member();
    const token = await linkFor(email);
    expect((await reset(token, "short")).statusCode).toBe(400);
    expect((await reset(token)).statusCode).toBe(204);
  });

  it("is voided by a later request", async () => {
    const { email } = await member();
    const first = await linkFor(email);
    const second = await linkFor(email);
    expect((await reset(first)).json()).toEqual({ error: "invalid_reset_link" });
    expect((await reset(second)).statusCode).toBe(204);
  });

  it("signs the Member out of every other session", async () => {
    const { email, caller: first } = await member();
    const second = await api.signIn(email, DEFAULT_PASSWORD);
    expect((await first.get("/v1/me")).statusCode).toBe(200);
    const caller = api.anonymous();
    expect((await reset(await linkFor(email), NEW_PASSWORD, caller)).statusCode).toBe(204);
    expect((await first.get("/v1/me")).statusCode).toBe(401);
    expect((await second.get("/v1/me")).statusCode).toBe(401);
    expect((await caller.get("/v1/me")).statusCode).toBe(200);
  });

  it("records the reset against the Member: the time, no token and no password", async () => {
    const { email, id } = await member();
    await reset(await linkFor(email));
    const { rows } = await sql<Record<string, unknown>>`select * from member_security_event where member_id = ${id}::uuid`.execute(migrator);
    expect(rows).toEqual([{ id: expect.any(String), member_id: id, kind: "password_reset", at: expect.any(Date) }]);
  });

  it("fails once its Member can no longer sign in", async () => {
    const { email, id } = await member();
    const token = await linkFor(email);
    await sql`update member set status = 'deactivated' where id = ${id}::uuid`.execute(migrator);
    const res = await reset(token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_reset_link" });
    const { rows } = await sql`select 1 from member_security_event where member_id = ${id}::uuid`.execute(migrator);
    expect(rows).toEqual([]);
  });

  it("expires after 30 minutes", async () => {
    const { email } = await member();
    const token = await linkFor(email);
    // Sessions last 12 hours, so moving the clock only this far ends none.
    api.advanceClock(PASSWORD_RESET.validMinutes * 60_000 + 1000);
    const res = await reset(token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_reset_link" });
  });
});

describe("the api's log", () => {
  it("holds no email, token or password from a request or a reset", async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logged = await buildApp({ db: worker, config: testConfig, now: api.now, logStream });
    try {
      const { email } = await member();
      const asked = await logged.inject({ method: "POST", url: "/v1/password-resets", headers: { "x-forwarded-for": newAddress() }, payload: { email } });
      expect(asked.statusCode).toBe(202);
      await drain();
      const token = sent.filter((m) => m.to === email).at(-1)!.token;
      const used = await logged.inject({ method: "POST", url: "/v1/password-resets/complete", payload: { token, password: NEW_PASSWORD } });
      expect(used.statusCode).toBe(204);
      const again = await logged.inject({ method: "POST", url: "/v1/password-resets/complete", payload: { token, password: NEW_PASSWORD } });
      expect(again.statusCode).toBe(400);
      const log = lines.join("");
      expect(log).toContain("/v1/password-resets");
      for (const secret of [email, token, NEW_PASSWORD]) expect(log).not.toContain(secret);
    } finally {
      await logged.close();
    }
  });
});
