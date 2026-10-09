import { describe, expect, it } from "vitest";
import { selectSteps, tail } from "./verify-steps.ts";

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
