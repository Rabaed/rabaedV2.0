// Seam 1: Home for the demo people (RP-407 acceptance; visibility.md "Home
// across Projects", scenarios RP-407-1 and RP-407-6). Hafiz, Mohammed, Yousef
// and Faisal each see on Home only what their own per-Project reads show them:
// the counts are the sums of their Projects page's counts, every row is one of
// their List's, and Beta Build never meets a TMC item.
import { workItemSearchParams, type Home, type ProjectSummary, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, DEFAULT_PASSWORD, type Caller } from "./support/harness.ts";
import { ok } from "./support/tower.ts";

const api = await createTestApi();
afterAll(() => api.close());

const demo = {
  hafiz: "hafiz.hamdan@tmc.demo.rabaed.test",
  mohammed: "mohammed.alshamsi@designconsultants.demo.rabaed.test",
  yousef: "yousef.karim@betabuild.demo.rabaed.test",
  faisal: "faisal.alotaibi@alwaha.demo.rabaed.test",
  nasser: "nasser.aldosari@betabuild.demo.rabaed.test",
} as const;
type Who = keyof typeof demo;
const people: Partial<Record<Who, Caller>> = {};
const as = (who: Who) => people[who]!;

beforeAll(async () => {
  for (const who of Object.keys(demo) as Who[]) people[who] = await api.signIn(demo[who], DEFAULT_PASSWORD);
});

async function home(by: Caller): Promise<Home & { body: string }> {
  const res = await ok(by.get("/v1/home"), 200);
  return { ...(res.json() as Home), body: res.body };
}

/** Every item of a Project's List, all Revisions, as `by` sees it. */
async function everything(by: Caller, projectId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page: WorkItemList = (
      await ok(by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams({ allRevisions: true, ...(cursor ? { cursor } : {}) })}`), 200)
    ).json();
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return ids;
}

describe("Home for the demo people", () => {
  it.each(["hafiz", "mohammed", "yousef", "faisal", "nasser"] as const)("%s: counts are the sums of his own Projects', every row one he can list", async (who) => {
    const h = await home(as(who));
    const cards: ProjectSummary[] = (await ok(as(who).get("/v1/projects"), 200)).json().projects;
    expect(h.projects).toEqual(cards);
    expect(h.counts.activeProjects).toBe(cards.filter((p) => p.status === "active").length);
    expect(h.counts.needMyAction).toBe(cards.reduce((n, p) => n + p.needMyAction, 0));
    const mine = new Map<string, string[]>();
    for (const p of cards) mine.set(p.id, await everything(as(who), p.id));
    for (const row of h.needsMyAction) expect(mine.get(row.project.id)).toContain(row.id);
    for (const entry of h.activity) expect(mine.get(entry.project.id)).toContain(entry.workItem.id);
  });

  it("Yousef (Beta Build) never meets a TMC item; Nasser sees only Jeddah Corniche Villas (RP-407-1, RP-407-6)", async () => {
    const hafizProjects: ProjectSummary[] = (await ok(as("hafiz").get("/v1/projects"), 200)).json().projects;
    const tower = hafizProjects.find((p) => p.code === "TWR")!;
    const tmcItems = await everything(as("hafiz"), tower.id);
    expect(tmcItems.length).toBeGreaterThan(0);
    const yousef = await home(as("yousef"));
    for (const id of tmcItems) expect(yousef.body).not.toContain(id);
    const nasser = await home(as("nasser"));
    expect(nasser.projects.map((p) => p.code)).toEqual(["JCV"]);
    expect(nasser.body).not.toContain(tower.id);
  });
});
