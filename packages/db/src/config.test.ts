import { describe, expect, it } from "vitest";
import { adminUrlFromEnv, appUrlFromEnv, connectionFromEnv, databaseUrlsFromEnv, loginUrl, poolMaxFromEnv, rolePasswordsFromEnv } from "./config.ts";

describe("loginUrl", () => {
  it("behind Supabase's pooler, logs in as <role>.<project ref>, as the URL's own login does", () => {
    expect(loginUrl("postgres://postgres.abcdefghijklmnop:su@aws-0-eu-central-1.pooler.supabase.com:5432/postgres", "rabaed_test_rds_master", "m@ster")).toBe(
      "postgres://rabaed_test_rds_master.abcdefghijklmnop:m%40ster@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    );
  });

  it("on a plain server, logs in as the role itself", () => {
    expect(loginUrl("postgres://postgres:su@localhost:5432/postgres", "rabaed_test_rds_master", "m@ster")).toBe(
      "postgres://rabaed_test_rds_master:m%40ster@localhost:5432/postgres",
    );
  });
});

// In AWS each password is its own secret, injected as its own variable, and
// the host comes from the database instance; locally .env holds whole URLs.
const parts = {
  DATABASE_HOST: "db.example.internal",
  DATABASE_PORT: "5432",
  DATABASE_NAME: "rabaed",
  DATABASE_SUPERUSER_USERNAME: "rabaed_master",
  DATABASE_SUPERUSER_PASSWORD: "p@ss:w/rd#1",
  DATABASE_MIGRATOR_PASSWORD: "migrator-pw",
  DATABASE_APP_PASSWORD: "app-pw",
  DATABASE_ADMIN_PASSWORD: "admin-pw",
};

describe("database URLs from their parts", () => {
  it("builds each role's URL; the superuser connects to the postgres database", () => {
    expect(databaseUrlsFromEnv(parts)).toEqual({
      superuser: "postgres://rabaed_master:p%40ss%3Aw%2Frd%231@db.example.internal:5432/postgres",
      migrator: "postgres://rabaed_migrator:migrator-pw@db.example.internal:5432/rabaed",
      app: "postgres://rabaed_app:app-pw@db.example.internal:5432/rabaed",
      admin: "postgres://rabaed_admin:admin-pw@db.example.internal:5432/rabaed",
    });
  });

  it("escapes passwords so the URL parses back to them", () => {
    const url = new URL(databaseUrlsFromEnv(parts).superuser);
    expect(decodeURIComponent(url.password)).toBe("p@ss:w/rd#1");
  });

  it("verifies the server's certificate when given a CA bundle", () => {
    const withCa = { ...parts, DATABASE_SSL_ROOT_CERT: "/etc/ssl/rds/global-bundle.pem" };
    expect(appUrlFromEnv(withCa)).toBe(
      "postgres://rabaed_app:app-pw@db.example.internal:5432/rabaed?sslmode=verify-full&sslrootcert=%2Fetc%2Fssl%2Frds%2Fglobal-bundle.pem",
    );
  });

  it("needs only the parts of the roles a process uses", () => {
    const { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_APP_PASSWORD } = parts;
    expect(appUrlFromEnv({ DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_APP_PASSWORD })).toBe(
      "postgres://rabaed_app:app-pw@db.example.internal:5432/rabaed",
    );
    expect(() => adminUrlFromEnv({ DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_APP_PASSWORD })).toThrow();
  });
});

describe("a long-running process's connection", () => {
  const server = { DATABASE_HOST: "db.example.internal", DATABASE_PORT: "5432", DATABASE_NAME: "rabaed" };

  it("reads its password from a secret when given one, so a rotated password reaches it", () => {
    expect(connectionFromEnv("app", { ...server, DATABASE_APP_SECRET_ARN: "arn:aws:secretsmanager:eu-central-1:1:secret:app" })).toEqual({
      url: "postgres://rabaed_app@db.example.internal:5432/rabaed",
      passwordSecret: "arn:aws:secretsmanager:eu-central-1:1:secret:app",
    });
    expect(connectionFromEnv("admin", { ...server, DATABASE_ADMIN_SECRET_ARN: "admin-secret" })).toEqual({
      url: "postgres://rabaed_admin@db.example.internal:5432/rabaed",
      passwordSecret: "admin-secret",
    });
  });

  it("otherwise uses the URL as before", () => {
    const url = "postgres://rabaed_app:local@localhost:5432/rabaed";
    expect(connectionFromEnv("app", { DATABASE_APP_URL: url })).toEqual({ url });
  });
});

describe("database URLs given whole", () => {
  it("are used as they are, and win over parts", () => {
    const url = "postgres://rabaed_app:local@localhost:5432/rabaed";
    expect(appUrlFromEnv({ ...parts, DATABASE_APP_URL: url })).toBe(url);
  });
});

// The AWS migration task and the Supabase gate's seam 2 run set DATABASE_ROLE_PASSWORDS=on-create:
// there something else owns the passwords (rotation; the Supabase pooler's cached secrets).
describe("rolePasswordsFromEnv", () => {
  it("is always by default, so changing .env takes effect locally", () => {
    expect(rolePasswordsFromEnv({})).toBe("always");
  });

  it("is on-create when the environment says so", () => {
    expect(rolePasswordsFromEnv({ DATABASE_ROLE_PASSWORDS: "on-create" })).toBe("on-create");
  });

  it("reads an empty value (an unset CI variable, a bare .env key) as unset", () => {
    expect(rolePasswordsFromEnv({ DATABASE_ROLE_PASSWORDS: "" })).toBe("always");
  });

  it("refuses any other value", () => {
    expect(() => rolePasswordsFromEnv({ DATABASE_ROLE_PASSWORDS: "never" })).toThrow();
  });
});

describe("poolMaxFromEnv", () => {
  it("is the process's own size when DATABASE_POOL_MAX is not set", () => {
    expect(poolMaxFromEnv({}, 4)).toBe(4);
    expect(poolMaxFromEnv({}, undefined)).toBeUndefined();
  });

  it("takes DATABASE_POOL_MAX over it: a Vercel instance keeps a few connections on the transaction pooler", () => {
    expect(poolMaxFromEnv({ DATABASE_POOL_MAX: "2" }, 4)).toBe(2);
    expect(poolMaxFromEnv({ DATABASE_POOL_MAX: "3" }, undefined)).toBe(3);
  });

  it("refuses a size that is not a whole number of one or more", () => {
    for (const value of ["0", "-1", "1.5", "two", ""]) expect(() => poolMaxFromEnv({ DATABASE_POOL_MAX: value }, 4)).toThrow();
  });
});
