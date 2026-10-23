// Seam 2: the Supabase gate's database checks (RP-1037), against a real Postgres.
// Under the gate on Supabase these run through its session pooler too.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_ROLE, loginFor } from "../src/config.ts";
import { checkBootstrapRole, checkBypassRole, poolerProbe } from "../src/supabase-gate.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();

async function query(url: string, text: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(text);
  } finally {
    await client.end();
  }
}

/** The URL logging in as `role`, through Supabase's pooler as `<role>.<project ref>`. */
function asUser(url: string, role: string, password: string): string {
  const u = new URL(url);
  u.username = loginFor(role, url);
  u.password = password;
  return u.toString();
}

describe("checkBootstrapRole", () => {
  const plain = "rabaed_test_gate_no_bypass";
  beforeAll(() => query(urls.superuser, `drop role if exists ${plain}; create role ${plain} login createrole createdb password 'gate-test-pw'`));
  afterAll(() => query(urls.superuser, `drop role if exists ${plain}`));

  it("passes for a role that may create a role with BYPASSRLS", async () => {
    await expect(checkBootstrapRole(urls.superuser)).resolves.toBeUndefined();
  });

  it("stops, naming the role and what it lacks, when it may not create the bypass role", async () => {
    await expect(checkBootstrapRole(asUser(urls.superuser, plain, "gate-test-pw"))).rejects.toThrow(
      `The bootstrap role ${plain} has neither SUPERUSER nor BYPASSRLS, so PostgreSQL refuses to create ${ADMIN_ROLE} with BYPASSRLS`,
    );
  });
});

describe("checkBypassRole", () => {
  it("passes when rabaed_admin bypasses row-level security", async () => {
    await expect(checkBypassRole(urls.superuser)).resolves.toBeUndefined();
  });
});

describe("poolerProbe", () => {
  // What the api does per request (withMember), and Rabaed Admin's switch to the app role (RP-960),
  // each in one transaction: what a transaction-mode pooler must carry.
  it("sets the Member per transaction with a parameterised query, and the setting ends with the transaction", async () => {
    await expect(poolerProbe({ app: urls.app, admin: urls.admin })).resolves.toEqual({
      memberSeen: true,
      memberAfterCommit: null,
      adminSwitchedTo: "rabaed_app",
    });
  });
});
