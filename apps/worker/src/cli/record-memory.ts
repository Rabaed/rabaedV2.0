// The record job's peak memory at the appendix's 100 MB limit (RP-957): makes one record whose
// appendix is 100 MB of phone photos, or 100 MB of PDFs of drawings and scans, as the record job
// makes it (job.ts: assets, Record Data, appendix, then make-pdf.ts), and reports the peak memory
// of this Node process (its maxRSS) and of Node and its Chromium processes together (sampled).
// The fixtures are made once, into a folder, with Chromium's canvas (no image library needed).
//
//   pnpm --filter @rabaed/worker exec tsx src/cli/record-memory.ts generate <folder>
//   pnpm --filter @rabaed/worker exec tsx src/cli/record-memory.ts run <folder> photos|pdfs [limit in MiB]
//
// Run each scenario in a process of its own, so one's memory is not the next one's. The sealing
// checks' veraPDF runs in its own Java process after the PDF is made, and is not counted here.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentFact } from "@rabaed/db";
import { PDFDocument, rgb } from "pdf-lib";
import { appendixOf, APPENDIX_LIMIT_BYTES } from "../record/appendix.ts";
import { documentAssets } from "../record/assets.ts";
import { expectationOf, recordProblems } from "../record/checks.ts";
import { fallbackFonts } from "../record/fonts.ts";
import { goldenFacts } from "../record/golden-fixtures.ts";
import { makeRecordPdf } from "../record/make-pdf.ts";
import { recordOf } from "../record/record-data.ts";
import { chromiumRenderer, launch } from "../record/render.ts";
import { localSealSigner } from "../record/signer.ts";
import { localTimestampAuthority } from "../record/timestamp.ts";

const MiB = 1024 * 1024;
const [mode, folder, scenario, limitMiB] = process.argv.slice(2);
/** The appendix's limit: 100 MB, or less (in MiB) to compare with a size an older maker could still make. */
const limitBytes = limitMiB ? Number(limitMiB) * MiB : APPENDIX_LIMIT_BYTES;

/** JPEGs of `width` × `height` that compress as phone photos do: smooth shapes with sensor noise. */
async function jpegs(count: number, width: number, height: number, quality: number): Promise<Buffer[]> {
  const browser = await launch({});
  try {
    const page = await (await browser.newContext()).newPage();
    const out: Buffer[] = [];
    for (let n = 0; n < count; n++) {
      // A string, not a function: tsx's compiled functions call a helper the page doesn't have.
      const url = (await page.evaluate(`(() => {
        const [w, h, q] = [${width}, ${height}, ${quality}];
        let s = ${n} * 7919 + 1;
        const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        for (let i = 0; i < 400; i++) {
          ctx.fillStyle = "hsl(" + random() * 360 + " 50% " + (30 + random() * 40) + "%)";
          ctx.beginPath();
          ctx.arc(random() * w, random() * h, 20 + random() * w * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
        const image = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < image.data.length; i += 4) {
          const d = (random() - 0.5) * 40;
          image.data[i] += d;
          image.data[i + 1] += d;
          image.data[i + 2] += d;
        }
        ctx.putImageData(image, 0, 0);
        return canvas.toDataURL("image/jpeg", q);
      })()`)) as string;
      out.push(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    }
    return out;
  } finally {
    await browser.close();
  }
}

async function generate(dir: string): Promise<void> {
  mkdirSync(join(dir, "photos"), { recursive: true });
  mkdirSync(join(dir, "pdfs"), { recursive: true });
  // Phone photos: 12 MP (4000 × 3000), about 5 MB each, past the 100 MB limit together.
  const photos = await jpegs(22, 4000, 3000, 0.9);
  photos.forEach((p, i) => writeFileSync(join(dir, "photos", `photo-${String(i + 1).padStart(2, "0")}.jpg`), p));
  // PDFs of drawings and scans: each page a scanned sheet (a 2400 × 1700 JPEG) with lines drawn over it.
  const scans = await jpegs(12, 2400, 1700, 0.85);
  for (let f = 0; f < 12; f++) {
    const pdf = await PDFDocument.create();
    for (let p = 0; p < 8; p++) {
      const page = pdf.addPage([842, 595]);
      const scan = await pdf.embedJpg(scans[(f + p) % scans.length]!);
      page.drawImage(scan, { x: 20, y: 20, width: 802, height: 555 });
      for (let l = 0; l < 200; l++) {
        page.drawLine({ start: { x: 20 + ((l * 37) % 800), y: 20 }, end: { x: 20 + ((l * 53) % 800), y: 575 }, thickness: 0.5, color: rgb(0.1, 0.1, 0.4) });
      }
    }
    writeFileSync(join(dir, "pdfs", `drawings-${String(f + 1).padStart(2, "0")}.pdf`), await pdf.save());
  }
  for (const kind of ["photos", "pdfs"]) {
    const total = readdirSync(join(dir, kind)).reduce((sum, name) => sum + statSync(join(dir, kind, name)).size, 0);
    console.log(`${kind}: ${(total / MiB).toFixed(1)} MiB`);
  }
}

/**
 * Samples the memory of this process and its descendants (Chromium's) every ~100 ms, in a
 * process of its own so a long synchronous step here does not stop it. `peak` is the highest
 * so far; `stop` ends it and returns the highest of all.
 */
function sampler(): { peak: () => Promise<number>; stop: () => Promise<number> } {
  const root = process.pid;
  const child =
    process.platform === "win32"
      ? spawn("powershell", [
          "-NoProfile",
          "-Command",
          `while ($true) { $all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize; $tree = @{${root}=$true}; do { $n = $tree.Count; foreach ($p in $all) { if ($tree.ContainsKey([int]$p.ParentProcessId)) { $tree[[int]$p.ProcessId] = $true } } } while ($tree.Count -ne $n); $sum = 0; foreach ($p in $all) { if ($tree.ContainsKey([int]$p.ProcessId)) { $sum += $p.WorkingSetSize } }; [Console]::Out.WriteLine($sum); Start-Sleep -Milliseconds 100 }`,
        ])
      : spawn("sh", [
          "-c",
          `while true; do ps -A -o pid=,ppid=,rss= | awk -v root=${root} '{p[$1]=$2; r[$1]=$3} END {t[root]=1; do {c=0; for (i in p) if ((p[i] in t) && !(i in t)) {t[i]=1; c=1}} while (c); s=0; for (i in t) s+=r[i]; print s*1024}'; sleep 0.1; done`,
        ]);
  let peak = 0;
  let buffered = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop()!;
    for (const line of lines) peak = Math.max(peak, Number(line) || 0);
  });
  // A second more, for the samples taken while this process was busy to arrive.
  const settled = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return peak;
  };
  return {
    peak: settled,
    stop: async () => {
      const highest = await settled();
      child.kill();
      return highest;
    },
  };
}

