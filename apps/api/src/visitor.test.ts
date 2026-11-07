import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { visitorOf, visitorSha256 } from "./visitor.ts";

// RP-1230: on Vercel the api sees web's egress address as the last X-Forwarded-For entry, so web
// names the visitor in `x-rabaed-visitor`, with VISITOR_FORWARD_SECRET in `x-rabaed-visitor-key`.
// Built at run time, so no secret-like literal is in the source.
const SECRET = "s".repeat(48);
const EGRESS = "198.51.100.1";
const BROWSER = "203.0.113.7";

const request = (headers: Record<string, string | string[]>, ip = "127.0.0.1") => ({ headers, ip }) as unknown as FastifyRequest;
const forwarded = (key: string | string[] | undefined) =>
  request({ "x-forwarded-for": EGRESS, "x-rabaed-visitor": BROWSER, ...(key === undefined ? {} : { "x-rabaed-visitor-key": key }) });

describe("the visitor a public route's limit counts", () => {
  it("is the visitor web names when web's key is the secret", () => {
    expect(visitorOf(forwarded(SECRET), SECRET)).toBe(BROWSER);
  });

  it.each([
    ["a wrong key", "w".repeat(48)],
    ["a key of another length", SECRET.slice(0, 32)],
    ["an empty key", ""],
    ["the key sent twice", [SECRET, SECRET]],
  ])("is the direct caller with %s, never the named visitor", (_name, key) => {
    expect(visitorOf(forwarded(key), SECRET)).toBe(EGRESS);
  });

  it("is the direct caller with no key", () => {
    expect(visitorOf(forwarded(undefined), SECRET)).toBe(EGRESS);
  });

  it("is the direct caller when the api has no secret, whatever key was sent (today's behaviour)", () => {
    expect(visitorOf(forwarded(SECRET), undefined)).toBe(EGRESS);
    expect(visitorOf(forwarded(""), undefined)).toBe(EGRESS);
  });

  it("is the direct caller when the key is right but no visitor is named", () => {
    expect(visitorOf(request({ "x-forwarded-for": EGRESS, "x-rabaed-visitor-key": SECRET }), SECRET)).toBe(EGRESS);
  });

  it("is the last X-Forwarded-For entry otherwise, whatever the browser wrote before it", () => {
    expect(visitorOf(request({ "x-forwarded-for": `10.9.9.9, ${EGRESS}` }), SECRET)).toBe(EGRESS);
  });

  it("is the connection's address with no X-Forwarded-For", () => {
    expect(visitorOf(request({}, "192.0.2.5"), SECRET)).toBe("192.0.2.5");
  });

  it("is kept as its SHA-256, never the address", () => {
    expect(visitorSha256(forwarded(SECRET), SECRET)).toEqual(createHash("sha256").update(BROWSER, "utf8").digest());
  });
});
