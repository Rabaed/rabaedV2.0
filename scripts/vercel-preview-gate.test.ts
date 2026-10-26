import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrationsNotOnMain, previewGate } from "./vercel-preview-gate.ts";

// ADR 0026, RP-1043: Vercel builds a pull request's preview itself, against UAT's
// database, which holds main's migrations. A branch with a migration main lacks
// gets no preview (the gate exits 0, Vercel's "skip"); production is built by
// the deploy workflow and always passes.

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" }).trim();

let root: string;
let origin: string;
let checkout: string;

function commit(repo: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "change");
}

/** A branch off main with `files`, cloned one commit deep as Vercel's build clones it. */
function branch(files: Record<string, string>) {
  git(origin, "switch", "-q", "-c", "feature", "main");
  commit(origin, files);
  git(origin, "switch", "-q", "main");
  git(root, "clone", "-q", "--depth=1", "--branch", "feature", pathToFileURL(origin).href, "checkout");
  checkout = join(root, "checkout");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rabaed-preview-gate-"));
  origin = join(root, "origin");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  commit(origin, { "packages/db/migrations/20270101000000_start.sql": "select 1;\n", "apps/web/page.tsx": "export {};\n" });
}, 30_000);

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("migrationsNotOnMain, from a one-commit-deep clone", () => {
  it("lists a migration the branch adds", () => {
    branch({ "packages/db/migrations/20270201000000_new.sql": "select 2;\n" });
    expect(migrationsNotOnMain(checkout, pathToFileURL(origin).href)).toEqual(["packages/db/migrations/20270201000000_new.sql"]);
  });

  it("lists a migration the branch changes", () => {
    branch({ "packages/db/migrations/20270101000000_start.sql": "select 3;\n" });
    expect(migrationsNotOnMain(checkout, pathToFileURL(origin).href)).toEqual(["packages/db/migrations/20270101000000_start.sql"]);
  });

  it("lists nothing for a branch that changes only code", () => {
    branch({ "apps/web/page.tsx": "export const x = 1;\n" });
    expect(migrationsNotOnMain(checkout, pathToFileURL(origin).href)).toEqual([]);
  });

  it("lists nothing for a branch behind main, whose migrations main has gained since", () => {
    branch({ "apps/web/page.tsx": "export const x = 1;\n" });
    commit(origin, { "packages/db/migrations/20270301000000_later.sql": "select 4;\n" });
    expect(migrationsNotOnMain(checkout, pathToFileURL(origin).href)).toEqual([]);
  });

  it("lists nothing once main has the branch's migration (merged elsewhere first)", () => {
    branch({ "packages/db/migrations/20270201000000_new.sql": "select 2;\n" });
    commit(origin, { "packages/db/migrations/20270201000000_new.sql": "select 2;\n" });
    expect(migrationsNotOnMain(checkout, pathToFileURL(origin).href)).toEqual([]);
  });

  it("throws when main cannot be fetched", () => {
    branch({ "apps/web/page.tsx": "export const x = 1;\n" });
    expect(() => migrationsNotOnMain(checkout, pathToFileURL(join(root, "nowhere")).href)).toThrow();
  });
});

describe("previewGate", () => {
  const preview = { VERCEL_ENV: "preview", VERCEL_GIT_REPO_OWNER: "Rabaed", VERCEL_GIT_REPO_SLUG: "rabaedV2.0" };

  // deploy-uat.yml deploys production prebuilt, which never runs this step; a production
  // build Vercel starts itself (its Git deploy turned back on, a dashboard redeploy) would
  // go live before the migrations, so it is skipped.
  it.each([["production"], [undefined]])("skips anything but a preview (VERCEL_ENV %s)", (vercelEnv) => {
    expect(previewGate({ ...preview, VERCEL_ENV: vercelEnv }, () => [])).toEqual({ build: false, reason: "not a preview: production is deployed only by deploy-uat.yml, after it migrates UAT" });
  });

  it("skips every preview of Rabaed Admin, which holds the bypass role", () => {
    expect(previewGate(preview, () => [], "admin")).toEqual({ build: false, reason: "no preview: Rabaed Admin holds the bypass role (ADR 0010), so only deploy-uat.yml deploys it" });
  });

  it("builds a preview whose branch adds no migration, asking main of the repository Vercel cloned", () => {
    const asked: string[] = [];
    expect(previewGate(preview, (remote) => (asked.push(remote), []))).toEqual({ build: true, reason: "no migration that main lacks" });
    expect(asked).toEqual(["https://github.com/Rabaed/rabaedV2.0.git"]);
  });

  it("skips a preview whose branch has a migration main lacks", () => {
    expect(previewGate(preview, () => ["packages/db/migrations/20270201000000_new.sql"])).toEqual({
      build: false,
      reason: "no preview: this branch has a migration main lacks (packages/db/migrations/20270201000000_new.sql), and previews run against UAT's database; it is seen on UAT after merge",
    });
  });

  it("exits 0 (skip) when the gate itself fails, rather than let Vercel build", () => {
    const script = join(dirname(import.meta.filename), "vercel-preview-gate.ts");
    const run = (cwd: string, env: NodeJS.ProcessEnv) => {
      try {
        execFileSync(process.execPath, [script], { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
        return 0;
      } catch (error) {
        return (error as { status: number }).status;
      }
    };
    // Not a Git checkout: git itself fails.
    expect(run(tmpdir(), preview)).toBe(0);
  });

  it("skips a preview when it cannot tell, rather than run against a schema it didn't migrate", () => {
    expect(previewGate({ VERCEL_ENV: "preview" }, () => [])).toEqual({ build: false, reason: "no preview: cannot tell whether this branch adds a migration (VERCEL_GIT_REPO_OWNER and VERCEL_GIT_REPO_SLUG unset)" });
    const failing = () => {
      throw new Error("fatal: unable to access");
    };
    expect(previewGate(preview, failing)).toEqual({ build: false, reason: "no preview: cannot tell whether this branch adds a migration (fatal: unable to access)" });
  });
});
