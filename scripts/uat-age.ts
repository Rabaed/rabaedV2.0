import { stepAgeWeeks } from "../packages/domain/src/step-age.ts";
import type { AgeCandidate } from "../packages/db/dev-tools/index.ts";
import { laneOfEnv, type Target } from "./uat-guard.ts";

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

const WEEK = 7 * 24 * 3_600_000;
const HOUR = 3_600_000;

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

export interface AgedItem {
  id: string;
  documentNumber: string;
  subject: string;
  /** How far back each of its times moves. */
  shiftMs: number;
  stepAge: { own: { from: number; to: number }; others: { from: number; to: number } };
}

export interface AgeChanges {
  items: AgedItem[];
}

const named = (c: AgeCandidate) => (c.documentNumber ? `${c.documentNumber} "${c.subject}"` : `"${c.subject}" (a Draft)`);
const fold = (text: string) => text.trim().toLowerCase();

/** The candidates `text` names: by Document Number, else by exact Subject; both any case. */
function matchesOf(text: string, candidates: AgeCandidate[]): AgeCandidate[] {
  const want = fold(text);
  const byNumber = candidates.filter((c) => c.documentNumber !== null && fold(c.documentNumber) === want);
  return byNumber.length > 0 ? byNumber : candidates.filter((c) => fold(c.subject) === want);
}

/**
 * The plan for `items` among `candidates` (the items whose Document Number or Subject contains one of
 * them): each text must name exactly one open, numbered item, younger than `weeks`. Every refusal
 * at once, and then no plan.
 */
export function ageChanges({ items, weeks }: Pick<AgeArgs, "items" | "weeks">, candidates: AgeCandidate[], now: Date): AgeChanges | { errors: string[] } {
  const errors: string[] = [];
  const planned: AgedItem[] = [];
  const seen = new Set<string>();
  // Into its Nth week by an hour, so it reads Step Age N for the week after the run.
  const enteredBy = now.getTime() - (weeks - 1) * WEEK - HOUR;
  for (const text of items) {
    const matches = matchesOf(text, candidates);
    if (matches.length === 0) {
      const close = candidates.filter((c) => fold(c.subject).includes(fold(text)) || fold(c.documentNumber ?? "").includes(fold(text))).slice(0, 10);
      errors.push(`"${text.trim()}" matches no item by Document Number or exact Subject${close.length > 0 ? `. Close: ${close.map(named).join(", ")}` : ""}`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`"${text.trim()}" matches ${matches.length} items; give one of their Document Numbers: ${matches.map(named).join(", ")}`);
      continue;
    }
    const c = matches[0]!;
    const label = c.documentNumber ?? `"${c.subject}"`;
    if (seen.has(c.id)) {
      errors.push(`${label} is named twice`);
      continue;
    }
    seen.add(c.id);
    if (c.documentNumber === null) {
      errors.push(`${label} is a Draft: a Draft has no Step Age (ADR 0020)`);
      continue;
    }
    if (c.closed) {
      errors.push(`${label} is closed: a closed item has no Step Age`);
      continue;
    }
    const shiftMs = c.stepEnteredAt.getTime() - enteredBy;
    const own = stepAgeWeeks(c.stepEnteredAt, now);
    if (shiftMs <= 0) {
      errors.push(`${label} already reads Step Age ${own}: the tool moves times back only, so give --weeks above ${own}`);
      continue;
    }
    const moved = (at: Date) => new Date(at.getTime() - shiftMs);
    planned.push({
      id: c.id,
      documentNumber: c.documentNumber,
      subject: c.subject,
      shiftMs,
      stepAge: {
        own: { from: own, to: stepAgeWeeks(moved(c.stepEnteredAt), now) },
        others: { from: stepAgeWeeks(c.participantEnteredAt, now), to: stepAgeWeeks(moved(c.participantEnteredAt), now) },
      },
    });
  }
  return errors.length > 0 ? { errors } : { items: planned };
}
