import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { claimCovers, fetchComments, globRegex, readClaims, type Claim, type Comment } from "./claims.ts";
import type { OverlapSeam } from "./pr-overlap.ts";
import { isDoc } from "./reviewed-required.ts";

/** What a check says: refused (`ok` false), a warning, or "" when there is nothing to say. */
export interface ClaimsVerdict {
  ok: boolean;
  message: string;
}

// `pnpm check:claims` (RP-1008): rule 12 checked, not remembered. A branch that changes a shared
// module (docs/agents/issue-tracker.md › "Ticket: shared files"), or whose migration redefines an
// `app.*` function, needs an open CLAIM on RP-603 naming the branch's key. RP-577 changed five
// shared API functions, and RP-651's follow-up redefined `app.sync_work_item_checklists`, with no
// claim until someone asked. `pnpm verify` and the pre-push hook run it too.
//
// It reads RP-603 only when the branch changes a shared module, with JIRA_EMAIL and JIRA_API_TOKEN
// (as `pnpm claims`). With no credentials or no network it warns and passes.
//
// It also warns (RP-1199, never refuses) when the branch changes `.github/workflows/**` and any non-doc
// file, naming rule 3's split: workflows in their own PR, after the script PR. That reads only the changed
// files, so it is printed with no credentials, no network and no shared module changed.

export interface ClaimsInput {
  /** The branch's issue key (`RP-1008`), undefined when its name has none. */
  key: string | undefined;
  /** The files the branch changes against origin/main. */
  files: string[];
  /** Every path the branch touches, deleted ones included (`files` leaves them out); the workflow mix reads it. Defaults to `files`. */
  touched?: string[] | undefined;
  /** The `app.*` functions a branch migration redefines. */
  redefined: string[];
  /** docs/agents/issue-tracker.md, which holds the shared-files list. */
  sharedList: string;
  /** RP-603's comments; called only when the branch changes a shared module. Throws when Jira can't be read. */
  comments: () => Promise<Comment[]>;
  /** `Main 3, lane-3a` for the claim line to post, when the lane is known. */
  owner?: string | undefined;
}

/** `Main m, lane-mx` from a lane's .env (`COMPOSE_PROJECT_NAME=rabaed-lane31`: lane mL, L 1–4 as a–d). */
export function laneOwner(env: string): string | undefined {
  const match = /^COMPOSE_PROJECT_NAME=rabaed-lane([1-9])([1-4])\s*$/m.exec(env);
  return match ? `Main ${match[1]}, lane-${match[1]}${"abcd"[Number(match[2]) - 1]}` : undefined;
}

/** The issue key a branch name starts with (rule 1: `RP-191-...`), upper-cased. */
export function branchKey(branch: string): string | undefined {
  return /^(?:refs\/heads\/)?(rp-\d+)(?![\d])/i.exec(branch)?.[1]?.toUpperCase();
}

const MIGRATIONS = "packages/db/migrations/";
// `app.name`, `app."name"` or `"app"."name"`, the head across lines too.
const DEFINED = /\bcreate\s+(?:or\s+replace\s+)?function\s+"?app"?\."?(\w+)"?/gi;
// On origin/main any line naming the function is enough to say it exists there (git grep is per line).
const NAMED = /\bfunction\s+"?app"?\."?(\w+)"?/gi;
const namesIn = (sql: string, pattern: RegExp): string[] => [...sql.matchAll(pattern)].map((m) => `app.${m[1]!.toLowerCase()}`);

/**
 * What the branch changes against where it left origin/main: at `commit` (the pre-push hook), or, without
 * one, in the working tree with untracked files (`pnpm verify`). `redefined` is each `app.*` function a
 * changed migration defines that origin/main's migrations define too; a new function is not shared yet.
 * Throws when git fails.
 */
export function branchChanges(repo: string, commit?: string): { files: string[]; touched: string[]; redefined: string[] } {
  const git = (...args: string[]) => spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const must = (...args: string[]) => {
    const done = git(...args);
    if (done.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr.trim()}`);
    return done.stdout;
  };
  const lines = (text: string) => text.split("\n").filter(Boolean);
  const mergeBase = git("merge-base", "origin/main", commit ?? "HEAD");
  if (mergeBase.status !== 0) throw new Error(`git merge-base origin/main failed: ${mergeBase.stderr.trim()}. Run \`git fetch origin main\` and try again.`);
  const base = mergeBase.stdout.trim();
  const files = [...new Set([...lines(must("diff", "--name-only", "--no-renames", "--diff-filter=d", base, ...(commit ? [commit] : []))), ...(commit ? [] : lines(must("ls-files", "--others", "--exclude-standard")))])].sort();
  // `touched`: the same without --diff-filter=d, so a deleted path counts for rule 3's workflow mix as in shared-files.ts.
  const touched = [...new Set([...lines(must("diff", "--name-only", "--no-renames", base, ...(commit ? [commit] : []))), ...(commit ? [] : lines(must("ls-files", "--others", "--exclude-standard")))])].sort();
  const migrations = files.filter((file) => file.startsWith(MIGRATIONS) && file.endsWith(".sql"));
  if (migrations.length === 0) return { files, touched, redefined: [] };
  const text = (file: string) => (commit ? must("show", `${commit}:${file}`) : existsSync(join(repo, file)) ? readFileSync(join(repo, file), "utf8") : "");
  // One git grep over origin/main's migrations (exit 1: no match), not a `git show` per migration.
  const grep = git("grep", "-h", "-i", "-E", 'function[[:space:]]+"?app"?\\.', base, "--", MIGRATIONS);
  if (grep.status !== 0 && grep.status !== 1) throw new Error(`git grep on origin/main's migrations failed: ${grep.stderr.trim()}`);
  const onMain = new Set(namesIn(grep.stdout, NAMED));
  const redefined = [...new Set(migrations.flatMap((file) => namesIn(text(file), DEFINED)))].filter((fn) => onMain.has(fn)).sort();
  return { files, touched, redefined };
}

