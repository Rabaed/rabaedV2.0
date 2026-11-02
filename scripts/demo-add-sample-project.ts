import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// `pnpm demo:add-sample-project` (RP-1217): adds the demo's sample Project, Al Nakheel District – Block A, to a lane's
// database that has the demo but not it, without a reset (the api's `demo:add-sample-project`, as the demo people),
// then spreads its open items' Step Age (scripts/sample-project-age.ts). Running it again changes nothing.
//
//   node scripts/demo-add-sample-project.ts [--lane <n>] [--dry-run]   the arguments go to the Step Age step
//
// A script of its own, not a chain in package.json: a root entry is a plain `node scripts/<file>.ts` (rule 3).

/** Each step's node arguments, in order; the second runs only when the first succeeds. */
export function addSampleProjectSteps(argv: string[]): string[][] {
  return [
    ["scripts/pnpm.ts", "--filter", "@rabaed/api", "run", "demo:add-sample-project"],
    ["scripts/sample-project-age.ts", ...argv],
  ];
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  for (const step of addSampleProjectSteps(process.argv.slice(2))) {
    const { status } = spawnSync(process.execPath, step, { stdio: "inherit" });
    if (status !== 0) process.exit(status ?? 1);
  }
}
