import { laneOfProject, protectedLaneReason, type Container, type Volume } from "./lanes.ts";
import { samePath } from "./paths.ts";
import type { LockHolder } from "./verify-lock.ts";
import { worktreeName } from "./worktrees.ts";

// `pnpm lanes [--main N]` (RP-1170): on 2026-10-31 idle stacks held Docker at 8 of 8 while #539
// waited, and freeing one took messages across Mains. This is the view: each rabaed-* stack with its
// lane, Main, worktrees, PR and its state, whether a verify runs, and how long it has been idle. It
// reads only; lanes-status.ts gathers the facts.

export type RowsInput = {
  containers: Container[];
  volumes: Volume[];
  /** Every worktree of this clone, with COMPOSE_PROJECT_NAME from its .env. */
  worktrees: { path: string; branch: string | undefined; project: string | undefined }[];
  /** `gh pr list --state all`, newest first. */
  prs: { number: number; headRefName: string; state: string; isDraft: boolean }[];
  /** The live verify holding a worktree's lock (verify-lock.ts liveHolder), or undefined. */
  verifyOf: (path: string) => LockHolder | undefined;
  /** The worktree's last activity, ms (its last commit or newest uncommitted file), or undefined. */
  activityOf: (path: string) => number | undefined;
  exists: (path: string) => boolean;
  now: number;
  /** --main N: only that Main's stacks. */
  main: number | undefined;
  platform?: NodeJS.Platform;
};

export type StackRow = { stack: string; lane: string; main: string; containers: string; worktrees: string; pr: string; verify: string; idle: string };

const laneOf = laneOfProject;

/** The Main a lane belongs to: m for lane mL, the legacy lane m for m; undefined for lane 0 (the main folder). */
export const mainOfLane = (lane: number | undefined): number | undefined => (lane === undefined || lane === 0 ? undefined : lane >= 10 ? Math.floor(lane / 10) : lane);

const mainLabel = (project: string, lane: number | undefined): string => {
  if (protectedLaneReason(project) !== undefined) return `Main ${mainOfLane(lane)} (UAT harness: never freed)`;
  const main = mainOfLane(lane);
  if (main === undefined) return lane === 0 ? "main folder" : "—";
  const l = lane! >= 10 ? lane! % 10 : 0;
  return l === 0 ? `Main ${main}` : `Main ${main}, lane ${"ABCD"[l - 1]}`;
};

export function parseLanesArgs(args: string[]): { main: number | undefined } | { error: string } {
  const usage = "Usage: pnpm lanes [--main N]";
  if (args.length === 0) return { main: undefined };
  const n = Number(args[1]);
  if (args.length === 2 && args[0] === "--main" && Number.isInteger(n) && n >= 1 && n <= 9) return { main: n };
  return { error: usage };
}

/** "20 min", "3 h", "2 d". */
export const formatAge = (ms: number): string => {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
};

/** One row per rabaed-* compose project (containers or volumes), by lane number, other projects last. */
export function laneRows({ containers, volumes, worktrees, prs, verifyOf, activityOf, exists, now, main, platform }: RowsInput): StackRow[] {
  const projects = [...new Set([...containers, ...volumes].map((x) => x.project).filter((p) => p.startsWith("rabaed-")))];
  const order = (p: string) => laneOf(p) ?? Number.MAX_SAFE_INTEGER;
  projects.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const rows: StackRow[] = [];
  for (const project of projects) {
    const lane = laneOf(project);
    if (main !== undefined && mainOfLane(lane) !== main) continue;
    const mine = containers.filter((c) => c.project === project);
    const running = mine.filter((c) => c.state === "running").length;
    const shown = mine.length === 0 ? "volumes only" : running === 0 ? "stopped" : `running ${running}/${mine.length}`;
    // Its folders: the containers' and every worktree whose .env names it.
    const folders: { path: string; branch: string | undefined }[] = [];
    const add = (path: string, branch: string | undefined) => {
      if (path !== "" && !folders.some((f) => samePath(f.path, path, platform))) folders.push({ path, branch });
    };
    for (const c of mine) add(c.workingDir, worktrees.find((w) => samePath(w.path, c.workingDir, platform))?.branch);
    for (const w of worktrees) if (w.project === project) add(w.path, w.branch);
    const named = folders.map((f) => `${worktreeName(f.path)} (${!exists(f.path) ? "gone" : (f.branch ?? "detached HEAD")})`);
    const prOf = (branch: string | undefined) => (branch === undefined ? undefined : prs.find((p) => p.headRefName === branch));
    const prList = [...new Set(folders.map((f) => prOf(f.branch)).filter((p) => p !== undefined))].map((p) => `#${p.number} ${p.isDraft ? "draft" : p.state}`);
    const live = folders.filter((f) => exists(f.path)).map((f) => verifyOf(f.path)).find((h) => h !== undefined);
    const last = folders.map((f) => activityOf(f.path)).filter((t): t is number => t !== undefined);
    rows.push({
      stack: project,
      lane: lane === undefined ? "—" : String(lane),
      main: mainLabel(project, lane),
      containers: shown,
      worktrees: named.join(", ") || "—",
      pr: prList.join(", ") || "—",
      verify: live ? `running (pid ${live.pid}, ${formatAge(now - live.started.getTime())})` : "—",
      idle: live ? "verifying" : last.length === 0 ? "—" : formatAge(now - Math.max(...last)),
    });
  }
  return rows;
}

const COLUMNS: [keyof StackRow, string][] = [
  ["stack", "Stack"],
  ["lane", "Lane"],
  ["main", "Main"],
  ["containers", "Containers"],
  ["worktrees", "Worktrees"],
  ["pr", "PR"],
  ["verify", "Verify"],
  ["idle", "Idle"],
];

/** The rows as an aligned table under a header line. */
export function formatRows(rows: StackRow[]): string[] {
  if (rows.length === 0) return ["No rabaed-* stacks."];
  const widths = COLUMNS.map(([key, title]) => Math.max(title.length, ...rows.map((r) => r[key].length)));
  const line = (cells: string[]) => cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ");
  return [line(COLUMNS.map(([, title]) => title)), ...rows.map((r) => line(COLUMNS.map(([key]) => r[key])))];
}
