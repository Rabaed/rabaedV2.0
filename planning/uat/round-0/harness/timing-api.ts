// node planning/uat/round-0/harness/timing-api.ts
//
// Times the api reads behind Home, the Submittals List and the Snag List, as Ali,
// through the web's /api/v1 proxy (no 3-second limit there), and reports how many
// items the Project holds, so a Bug can say how slow at what size.

import { closeBrowser, closeContexts } from "./browser.ts";
import { Api, projectIdOf } from "./helpers.ts";

const api = await Api.as("ali");
const projectId = await projectIdOf(api);
const paths = [
  ["GET /v1/home", "/home"],
  ["GET submittals List", `/projects/${projectId}/modules/submittals/work-items`],
  ["GET submittals Kanban", `/projects/${projectId}/modules/submittals/work-items?view=kanban`],
  ["GET Snag List", `/projects/${projectId}/modules/snag_list/work-items`],
];
for (const [name, path] of paths) {
  const runs: string[] = [];
  let size = 0;
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    const r = await api.get(path);
    runs.push(`${((Date.now() - t) / 1000).toFixed(2)}s ${r.status}`);
    size = r.text.length;
  }
  console.log(`${name.padEnd(22)} ${runs.join("  ")}  (${Math.round(size / 1024)} KB)`);
}
const all = await api.get(`/projects/${projectId}/modules/submittals/work-items?limit=1`);
const body = all.body as Record<string, unknown>;
console.log("List answer keys:", Object.keys(body ?? {}).join(", "), JSON.stringify(body?.["stageCounts"] ?? body?.["counts"] ?? body?.["total"] ?? "").slice(0, 400));
await closeContexts();
await closeBrowser();
