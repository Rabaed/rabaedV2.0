import { resolve } from "node:path";
import { stepAgeWeeks } from "../packages/domain/src/step-age.ts";
import { AgeRefused, ageChanges, ageItems, findAgeCandidates, type AgeCandidate } from "../packages/db/dev-tools/index.ts";
import { createDb } from "../packages/db/src/client.ts";
import { targetOf } from "./uat-age.ts";
import { guardedOrExit, loadToolEnv, printsItemText, runCli, type Target } from "./uat-guard.ts";

// The sample Project's Step Age (RP-1217): after `demo:add-sample-project` (or the demo seed) every
// item has just reached its Step, so every dot reads 1. This spreads the open items of Al Nakheel
// District – Block A over 1 to 4+ weeks with uat:age's own code (RP-922), item by item, as the
// migrator. Dev and UAT only (scripts/uat-guard.ts), like uat:age:
//
//   node scripts/sample-project-age.ts [--lane <n> | --uat] [--dry-run]
//
// Each item's Step Age comes from its own Document Number, so a run always plans the same, and an
// item that already reads that Step Age or more is left as it is: a second run changes nothing. The
// audit trail keeps its true times (uat-age.ts says why). It prints counts only.

const PREFIX = "NKD-";

/** Step Age by an item's number: a quarter stay at 1, as new items are; the rest 2 to 6 weeks (the dots read 4+ from 4). */
const WEEKS = [1, 2, 3, 1, 4, 5, 2, 6];

export interface SampleAge {
  documentNumber: string;
  weeks: number;
}

/** Which of `candidates` to age, and to what Step Age: the sample Project's open, numbered items not already that old. */
export function sampleAgeTargets(candidates: AgeCandidate[], now: Date): SampleAge[] {
  return candidates.flatMap((c) => {
    if (c.closed || !c.documentNumber?.startsWith(PREFIX)) return [];
    const counter = Number(/(\d+)(?: Rev \d+)?$/.exec(c.documentNumber)?.[1] ?? 0);
    const weeks = WEEKS[counter % WEEKS.length]!;
    return weeks > stepAgeWeeks(c.stepEnteredAt, now) ? [{ documentNumber: c.documentNumber, weeks }] : [];
  });
}

export function parseSampleAgeArgs(argv: string[], env: NodeJS.ProcessEnv): { target: Target; dryRun: boolean } | { error: string } {
  let lane: string | undefined;
  let uat = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--lane") lane = argv[++i];
    else if (arg === "--uat") uat = true;
    else if (arg === "--dry-run") dryRun = true;
    else return { error: arg.startsWith("--") ? `unknown option ${arg}` : `unexpected ${arg}` };
  }
  const target = targetOf({ lane, uat }, env);
  return "error" in target ? target : { target, dryRun };
}

async function main(argv: string[]): Promise<number> {
  const env = loadToolEnv();
  const args = parseSampleAgeArgs(argv, env);
  if ("error" in args) {
    console.error(`sample-project-age: ${args.error}\nusage: node scripts/sample-project-age.ts [--lane <n> | --uat] [--dry-run]`);
    return 2;
  }
  const guarded = guardedOrExit("sample-project-age", env, args.target);
  console.log(`sample-project-age on ${guarded.label}${args.dryRun ? " (dry run: nothing is written)" : ""}`);
  const db = createDb(guarded.migratorUrl, { max: 1 });
  try {
    const now = new Date();
    const candidates = await findAgeCandidates(db, [PREFIX]);
    const targets = sampleAgeTargets(candidates, now);
    let aged = 0;
    let refused = 0;
    for (const { documentNumber, weeks } of targets) {
      const changes = ageChanges({ items: [documentNumber], weeks }, candidates, now, { itemText: printsItemText(env) });
      if ("errors" in changes) {
        refused++;
        continue;
      }
      try {
        await ageItems(db, changes.items, { dryRun: args.dryRun });
        aged++;
      } catch (error) {
        if (!(error instanceof AgeRefused)) throw error;
        refused++;
      }
    }
    console.log(`sample-project-age: ${aged} item(s) ${args.dryRun ? "would be" : ""} aged, ${refused} refused by uat:age's checks, ${candidates.length - targets.length} left as they are`.replace("  ", " "));
    return 0;
  } finally {
    await db.destroy();
  }
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) runCli("sample-project-age", main);
