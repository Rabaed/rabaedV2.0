// Seam 1: the visitor a public route's limit counts when web calls the api on Vercel (RP-1230, part 2;
// RP-157's typed-code limit, RP-1058's password-reset limit). Vercel overwrites X-Forwarded-For at
// each hop, so the api's last entry is web's egress address, one for every visitor. Web names the
// visitor in `x-rabaed-visitor`, with VISITOR_FORWARD_SECRET in `x-rabaed-visitor-key`, and the api
// believes it only with that key. The typed-code route counts a wrong code as an attempt, so no
// record is needed here (verification.test.ts has the records), and the password-reset route counts
// a request for any email alike.
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { PASSWORD_RESET, VERIFICATION_ATTEMPTS } from "@rabaed/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { testConfig } from "./support/harness.ts";

// Built at run time, so no secret-like literal is in the source.
const SECRET = randomBytes(36).toString("base64url");
const log: string[] = [];
const logStream = new Writable({
  write(chunk, _encoding, done) {
    log.push(String(chunk));
    done();
  },
});

const db = createDb(testDatabaseUrls().app, { max: 2 });
const withSecret = await buildApp({ db, config: { ...testConfig, visitorForwardSecret: SECRET }, logStream });
const withoutSecret = await buildApp({ db, config: testConfig, logger: "errors" });
afterAll(async () => {
  await Promise.all([withSecret.close(), withoutSecret.close()]);
  await db.destroy();
});

/** A fresh address per call: the database keeps attempts across runs, so no two runs share one. */
const address = () => `2001:db8::${randomBytes(6).toString("hex").match(/.{4}/g)!.join(":")}`;

/** One typed-code attempt through `app`, as web sends it from `egress` for `visitor` with `key`. */
const attempt = (app: FastifyInstance, egress: string, visitor?: string, key?: string) =>
  app.inject({
    method: "POST",
    url: "/v1/verification/code",
    headers: {
      "x-forwarded-for": egress,
      ...(visitor ? { "x-rabaed-visitor": visitor } : {}),
      ...(key !== undefined ? { "x-rabaed-visitor-key": key } : {}),
    },
    payload: { code: "ZZZZ-ZZZZ", documentNumber: "VER" },
  });

/** Uses up `visitor`'s attempts, each a wrong code, then returns the answer to one more. */
async function pastTheLimit(app: FastifyInstance, egress: string, visitor?: string, key?: string) {
  for (let i = 0; i < VERIFICATION_ATTEMPTS.perVisitor; i++) expect((await attempt(app, egress, visitor, key)).statusCode).toBe(404);
  return (await attempt(app, egress, visitor, key)).statusCode;
}

describe("RP-1230: two visitors behind one egress address", () => {
  it("get a limit each when web names them with the right key", async () => {
    const egress = address();
    const [first, second] = [address(), address()];
    expect(await pastTheLimit(withSecret, egress, first, SECRET)).toBe(429);
    expect((await attempt(withSecret, egress, second, SECRET)).statusCode).toBe(404);
  });

  it.each([
    ["a wrong key", () => randomBytes(36).toString("base64url")],
    ["no key", () => undefined],
  ])("share the egress address's limit with %s: the named visitor is not believed", async (_name, key) => {
    const egress = address();
    expect(await pastTheLimit(withSecret, egress, address(), key())).toBe(429);
    expect((await attempt(withSecret, egress, address(), key())).statusCode).toBe(429);
  });

  it("share the egress address's limit when the api has no secret (today's behaviour)", async () => {
    const egress = address();
    expect(await pastTheLimit(withoutSecret, egress, address(), SECRET)).toBe(429);
    expect((await attempt(withoutSecret, egress, address(), SECRET)).statusCode).toBe(429);
  });

  it("get a password-reset limit each too (RP-1058), each request for an email no one has", async () => {
    const egress = address();
    const [first, second] = [address(), address()];
    const ask = (visitor: string) =>
      withSecret.inject({
        method: "POST",
        url: "/v1/password-resets",
        headers: { "x-forwarded-for": egress, "x-rabaed-visitor": visitor, "x-rabaed-visitor-key": SECRET },
        payload: { email: `nobody-${randomBytes(6).toString("hex")}@rabaed.test` },
      });
    for (let i = 0; i < PASSWORD_RESET.perVisitor; i++) expect((await ask(first)).statusCode).toBe(202);
    expect((await ask(first)).statusCode).toBe(429);
    expect((await ask(second)).statusCode).toBe(202);
  });

  it("never puts the key in the api's log", () => {
    expect(log.join("")).toContain("/v1/verification/code");
    expect(log.join("")).not.toContain(SECRET);
  });
});
