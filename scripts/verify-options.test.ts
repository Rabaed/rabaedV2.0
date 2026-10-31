import { describe, expect, it } from "vitest";
import { verifyOptions } from "./verify-options.ts";
import { selectSteps, stepNames } from "./verify-steps.ts";

const valid = "Valid steps: check:migrations, lint, typecheck, test:unit, test:seam1, test:seam2, test:stories.";

describe("verifyOptions", () => {
  it("runs everything, to the terminal, with no flags", () => {
    expect(verifyOptions([])).toEqual({ ok: true });
  });

  it("takes --from a step by its pnpm script name, or without its test:/check: prefix", () => {
    expect(verifyOptions(["--from", "test:seam1"])).toEqual({ ok: true, from: "test:seam1" });
    expect(verifyOptions(["--from", "seam1"])).toEqual({ ok: true, from: "test:seam1" });
    expect(verifyOptions(["--from=migrations"])).toEqual({ ok: true, from: "check:migrations" });
    expect(verifyOptions(["--from", "lint"])).toEqual({ ok: true, from: "lint" });
  });

  it("refuses an unknown step, listing the valid ones", () => {
    expect(verifyOptions(["--from", "seam3"])).toEqual({ ok: false, message: `pnpm verify --from: no step "seam3". ${valid}` });
  });

  it("takes --log and a file, beside --from", () => {
    expect(verifyOptions(["--log", "verify.log", "--from", "unit"])).toEqual({ ok: true, log: "verify.log", from: "test:unit" });
  });

  it("refuses a flag it does not know, or one with no value, saying how to call it", () => {
    for (const argv of [["--bogus"], ["--from"], ["--log"], ["seam1"]]) {
      const options = verifyOptions(argv);
      expect(options.ok).toBe(false);
      expect(!options.ok && options.message).toContain("Usage: pnpm verify [--from <step>] [--log <file>] [--pr <n>]");
    }
  });

  it("takes --pr and a PR number (RP-1171), beside the other flags", () => {
    expect(verifyOptions(["--pr", "521"])).toEqual({ ok: true, pr: 521 });
    expect(verifyOptions(["--pr=7", "--log", "v.log"])).toEqual({ ok: true, pr: 7, log: "v.log" });
  });

  it("refuses --pr with no PR number, and --pr beside --from, which never prints a stamped line", () => {
    for (const bad of ["x", "0", "1.5"]) {
      const options = verifyOptions(["--pr", bad]);
      expect(options.ok).toBe(false);
      expect(!options.ok && options.message).toContain(`--pr needs a PR number, not "${bad}"`);
    }
    const resumed = verifyOptions(["--pr", "5", "--from", "seam1"]);
    expect(resumed.ok).toBe(false);
    expect(!resumed.ok && resumed.message).toContain("--pr cannot go with --from");
  });

  it("ignores the `--` that some pnpm versions pass before a script's arguments", () => {
    expect(verifyOptions(["--", "--from", "seam2"])).toEqual({ ok: true, from: "test:seam2" });
  });
});

describe("stepNames", () => {
  it("lists every step pnpm verify can run, in run order", () => {
    const all = selectSteps(["packages/db/migrations/20261009000000_x.sql", "packages/ui/src/board.tsx"]).steps.map((step) => step.name);
    expect(stepNames).toEqual(all);
  });
});
