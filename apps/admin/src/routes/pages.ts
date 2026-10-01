import { readFileSync } from "node:fs";
import type { FastifyPluginAsync } from "fastify";

// Rabaed Admin's screens: one static page and its script and styles, which
// call the JSON API above. Read once at start; nothing in them is per request.
const file = (name: string) => readFileSync(new URL(`../pages/${name}`, import.meta.url), "utf8");
const pages = {
  "/": { body: file("index.html"), type: "text/html; charset=utf-8" },
  "/assets/admin.js": { body: file("admin.js"), type: "text/javascript; charset=utf-8" },
  "/assets/admin.css": { body: file("admin.css"), type: "text/css; charset=utf-8" },
};

export const pageRoutes = (): FastifyPluginAsync => async (app) => {
  for (const [path, page] of Object.entries(pages)) {
    app.get(path, async (_request, reply) => reply.type(page.type).header("cache-control", "no-cache").send(page.body));
  }
};
