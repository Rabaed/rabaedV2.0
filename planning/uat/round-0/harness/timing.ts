// node planning/uat/round-0/harness/timing.ts
//
// Times the pages the Round 0 runs saw turn into the not-found page under load:
// Home, the Submittals List and Kanban, and the Snag List, as Ali and Hafiz, three
// loads each, and says whether each load showed the not-found page.

import { closeBrowser, closeContexts, pageAs } from "./browser.ts";
import { go, openProject } from "./helpers.ts";

const people = ["ali", "hafiz"];
for (const person of people) {
  const { page } = await pageAs(person);
  const projectId = await openProject(page);
  const routes = [
    ["Home", "/"],
    ["Submittals List", `/projects/${projectId}/work-items?view=list`],
    ["Submittals Kanban", `/projects/${projectId}/work-items?view=kanban`],
    ["Snag List", `/projects/${projectId}/snag-list`],
  ];
  for (const [name, path] of routes) {
    const runs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      await go(page, path);
      const ms = Date.now() - t;
      const notFound = (await page.locator('[data-testid="not-found"]').count()) > 0;
      const failed = (await page.getByText(/couldn.t be loaded/i).count()) > 0;
      runs.push(`${(ms / 1000).toFixed(1)}s${notFound ? " NOT-FOUND" : failed ? " FAILED" : ""}`);
    }
    console.log(`${person.padEnd(6)} ${name.padEnd(18)} ${runs.join("  ")}`);
  }
}
await closeContexts();
await closeBrowser();
