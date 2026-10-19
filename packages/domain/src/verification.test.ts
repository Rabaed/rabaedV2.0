import { describe, expect, it } from "vitest";
import { copyMatch, parseVerificationCode } from "./verification.ts";

describe("parseVerificationCode", () => {
  it("reads a typed code as the record prints it", () => {
    expect(parseVerificationCode("7K3M-Q9TB")).toBe("7K3M-Q9TB");
    expect(parseVerificationCode(" 7k3m q9tb ")).toBe("7K3M-Q9TB");
    expect(parseVerificationCode("7k3mq9tb")).toBe("7K3M-Q9TB");
  });

  it("reads I and L as 1 and O as 0, as Crockford's base 32 does", () => {
    expect(parseVerificationCode("IL0O-0000")).toBe("1100-0000");
  });

  it("is null for anything that can't be a code", () => {
    for (const typed of ["", "7K3M-Q9T", "7K3M-Q9TBX", "7K3M-Q9TU", "7K3M_Q9TB", "#7K3MQ9TB"]) expect(parseVerificationCode(typed), typed).toBeNull();
  });
});

describe("copyMatch", () => {
  const current = "a".repeat(64);
  const old = "b".repeat(64);
  const fingerprints = { current, replaced: [{ sha256: old, replacedAt: "2027-08-28T09:00:00.000Z" }] };

  it("knows the original, in either case", () => {
    expect(copyMatch(current.toUpperCase(), fingerprints)).toEqual({ kind: "original" });
  });

  it("knows a copy a corrected one replaced, and when", () => {
    expect(copyMatch(old, fingerprints)).toEqual({ kind: "replaced", replacedAt: "2027-08-28T09:00:00.000Z" });
  });

  it("knows any other file is not this record", () => {
    expect(copyMatch("c".repeat(64), fingerprints)).toEqual({ kind: "different" });
  });
});
