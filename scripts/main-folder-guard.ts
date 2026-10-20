import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// A PreToolUse hook (.claude/settings.json) for Edit, Write, MultiEdit and NotebookEdit:
// nothing is edited in the main checkout (G:\Rabaed Contech), only in worktrees. Every
// Main session opens on the main folder, and on 2026-10-16 one left an uncommitted
// GLOSSARY.md change there that no branch held (RP-613). `.claude/` (local settings, the
// app's worktrees) stays editable. For Bash and PowerShell it refuses a git command that changes
// HEAD or branches from a worktree folder that lost its .git file (gitFallbackRefusal, RP-956).
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

/** git subcommands that move HEAD or change branches; `branch` only with a rename or delete flag. */
const HEAD_CHANGING = new Set(["switch", "checkout", "reset", "merge", "commit", "rebase", "pull", "stash"]);
const BRANCH_CHANGING = /^(-[mMdD]|--move|--delete|--force-move)$/;

/** The git subcommand of a command that moves HEAD or changes branches (`switch`, `branch -m`), or undefined. */
export function headChangingGit(command: string): string | undefined {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/);
    if (!/^(?:.*[\\/])?git(?:\.exe)?$/i.test(tokens[0] ?? "")) continue;
    let i = 1;
    // Global options: -c name=value and -C dir take a value.
    while (tokens[i]?.startsWith("-")) i += tokens[i] === "-c" || tokens[i] === "-C" ? 2 : 1;
    const sub = tokens[i];
    if (sub === undefined) continue;
    if (HEAD_CHANGING.has(sub)) return sub;
    if (sub === "branch" && tokens.slice(i + 1).some((t) => BRANCH_CHANGING.test(t))) return "branch";
  }
  return undefined;
}

/**
 * RP-956: why a HEAD- or branch-changing git command must be refused, or undefined. It is when the
 * cwd is in `<main>/.claude/worktrees/<name>` but that folder has no `.git` file: the worktree was
 * removed or lost its link while a session worked in it, and git falls back to the main checkout's
 * `.git` directory, so `git switch` would move the main folder off main. Walking up from the cwd,
 * meeting the main `.git` directory before any `.git` file is that mismatch; no git is spawned.
 */
export function gitFallbackRefusal(command: string, cwd: string, gitKind: (dir: string) => GitKind = gitKindOnDisk): string | undefined {
  const sub = headChangingGit(command);
  if (sub === undefined) return undefined;
  const start = resolve(cwd);
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
