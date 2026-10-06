import { execFileSync } from "node:child_process";

// What the migration checks share: where the migrations live, and git.

/** The migrations folder, relative to the repository root. */
export const migrationsDir = "packages/db/migrations";

/** Runs git in `repo` and returns its output. */
export const git = (repo: string, ...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
