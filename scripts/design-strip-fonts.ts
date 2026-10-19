import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// A Claude Design HTML export carries every asset base64 in its
// `__bundler/manifest` script, fonts too: Thmanyah among them, which is licensed
// and never committed (CLAUDE.md, RP-211). This removes the font resources and
// keeps the rest; the page then falls back to the system fonts. Run it before
// committing an export: scripts/check-no-fonts.ts refuses embedded font data (RP-962).
//
// Usage: pnpm design:strip-fonts <in.html> <out.html>

type ManifestEntry = { mime?: string };

const fontMime = /^(font\/|application\/(x-)?font)/i;
const manifestScript = /(<script type="__bundler\/manifest">)([\s\S]*?)(<\/script>)/;
const extResourcesScript = /(<script type="__bundler\/ext_resources">)([\s\S]*?)(<\/script>)/;

/** The page without its font resources, and the manifest keys removed. */
export function stripFonts(page: string): { html: string; removed: string[] } {
  const manifestMatch = manifestScript.exec(page);
  if (!manifestMatch) throw new Error("This is not a Claude Design page: it has no __bundler/manifest script.");
  const manifest = JSON.parse(manifestMatch[2]!) as Record<string, ManifestEntry>;

  const removed = Object.keys(manifest).filter((uuid) => fontMime.test(manifest[uuid]!.mime ?? ""));
  if (removed.length === 0) return { html: page, removed };
  const kept = Object.fromEntries(Object.entries(manifest).filter(([uuid]) => !removed.includes(uuid)));

  // Replacer functions, so "$" in the data is never read as a replacement pattern.
  let html = page.replace(manifestScript, (_all, open: string, _json, close: string) => open + JSON.stringify(kept) + close);
  html = html.replace(extResourcesScript, (all, open: string, json: string, close: string) => {
    const resources = JSON.parse(json) as { uuid: string }[];
    const keptResources = resources.filter((resource) => !removed.includes(resource.uuid));
    if (keptResources.length === resources.length) return all;
    return open + json.replace(json.trim(), () => JSON.stringify(keptResources)) + close;
  });
  return { html, removed };
}

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: pnpm design:strip-fonts <in.html> <out.html>");
    process.exit(2);
  }
  const before = readFileSync(input, "utf8");
  const { html, removed } = stripFonts(before);
  writeFileSync(output, html);
  const kb = (text: string) => Math.round(Buffer.byteLength(text) / 1024);
  console.log(`Removed ${removed.length} font resources; ${kb(before)} KB -> ${kb(html)} KB, written to ${output}.`);
}
