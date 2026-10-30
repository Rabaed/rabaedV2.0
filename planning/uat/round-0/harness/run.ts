import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { closeBrowser, closeContexts, round } from "./browser.ts";
import { CaseRun, registry, type CaseResult, type Status } from "./case.ts";
import { runWhileUp, type WhileUpOutcome } from "../../../../scripts/stack-health.ts";
import { stackDown } from "./stack.ts";

// node planning/uat/round-0/harness/run.ts [--part VIS[,SUB]] [--id VIS-01,VIS-02] [--fixtures]
//
// Loads cases/<part>.ts, runs the cases in sequence, and merges each result into
// results/results.json as it finishes. A thrown error is "error" (a script problem), never "fail".
// The api and db are checked before and after each case (RP-1099): when either is down the run
// stops and that case's result is not written (runWhileUp, scripts/stack-health.ts). An outage that starts and ends inside one case
// is not seen.

const resultsFile = resolve(round, "results", "results.json");
const casesDir = resolve(round, "cases");
const CASE_TIMEOUT_MS = 180_000;

type Results = Record<string, CaseResult>;

function readResults(): Results {
  return existsSync(resultsFile) ? (JSON.parse(readFileSync(resultsFile, "utf8")) as Results) : {};
}

// One file per case (results/by-case/<ID>.json), so several runs at once never overwrite
// each other; results/results.json is then rebuilt from them.
const byCaseDir = resolve(round, "results", "by-case");

function saveResult(id: string, result: CaseResult): void {
  mkdirSync(byCaseDir, { recursive: true });
  writeFileSync(resolve(byCaseDir, `${id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  const all = readResults();
  for (const f of readdirSync(byCaseDir).filter((n) => n.endsWith(".json"))) {
    try { all[f.slice(0, -5)] = JSON.parse(readFileSync(resolve(byCaseDir, f), "utf8")) as CaseResult; } catch { /* being written by another run */ }
  }
  writeFileSync(resultsFile, `${JSON.stringify(all, null, 2)}\n`);
}

function argList(argv: string[], name: string): string[] | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function withTimeout<T>(work: Promise<T>, id: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${id} ran over ${CASE_TIMEOUT_MS / 1000} s.`)), CASE_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function runCase(id: string, body: (t: CaseRun) => Promise<void>): Promise<CaseResult> {
  const t = new CaseRun(id);
  let error: unknown;
  try {
    await withTimeout(body(t), id);
  } catch (e) {
    error = e;
  }
  // A page left open by a failed case must not leak into the next one.
  await closeContexts();
  let status: Status;
  const notes = [...t.notes];
  if (error !== undefined) {
    status = "error";
    const e = error instanceof Error ? error : new Error(String(error));
    notes.push(`Script error: ${e.message.split("\n").slice(0, 6).join(" | ")}`);
  } else if (t.declared) {
    status = t.declared.status;
    notes.push(t.declared.reason);
  } else if (t.checks.length === 0) {
    status = "error";
    notes.push("Script error: the case recorded no check and declared no status.");
  } else {
    status = t.checks.every((c) => c.ok) ? "pass" : "fail";
  }
  return { status, checks: t.checks, screenshots: t.screenshots, notes: notes.join("\n"), ranAt: new Date().toISOString() };
}

async function main() {
  const argv = process.argv.slice(2);
  const down = await stackDown();
  if (down) {
    console.error(down);
    process.exitCode = 1;
    return;
  }
  if (argv.includes("--fixtures")) {
    const { applyFixtures } = await import("./fixtures.ts");
    await applyFixtures(argList(argv, "--only"));
    await closeBrowser();
    return;
  }
  const parts = argList(argv, "--part");
  const ids = argList(argv, "--id");
  const files = existsSync(casesDir) ? readdirSync(casesDir).filter((f) => f.endsWith(".ts")) : [];
  const chosen = parts ? files.filter((f) => parts.some((p) => f.toLowerCase() === `${p.toLowerCase()}.ts`)) : files;
  if (parts && chosen.length === 0) throw new Error(`No case file for part ${parts.join(", ")} in cases/ (have: ${files.join(", ") || "none"}).`);
  for (const file of chosen) await import(pathToFileURL(resolve(casesDir, file)).href);

  const known = new Set((JSON.parse(readFileSync(resolve(round, "test-cases.json"), "utf8")) as { id: string }[]).map((c) => c.id));
  const todo = registry.filter((c) => !ids || ids.includes(c.id));
  if (ids) for (const id of ids) if (!registry.some((c) => c.id === id)) console.warn(`No case ${id} in the loaded files.`);
  const counts: Record<string, number> = {};
  let outcome: WhileUpOutcome;
  try {
    // A case the stack went down under is not saved, so its earlier result in results/ stays.
    outcome = await runWhileUp(todo, {
      down: (c) => stackDown(c.id),
      run: (c) => {
        if (!known.has(c.id) && !c.id.startsWith("SMOKE")) console.warn(`Warning: ${c.id} is not in test-cases.json.`);
        return runCase(c.id, c.body as (t: CaseRun) => Promise<void>);
      },
      save: (c, result) => {
        saveResult(c.id, result);
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        const failed = result.checks.filter((k) => !k.ok).length;
        const why = result.status === "pass" ? "" : ` ${result.notes.split("\n").pop() ?? ""}`;
        console.log(`${c.id.padEnd(10)} ${result.status.toUpperCase().padEnd(8)} ${result.checks.length - failed}/${result.checks.length} checks, ${result.screenshots.length} shots${why}`);
      },
    });
  } finally {
    await closeBrowser();
  }
  if (outcome.stopped) {
    console.error(outcome.stopped);
    process.exitCode = 1;
  }
  console.log(`${outcome.stopped ? `Stopped: ${outcome.saved} of ${todo.length}` : `Done: ${todo.length}`} cases written (${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ") || "none"}). Results: ${resultsFile}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
