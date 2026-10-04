import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// scripts/pnpm.ts reruns the pnpm that started the current package.json script,
// so root scripts work where only `corepack pnpm` exists (agent shells, RP-298).
const shim = resolve(import.meta.dirname, "pnpm.ts");
const root = resolve(import.meta.dirname, "..");

// A stand-in for pnpm's own entry file (what pnpm puts in npm_execpath):
// it prints its arguments and exits with the code given in FAKE_PNPM_EXIT.
let dir: string;
let fakePnpm: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rabaed-pnpm-shim-"));
  fakePnpm = join(dir, "pnpm.cjs");
  writeFileSync(fakePnpm, "console.log(JSON.stringify(process.argv.slice(2)));\nprocess.exit(Number(process.env.FAKE_PNPM_EXIT ?? 0));\n");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

// PATH holds only node's own folder, so no `pnpm` command can be found on it.
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [shim, ...args], {
    encoding: "utf8",
    env: { SystemRoot: process.env.SystemRoot ?? "", PATH: resolve(process.execPath, ".."), npm_execpath: fakePnpm, ...env },
  });

describe("scripts/pnpm.ts", () => {
  it("runs the pnpm that started the script, with the same arguments, without pnpm on PATH", () => {
    const result = run(["--filter", "@rabaed/db", "run", "setup"]);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(["--filter", "@rabaed/db", "run", "setup"]);
    expect(result.status).toBe(0);
  });

  it("fails with pnpm's exit code", () => {
    const result = run(["-r", "run", "typecheck"], { FAKE_PNPM_EXIT: "2" });
    expect(result.status).toBe(2);
  });
});

describe("root package.json scripts", () => {
  it("never call `pnpm` directly, only through scripts/pnpm.ts", () => {
    const { scripts } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const direct = Object.entries(scripts)
      .filter(([, command]) => /(^|&&|\|\||;)\s*pnpm\s/.test(command))
      .map(([name]) => name);
    expect(direct).toEqual([]);
  });
});
