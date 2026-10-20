import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDoc } from "./reviewed-required.ts";

// Rule 3 (planning/parallel-sessions.md): root shared files travel in their own PR,
// with at most docs. One definition for `pnpm queue` (scripts/queue-pr.ts), which
// refuses such a PR, and for `pnpm verify` and the pre-push hook, which name it
// before the push (RP-993: RP-645's lockfile change inside a feature ticket showed
// only at queue time and needed PR #305 first).

/** Root shared files: exact paths, then path prefixes. */
const ROOT_SHARED = { files: ["package.json", "pnpm-lock.yaml"], prefixes: [".github/workflows/"] };
const isRootShared = (file: string) => ROOT_SHARED.files.includes(file) || ROOT_SHARED.prefixes.some((prefix) => file.startsWith(prefix));
const rootSharedList = [...ROOT_SHARED.files, ...ROOT_SHARED.prefixes.map((prefix) => `${prefix}*`)].join(", ");
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
  const dependencies = files.includes("pnpm-lock.yaml") || files.some(isWorkspacePackageJson);
  return [
    ...breach.root.map((file) => `  shared: ${file}`),
    `  and ${breach.others} other file(s), e.g. ${breach.example}`,
    ...(files.some(isWorkspacePackageJson)
      ? ["Note: a workspace package.json beside the lockfile is allowed when only its dependency fields (dependencies/devDependencies/peerDependencies/optionalDependencies) change."]
      : []),
    `Fix: a change to root ${rootSharedList} is its own PR (only those and docs).`,
    ...(dependencies
      ? [
          'For dependencies: put the lockfile and the workspace package.json dependency fields in a dependencies-only PR first, and build on it once it merges (docs/agents/issue-tracker.md › "Ticket: workspace dependencies").',
        ]
      : []),
  ];
}

/**
 * RP-993: `sharedFilesMix` for this branch, against where it left origin/main: at `commit` (the pre-push hook),
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
  const files = [...lines(must("diff", "--name-only", "--no-renames", base, ...(commit ? [commit] : []))), ...(commit ? [] : lines(must("ls-files", "--others", "--exclude-standard")))];
  const show = (ref: string, file: string) => {
    const done = git("show", `${ref}:${file}`);
    return done.status === 0 ? done.stdout : undefined;
  };
  const onDisk = (file: string) => (existsSync(join(repo, file)) ? readFileSync(join(repo, file), "utf8") : undefined);
  return sharedFilesMix(files, (file) => ({ before: show(base, file), after: commit ? show(commit, file) : onDisk(file) }));
}
