import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openLog, verifyOutput } from "./verify-output.ts";

function recorded(withLog: boolean) {
  const seen = { stdout: [] as string[], stderr: [] as string[], log: [] as string[] };
  const out = verifyOutput({ stdout: (text) => seen.stdout.push(text), stderr: (text) => seen.stderr.push(text), ...(withLog ? { log: (text: string) => seen.log.push(text) } : {}) });
  return { out, seen };
}

describe("verifyOutput without --log", () => {
  it("prints progress to stdout and problems to stderr, as before, and keeps a step's output to itself", () => {
    const { out, seen } = recorded(false);
    out.info("run  lint ...");
    out.error("FAIL lint");
    out.stepOutput("lint", "the whole lint output");
    expect(seen).toEqual({ stdout: ["run  lint ..."], stderr: ["FAIL lint"], log: [] });
  });

  it("ends a passing run on stdout and a failing one on stderr, each line after a blank line", () => {
    const passed = recorded(false);
    passed.out.end(["pnpm verify passed on abc1234: lint."], false);
    expect(passed.seen.stdout).toEqual(["\npnpm verify passed on abc1234: lint."]);
    const failed = recorded(false);
    failed.out.end(["a load note", "pnpm verify stopped at test:seam1."], true);
    expect(failed.seen.stderr).toEqual(["\na load note", "\npnpm verify stopped at test:seam1."]);
  });
});

describe("verifyOutput with --log", () => {
  it("writes every line, and each step's whole output, to the log, and nothing to the terminal before the end", () => {
    const { out, seen } = recorded(true);
    out.info("run  lint ...");
    out.error("FAIL lint");
    out.stepOutput("lint", "the whole lint output");
    expect(seen.stdout).toEqual([]);
    expect(seen.stderr).toEqual([]);
    expect(seen.log).toEqual(["run  lint ...", "FAIL lint", "--- what lint printed ---\nthe whole lint output"]);
  });

  it("prints only the final line to stdout, passing or failing, and logs the whole end", () => {
    const failed = recorded(true);
    failed.out.end(["a load note", "pnpm verify stopped at test:seam1."], true);
    expect(failed.seen.stdout).toEqual(["pnpm verify stopped at test:seam1."]);
    expect(failed.seen.stderr).toEqual([]);
    expect(failed.seen.log).toEqual(["\na load note", "\npnpm verify stopped at test:seam1."]);
    const passed = recorded(true);
    passed.out.end(["pnpm verify passed on abc1234: lint."], false);
    expect(passed.seen.stdout).toEqual(["pnpm verify passed on abc1234: lint."]);
  });
});

describe("openLog", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("starts the file afresh, in a folder it creates, and appends each text as a line", () => {
    dir = mkdtempSync(join(tmpdir(), "verify-log-"));
    const file = join(dir, "logs", "verify.log");
    const first = openLog(file);
    first("from an earlier run");
    const log = openLog(file);
    log("run  lint ...");
    log("ok   lint");
    expect(readFileSync(file, "utf8")).toBe("run  lint ...\nok   lint\n");
  });

  it("throws, naming the file, when it cannot be written", () => {
    dir = mkdtempSync(join(tmpdir(), "verify-log-"));
    const notAFolder = join(dir, "file");
    writeFileSync(notAFolder, "");
    expect(() => openLog(join(notAFolder, "verify.log"))).toThrow(/verify\.log/);
  });
});
