import { describe, expect, it } from "vitest";
import { adminUrlFromEnv, appUrlFromEnv, connectionFromEnv, databaseUrlsFromEnv } from "./config.ts";

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
