import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";

// Where the UAT sealing authority's files may be written (uat-sealing-authority.ts): never inside
// a git checkout, so its key can't be committed to the public repo by mistake (RP-1042).

/** The git checkout `from` is in (the nearest folder with a `.git`, a worktree's file included), or null. */
export function repoRootOf(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Why the authority's files may not go in `folder`, or null when they may. */
export function authorityFolderProblem(folder: string, repoRoot: string | null): string | null {
  const inside = (root: string) => {
    const rel = relative(resolve(root), resolve(folder));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  if (repoRoot && inside(repoRoot)) return `${folder} is inside the repo (${repoRoot}): choose a folder outside it, so the key is never committed.`;
  const own = repoRootOf(folder);
  if (own) return `${folder} is inside a git checkout (${own}): choose a folder outside any repo.`;
  return null;
}
