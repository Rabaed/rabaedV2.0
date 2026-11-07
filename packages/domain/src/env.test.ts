import { describe, expect, it } from "vitest";
import { z } from "zod";
import { optionalSecret, VISITOR_FORWARD_SECRET_MIN_LENGTH, visitorForwardSecret } from "./env.ts";

describe("optionalSecret", () => {
  const schema = z.object({ KEY: optionalSecret });

  it("takes an empty value as unset: a .env line `KEY=` never stops a process (#560)", () => {
    expect(schema.parse({ KEY: "" })).toEqual({ KEY: undefined });
  });

  it("takes a blank value (spaces only) as unset", () => {
    expect(schema.parse({ KEY: "  " })).toEqual({ KEY: undefined });
  });

  it("takes an absent value as unset", () => {
    expect(schema.parse({})).toEqual({ KEY: undefined });
  });

  it("keeps a value that is set", () => {
    expect(schema.parse({ KEY: "s3cr3t" })).toEqual({ KEY: "s3cr3t" });
  });

  it("refuses a value that is not a string", () => {
    expect(() => schema.parse({ KEY: 42 })).toThrow();
  });
});

describe("visitorForwardSecret (RP-1230)", () => {
  const schema = z.object({ VISITOR_FORWARD_SECRET: visitorForwardSecret });

  it.each([["absent", {}], ["empty", { VISITOR_FORWARD_SECRET: "" }], ["blank", { VISITOR_FORWARD_SECRET: "  " }]])("is unset when %s", (_name, env) => {
    expect(schema.parse(env).VISITOR_FORWARD_SECRET).toBeUndefined();
  });

  it(`keeps a secret of ${VISITOR_FORWARD_SECRET_MIN_LENGTH} characters or more`, () => {
    const secret = "k".repeat(VISITOR_FORWARD_SECRET_MIN_LENGTH);
    expect(schema.parse({ VISITOR_FORWARD_SECRET: secret }).VISITOR_FORWARD_SECRET).toBe(secret);
  });

  it("refuses a shorter one, naming the variable but never the value", () => {
    const short = "k".repeat(VISITOR_FORWARD_SECRET_MIN_LENGTH - 1);
    const result = schema.safeParse({ VISITOR_FORWARD_SECRET: short });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("VISITOR_FORWARD_SECRET");
    expect(result.error?.message).not.toContain(short);
  });
});
