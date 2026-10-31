import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePage, encodePage, isFontMime, isNestedPage, type Manifest, type ManifestEntry, manifestOf, manifestScript } from "./check-no-fonts.ts";

// A Claude Design HTML export carries every asset base64 in its
// `__bundler/manifest` script, fonts too: Thmanyah among them, which is licensed
// and never committed (CLAUDE.md, RP-211). This removes the font resources and
// keeps the rest; the page then falls back to the system fonts. Run it before
// committing an export: scripts/check-no-fonts.ts refuses embedded font data (RP-962).
//
// An export can nest whole other exports as text/html manifest entries, each with
// its own fonts (RP-1146): those are decoded, stripped the same way and encoded
// again as they were (gzipped when compressed). A nested page that loses nothing
// is left byte for byte.
//
// The template's @font-face rules keep their src: url(<uuid>) for a removed font.
// That is fine: the loader swaps in only the uuids still in the manifest, so the
// url resolves to nothing and the browser uses the next font in the stack.
//
// Usage: pnpm design:strip-fonts <in.html> <out.html>

export type { ManifestEntry };

const extResourcesScript = /(<script\b[^>]*\btype="__bundler\/ext_resources"[^>]*>)([\s\S]*?)(<\/script>)/;

/** JSON safe inside a script element: no "<" to start a "</script>" with. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * The page without its font resources, nested pages' included, and the manifest
 * keys removed: a nested page's as "<page uuid>/<font uuid>".
 */
export function stripFonts(page: string): Stripped {
  const stripped = stripPage(page);
  if (!stripped) throw new Error("This is not a Claude Design page: it has no __bundler/manifest script holding JSON.");
  return stripped;
}

type Stripped = { html: string; removed: string[] };

/** A page and every page it nests without their fonts; undefined for a page with no manifest, which is left as it is. */
function stripPage(page: string): Stripped | undefined {
  const manifest = manifestOf(page);
  if (!manifest) return undefined;

  const removed: string[] = [];
  const kept: Manifest = {};
  for (const [uuid, entry] of Object.entries(manifest)) {
    if (isFontMime(entry.mime ?? "")) {
      removed.push(uuid);
      continue;
    }
    const nested = isNestedPage(entry) ? stripPage(decodePage(uuid, entry)) : undefined;
    if (nested && nested.removed.length > 0) {
      kept[uuid] = { ...entry, data: encodePage(nested.html, entry) };
      removed.push(...nested.removed.map((key) => `${uuid}/${key}`));
    } else {
      kept[uuid] = entry;
    }
  }
  if (removed.length === 0) return { html: page, removed };

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
