// The customer api has no way to reach the role that bypasses row-level
// security (ADR 0010, RP-254): nothing the running api loads comes from
// Rabaed Admin (apps/admin), and none of the api's own code asks for the admin
// connection. Only the demo seed and the tests, which never run in the api
// service, use Rabaed Admin's services.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const api = join(root, "apps/api/src");

/** The file a workspace package name points at, e.g. @rabaed/db → packages/db/src/index.ts. */
function workspaceEntry(specifier: string): string | null {
  const [, name, subpath] = /^@rabaed\/([^/]+)(?:\/(.+))?$/.exec(specifier) ?? [];
  if (!name) return null;
  for (const dir of [join(root, "packages", name), join(root, "apps", name)]) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const exports = JSON.parse(readFileSync(manifest, "utf8")).exports ?? {};
    const target = exports[subpath ? `./${subpath}` : "."];
    return typeof target === "string" ? join(dir, target) : null;
  }
  return null;
}

const importPattern = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** Every source file `entry` loads, following relative and @rabaed/* imports; type-only imports too, to be safe. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2]!;
      const target = specifier.startsWith(".") ? resolve(dirname(file), specifier) : workspaceEntry(specifier);
      if (target && existsSync(target)) visit(target);
    }
  };
  visit(entry);
  return seen;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/** A source file without its comments, which may name what the code must not use. */
const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const rel = (file: string) => relative(root, file).replaceAll("\\", "/");

describe("the customer api and Rabaed Admin", () => {
  const loaded = [...reachable(join(api, "server.ts"))].map(rel);

  it("finds what the api server loads (the check itself works)", () => {
    expect(loaded).toContain("apps/api/src/app.ts");
    expect(loaded).toContain("packages/db/src/client.ts");
    expect(loaded).toContain("packages/auth/src/password.ts");
  });

  it("loads nothing from Rabaed Admin", () => {
    expect(loaded.filter((f) => f.startsWith("apps/admin/"))).toEqual([]);
  });

  it("never asks for the admin connection, its URL or its secret", () => {
    const admin = /createDbFromEnv\(\s*["']admin["']|adminUrlFromEnv|DATABASE_ADMIN|ADMIN_ROLE|rabaed_admin|\.admin\b/;
    expect(loaded.filter((f) => f.startsWith("apps/api/") && admin.test(code(join(root, f))))).toEqual([]);
  });

  it("uses Rabaed Admin's services only in the demo seed, never in what the api serves", () => {
    const users = sourceFiles(api)
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => /@rabaed\/admin/.test(code(f)))
      .map(rel);
    expect(users.sort()).toEqual(["apps/api/src/demo/seed.ts"]);
  });
});