/** The paths, directories (`dir/`) and globs (`scripts/lanes*.ts`) the "Ticket: shared files" list names. */
export function sharedPatterns(issueTracker: string): string[] {
  const lines = issueTracker.split("\n");
  // eslint-disable-next-line rabaed/no-avoid-terms -- the doc's own heading, quoted.
  const start = lines.findIndex((line) => line.startsWith("- **Ticket: shared files.**"));
  // eslint-disable-next-line rabaed/no-avoid-terms -- the doc's own heading, quoted.
  if (start === -1) throw new Error('docs/agents/issue-tracker.md has no "Ticket: shared files" list.');
  const patterns: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // The list ends at its last item; the bullet on adding a module repeats names as examples.
    if (!line.startsWith("  ") || line.startsWith("  - A new shared module")) break;
    // An example in parentheses (`(e.g. `tower.ts`)`) names a file inside a listed module, not a module.
    for (const [, span] of line.replace(/\((?:e\.g\.|such as)[^)]*\)/g, "").matchAll(/`([^`]+)`/g)) {
      // A path names a directory or a file with an extension; `app.*` functions are matched apart.
      if (/^[\w.@-][\w./*@-]*$/.test(span!) && !span!.startsWith("app.") && /\/|\.\w+$/.test(span!)) patterns.push(span!);
    }
  }
  return [...new Set(patterns)];
}

/** Whether `file` is the shared module `pattern` names: the file, under the directory, or matched by the glob. */
function isShared(file: string, pattern: string): boolean {
  if (pattern.endsWith("/")) return file.startsWith(pattern);
  if (pattern.includes("*")) return globRegex(pattern).test(file);
  return file === pattern;
}

/**
 * Whether a claim is posted under `key`: its owner (the key after "Main n", or the spec's), or the key in
 * its header before the attribution (`CLAIM for RP-959, branch … — Main 5`). Not a key it only mentions.
 */
function namesKey(claim: Claim, key: string): boolean {
  if (claim.keys.includes(key)) return true;
  const header = (claim.text.split("\n")[0] ?? "").split(/\s[—–-]+\s*Main \d|\bMain \d/)[0] ?? "";
  return new RegExp(`\\b${key}\\b(?!-\\d)`).test(header);
}

const WORKFLOWS = ".github/workflows/";

/**
 * Rule 3 (RP-1199): a branch changing `.github/workflows/**` together with any other file that is not a doc
 * (a doc: `isDoc` of reviewed-required.ts) goes up as two PRs, the workflow files in their own, after the
 * PR with the other non-doc files (scripts, app code, anything the workflows rely on). A Markdown file under
 * `.github/workflows/` is a doc, not a workflow file; `.github/actions/**` counts as a non-doc. Returns the
 * warning naming both lists, "" when the branch has no such mix. A pure function of the changed files: no
 * Jira, no network. It warns and never refuses. `branchMix` (shared-files.ts), which the pre-push hook and
 * `pnpm verify` print, leaves workflow files out, so a workflow mix gets this one message.
 */
export function workflowMixWarning(files: string[]): string {
  const workflows = files.filter((file) => file.startsWith(WORKFLOWS) && !isDoc(file));
  const nonDocs = files.filter((file) => !file.startsWith(WORKFLOWS) && !isDoc(file));
  if (workflows.length === 0 || nonDocs.length === 0) return "";
  const list = (items: string[]) => items.map((item) => `  ${item}`);
  /* eslint-disable rabaed/no-avoid-terms -- source files, git paths and GitHub's merge queue, by their own names. */
  return [
    "Warning: check:claims (rule 3): this branch changes workflow files together with other non-doc files, so `pnpm queue` will refuse it. Split it in two (planning/parallel-sessions.md rule 3): the workflow files go in their own PR, opened after the PR with the other non-doc files has merged.",
    "Workflow PR (second), the files under .github/workflows/:",
    ...list(workflows),
    "First PR, the other non-doc files:",
    ...list(nonDocs),
    "(Docs may go with either PR.)",
  ].join("\n");
  /* eslint-enable rabaed/no-avoid-terms */
}

