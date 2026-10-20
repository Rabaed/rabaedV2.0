import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// A PreToolUse hook (.claude/settings.json) for Edit, Write, MultiEdit and NotebookEdit:
// nothing is edited in the main checkout (G:\Rabaed Contech), only in worktrees. Every
// Main session opens on the main folder, and on 2026-10-16 one left an uncommitted
// GLOSSARY.md change there that no branch held (RP-613). `.claude/` (local settings, the
// app's worktrees) stays editable. For Bash and PowerShell it refuses a git command that changes
// HEAD or branches run against a worktree folder that lost its .git file (gitFallbackRefusal, RP-956),
// after any cd, Set-Location or pushd earlier in the command line, or at its -C. The hook entry in
// .claude/settings.json refuses every command when this file itself is missing: the worktree lost its files.
// RABAED_ALLOW_MAIN_FOLDER=1 turns the guard off.

export type GitKind = "dir" | "file" | undefined;

/** What `.git` is in dir: a directory (the main checkout), a file (a worktree), or absent. */
const gitKindOnDisk = (dir: string): GitKind => {
  const git = resolve(dir, ".git");
  if (!existsSync(git)) return undefined;
  return statSync(git).isDirectory() ? "dir" : "file";
};

/** Why editing path must be refused, or undefined to allow it. */
export function refusal(path: string, cwd: string, gitKind: (dir: string) => GitKind = gitKindOnDisk): string | undefined {
  const file = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const kind = gitKind(dir);
    if (kind === "file") return undefined;
    if (kind === "dir") {
      const inside = relative(dir, file);
      if (inside === ".claude" || inside.startsWith(`.claude${sep}`) || inside.startsWith(".claude/")) return undefined;
      return (
        `${file} is in the main checkout (${dir}). Nothing is edited there, only in a worktree ` +
        "(planning/parallel-sessions.md, \"How a Main works\"). Call EnterWorktree first, named after the topic or issue, and edit it there."
      );
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** git subcommands that move HEAD or change branches; `branch` only with a rename, delete or force flag. */
const HEAD_CHANGING = new Set(["switch", "checkout", "reset", "merge", "commit", "rebase", "pull", "stash", "cherry-pick", "revert", "am"]);
const BRANCH_CHANGING = /^(-[mMdDf]|--move|--delete|--force-move|--force)$/;
/** Commands that change the directory for the segments after them: bash's and PowerShell's. */
const DIRECTORY_CHANGING = /^(cd|chdir|pushd|set-location|sl)$/i;
/** git or git.exe, bare or by a path. */
const GIT = /^(?:.*[\\/])?git(?:\.exe)?$/i;

/** One git command of a shell command line: its subcommand and the directory it runs against. */
export type GitCall = { sub: string; dir: string };

/** The words of one segment, quotes removed; a backslash is no escape (Windows paths keep theirs). */
const wordsOf = (segment: string): string[] => [...segment.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");

/**
 * The git commands of a command line that move HEAD or change branches (`switch`, `branch -m`, …),
 * each with the directory it runs against. The line is split into segments on &&, ||, ;, | and
 * newlines; a `cd`, `Set-Location` or `pushd` segment moves the directory for the segments after
 * it, and `git -C <dir>` points one git command elsewhere, both resolved against the directory so far.
 * git may follow PowerShell's call operator `&`, and may be named by a quoted or unquoted path.
 */
export function headChangingGitCalls(command: string, cwd: string): GitCall[] {
  const calls: GitCall[] = [];
  let dir = resolve(cwd);
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = wordsOf(segment.trim().replace(/^&\s*/, ""));
    const [first = "", ...rest] = words;
    if (DIRECTORY_CHANGING.test(first)) {
      const target = rest.find((w) => !w.startsWith("-") && w.toLowerCase() !== "/d");
      if (target !== undefined && !/^[~$]/.test(target)) dir = resolve(dir, target);
      continue;
    }
    if (!GIT.test(first)) continue;
    let gitDir = dir;
    let i = 0;
    // Global options: -c name=value and -C dir take a value; -C points git at dir.
    while (rest[i]?.startsWith("-")) {
      if (rest[i] === "-C" && rest[i + 1] !== undefined) gitDir = resolve(gitDir, rest[i + 1] ?? "");
      i += rest[i] === "-c" || rest[i] === "-C" ? 2 : 1;
    }
    const sub = rest[i];
    if (sub === undefined) continue;
    if (HEAD_CHANGING.has(sub) || (sub === "branch" && rest.slice(i + 1).some((w) => BRANCH_CHANGING.test(w)))) calls.push({ sub, dir: gitDir });
  }
  return calls;
}

/**
 * RP-956: why a HEAD- or branch-changing git command must be refused, or undefined. It is when the
 * directory it runs against (the cwd, after any cd, or its -C) is in `<main>/.claude/worktrees/<name>`
 * but that folder has no `.git` file: the worktree was removed or lost its link while a session worked
 * in it, and git falls back to the main checkout's `.git` directory, so `git switch` would move the
 * main folder off main. Walking up from that directory, meeting the main `.git` directory before any
 * `.git` file is that mismatch; no git is spawned.
 */
export function gitFallbackRefusal(command: string, cwd: string, gitKind: (dir: string) => GitKind = gitKindOnDisk): string | undefined {
  for (const { sub, dir } of headChangingGitCalls(command, cwd)) {
    const why = lostLinkRefusal(sub, dir, gitKind);
    if (why !== undefined) return why;
  }
  return undefined;
}

function lostLinkRefusal(sub: string, start: string, gitKind: (dir: string) => GitKind): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    const kind = gitKind(dir);
    if (kind === "file") return undefined;
    if (kind === "dir") {
      const [claude, worktrees, name] = relative(dir, start).split(/[\\/]/);
      if (claude !== ".claude" || worktrees !== "worktrees" || !name) return undefined;
      return (
        `${resolve(dir, ".claude", "worktrees", name)} has lost its .git link: the worktree was removed while this session worked in it, ` +
        `so \`git ${sub}\` would run against the main checkout (${dir}) and change its branch. Do not run git here. ` +
        "Copy any work out of this folder, then EnterWorktree a new worktree, or stop and ask. RABAED_ALLOW_MAIN_FOLDER=1 turns this guard off."
      );
    }
    if (dirname(dir) === dir) return undefined;
  }
}

function main(): void {
  if (process.env.RABAED_ALLOW_MAIN_FOLDER === "1") return;
  type Input = { cwd?: string; tool_input?: { file_path?: string; notebook_path?: string; command?: string } };
  let input: Input;
  try {
    input = JSON.parse(readFileSync(0, "utf8").trimStart()) as Input; // trimStart drops a byte order mark too
  } catch {
    return; // Not a hook payload: never block an edit on a guard that cannot read it.
  }
  const cwd = input.cwd ?? process.cwd();
  const command = input.tool_input?.command;
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const why = typeof command === "string" ? gitFallbackRefusal(command, cwd) : path ? refusal(path, cwd) : undefined;
  if (why === undefined) return;
  console.error(why);
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
