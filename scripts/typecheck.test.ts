import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workspacePackages } from "./typecheck.ts";

// `pnpm typecheck` runs scripts/typecheck.ts (RP-997): every workspace package's
// own typecheck, a failing package's compiler output on stderr and one last line
// naming the failing packages, even under `pnpm -s typecheck`.
const script = resolve(import.meta.dirname, "typecheck.ts");

// A workspace in a temp folder, and a stand-in for pnpm's entry file (what pnpm
// puts in npm_execpath). Like pnpm, the stand-in prints a `> name typecheck`
// header unless given -s, then runs the package's typecheck script.
let root: string;
let fakePnpm: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rabaed-typecheck-"));
  fakePnpm = join(root, "pnpm.cjs");
  writeFileSync(
    fakePnpm,
    [
      'const { readFileSync } = require("node:fs");',
      'const { spawnSync } = require("node:child_process");',
      'const { name, scripts } = JSON.parse(readFileSync("package.json", "utf8"));',
      // The package's typecheck process (scripts/pnpm.ts, this file's parent) killed by a signal.
      "if (process.env.FAKE_PNPM_KILL_PARENT) process.kill(process.ppid, process.env.FAKE_PNPM_KILL_PARENT);",
      'if (!process.argv.includes("-s")) console.log(`> ${name} typecheck`);',
      'const result = spawnSync(scripts.typecheck, { shell: true, stdio: "inherit" });',
      "process.exit(result.status ?? 1);",
    ].join("\n"),
  );
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A workspace package whose typecheck prints `output` and exits with `exit`. */
function pkg(dir: string, name: string, output: string, exit: number) {
  mkdirSync(join(root, dir), { recursive: true });
  const typecheck = `node -e "console.log(${JSON.stringify(output).replaceAll('"', '\\"')}); process.exit(${exit})"`;
  writeFileSync(join(root, dir, "package.json"), JSON.stringify({ name, scripts: { typecheck } }));
}

const run = (env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { SystemRoot: process.env.SystemRoot ?? "", PATH: process.env.PATH ?? "", npm_execpath: fakePnpm, ...env },
  });

describe("scripts/typecheck.ts", () => {
  it("prints a failing package's compiler errors and names it on the last line, exiting with its code", () => {
    pkg("apps/api", "@rabaed/api", "src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.", 2);
    pkg("packages/domain", "@rabaed/domain", "", 0);

    const result = run({ npm_config_reporter: "silent" });

    expect(result.stderr).toContain("src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.");
    expect(result.stderr.trimEnd().split("\n").at(-1)).toBe("typecheck failed in: @rabaed/api");
    expect(result.status).toBe(2);
  });

  it("checks every package past the first failure and names all the failing ones", () => {
    pkg("apps/web", "@rabaed/web", "src/page.tsx(4,2): error TS2304: Cannot find name 'x'.", 2);
    pkg("apps/api", "@rabaed/api", "src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.", 2);
    pkg("packages/domain", "@rabaed/domain", "", 0);
    mkdirSync(join(root, "packages/no-script"), { recursive: true });
    writeFileSync(join(root, "packages/no-script/package.json"), JSON.stringify({ name: "@rabaed/no-script" }));

    const result = run({ npm_config_reporter: "silent" });

    expect(result.stderr).toContain("src/page.tsx(4,2): error TS2304: Cannot find name 'x'.");
    expect(result.stderr).toContain("src/a.ts(1,14): error TS2322");
    expect(result.stderr.trimEnd().split("\n").at(-1)).toBe("typecheck failed in: @rabaed/api, @rabaed/web");
    expect(result.status).toBe(2);
  });

  // Windows has no signals: a process killed by another one just exits 1.
  it.skipIf(process.platform === "win32")("names the signal that killed a package's typecheck, and fails", () => {
    pkg("apps/api", "@rabaed/api", "", 0);

    const result = run({ npm_config_reporter: "silent", FAKE_PNPM_KILL_PARENT: "SIGTERM" });

    expect(result.stderr).toContain("@rabaed/api (apps/api) typecheck failed (killed by SIGTERM):");
    expect(result.stderr.trimEnd().split("\n").at(-1)).toBe("typecheck failed in: @rabaed/api");
    expect(result.status).toBe(1);
  });

  it("prints nothing and exits 0 under `pnpm -s` when every package passes", () => {
    pkg("apps/api", "@rabaed/api", "", 0);
    pkg("packages/domain", "@rabaed/domain", "", 0);

    const result = run({ npm_config_reporter: "silent" });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("says how many packages passed without `-s`", () => {
    pkg("apps/api", "@rabaed/api", "", 0);
    pkg("packages/domain", "@rabaed/domain", "", 0);

    const result = run();

    expect(result.stdout).toBe("typecheck passed in 2 packages.\n");
    expect(result.status).toBe(0);
  });
});

// The stand-in prints whatever it is told, so it can't show the claim the script
// rests on: under `pnpm -s` (npm_config_reporter=silent) a recursive run drops a
// package's output, but a single-package `pnpm -s run` passes it through. These
// run the real pnpm, the one that started the tests (npm_execpath), or else
// pnpm on PATH, as scripts/pnpm.ts picks it.
describe("scripts/typecheck.ts with the real pnpm", () => {
  const runUnderSilentPnpm = () =>
    spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", env: { ...process.env, npm_config_reporter: "silent" } });

  it("prints a failing package's compiler errors and the failing-packages line", { timeout: 60_000 }, () => {
    pkg("apps/api", "@rabaed/api", "src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.", 2);
    pkg("packages/domain", "@rabaed/domain", "", 0);

    const result = runUnderSilentPnpm();

    expect(result.stderr).toContain("src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.");
    expect(result.stderr.trimEnd().split("\n").at(-1)).toBe("typecheck failed in: @rabaed/api");
    expect(result.status).toBe(2);
  });

  it("prints nothing for a clean workspace", { timeout: 60_000 }, () => {
    pkg("apps/api", "@rabaed/api", "", 0);
    pkg("packages/domain", "@rabaed/domain", "", 0);

    const result = runUnderSilentPnpm();

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("workspacePackages", () => {
  it("lists the packages pnpm-workspace.yaml names, leaving out its `!pattern` entries as pnpm does", () => {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n  - '!packages/legacy'\n  - '!**/fixtures/**'\n");
    pkg("apps/api", "@rabaed/api", "", 0);
    pkg("packages/domain", "@rabaed/domain", "", 0);
    pkg("packages/legacy", "@rabaed/legacy", "", 0);
    pkg("packages/fixtures", "@rabaed/fixtures", "", 0);

    expect(workspacePackages(root).map(({ name, dir }) => [name, dir])).toEqual([
      ["@rabaed/api", "apps/api"],
      ["@rabaed/domain", "packages/domain"],
    ]);
  });

  it("fails naming a package.json that has no name", () => {
    pkg("apps/api", "@rabaed/api", "", 0);
    mkdirSync(join(root, "packages/nameless"), { recursive: true });
    writeFileSync(join(root, "packages/nameless/package.json"), JSON.stringify({ scripts: { typecheck: "tsc" } }));

    expect(() => workspacePackages(root)).toThrow("packages/nameless/package.json has no name");
  });
});
