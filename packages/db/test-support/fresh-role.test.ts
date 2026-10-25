import { describe, expect, it } from "vitest";
import { freshRoleName, leftoverRoleNames } from "./fresh-role.ts";

const hour = 60 * 60_000;
const now = Date.UTC(2026, 9, 25, 12);

// Supavisor caches each login's SCRAM secret by name: a role dropped and created again under
// the same name gets a new salt, and the next pooled login fails with 28P01 (RP-1037).
describe("freshRoleName", () => {
  it("names a new role on each call, under the prefix", () => {
    const first = freshRoleName("rabaed_test_gate_no_bypass", now);
    const second = freshRoleName("rabaed_test_gate_no_bypass", now);

    expect(first).toMatch(/^rabaed_test_gate_no_bypass_[0-9a-z]{6}_[0-9a-f]{8}$/);
    expect(second).not.toBe(first);
  });

  it("fits PostgreSQL's 63-character names with the longest prefix it takes", () => {
    expect(freshRoleName(`r${"x".repeat(46)}`, now)).toHaveLength(63);
  });

  it("refuses a prefix that is not a plain lowercase identifier, or too long to fit", () => {
    expect(() => freshRoleName("Rabaed; drop role x")).toThrow(/prefix/);
    expect(() => freshRoleName(`r${"x".repeat(47)}`)).toThrow(/prefix/);
  });
});

// Roles are cluster-wide, and two runs may share a server: only a role older than any run is left over.
describe("leftoverRoleNames", () => {
  const prefix = "rabaed_test_rds_master";

  it("takes the prefix's names from over six hours ago, and the old fixed name", () => {
    const old = freshRoleName(prefix, now - 7 * hour);

    expect(leftoverRoleNames([old, prefix], prefix, now)).toEqual([old, prefix]);
  });

  it("leaves a name another run may be using now, and every other role", () => {
    const names = [
      freshRoleName(prefix, now - 5 * hour),
      freshRoleName(prefix, now),
      freshRoleName("rabaed_test_gate_no_bypass", now - 7 * hour),
      `${prefix}_x_0123abcd`,
      "rabaed_app",
    ];

    expect(leftoverRoleNames(names, prefix, now)).toEqual([]);
  });
});
