import { execFileSync } from "node:child_process";

// What the migration checks share: where the migrations live, git, and a
// commit's migrations.

/** The migrations folder, relative to the repository root. */
export const migrationsDir = "packages/db/migrations";

/** A migration: its file name and its SQL. */
export interface Migration {
  name: string;
  sql: string;
}

/** Runs git in `repo` and returns its output. */
export const git = (repo: string, ...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** The migrations in a commit's tree, by file name, each with its content's blob id. */
export function migrationBlobs(repo: string, commit: string): Map<string, string> {
  return new Map(
    git(repo, "ls-tree", `${commit}:${migrationsDir}`)
      .split("\n")
      .map((line) => line.split("\t") as [string, string])
      .filter(([, name]) => name?.endsWith(".sql"))
      .map(([info, name]) => [name, info.split(" ")[2] as string]),
  );
}

/** The migrations' file names in a commit's tree. */
export const migrationNames = (repo: string, commit: string): string[] => [...migrationBlobs(repo, commit).keys()];

/** A migration's SQL at a commit. */
export const migrationSql = (repo: string, commit: string, name: string): string => git(repo, "show", `${commit}:${migrationsDir}/${name}`);
