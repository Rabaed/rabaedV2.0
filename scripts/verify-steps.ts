import { migrationsDir } from "./migrations.ts";

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
  else skipped.push({ name: "check:migrations", reason: "no migration changed against origin/main" });
  steps.push(step("lint"), step("typecheck"), step("test:unit"), step("test:seam1"), step("test:seam2"));
  if (uiChanged) steps.push(step("test:stories"));
  else skipped.push({ name: "test:stories", reason: "nothing changed in packages/ui or apps/web" });
  return { steps, skipped };
}

/** The last `count` lines of `output`. */
export function tail(output: string, count: number): string {
  return output.trimEnd().split("\n").slice(-count).join("\n");
}
