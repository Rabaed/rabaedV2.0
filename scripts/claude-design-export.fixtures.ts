// A fixture the embedded-font check and design:strip-fonts tests share: a small
// bundle shaped like a Claude Design HTML export. Real exports keep every asset
// (fonts too) base64 in the `__bundler/manifest` script, keyed by uuid.
//
// The font mime types are built at run time, so this file itself never holds
// embedded font data for the check to find. The "font" bytes are plain text.

import { gzipSync } from "node:zlib";
import type { ManifestEntry } from "./design-strip-fonts.ts";

/** A font mime type, e.g. font("woff2") is the woff2 one. */
export const font = (format: string) => ["font", format].join("/");

/** A few fake bytes, base64: long enough to look like an inlined asset. */
export const fakeBase64 = Buffer.from("not a font, only test bytes").toString("base64");

/** A Claude Design export: loader, manifest, ext_resources and template script tags. */
export function claudeDesignExport(manifest: Record<string, ManifestEntry>, extResources: { id: string; uuid: string }[] = []) {
  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head><title>Export</title></head>",
    "<body>",
    '  <script>const manifest = JSON.parse(document.querySelector(\'script[type="__bundler/manifest"]\').textContent);</script>',
    `  <script type="__bundler/manifest">${JSON.stringify(manifest)}</script>`,
    '  <script type="__bundler/ext_resources">',
    JSON.stringify(extResources),
    "  </script>",
    '  <script type="__bundler/template">"<html><body>Page</body></html>"</script>',
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** A whole page nested in an export's manifest, as Claude Design writes one: base64, gzipped unless told not to (RP-1146). */
export function nestedPage(html: string, compressed = true): ManifestEntry {
  const bytes = Buffer.from(html, "utf8");
  return { mime: "text/html", compressed, data: (compressed ? gzipSync(bytes) : bytes).toString("base64") };
}
