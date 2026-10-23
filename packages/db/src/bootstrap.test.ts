import { describe, expect, it } from "vitest";
import { passwordOfRole } from "./bootstrap.ts";

const local = "postgres://postgres:su@localhost:5432/postgres";
const supabase = "postgres://postgres.abcdefghijklmnop:su@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

describe("passwordOfRole", () => {
  it("takes the password of a URL that logs in as the role", () => {
    expect(passwordOfRole("postgres://rabaed_app:p%40ss@localhost:5432/rabaed", "rabaed_app", local)).toBe("p@ss");
  });

  it("refuses a URL that logs in as another role", () => {
    expect(() => passwordOfRole("postgres://rabaed_admin:pw@localhost:5432/rabaed", "rabaed_app", local)).toThrow(
      "Expected the connection URL to use role rabaed_app, got rabaed_admin",
    );
  });

  // Supabase's pooler: logins are <role>.<project ref>, the role is <role>.
  it("behind a pooler whose superuser logs in as <name>.<tenant>, takes <role>.<tenant>", () => {
    expect(passwordOfRole("postgres://rabaed_app.abcdefghijklmnop:pw@aws-0-eu-central-1.pooler.supabase.com:5432/rabaed", "rabaed_app", supabase)).toBe("pw");
  });

  it("behind that pooler, refuses another tenant or the bare role", () => {
    expect(() => passwordOfRole("postgres://rabaed_app.zzzz:pw@aws-0-eu-central-1.pooler.supabase.com:5432/rabaed", "rabaed_app", supabase)).toThrow(
      /use role rabaed_app\.abcdefghijklmnop, got rabaed_app\.zzzz/,
    );
    expect(() => passwordOfRole("postgres://rabaed_app:pw@aws-0-eu-central-1.pooler.supabase.com:5432/rabaed", "rabaed_app", supabase)).toThrow(/got rabaed_app$/);
  });

  it("elsewhere, reads a dot in the superuser login as part of its name, not a pooler suffix", () => {
    expect(passwordOfRole("postgres://rabaed_app:pw@db.internal:5432/rabaed", "rabaed_app", "postgres://admin.ops:su@db.internal:5432/postgres")).toBe("pw");
  });

  it("on a plain server, refuses a tenant suffix: locally the check is as strict as before", () => {
    expect(() => passwordOfRole("postgres://rabaed_app.abcdefghijklmnop:pw@localhost:5432/rabaed", "rabaed_app", local)).toThrow(
      /got rabaed_app\.abcdefghijklmnop/,
    );
  });
});
