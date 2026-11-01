import type { spawnSync } from "node:child_process";

// Reading a file at a commit, failing closed (RP-1196). Only node built-ins here: the pre-push hook loads it through
// shared-files.ts, and scripts/git-hooks.test.ts copies the hook's scripts into a bare repo.

/**
 * A file's text (path from the repo root) at `ref`; undefined only when the path is not a file there (RP-1196: fail
 * closed). Any other git failure throws: a bad ref, a commit a shallow clone lacks, a crash. `git show ref:path`
 * fails the same way (exit 128) for "no such path" and "no such commit", so a reader of its status took a missing
 * commit for a deleted file. `ls-tree` answers "not there" as data instead (exit 0, nothing listed) and fails only
 * when it cannot read the commit; its messages are not parsed (they change with git's version and language).
 */
export function fileAtVia(cwd: string, spawn: typeof spawnSync): (ref: string, file: string) => string | undefined {
  const must = (args: string[]) => {
    const done = spawn("git", args, { cwd, encoding: "utf8" });
    if (done.status !== 0) throw new Error(`git ${args.slice(0, 2).join(" ")} failed:\n${done.stdout ?? ""}${done.stderr ?? ""}`);
    return done.stdout ?? "";
  };
  return (ref, file) => {
    // -z: the path as is, never quoted; --full-tree: the path and the listing from the root, as `ref:path` reads it.
    const entry = must(["ls-tree", "-z", "--full-tree", ref, "--", file])
      .split("\0")
      .map((line) => /^\d+ (\w+) (\S+)\t(.*)$/s.exec(line))
      .find((match) => match?.[3] === file);
    if (!entry || entry[1] !== "blob") return undefined;
    return must(["cat-file", "blob", entry[2] ?? ""]);
  };
}

/** What `fileVersionsVia` answers: a file's text at the merge base and at the commit, undefined where it is not a file. */
export type FileVersions = (commit: string, file: string) => { before: string | undefined; after: string | undefined };

/**
 * A file's text at the merge base of origin/main and `commit` (what the three-dot diff diffs against) and at
 * `commit`; undefined where it does not exist. Throws on any other git failure, a missing merge base too (`fileAtVia`).
 */
export function fileVersionsVia(cwd: string, spawn: typeof spawnSync): FileVersions {
  const at = fileAtVia(cwd, spawn);
  return (commit, file) => {
    const base = spawn("git", ["merge-base", "origin/main", commit], { cwd, encoding: "utf8" });
    if (base.status !== 0) throw new Error(`git merge-base origin/main ${commit} failed:\n${base.stdout ?? ""}${base.stderr ?? ""}`);
    return { before: at((base.stdout ?? "").trim(), file), after: at(commit, file) };
  };
}
