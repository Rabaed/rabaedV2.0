import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation.ts";

afterEach(() => vi.unstubAllEnvs());

describe("web's start-up (instrumentation.ts)", () => {
  it("stops when VISITOR_FORWARD_SECRET is shorter than 32 characters (RP-1230)", () => {
    vi.stubEnv("VISITOR_FORWARD_SECRET", "k".repeat(31));
    expect(() => register()).toThrow(/VISITOR_FORWARD_SECRET/);
  });

  it.each([
    ["unset", ""],
    ["32 characters or more", "k".repeat(32)],
  ])("goes on when VISITOR_FORWARD_SECRET is %s", (_name, value) => {
    vi.stubEnv("VISITOR_FORWARD_SECRET", value);
    expect(() => register()).not.toThrow();
  });
});
