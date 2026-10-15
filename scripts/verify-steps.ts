import { composeProjectOfEnv } from "./lanes.ts";
import { migrationsDir } from "./migrations.ts";
import { hostAndPort } from "./test-services.ts";

// Which checks `pnpm verify` (RP-459) runs for a diff. Pure, so it is unit-tested.

export type Step = { name: string; script: string };
export type Skipped = { name: string; reason: string };

const storyFolders = ["packages/ui/", "apps/web/"];

const step = (name: string): Step => ({ name, script: name });

/** The steps for the files changed against origin/main, in run order, and the steps left out. */
export function selectSteps(changed: string[]): { steps: Step[]; skipped: Skipped[] } {
  const files = changed.map((file) => file.replaceAll("\\", "/"));
  const migrationChanged = files.some((file) => file.startsWith(`${migrationsDir}/`));
  const uiChanged = files.some((file) => storyFolders.some((folder) => file.startsWith(folder)));

  const steps: Step[] = [];
  const skipped: Skipped[] = [];
  if (migrationChanged) steps.push(step("check:migrations"));
  // eslint-disable-next-line rabaed/no-avoid-terms -- the database-schema migration files, named as the check script names them.
  else skipped.push({ name: "check:migrations", reason: "no migration changed against origin/main" });
  steps.push(step("lint"), step("typecheck"), step("test:unit"), step("test:seam1"), step("test:seam2"));
  if (uiChanged) steps.push(step("test:stories"));
  else skipped.push({ name: "test:stories", reason: "nothing changed in packages/ui or apps/web" });
  return { steps, skipped };
}

/** The line `pnpm verify` ends with when every step passed: the verified commit, "dirty" if the tree has uncommitted changes (RP-563). */
export function finalLine({ sha, dirty, steps }: { sha: string; dirty: boolean; steps: string[] }): string {
  return `pnpm verify passed on ${sha === "" ? "unknown commit" : sha}${dirty ? " (dirty: uncommitted changes)" : ""}: ${steps.join(", ")}.`;
}

const envValue = (env: string, key: string): string | undefined =>
  new RegExp(`^${key}=(.*)$`, "m").exec(env)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;

/** Where this worktree's Postgres listens, from its .env text (RP-575): the superuser URL's host and port, else POSTGRES_PORT on localhost; the lane from COMPOSE_PROJECT_NAME. */
export function postgresOfEnv(env: string): { lane: number | undefined; host: string; port: number } | undefined {
  const laneMatch = /^rabaed-lane(\d+)$/.exec(composeProjectOfEnv(env) ?? "");
  const lane = laneMatch ? Number(laneMatch[1]) : undefined;
  const url = envValue(env, "DATABASE_SUPERUSER_URL");
  if (url) return { lane, ...hostAndPort(url) };
  const port = Number(envValue(env, "POSTGRES_PORT"));
  return port ? { lane, host: "localhost", port } : undefined;
}

/** The message `pnpm verify` stops with when this worktree's Postgres doesn't answer. */
export const postgresDown = ({ lane, port }: { lane: number | undefined; port: number }): string =>
  // eslint-disable-next-line rabaed/no-avoid-terms -- `files` is the Docker Compose service's name, not a Document
  `Postgres for ${lane === undefined ? "this worktree" : `lane ${lane}`} (port ${port}) is down: \`docker compose up -d --wait db mailpit files\``;

/** The last `count` lines of `output`. */
export function tail(output: string, count: number): string {
  return output.trimEnd().split("\n").slice(-count).join("\n");
}
