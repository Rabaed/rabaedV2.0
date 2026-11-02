/* eslint-disable rabaed/no-avoid-terms -- package.json dependency fields, git's changed files and GitHub's merge queue, by their own names */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const isSymlink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};
import { isDoc } from "./reviewed-required.ts";
import { fileAtVia } from "./git-files.ts";

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

/** An added root script: exactly `node scripts/<file>.ts`, nothing after it, no subfolder, not a test or fixture. */
const NEW_SCRIPT_COMMAND = /^node scripts\/([\w-]+(?:\.[\w-]+)*\.ts)$/;
const isTestOrFixture = (file: string) => /\.(?:test|fixtures)\.ts$/.test(file);
/** Lifecycle names that run on install, publish or version, not when asked (the `pre…`/`post…` ones are caught below). */
const LIFECYCLE_NAMES = ["install", "uninstall", "publish", "version", "dependencies", "shrinkwrap"];
/**
 * A name that runs without being asked: a lifecycle name, pnpm's own hooks (`pnpm:devPreinstall` runs on every install),
 * or any `pre…`/`post…` name (a later `<x>` would make it run around `<x>`). Those go in their own PR. This also
 * catches plain names like `preview`, which fails closed.
 */
const isHookName = (name: string) => LIFECYCLE_NAMES.includes(name) || name.startsWith("pnpm:") || name.startsWith("pre") || name.startsWith("post");

/**
 * RP-1195 item 7: true when root package.json only adds `scripts` entries `node scripts/<file>` whose file this change
 * adds (`isAdded`); every other field and every existing entry unchanged. Both versions must exist and parse (fails closed).
 */
function onlyNewScriptEntries(before: string | undefined, after: string | undefined, isAdded: (file: string) => boolean): boolean {
  if (before === undefined || after === undefined) return false;
  try {
    const parse = (text: string) => {
      const json: unknown = JSON.parse(text);
      if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("not an object");
      const { scripts = {}, ...rest } = json as Record<string, unknown>;
      if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) throw new Error("scripts not an object");
      return { scripts: scripts as Record<string, unknown>, rest: JSON.stringify(rest) };
    };
    const [old, next] = [parse(before), parse(after)];
    if (old.rest !== next.rest) return false;
    if (Object.entries(old.scripts).some(([name, command]) => !Object.hasOwn(next.scripts, name) || next.scripts[name] !== command)) return false;
    const added = Object.entries(next.scripts).filter(([name]) => !Object.hasOwn(old.scripts, name));
    return (
      added.length > 0 &&
      added.every(([name, command]) => {
        if (isHookName(name)) return false;
        const file = typeof command === "string" ? NEW_SCRIPT_COMMAND.exec(command)?.[1] : undefined;
        return file !== undefined && !isTestOrFixture(file) && isAdded(`scripts/${file}`);
      })
    );
  } catch {
    return false;
  }
}

/**
 * A changed file's text where the change starts and where it ends; undefined where it does not exist. Named for the
 * package.json files it was first read for; item 7 also reads an added script through it.
 */
export type PackageJsonVersions = (file: string) => { before: string | undefined; after: string | undefined };

/**
 * The lines that name a rule-3 breach in `files` (changed against the merge base with origin/main), and say
 * what to do; undefined when there is none. Two changes are not breaches: a workspace package.json that changes only
 * dependency fields belongs to a dependencies-only PR beside the lockfile (RP-573), and a root package.json that only
 * adds `node scripts/<file>.ts` entries for scripts this change adds rides with them (RP-1195 item 7). Callers add
 * their heading and next step.
 */
export function sharedFilesMix(files: string[], versions: PackageJsonVersions): string[] | undefined {
  // An added script: absent where the change starts, present where it ends. A file renamed into scripts/ counts, since
  // the lists are --no-renames. Its text must hold a newline: a git symlink's blob is its one-line target, which `node`
  // would follow to code the change didn't add (the seams read blobs, not modes; a real script spans lines).
  const isAdded = (file: string) => {
    if (!files.includes(file)) return false;
    const { before, after } = versions(file);
    return before === undefined && after !== undefined && after.includes("\n");
  };
  const rootPackageJson = files.includes("package.json") ? versions("package.json") : undefined;
  const exempt = rootPackageJson !== undefined && onlyNewScriptEntries(rootPackageJson.before, rootPackageJson.after, isAdded);
  const breach = rootSharedFilesBreach(exempt ? files.filter((file) => file !== "package.json") : files, (file) => {
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
    `Fix: a change to root ${rootSharedList} is its own PR (only those and docs), unless root package.json only adds \`node scripts/<file>.ts\` entries for scripts this PR adds.`,
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
  // A symlink reads as its target, the way git stores it, never followed: so an added script that is a symlink fails
  // item 7's exemption here too, as it does in `pnpm queue` and the hook (Main 6's Low on #637).
  const onDisk = (file: string) => {
    const path = join(repo, file);
    if (!existsSync(path) && !isSymlink(path)) return undefined;
    return isSymlink(path) ? readlinkSync(path) : readFileSync(path, "utf8");
  };
  return sharedFilesMix(files, (file) => ({ before: show(base, file), after: commit ? show(commit, file) : onDisk(file) }));
}
