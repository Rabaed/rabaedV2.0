import { describe, expect, it } from "vitest";
import { z } from "zod";
import { optionalSecret } from "./env.ts";

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
