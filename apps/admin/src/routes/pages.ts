import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";

// Rabaed Admin's screens: static pages and their scripts and styles, which call the JSON
// API above. Read once at start; nothing in them is per request. The home page is plain
// script; the Workflows page (RP-443) is the builder from @rabaed/ui, built by `vite build`
// into dist/ (the admin image builds it; `pnpm dev` builds it first).
const file = (name: string) => readFileSync(new URL(`../pages/${name}`, import.meta.url), "utf8");
const types: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
};

type Page = { body: string | Buffer; type: string };
const pages: Record<string, Page> = {
  "/": { body: file("index.html"), type: "text/html; charset=utf-8" },
  "/workflows": { body: file("workflows.html"), type: "text/html; charset=utf-8" },
  "/assets/admin.js": { body: file("admin.js"), type: types[".js"]! },
  "/assets/admin.css": { body: file("admin.css"), type: types[".css"]! },
};

/** Every file the build wrote to dist/, by the path it is served at. */
function builtAssets(dir: string): Record<string, Page> {
  if (!existsSync(dir)) return {};
  const found: Record<string, Page> = {};
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (types[extname(entry.name)]) found[`/assets/${relative(dir, path).split("\\").join("/")}`] = { body: readFileSync(path), type: types[extname(entry.name)]! };
    }
  };
  walk(dir);
  return found;
}

export const pageRoutes = (): FastifyPluginAsync => async (app) => {
  const built = builtAssets(fileURLToPath(new URL("../../dist", import.meta.url)));
  for (const [path, page] of Object.entries({ ...built, ...pages })) {
    app.get(path, async (_request, reply) => reply.type(page.type).header("cache-control", "no-cache").send(page.body));
  }
};
