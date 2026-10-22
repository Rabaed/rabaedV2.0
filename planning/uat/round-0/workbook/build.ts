// Builds the offline UAT workbook for Round 0 (RP-1033): one self-contained HTML file
// for a tester (Ahmed) to record a verdict and comment per Test Case and export them to Excel.
//
//   node planning/uat/round-0/workbook/build.ts
//
// Reads  planning/uat/round-0/test-cases.json         (every Test Case of RP-683)
//        planning/uat/round-0/results/results.json    (the Playwright run, if any)
//        planning/uat/round-0/ux/ux-results.json      (the ui-ux-tester's pass of Part UX, if any)
//        the screenshots those results name (evidence/, ux/)
// Writes planning/uat/round-0/UAT-Round-0-Workbook.html
//
// Screenshots are embedded as small thumbnails (made in a headless browser, no image
// library); each links to its full-size file in evidence/, shipped beside the HTML as a zip.
// The Excel export is written in the browser by a small SpreadsheetML writer zipped with
// fflate (MIT), inlined from node_modules, so the file works offline.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const round = resolve(here, "..");
const root = resolve(round, "../../..");

type TestCase = {
  id: string; jira: string; part: string; partName: string; title: string; who: string;
  steps: string; expected: string; priority: string; mode: string; waits: string; covers: string;
};
type Check = { text: string; ok: boolean; detail?: string };
type Result = { status: string; checks?: Check[]; screenshots?: string[]; notes?: string; ranAt?: string };

const cases = JSON.parse(readFileSync(join(round, "test-cases.json"), "utf8")) as TestCase[];
const resultsFile = join(round, "results", "results.json");
const results: Record<string, Result> = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : {};
// Each run also writes one file per case; the newest word on a case wins over results.json.
const byCase = join(round, "results", "by-case");
if (existsSync(byCase)) {
  for (const f of readdirSync(byCase).filter((n) => n.endsWith(".json"))) results[f.slice(0, -5)] = JSON.parse(readFileSync(join(byCase, f), "utf8"));
}
// The Bugs Main 7 filed in this round: [{ bug, priority, testCase, title }], listed at the top.
const issuesFile = join(round, "results", "issues.json");
const issues = existsSync(issuesFile) ? JSON.parse(readFileSync(issuesFile, "utf8")) : [];
// The ui-ux-tester's pass of Part UX, where the Playwright run has no result of its own.
const uxFile = join(round, "ux", "ux-results.json");
if (existsSync(uxFile)) {
  for (const [id, r] of Object.entries(JSON.parse(readFileSync(uxFile, "utf8")) as Record<string, Result>)) results[id] ??= r;
}

function findFflate(): string {
  const store = join(root, "node_modules", ".pnpm");
  const dir = readdirSync(store).filter((d) => d.startsWith("fflate@")).sort().pop();
  if (!dir) throw new Error("fflate is not in node_modules/.pnpm: run pnpm install");
  return readFileSync(join(store, dir, "node_modules", "fflate", "umd", "index.js"), "utf8");
}

async function thumbnails(files: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (files.length === 0) return out;
  const pw = createRequire(join(root, "packages/ui/package.json"))("playwright") as typeof import("playwright");
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<canvas id=c></canvas>");
  for (const rel of files) {
    const abs = join(round, rel);
    if (!existsSync(abs)) continue;
    const mime = extname(abs).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
    const src = `data:${mime};base64,${readFileSync(abs).toString("base64")}`;
    out[rel] = await page.evaluate(async (s) => {
      const img = new Image();
      img.src = s;
      await img.decode();
      const w = Math.min(420, img.naturalWidth);
      const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
      const c = document.getElementById("c") as HTMLCanvasElement;
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/jpeg", 0.55);
    }, src);
  }
  await browser.close();
  return out;
}

const autoLabel: Record<string, string> = {
  pass: "Pass", fail: "Fail", error: "Not run", manual: "Manual", "not-run": "Not run", blocked: "Blocked",
};

async function main() {
  const shots = cases.flatMap((c) => results[c.id]?.screenshots ?? []);
  const thumbs = await thumbnails(shots);
  const rows = cases.map((c) => {
    const r = results[c.id];
    const status = r ? (autoLabel[r.status] ?? "Not run") : c.mode === "Manual" ? "Manual" : "Not run";
    return {
      ...c,
      auto: status,
      autoNote: r?.notes ?? (r ? "" : c.waits === "Now" ? "Not run by the script in this round." : `Waits for ${c.waits}`),
      checks: r?.checks ?? [],
      ranAt: r?.ranAt ?? "",
      shots: (r?.screenshots ?? []).map((f) => ({ file: f, thumb: thumbs[f] ?? "" })),
    };
  });
  const built = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const template = readFileSync(join(here, "template.html"), "utf8");
  const html = template
    .replace("/*__FFLATE__*/", () => findFflate())
    .replace("\"__DATA__\"", () => JSON.stringify({ built, rows, issues, tunnel: process.env.UAT_TUNNEL_URL ?? "" }).replace(/</g, "\\u003c"));
  const outFile = join(round, "UAT-Round-0-Workbook.html");
  writeFileSync(outFile, html);
  const mb = statSync(outFile).size / 1024 / 1024;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.auto] = (counts[r.auto] ?? 0) + 1;
  console.log(`Wrote ${outFile} (${mb.toFixed(1)} MB, ${rows.length} Test Cases, ${shots.length} screenshots)`);
  console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · "));
}

await main();