/**
 * Whether the push may go: every shared module the branch changes has an open CLAIM naming its key. The
 * rule-3 workflow warning, when the branch has the mix, rides in `message` beside any claims message. It
 * reads `touched` (deleted paths too), the claims check only `files`.
 */
export async function checkClaims(input: ClaimsInput): Promise<ClaimsVerdict> {
  const verdict = await claimsVerdict(input);
  const mix = workflowMixWarning(input.touched ?? input.files);
  return mix === "" ? verdict : { ok: verdict.ok, message: verdict.message === "" ? mix : `${verdict.message}\n\n${mix}` };
}

async function claimsVerdict(input: ClaimsInput): Promise<ClaimsVerdict> {
  const patterns = sharedPatterns(input.sharedList);
  const shared = [...input.files.filter((file) => patterns.some((pattern) => isShared(file, pattern))), ...input.redefined];
  if (shared.length === 0) return { ok: true, message: "" };
  const list = (items: string[]) => items.map((item) => `  ${item}`);
  const claimLine = (items: string[], key: string) => `  CLAIM ${items.map((item) => `\`${item}\``).join(", ")} — ${input.owner ?? "Main <m>, lane-<mx>"}, ${key}`;
  if (input.key === undefined) {
    return {
      ok: false,
      message: ["check:claims (rule 12): this branch changes shared modules, but the branch has no issue key in front to look up on RP-603:", ...list(shared), "Rename the branch after its issue (rule 1: `git branch -m RP-nnn-<slug>`), then post on RP-603:", claimLine(shared, "RP-nnn")].join("\n"),
    };
  }
  const key = input.key;
  let comments: Comment[];
  try {
    comments = await input.comments();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: true, message: [`Warning: check:claims could not read RP-603 (${reason}), so it did not look at the claims for:`, ...list(shared), "Look them up with `pnpm claims --open` before the PR."].join("\n") };
  }
  const open = readClaims(comments).filter((claim) => claim.releasedBy === undefined && namesKey(claim, key));
  const unclaimed = shared.filter((item) => !open.some((claim) => claimCovers(claim, item)));
  if (unclaimed.length === 0) return { ok: true, message: "" };
  return {
    ok: false,
    message: [`check:claims (rule 12): ${key} has no open CLAIM on RP-603 for:`, ...list(unclaimed), "Post it on RP-603 first (planning/parallel-sessions.md rule 12):", claimLine(unclaimed, key)].join("\n"),
  };
}

/** RP-603's comments with the environment's Jira credentials; throws when they are missing or Jira can't be read. */
async function rp603Comments(): Promise<Comment[]> {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error("JIRA_EMAIL and JIRA_API_TOKEN are not set; see .env.example");
  // A stalled network warns after this, rather than holding up every push.
  return fetchComments(email, token, (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(JIRA_TIMEOUT_MS) }));
}

const JIRA_TIMEOUT_MS = 20_000;

/**
 * `checkClaims` for this branch: at `commit` pushed to `branch` (the pre-push hook), or the working tree on
 * the checked-out branch (`pnpm verify`, `pnpm check:claims`). Throws when git fails.
 */
export async function branchClaims(repo: string, push?: { commit: string; branch: string }): Promise<ClaimsVerdict> {
  const { files, touched, redefined } = branchChanges(repo, push?.commit);
  const branch = push?.branch ?? spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  const envFile = join(repo, ".env");
  return checkClaims({
    key: branchKey(branch),
    files,
    touched,
    redefined,
    sharedList: readFileSync(join(repo, "docs", "agents", "issue-tracker.md"), "utf8"),
    comments: rp603Comments,
    owner: existsSync(envFile) ? laneOwner(readFileSync(envFile, "utf8")) : undefined,
  });
}

/**
 * The open PRs that change the same files as this branch, which of them would conflict, and the merge order
 * (scripts/pr-overlap.ts, RP-1172): a warning to print, "" when there is none; it never refuses or throws.
 * `pr-overlap.ts` is loaded here, not at the top, so the pre-push hook and `pnpm verify`, which load this file
 * for `branchClaims`, neither wait for GitHub nor need the module. `pnpm queue` and `pnpm verify` can call
 * `overlapWarning` themselves.
 */
export async function branchOverlaps(repo: string, seam?: OverlapSeam): Promise<string> {
  try {
    const { overlapWarning } = await import("./pr-overlap.ts");
    return await overlapWarning(repo, seam);
  } catch (error) {
    // A module that won't load must not fail a lane whose claims are fine.
    return `Warning: check:claims could not run the overlap look (${error instanceof Error ? error.message : String(error)}).`;
  }
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  try {
    const result = await branchClaims(process.cwd());
    if (result.message) (result.ok ? console.log : console.error)(result.message);
    // A warning only: it never changes the exit code.
    const overlaps = await branchOverlaps(process.cwd());
    if (overlaps) console.log(overlaps);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
