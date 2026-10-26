import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `pnpm --filter <package> <word>` runs pnpm's own command when <word> is one, even
// when the package has a script of that name: `pnpm --filter @rabaed/db setup` ran
// pnpm's `setup`, which refused the --recursive that --filter implies, and Deploy UAT
// failed (run 40388707146, RP-1043). A package's script goes through `run`.

// pnpm's own commands (pnpm 10), which a script of the same name can't be reached past.
// Not `test`, `t` or `start`: those built-ins run the package's script of that name.
const PNPM_COMMANDS = new Set(
  [
    "add install i install-test it update up upgrade remove rm uninstall un link ln unlink import rebuild rb prune fetch patch patch-commit patch-remove",
    "setup self-update dedupe approve-builds ignored-builds publish pack run exec dlx create init env store server root bin list ls why outdated",
    "audit licenses deploy config c get set doctor cache cat-file cat-index find-hash",
  ]
    .join(" ")
    .split(" "),
);

interface ShadowedCall {
  pkg: string;
  word: string;
}

/**
 * Each `pnpm --filter <pkg> <word>` (also `node scripts/pnpm.ts --filter …`, with flags
 * between, or a spawn array) in `text` whose word is both a pnpm command and one of the
 * package's scripts.
 */
function shadowedScriptCalls(text: string, scripts: Record<string, string[]>): ShadowedCall[] {
  const calls = [
    ...text.matchAll(/pnpm(?:\.ts)?\s+(?:--filter|-F)[\s=]+["']?([^\s"'`]+)["']?(?:\s+--?[\w-]+(?:=\S+)?)*(?:\s|\\)+([^\s"'`\\]+)/g),
    ...text.matchAll(/["'](?:--filter|-F)["'],\s*["']([^"']+)["'],\s*["']([^"']+)["']/g),
  ];
  return calls
    .map(([, pkg, word]) => ({ pkg: pkg ?? "", word: word ?? "" }))
    .filter(({ pkg, word }) => PNPM_COMMANDS.has(word) && (scripts[pkg] ?? []).includes(word));
}

const root = resolve(import.meta.dirname, "..");

function workspaceScripts(): Record<string, string[]> {
  const scripts: Record<string, string[]> = {};
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let manifest: { name?: string; scripts?: Record<string, string> };
      try {
        manifest = JSON.parse(readFileSync(join(root, group, entry.name, "package.json"), "utf8"));
      } catch {
        continue;
      }
      if (manifest.name) scripts[manifest.name] = Object.keys(manifest.scripts ?? {});
    }
  }
  return scripts;
}

/** The tracked workflows, package.json files and code (not tests) that may call pnpm. */
function scannedFiles(): string[] {
  const tracked = execFileSync("git", ["ls-files", "--", ".github/workflows", ".githooks", "package.json", "Dockerfile", "scripts", "apps", "packages"], { cwd: root, encoding: "utf8" });
  return tracked
    .split("\n")
    .filter((path) => !/\.test\.tsx?$/.test(path) && (/\.(ya?ml|ts|tsx|mjs|cjs|js|sh)$/.test(path) || /(^|\/)(package\.json|Dockerfile)$/.test(path) || path.startsWith(".githooks/")))
    // A tracked file deleted but not yet committed is not there to read.
    .filter((path) => existsSync(join(root, path)));
}

describe("pnpm calls of a package's script", () => {
  const scripts = { "@rabaed/db": ["setup", "reset", "gate:supabase"], "@rabaed/api": ["start", "fonts:fetch"] };

  it("finds a script shadowed by pnpm's own command, in a shell line or a spawn array", () => {
    const setup = [{ pkg: "@rabaed/db", word: "setup" }];
    expect(shadowedScriptCalls("run: pnpm --filter @rabaed/db setup", scripts)).toEqual(setup);
    expect(shadowedScriptCalls(`run("pnpm", ["--filter", "@rabaed/db", "setup"], env)`, scripts)).toEqual(setup);
    expect(shadowedScriptCalls(`"db:setup": "node scripts/pnpm.ts --filter @rabaed/db setup"`, scripts)).toEqual(setup);
    expect(shadowedScriptCalls("pnpm -F=@rabaed/db --silent setup", scripts)).toEqual(setup);
    expect(shadowedScriptCalls(`pnpm --filter "@rabaed/db" setup`, scripts)).toEqual(setup);
    expect(shadowedScriptCalls("pnpm --filter @rabaed/db \\\n  setup", scripts)).toEqual(setup);
  });

  it("accepts `run`, `exec`, a script no pnpm command shadows, and a pnpm command the package has no script for", () => {
    const text = [
      "pnpm --filter @rabaed/db run setup",
      `["--filter", "@rabaed/db", "run", "setup"]`,
      "pnpm --filter @rabaed/db exec tsx src/check-app-role.ts",
      "pnpm --filter @rabaed/db gate:supabase",
      "pnpm --filter @rabaed/db install",
      // pnpm's `start` runs the package's start script.
      "pnpm --filter @rabaed/api start",
    ].join("\n");
    expect(shadowedScriptCalls(text, scripts)).toEqual([]);
  });

  it("no workflow, hook, Dockerfile, package.json or script calls a package's script that a pnpm command shadows", () => {
    const all = workspaceScripts();
    expect(all["@rabaed/db"]).toContain("setup");
    const found = scannedFiles().flatMap((file) => shadowedScriptCalls(readFileSync(join(root, file), "utf8"), all).map(({ pkg, word }) => `${file}: pnpm --filter ${pkg} ${word} (use \`run ${word}\`)`));
    expect(found).toEqual([]);
  });
});
