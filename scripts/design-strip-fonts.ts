import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isFontMime } from "./check-no-fonts.ts";

// A Claude Design HTML export carries every asset base64 in its
// `__bundler/manifest` script, fonts too: Thmanyah among them, which is licensed
// and never committed (CLAUDE.md, RP-211). This removes the font resources and
// keeps the rest; the page then falls back to the system fonts. Run it before
// committing an export: scripts/check-no-fonts.ts refuses embedded font data (RP-962).
//
// The template's @font-face rules keep their src: url(<uuid>) for a removed font.
// That is fine: the loader swaps in only the uuids still in the manifest, so the
// url resolves to nothing and the browser uses the next font in the stack.
//
// Usage: pnpm design:strip-fonts <in.html> <out.html>

/** One asset in a Claude Design manifest, keyed by uuid. */
export type ManifestEntry = { mime: string; compressed?: boolean; data: string };

// The opening tag may carry more attributes than its type.
const manifestScript = /(<script\b[^>]*\btype="__bundler\/manifest"[^>]*>)([\s\S]*?)(<\/script>)/;
const extResourcesScript = /(<script\b[^>]*\btype="__bundler\/ext_resources"[^>]*>)([\s\S]*?)(<\/script>)/;

/** JSON safe inside a script element: no "<" to start a "</script>" with. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** The page without its font resources, and the manifest keys removed. */
export function stripFonts(page: string): { html: string; removed: string[] } {
  const manifestMatch = manifestScript.exec(page);
  if (!manifestMatch) throw new Error("This is not a Claude Design page: it has no __bundler/manifest script.");
  const manifest = JSON.parse(manifestMatch[2]!) as Record<string, ManifestEntry>;

  const removed = Object.keys(manifest).filter((uuid) => isFontMime(manifest[uuid]!.mime ?? ""));
  if (removed.length === 0) return { html: page, removed };
  const kept = Object.fromEntries(Object.entries(manifest).filter(([uuid]) => !removed.includes(uuid)));

  // Replacer functions, so "$" in the data is never read as a replacement pattern.
  let html = page.replace(manifestScript, (_all, open: string, _json, close: string) => open + scriptJson(kept) + close);
  html = html.replace(extResourcesScript, (all, open: string, json: string, close: string) => {
    const resources = JSON.parse(json) as { uuid: string }[];
    const keptResources = resources.filter((resource) => !removed.includes(resource.uuid));
    if (keptResources.length === resources.length) return all;
    return open + json.replace(json.trim(), () => scriptJson(keptResources)) + close;
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
