import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// A PreToolUse hook (.claude/settings.json) for Edit, Write, MultiEdit and NotebookEdit:
// nothing is edited in the main checkout (G:\Rabaed Contech), only in worktrees. Every
// Main session opens on the main folder, and on 2026-10-16 one left an uncommitted
// GLOSSARY.md change there that no branch held (RP-613). `.claude/` (local settings, the
// app's worktrees) stays editable. RABAED_ALLOW_MAIN_FOLDER=1 turns the guard off.

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

function main(): void {
  if (process.env.RABAED_ALLOW_MAIN_FOLDER === "1") return;
  type Input = { cwd?: string; tool_input?: { file_path?: string; notebook_path?: string } };
  let input: Input;
  try {
    input = JSON.parse(readFileSync(0, "utf8").trimStart()) as Input; // trimStart drops a byte order mark too
  } catch {
    return; // Not a hook payload: never block an edit on a guard that cannot read it.
  }
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!path) return;
  const why = refusal(path, input.cwd ?? process.cwd());
  if (why === undefined) return;
  console.error(why);
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
