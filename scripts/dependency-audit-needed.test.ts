import { describe, expect, it } from "vitest";
import { auditNeeded, decideAudit } from "./dependency-audit-needed.ts";

// RP-1032: the package audit is a required check, so its job runs on every pull request and
// merge-group entry, and audits only a change that can move what it audits.

describe("auditNeeded", () => {
  it("audits a change to the lockfile, any package.json or pnpm's workspace settings", () => {
    expect(auditNeeded(["pnpm-lock.yaml"])).toBe(true);
    expect(auditNeeded(["package.json"])).toBe(true);
    expect(auditNeeded(["apps/web/package.json"])).toBe(true);
    expect(auditNeeded(["pnpm-workspace.yaml"])).toBe(true);
  });

  it("audits a change to the allow-list, the audit's scripts or its workflow", () => {
    expect(auditNeeded([".audit-allowlist.json"])).toBe(true);
    expect(auditNeeded(["scripts/dependency-audit.ts"])).toBe(true);
    expect(auditNeeded(["scripts/dependency-audit-needed.ts"])).toBe(true);
    expect(auditNeeded([".github/workflows/dependency-audit.yml"])).toBe(true);
  });

  it("skips a change that touches none of them, even one beside a package.json", () => {
    expect(auditNeeded(["apps/web/src/app/page.tsx", "docs/visibility.md"])).toBe(false);
    expect(auditNeeded(["apps/web/package.json.bak", "scripts/dependency-audit.test.ts"])).toBe(false);
    expect(auditNeeded([])).toBe(false);
  });
});

describe("decideAudit", () => {
  it("audits with no base commit: the nightly run on main and a run by hand", () => {
    expect(decideAudit(undefined, () => [])).toEqual({ needed: true });
    expect(decideAudit("", () => [])).toEqual({ needed: true });
  });

  it("decides on the files changed since the base", () => {
    expect(decideAudit("main", (base) => (base === "main" ? ["pnpm-lock.yaml", "README.md"] : []))).toEqual({ needed: true, base: "main", files: 2 });
    expect(decideAudit("main", () => ["README.md"])).toEqual({ needed: false, base: "main", files: 1 });
  });
});
