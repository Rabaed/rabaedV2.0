import { describe, expect, it } from "vitest";
import { assertLocalDatabases, assertResettableDatabases, REMOTE_TEST_SERVER_VARIABLE } from "./local-database.ts";

const local = "postgres://rabaed_migrator:pw@localhost:6032/rabaed";

describe("assertLocalDatabases", () => {
  it("accepts databases on this machine", () => {
    for (const url of [
      local,
      "postgres://u:p@127.0.0.1:5432/rabaed",
      "postgres://u:p@[::1]:5432/rabaed",
      "postgresql://u:p@LOCALHOST/rabaed",
    ]) {
      expect(() => assertLocalDatabases([url]), url).not.toThrow();
    }
  });

  it("refuses any other host, whichever URL names it", () => {
    for (const url of [
      "postgres://u:p@rabaed-dev.abc.eu-central-1.rds.amazonaws.com:5432/rabaed",
      "postgres://u:p@10.0.0.5/rabaed",
      "postgres://u:p@127.0.0.2/rabaed",
    ]) {
      expect(() => assertLocalDatabases([local, url]), url).toThrow(/not on this machine/);
    }
  });

  it("reads the host the way the Postgres client does, so a query string can't redirect it", () => {
    expect(() => assertLocalDatabases(["postgres://u:p@localhost:5432/rabaed?host=prod.example.com"])).toThrow(
      /prod\.example\.com is not on this machine/,
    );
    expect(() => assertLocalDatabases(["postgres://u:p@localhost:5432/rabaed?host=/var/run/postgresql"])).toThrow();
  });

  it("names no password in its refusal", () => {
    expect(() => assertLocalDatabases(["postgres://u:secret-pw@db.example.com/rabaed"])).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secret-pw") }),
    );
  });
});

// The Supabase gate (RP-1037) runs seam 2 on a remote server: it names that server
// (the pooler host and the project its logins name), and there only seam 2's test
// database and its scratch database beside it may be reset.
describe("assertResettableDatabases", () => {
  const pooler = "aws-0-eu-central-1.pooler.supabase.com";
  const on = (db: string, { host = pooler, project = "abcdefghijklmnop" } = {}) => [
    `postgres://postgres.${project}:pw@${host}:5432/postgres`,
    `postgres://rabaed_migrator.${project}:pw@${host}:5432/${db}`,
  ];
  const named = { [REMOTE_TEST_SERVER_VARIABLE]: `abcdefghijklmnop@${pooler}` };

  it("accepts seam 2's test database, and its scratch database, on the server the gate names", () => {
    expect(() => assertResettableDatabases(on("rabaed_gate_test"), "rabaed_gate_test", named)).not.toThrow();
    expect(() => assertResettableDatabases(on("rabaed_gate_test_reset"), "rabaed_gate_test_reset", named)).not.toThrow();
  });

  it("refuses any other database there", () => {
    for (const db of ["rabaed", "rabaed_test_archive", "uat_test_data"]) {
      expect(() => assertResettableDatabases(on(db), db, named), db).toThrow(/not on this machine/);
    }
  });

  it("refuses another project on the same shared pooler host", () => {
    expect(() => assertResettableDatabases(on("rabaed_gate_test", { project: "zzzzzzzzzzzzzzzz" }), "rabaed_gate_test", named)).toThrow(/not on this machine/);
  });

  it("refuses another remote host, and any remote host when none is named", () => {
    expect(() => assertResettableDatabases(on("rabaed_gate_test", { host: "db.example.com" }), "rabaed_gate_test", named)).toThrow(
      /db\.example\.com is not on this machine/,
    );
    expect(() => assertResettableDatabases(on("rabaed_gate_test"), "rabaed_gate_test", {})).toThrow(/not on this machine/);
  });

  it("still accepts local databases", () => {
    expect(() => assertResettableDatabases([local], "rabaed", {})).not.toThrow();
  });
});