async function run(dir: string, kind: "photos" | "pdfs"): Promise<void> {
  const names = readdirSync(join(dir, kind)).sort();
  const contentType = kind === "photos" ? "image/jpeg" : "application/pdf";
  const documents: DocumentFact[] = names.map((name) => {
    const bytes = readFileSync(join(dir, kind, name));
    return {
      fileName: name,
      contentType,
      size: bytes.length,
      storageKey: `key/${name}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      fieldKey: "datasheet",
      itemKey: null,
      takenAt: null,
    };
  });
  // Read from disk at each get, as the job reads S3: the store keeps nothing in memory.
  const path = (key: string) => join(dir, kind, key.slice("key/".length));
  const files = {
    put: async () => {},
    get: async (key: string) => (key.startsWith("key/") ? new Uint8Array(readFileSync(path(key))) : null),
    sha256: async (key: string) => (key.startsWith("key/") ? createHash("sha256").update(readFileSync(path(key))).digest("hex") : null),
  };
  const facts = { ...goldenFacts("A", "en"), documents };
  const renderer = chromiumRenderer();
  const signer = await localSealSigner();
  const timestamps = await localTimestampAuthority();
  const deps = { renderer, fonts: async () => fallbackFonts(), signer: async () => signer, timestamps: async () => timestamps };

  const memory = sampler();
  const started = Date.now();
  const assets = await documentAssets(facts, files);
  const record = recordOf(facts, { code: "ABCD-EFGH", link: "https://rabaed.test/verify/x" }, assets.pageCounts, (key) => assets.images.has(key), assets.fingerprints);
  const appendix = await appendixOf(facts, files, limitBytes);
  const made = await makeRecordPdf(deps, { data: record.data, marks: record.images, images: assets.images, appendix }, new Date());
  const madeIn = (Date.now() - started) / 1000;
  const making = { node: process.resourceUsage().maxRSS * 1024, together: await memory.peak() };
  // The checks' own part in Node (checks.ts: the PDF opened, its pages and images counted, its seal
  // verified); veraPDF runs in its own process.
  const problems = await recordProblems(made.pdf, expectationOf(made.data, made.layoutPages), { validate: async () => ({ compliant: true, problems: [] }) });
  await renderer.close();
  const together = await memory.stop();

  const carried = made.data.appendix.filter((f) => f.way !== "held");
  const carriedBytes = documents.filter((d) => carried.some((f) => f.fileName === d.fileName)).reduce((sum, d) => sum + d.size, 0);
  console.log(
    JSON.stringify({
      scenario: kind,
      carried: `${carried.length} files, ${(carriedBytes / MiB).toFixed(1)} MiB`,
      pages: made.layoutPages + made.data.appendix.reduce((n, f) => n + (f.way === "pages" ? f.pageCount : 0), 0),
      pdfMiB: +(made.pdf.length / MiB).toFixed(1),
      seconds: madeIn,
      // Up to the sealed PDF (make-pdf.ts), then with the checks after it.
      makingPeakMiB: { node: Math.round(making.node / MiB), nodeAndChromium: Math.round(making.together / MiB) },
      withChecksPeakMiB: { node: Math.round((process.resourceUsage().maxRSS * 1024) / MiB), nodeAndChromium: Math.round(together / MiB) },
      problems,
    }),
  );
}

if (mode === "generate" && folder) await generate(folder);
else if (mode === "run" && folder && (scenario === "photos" || scenario === "pdfs")) await run(folder, scenario);
else {
  console.error("Usage: record-memory.ts generate <folder> | run <folder> photos|pdfs [limit in MiB]");
  process.exit(2);
}
