import { describe, expect, it } from "vitest";
import { assertLocalDatabases } from "./local-database.ts";

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
