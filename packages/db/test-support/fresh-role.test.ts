import { describe, expect, it } from "vitest";
import { freshRoleName, leftoverRolePattern } from "./fresh-role.ts";

// Supavisor caches each login's SCRAM secret by name: a role dropped and created again under
// the same name gets a new salt, and the next pooled login fails with 28P01 (RP-1037).
describe("freshRoleName", () => {
  it("names a new role on each call, under the prefix", () => {
    const first = freshRoleName("rabaed_test_gate_no_bypass");
    const second = freshRoleName("rabaed_test_gate_no_bypass");

    expect(first).toMatch(/^rabaed_test_gate_no_bypass_[0-9a-f]{8}$/);
    expect(second).not.toBe(first);
  });

  it("refuses a prefix that is not a plain lowercase identifier, or too long for one", () => {
    expect(() => freshRoleName("Rabaed; drop role x")).toThrow(/prefix/);
    expect(() => freshRoleName(`rabaed_${"x".repeat(60)}`)).toThrow(/prefix/);
  });
});

describe("leftoverRolePattern", () => {
  it("matches the names freshRoleName gives that prefix, and no other role", () => {
    const pattern = new RegExp(leftoverRolePattern("rabaed_test_rds_master"));

    expect(pattern.test(freshRoleName("rabaed_test_rds_master"))).toBe(true);
    expect(pattern.test("rabaed_test_rds_master")).toBe(false);
    expect(pattern.test("rabaed_test_rds_master_x_0123abcd")).toBe(false);
    expect(pattern.test(freshRoleName("rabaed_test_gate_no_bypass"))).toBe(false);
  });
});
