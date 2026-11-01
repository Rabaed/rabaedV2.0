/* eslint-disable rabaed/no-avoid-terms -- package.json dependency fields, git's changed files and GitHub's merge queue, by their own names */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDoc } from "./reviewed-required.ts";
import { fileAtVia } from "./verify-gate.ts";

// Rule 3 (planning/parallel-sessions.md): root shared files travel in their own PR,
// with at most docs. One definition for `pnpm queue` (scripts/queue-pr.ts), which
// refuses such a PR, and for `pnpm verify` and the pre-push hook, which name it
// before the push (RP-993: RP-645's lockfile change inside a feature ticket showed
// only at queue time and needed PR #305 first).

/** Root shared files: exact paths, then path prefixes. */
const ROOT_SHARED = { files: ["package.json", "pnpm-lock.yaml"], prefixes: [".github/workflows/"] };
const isRootShared = (file: string) => ROOT_SHARED.files.includes(file) || ROOT_SHARED.prefixes.some((prefix) => file.startsWith(prefix));
const rootSharedList = [...ROOT_SHARED.files, ...ROOT_SHARED.prefixes.map((prefix) => `${prefix}*`)].join(", ");
/** A workflow file: under `.github/workflows/` and not a doc, as check:claims counts one. */
const isWorkflow = (file: string) => file.startsWith(".github/workflows/") && !isDoc(file);
const isWorkspacePackageJson = (file: string) => file.endsWith("/package.json");

interface Breach {
  root: string[];
  others: number;
  example: string;
}

/** Root shared files changed together with files other than docs (and, given `isDependencyOnlyChange`, dependencies-only workspace package.json files). */
function rootSharedFilesBreach(files: string[], isDependencyOnlyChange: (file: string) => boolean = () => false): Breach | undefined {
  const root = files.filter(isRootShared);
  const others = files.filter((file) => !isRootShared(file) && !isDoc(file) && !isDependencyOnlyChange(file));
  const [example] = others;
  return root.length > 0 && example !== undefined ? { root, others: others.length, example } : undefined;
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** RP-573: true when two versions of a workspace package.json differ only in the dependency fields (both must exist and parse). */
function onlyDependencyFieldsChanged(before: string | undefined, after: string | undefined): boolean {
  if (before === undefined || after === undefined) return false;
  try {
    const strip = (text: string) => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, unknown>).filter(([key]) => !DEPENDENCY_FIELDS.includes(key))));
    return strip(before) === strip(after);
  } catch {
    return false;
  }
}

/** A workspace package.json's text where the change starts and where it ends; undefined where it does not exist. */
export type PackageJsonVersions = (file: string) => { before: string | undefined; after: string | undefined };

/**
 * The lines that name a rule-3 breach in `files` (changed against the merge base with origin/main), and say
 * what to do; undefined when there is none. A workspace package.json that changes only dependency fields
 * belongs to a dependencies-only PR beside the lockfile (RP-573). Callers add their heading and next step.
 */
export function sharedFilesMix(files: string[], versions: PackageJsonVersions): string[] | undefined {
  const breach = rootSharedFilesBreach(files, (file) => {
    if (!isWorkspacePackageJson(file)) return false;
    const { before, after } = versions(file);
    return onlyDependencyFieldsChanged(before, after);
  });
  if (!breach) return undefined;
  const workspacePackageJson = files.some(isWorkspacePackageJson);
  return [
    ...breach.root.map((file) => `  shared: ${file}`),
    `  and ${breach.others} other file(s), e.g. ${breach.example}`,
    ...(workspacePackageJson
      ? ["Note: a workspace package.json beside the lockfile is allowed when only its dependency fields (dependencies/devDependencies/peerDependencies/optionalDependencies) change."]
      : []),
    `Fix: a change to root ${rootSharedList} is its own PR (only those and docs).`,
    ...(workspacePackageJson || files.includes("pnpm-lock.yaml")
      ? [
          'For dependencies: open a dependencies-only PR first (the lockfile and the workspace package.json dependency fields), then build the feature PR on it (docs/agents/issue-tracker.md › "Ticket: workspace dependencies").',
        ]
      : []),
  ];
}

/**
 * RP-993: `sharedFilesMix` for this branch (workflow files apart, see below), against where it left origin/main: at `commit` (the pre-push hook),
 * or, without one, in the working tree with uncommitted and untracked files (`pnpm verify`). Throws when git fails.
 */
export function branchMix(repo: string, commit?: string): string[] | undefined {
  const git = (...args: string[]) => spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: repo, encoding: "utf8" });
  const must = (...args: string[]) => {
    const done = git(...args);
    if (done.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr.trim()}. Run \`git fetch origin main\` and try again.`);
    return done.stdout;
  };
  const lines = (text: string) => text.split("\n").filter(Boolean);
  const base = must("merge-base", "origin/main", commit ?? "HEAD").trim();
  // --no-renames lists a rename's old path too, as `pnpm queue` does (RP-606).
  // Workflow files are left out (RP-1199): a workflow mix is named once, with the two-PR split, by check:claims
  // (scripts/check-claims.ts, which the hook and verify print too), so this warning stays for package.json and the
  // lockfile. `pnpm queue` still refuses a workflow mix: it calls `sharedFilesMix` on every file.
  const files = [...lines(must("diff", "--name-only", "--no-renames", base, ...(commit ? [commit] : []))), ...(commit ? [] : lines(must("ls-files", "--others", "--exclude-standard")))].filter((file) => !isWorkflow(file));
  // Undefined only where the path is not there; any other git failure throws (RP-1196).
  const show = fileAtVia(repo, spawnSync);
  const onDisk = (file: string) => (existsSync(join(repo, file)) ? readFileSync(join(repo, file), "utf8") : undefined);
  return sharedFilesMix(files, (file) => ({ before: show(base, file), after: commit ? show(commit, file) : onDisk(file) }));
}
