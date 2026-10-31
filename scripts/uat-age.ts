import { laneOfEnv, type Target } from "./uat-guard.ts";
export { ageChanges, type AgeChanges, type AgedItem } from "../packages/db/dev-tools/changes.ts";

// `uat:age` (RP-922): moves chosen items back in time, so UAT can see Step Age it would otherwise wait
// weeks for. Dev and UAT only (scripts/uat-guard.ts):
//
//   pnpm uat:age --item <Document Number or exact Subject> [--item ...] --weeks <1-52> [--lane <n>] [--dry-run]
//   node scripts/uat-age.ts --uat ...     UAT's database, from the "Age UAT items" GitHub Action only
//
// `--weeks N` leaves each item at Step Age N, the dots its holder reads (1 to 4+): its Step began
// N - 1 weeks and an hour ago, so it reads N for the next week. Every time of the item moves back by
// that one amount, so their order holds (Creation Date, then when it reached its Participant, then
// its Step) and other Companies' Step Age moves with it. The audit trail is never touched, so its
// events read later than the moved times: by design, it keeps the true history.

export interface AgeArgs {
  target: Target;
  /** As given: each a Document Number or an exact Subject. */
  items: string[];
  weeks: number;
  dryRun: boolean;
}

const USAGE = "usage: uat:age --item <Document Number or Subject> [--item ...] --weeks <1-52> [--lane <n> | --uat] [--dry-run]";

/** The command line, the lane defaulting to the one `env` (the worktree's .env) names. */
export function parseAgeArgs(argv: string[], env: NodeJS.ProcessEnv): AgeArgs | { error: string } {
  const items: string[] = [];
  let weeks: string | undefined;
  let lane: string | undefined;
  let uat = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--item") items.push(argv[++i] ?? "");
    else if (arg === "--weeks") weeks = argv[++i];
    else if (arg === "--lane") lane = argv[++i];
    else if (arg === "--uat") uat = true;
    else if (arg === "--dry-run") dryRun = true;
    else return { error: arg.startsWith("--") ? `unknown option ${arg}` : `unexpected ${arg}; ${USAGE}` };
  }
  if (items.length === 0 || items.some((text) => text.trim() === "")) return { error: "give at least one --item (a Document Number or an exact Subject)" };
  if (weeks === undefined || !/^[1-9][0-9]?$/.test(weeks) || Number(weeks) > 52) return { error: "--weeks is a whole number from 1 to 52" };
  const target = targetOf({ lane, uat }, env);
  if ("error" in target) return target;
  return { target, items, weeks: Number(weeks), dryRun };
}

/** `--lane <n>`, `--uat`, or the lane the worktree's .env names. Shared with `uat:run-job`. */
export function targetOf({ lane, uat }: { lane: string | undefined; uat: boolean }, env: NodeJS.ProcessEnv): Target | { error: string } {
  if (uat && lane !== undefined) return { error: "--lane and --uat are two targets: give one" };
  if (uat) return { kind: "uat" };
  if (lane !== undefined) return /^[0-9]+$/.test(lane) ? { kind: "lane", lane: Number(lane) } : { error: `--lane ${lane} is not a number` };
  const fromEnv = laneOfEnv(env);
  return fromEnv === undefined ? { error: "no lane: this worktree's .env has no lane; give --lane <n> (or --uat)" } : { kind: "lane", lane: fromEnv };
}

