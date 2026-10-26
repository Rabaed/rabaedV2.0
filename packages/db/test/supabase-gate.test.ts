// Seam 2: the Supabase gate's database checks (RP-1037), against a real Postgres.
// Under the gate on Supabase these run through its session pooler too.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_ROLE, databaseNameOf, loginUrl } from "../src/config.ts";
import { checkBootstrapRole, checkBypassRole, checkSupabaseRolesHoldNothing, poolerProbe, SUPABASE_API_ROLES } from "../src/supabase-gate.ts";
import { dropLeftoverRoles, freshRoleName } from "../test-support/fresh-role.ts";
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

describe("checkBootstrapRole", () => {
  // A new name each run: Supavisor caches a login's SCRAM secret by name, so a role created
  // again under an old name fails the pooled login with 28P01 (fresh-role.ts, RP-1037).
  const prefix = "rabaed_test_gate_no_bypass";
  const plain = freshRoleName(prefix);
  beforeAll(async () => {
    await dropLeftoverRoles(urls.superuser, prefix);
    await query(urls.superuser, `create role ${plain} login createrole createdb password 'gate-test-pw'`);
  });
  afterAll(() => query(urls.superuser, `drop role if exists ${plain}`));

  it("passes for a role that may create a role with BYPASSRLS", async () => {
    await expect(checkBootstrapRole(urls.superuser)).resolves.toBeUndefined();
  });

  it("stops, naming the role and what it lacks, when it may not create the bypass role", async () => {
    await expect(checkBootstrapRole(loginUrl(urls.superuser, plain, "gate-test-pw"))).rejects.toThrow(
      `The bootstrap role ${plain} has neither SUPERUSER nor BYPASSRLS, so PostgreSQL refuses to create ${ADMIN_ROLE} with BYPASSRLS`,
    );
  });
});

describe("checkBypassRole", () => {
  it("passes when rabaed_admin bypasses row-level security", async () => {
    await expect(checkBypassRole(urls.superuser)).resolves.toBeUndefined();
  });
});

describe("checkSupabaseRolesHoldNothing", () => {
  // The check names Supabase's roles, so a fresh name can't stand in (fresh-role.ts): on Supabase
  // they exist; on a local Postgres this creates them, and drops only those it created.
  const database = databaseNameOf(urls.migrator);
  const absent = "rabaed_no_such_database_gate";
  const created: string[] = [];
  const check = () => checkSupabaseRolesHoldNothing(urls.superuser, [database, absent]);
  // Only this database's findings: a shared server has other Rabaed databases, which the check reads too.
  const heldHere = async () => {
    const result = await check();
    return result.outcome === "checked" ? result.privileges.filter((p) => p.database === database) : undefined;
  };
  beforeAll(async () => {
    const client = new pg.Client({ connectionString: urls.superuser });
    await client.connect();
    try {
      const { rows } = await client.query<{ name: string }>("select rolname as name from pg_roles where rolname = any($1::text[])", [SUPABASE_API_ROLES]);
      for (const role of SUPABASE_API_ROLES.filter((r) => !rows.some((row) => row.name === r))) {
        await client.query(`create role ${role} nologin`);
        created.push(role);
      }
    } finally {
      await client.end();
    }
  });
  afterAll(async () => {
    // The tests revoke what they grant; again here, so a failed one leaves no grant or role behind.
    await query(urls.migrator, "revoke all on company from anon, authenticated, public");
    await query(urls.migrator, "revoke all on function app.current_member_id() from public");
    for (const role of created) await query(urls.superuser, `drop role if exists ${role}`);
  });

  async function whileGranted(grant: string, revoke: string, fn: () => Promise<void>): Promise<void> {
    await query(urls.migrator, grant);
    try {
      await fn();
    } finally {
      await query(urls.migrator, revoke);
    }
  }

  it("passes when anon and authenticated hold nothing, and skips a database that doesn't exist, saying so", async () => {
    const result = await check();

    expect(result).toMatchObject({ outcome: "checked", roles: ["anon", "authenticated"], missing: [absent] });
    expect(result.outcome === "checked" && result.checked[0]).toBe(database);
    expect(await heldHere()).toEqual([]);
  });

  it("finds a privilege granted to anon, naming the role, privilege, object and database, and passes once it is revoked", async () => {
    await whileGranted("grant select on company to anon", "revoke select on company from anon", async () => {
      expect(await heldHere()).toEqual([{ database, role: "anon", privilege: "SELECT", kind: "table", object: "public.company" }]);
    });
    expect(await heldHere()).toEqual([]);
  });

  it("finds a grant on a single column", async () => {
    await whileGranted("grant select (id) on company to authenticated", "revoke select (id) on company from authenticated", async () => {
      expect(await heldHere()).toEqual([{ database, role: "authenticated", privilege: "SELECT", kind: "table", object: "public.company" }]);
    });
  });

  // anon and authenticated inherit whatever PUBLIC may do.
  it("finds a privilege both roles hold through PUBLIC", async () => {
    await whileGranted("grant execute on function app.current_member_id() to public", "revoke execute on function app.current_member_id() from public", async () => {
      expect(await heldHere()).toEqual([
        { database, role: "anon", privilege: "EXECUTE", kind: "function", object: "app.current_member_id()" },
        { database, role: "authenticated", privilege: "EXECUTE", kind: "function", object: "app.current_member_id()" },
      ]);
    });
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
