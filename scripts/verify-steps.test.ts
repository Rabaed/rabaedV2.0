import { describe, expect, it } from "vitest";
import { finalLine, postgresDown, postgresOfEnv, selectSteps, tail } from "./verify-steps.ts";

const names = (changed: string[]) => selectSteps(changed).steps.map((step) => step.name);

describe("selectSteps", () => {
  it("runs the always-on steps in order, and skips migrations and stories when neither changed", () => {
    expect(names(["scripts/verify.ts"])).toEqual(["lint", "typecheck", "test:unit", "test:seam1", "test:seam2"]);
  });

  it("includes check:migrations first when a migration changed", () => {
    expect(names(["packages/db/migrations/20261009000000_x.sql"])[0]).toBe("check:migrations");
  });

  it("includes test:stories last when packages/ui or apps/web changed", () => {
    expect(names(["packages/ui/src/board.tsx"]).at(-1)).toBe("test:stories");
    expect(names(["apps/web/src/page.tsx"]).at(-1)).toBe("test:stories");
  });

  it("does not treat a lookalike folder as UI", () => {
    expect(names(["packages/ui-kit/a.ts", "apps/webhooks/a.ts"])).not.toContain("test:stories");
  });

  it("gives every step the pnpm script of its name", () => {
    expect(selectSteps([]).steps.every((step) => step.script === step.name)).toBe(true);
  });

  it("says why a step is skipped", () => {
    const skipped = selectSteps([]).skipped;
    expect(skipped.map((s) => s.name)).toEqual(["check:migrations", "test:stories"]);
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
  });
});

describe("tail", () => {
  it("keeps the last lines only", () => {
    expect(tail("a\nb\nc\nd\n", 2)).toBe("c\nd");
    expect(tail("a\nb", 5)).toBe("a\nb");
  });
});

describe("postgresOfEnv", () => {
  const lane5 = "COMPOSE_PROJECT_NAME=rabaed-lane5\nPOSTGRES_PORT=5932\nDATABASE_SUPERUSER_URL=postgres://postgres:pw@localhost:5932/postgres\n";

  it("reads the lane and the superuser URL's host and port", () => {
    expect(postgresOfEnv(lane5)).toEqual({ lane: 5, host: "localhost", port: 5932 });
  });

  it("falls back to POSTGRES_PORT on localhost without a superuser URL", () => {
    expect(postgresOfEnv("COMPOSE_PROJECT_NAME=rabaed-lane3\nPOSTGRES_PORT=5732\n")).toEqual({ lane: 3, host: "localhost", port: 5732 });
  });

  it("has no lane for a project that is not a lane's", () => {
    expect(postgresOfEnv("COMPOSE_PROJECT_NAME=rabaed\nPOSTGRES_PORT=5432\n")).toEqual({ lane: undefined, host: "localhost", port: 5432 });
  });

  it("finds nothing to check in an .env without either", () => {
    expect(postgresOfEnv("PORT=3000\n")).toBeUndefined();
  });
});

describe("postgresDown", () => {
  it("names the lane, the port and the command to start it", () => {
    expect(postgresDown({ lane: 5, port: 5932 })).toBe("Postgres for lane 5 (port 5932) is down: `docker compose up -d --wait db mailpit files`");
  });

  it("names this worktree when it has no lane", () => {
    expect(postgresDown({ lane: undefined, port: 5432 })).toBe("Postgres for this worktree (port 5432) is down: `docker compose up -d --wait db mailpit files`");
  });
});

describe("finalLine", () => {
  const steps = ["lint", "typecheck"];

  it("names the verified commit and the steps that passed", () => {
    expect(finalLine({ sha: "abc1234", dirty: false, steps })).toBe("pnpm verify passed on abc1234: lint, typecheck.");
  });

  it("does not print an empty commit when git could not name it", () => {
    expect(finalLine({ sha: "", dirty: false, steps })).toBe("pnpm verify passed on unknown commit: lint, typecheck.");
  });

  it("says dirty when the tree has uncommitted changes", () => {
    expect(finalLine({ sha: "abc1234", dirty: true, steps })).toBe("pnpm verify passed on abc1234 (dirty: uncommitted changes): lint, typecheck.");
  });
});
