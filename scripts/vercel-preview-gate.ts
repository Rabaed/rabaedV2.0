import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Vercel's Ignored Build Step for the three UAT projects (ADR 0026, RP-1043). Vercel
// builds a pull request's preview itself, from Git, and the preview runs against UAT's
// database, which holds main's migrations. So a branch with a migration main lacks
// gets no preview: the migration is seen on UAT after merge, through deploy-uat.yml.
//
// The deploy workflow sets it as each project's `commandForIgnoringBuildStep`:
//   node ../../scripts/vercel-preview-gate.ts
// Vercel runs it before the install, in the project's Root Directory, in a clone ten
// commits deep, with the system variables (VERCEL_ENV, VERCEL_GIT_REPO_OWNER,
// VERCEL_GIT_REPO_SLUG). Exit 1 builds, exit 0 skips the build (Vercel docs, Project
// settings › Ignored Build Step). Plain Node: no dependencies, since nothing is installed yet.
//
// Production always builds: deploy-uat.yml migrates UAT before it deploys. Where the
// gate cannot tell (main can't be fetched), a preview is skipped, never built against a
// schema it didn't migrate.

export const MIGRATIONS_DIR = "packages/db/migrations/";

/**
 * The migrations in `repo`'s HEAD that main's tip doesn't have as they are: added or
 * changed by the branch. Compares the two trees, so it needs main's tip only (one commit
 * deep), not the merge base; a migration main gained since the branch left is not listed.
 */
export function migrationsNotOnMain(repo: string, remote: string): string[] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("fetch", "--quiet", "--no-tags", "--depth=1", remote, "refs/heads/main");
  const listed = git("diff", "--name-only", "--diff-filter=d", "FETCH_HEAD", "HEAD", "--", `:/${MIGRATIONS_DIR}`);
  return listed ? listed.split("\n") : [];
}

export interface GateDecision {
  build: boolean;
  reason: string;
}

/* eslint-disable rabaed/no-avoid-terms -- "migration" here is a database migration (packages/db/migrations), as in the build log */
/** Whether Vercel builds this deployment; `notOnMain` is migrationsNotOnMain for the clone, given main's remote. */
export function previewGate(env: NodeJS.ProcessEnv, notOnMain: (remote: string) => string[]): GateDecision {
  if (env.VERCEL_ENV === "production") return { build: true, reason: "a production deployment: the deploy workflow migrated UAT first" };
  const cannotTell = (why: string): GateDecision => ({ build: false, reason: `no preview: cannot tell whether this branch adds a migration (${why})` });
  const { VERCEL_GIT_REPO_OWNER: owner, VERCEL_GIT_REPO_SLUG: slug } = env;
  if (!owner || !slug) return cannotTell("VERCEL_GIT_REPO_OWNER and VERCEL_GIT_REPO_SLUG unset");
  let migrations: string[];
  try {
    migrations = notOnMain(`https://github.com/${owner}/${slug}.git`);
  } catch (error) {
    return cannotTell(((error as Error).message.split("\n")[0] ?? "").trim());
  }
  if (migrations.length === 0) return { build: true, reason: "no migration that main lacks" };
  return {
    build: false,
    reason: `no preview: this branch has a migration main lacks (${migrations.join(", ")}), and previews run against UAT's database; it is seen on UAT after merge`,
  };
}
/* eslint-enable rabaed/no-avoid-terms */

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const { build, reason } = previewGate(process.env, (remote) => migrationsNotOnMain(process.cwd(), remote));
  console.log(`vercel-preview-gate: ${reason}`);
  process.exit(build ? 1 : 0);
}
