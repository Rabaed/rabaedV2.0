// Seam 1 for the List's numbered pages and its sort on every column (RP-409, the
// owner's design; visibility.md "Search and filters"). A page of 10, 25 or 50 rows
// by number, with the total from the Stage counts; under a search no total at all,
// only whether a next page exists. Every sort, either way, lists each visible row
// once across the pages, and rows with nothing to sort by come last either way.
import { workItemSearchParams, workItemSorts, type WorkItemList, type WorkItemQueryInput } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { bilingual, buildTower, ok, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let at: Tower;
let k1: Company;
const created: string[] = [];
let approved = "";
let revise = "";
let onFloor = "";
let inZoneTwo = "";

async function list(by: Caller, query: WorkItemQueryInput): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${at.projectId}/work-items?${workItemSearchParams(query)}`), 200)).json();
}
const ids = (l: WorkItemList) => l.items.map((i) => i.id);
const total = (l: WorkItemList) => l.stages.reduce((sum, s) => sum + s.count, 0);

/** Every row of `query` as `by` reads it, page by page, and the pages' sizes. */
async function allPages(by: Caller, query: WorkItemQueryInput) {
  const rows: string[] = [];
  const sizes: number[] = [];
  for (let page = 1; ; page++) {
    const l = await list(by, { ...query, page });
    rows.push(...ids(l));
    sizes.push(l.items.length);
    expect(l.nextCursor).toBeNull();
    if (!l.page?.hasNext) break;
  }
  return { rows, sizes };
}

/** K1 verifies a submitted item and closes it with `transition`. */
async function code(id: string, transition: "approve_a" | "revise_c", manager: Caller) {
  const item = (await ok(manager.get(`/v1/work-items/${id}`), 200)).json();
  await ok(
    manager.request("PUT", `/v1/work-items/${id}/answers`, {
      answers: { ...item.answers, sample_checked: true, matches_specification: transition === "approve_a", verification_note: "Checked" },
    }),
  );
  await ok(manager.post(`/v1/work-items/${id}/claim`));
  await take(manager, id, transition, { remarks: "As noted" });
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "PGS");
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${at.projectId}/${path}`, body), 201)).json().id as string;
  const zone1 = await post("locations", { code: "Z1", name: bilingual("Zone 1"), parentId: null });
  const building1 = await post("locations", { code: "Z1B1", name: bilingual("Building 1"), parentId: zone1 });
  const floor1 = await post("locations", { code: "Z1B1F1", name: bilingual("Floor 1"), parentId: building1 });
  const zone2 = await post("locations", { code: "Z2", name: bilingual("Zone 2"), parentId: null });
  // Drafts with only their Trade: quick to make, and they share a Step entry time.
  for (let i = 0; i < 21; i++) {
    const answers = { trade: i % 2 ? at.electrical : at.mechanical, ...(i === 0 ? { location: floor1 } : i === 1 ? { location: zone2 } : {}) };
    const res = await ok(at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: "MAR", title: `Item ${String(i).padStart(2, "0")}`, answers }), 201);
    created.push(res.json().id);
  }
  onFloor = created[0]!;
  inZoneTwo = created[1]!;
  approved = await submitted(at, at.c1Engineer, at.c1Pm, "Approved cable");
  revise = await submitted(at, at.c1Engineer, at.c1Pm, "Revised cable");
  created.push(approved, revise, await submitted(at, at.c1Engineer, at.c1Pm, "Waiting cable"), await submitted(at, at.c1Engineer, at.c1Pm, "Another cable"));
  await code(approved, "approve_a", at.k1Manager);
  await code(revise, "revise_c", at.k1Manager);
});

describe("the Member's own columns (Save as my default)", () => {
  const path = () => `/v1/projects/${at.projectId}/modules/submittals/work-items/list/columns`;
  const mine = [
    { key: "owner", shown: true },
    { key: "stepAge", shown: true },
    { key: "revision", shown: false },
  ];

  it("start as the design's, and are kept for the Member who saved them, the locked columns first", async () => {
    expect((await list(at.c1Engineer, { page: 1 })).columnLayout).toBeUndefined();
    const saved = (await ok(at.c1Engineer.request("PUT", path(), mine), 200)).json();
    expect(saved.slice(0, 3)).toEqual([
      { key: "documentNumber", shown: true },
      { key: "subject", shown: true },
      { key: "owner", shown: true },
    ]);
    expect((await list(at.c1Engineer, { page: 1 })).columnLayout).toEqual(saved);
  });

  it("are nobody else's: a colleague and another Company still see the design's", async () => {
    expect((await list(at.c1Pm, { page: 1 })).columnLayout).toBeUndefined();
    expect((await list(at.k1Manager, { page: 1 })).columnLayout).toBeUndefined();
  });

  it("refuse a column twice, or one that isn't the List's", async () => {
    expect((await at.c1Engineer.request("PUT", path(), [...mine, { key: "owner", shown: false }])).statusCode).toBe(400);
    expect((await at.c1Engineer.request("PUT", path(), [{ key: "dueDate", shown: true }])).statusCode).toBe(400);
  });

  it("are not found on a Project the Member isn't on", async () => {
    const stranger = await api.authorizedPerson();
    expect((await stranger.caller.request("PUT", path(), mine)).statusCode).toBe(404);
  });
});

describe("numbered pages", () => {
  it("pages 10 rows at a time, each row once, and says when there is a next page", async () => {
    const { rows, sizes } = await allPages(at.c1Engineer, { pageSize: 10 });
    expect(sizes).toEqual([10, 10, 5]);
    expect([...rows].sort()).toEqual([...created].sort());
    const first = await list(at.c1Engineer, { page: 1, pageSize: 10 });
    expect(first.page).toEqual({ number: 1, size: 10, hasNext: true });
    expect(total(first)).toBe(25);
  });

  it("opens any page by its number, the last too, and one past the end is empty", async () => {
    const last = await list(at.c1Engineer, { page: 3, pageSize: 10 });
    expect(last.items).toHaveLength(5);
    expect(last.page?.hasNext).toBe(false);
    const past = await list(at.c1Engineer, { page: 9, pageSize: 10 });
    expect(past.items).toEqual([]);
    expect(past.page?.hasNext).toBe(false);
  });

  it("holds 50 rows a page when no size is given", async () => {
    expect((await list(at.c1Engineer, { page: 1 })).page).toEqual({ number: 1, size: 50, hasNext: false });
  });

  it("under a search, counts no more than the page shows: no total reaches the client", async () => {
    const first = await list(at.c1Engineer, { q: "Item", page: 1, pageSize: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.page?.hasNext).toBe(true);
    // The Stage counts are the page's own rows, never the 21 matches.
    expect(total(first)).toBe(10);
    expect(JSON.stringify(first)).not.toMatch(/"(total|count)":21\b/);
    const third = await list(at.c1Engineer, { q: "Item", page: 3, pageSize: 10 });
    expect(third.items).toHaveLength(1);
    expect(total(third)).toBe(1);
    expect(third.page?.hasNext).toBe(false);
  });
});

describe("Export (the rows the viewer reads, with the List's filters)", () => {
  const exported = async (by: Caller, query: WorkItemQueryInput, project = at.projectId) =>
    (await ok(by.get(`/v1/projects/${project}/modules/submittals/work-items/export?${workItemSearchParams(query)}`), 200)).json() as {
      items: WorkItemList["items"];
    };

  it("gives every matching row, not only the page, in the List's order", async () => {
    const all = await exported(at.c1Engineer, { sort: "subject", page: 1, pageSize: 10 });
    expect(all.items).toHaveLength(created.length);
    expect(all.items.map((i) => i.title)).toEqual((await list(at.c1Engineer, { sort: "subject", page: 1 })).items.map((i) => i.title));
    expect((await exported(at.c1Engineer, { stage: ["draft"] })).items).toHaveLength(21);
  });

  it("under a search, gives only the pages read so far, and no total", async () => {
    const two = await exported(at.c1Engineer, { q: "Item", page: 2, pageSize: 10 });
    expect(two.items).toHaveLength(20);
    expect(Object.keys(two)).toEqual(["items"]);
    expect((await exported(at.c1Engineer, { q: "Item", page: 1, pageSize: 10 })).items).toHaveLength(10);
  });

  it("names owners as V14 has it: the Consultant's own person to the Consultant, its Company only to the Contractor", async () => {
    const waiting = created.at(-2)!;
    await ok(at.k1Manager.post(`/v1/work-items/${waiting}/claim`));
    const forK1 = (await exported(at.k1Manager, {})).items.find((i) => i.id === waiting)!;
    const forC1 = (await exported(at.c1Engineer, {})).items.find((i) => i.id === waiting)!;
    expect(forK1.with).toMatchObject({ kind: "own", claimer: { isMe: true } });
    expect(forC1.with?.kind).toBe("company");
    expect(JSON.stringify(forC1)).not.toMatch(/claimer/);
    // The Creation Date is the raiser's own: the Consultant reads none.
    expect(forK1.creationDate).toBeNull();
    expect(forC1.creationDate).not.toBeNull();
  });

  it("gives another Company only what it sees: never the Contractor's Drafts or internal review", async () => {
    const forK1 = await exported(at.k1Manager, {});
    expect(forK1.items.map((i) => i.title).some((t) => t.startsWith("Item"))).toBe(false);
    expect(forK1.items.every((i) => i.submissionDate !== null)).toBe(true);
  });

  it("is not found on a Project the Member isn't on", async () => {
    const stranger = await api.authorizedPerson();
    expect((await stranger.caller.get(`/v1/projects/${at.projectId}/modules/submittals/work-items/export`)).statusCode).toBe(404);
  });
});

describe("every column's sort", () => {
  for (const sort of workItemSorts) {
    for (const dir of ["asc", "desc"] as const) {
      it(`lists each row once across the pages (${sort}, ${dir})`, async () => {
        const { rows } = await allPages(at.c1Engineer, { sort, dir, pageSize: 10 });
        expect(rows).toHaveLength(created.length);
        expect(new Set(rows).size).toBe(created.length);
      });
    }
  }

  it("sorts by Subject A to Z, or Z to A", async () => {
    const titles = async (dir: "asc" | "desc") =>
      (await list(at.c1Engineer, { sort: "subject", dir, page: 1, pageSize: 50 })).items.map((i) => i.title).filter((t) => t.startsWith("Item"));
    const expected = Array.from({ length: 21 }, (_, i) => `Item ${String(i).padStart(2, "0")}`);
    expect(await titles("asc")).toEqual(expected);
    expect(await titles("desc")).toEqual([...expected].reverse());
  });

  it("puts rows with nothing to sort by last, either way: open items have no Code", async () => {
    const asc = ids(await list(at.c1Engineer, { sort: "outcome", dir: "asc", page: 1 }));
    const desc = ids(await list(at.c1Engineer, { sort: "outcome", dir: "desc", page: 1 }));
    expect(asc.slice(0, 2)).toEqual([approved, revise]);
    expect(desc.slice(0, 2)).toEqual([revise, approved]);
  });

  it("sorts by a level of the Location tree: only an item with a place at that level comes first", async () => {
    for (const dir of ["asc", "desc"] as const) {
      expect(ids(await list(at.c1Engineer, { sort: "locationLevel3", dir, page: 1 }))[0]).toBe(onFloor);
    }
    // Zone 1 (the floor's) before Zone 2, in the Project's order of Locations; Building A, made first, before both.
    const level1 = ids(await list(at.c1Engineer, { sort: "locationLevel1", page: 1 }));
    expect(level1.indexOf(onFloor)).toBeLessThan(level1.indexOf(inZoneTwo));
    expect(level1.indexOf(approved)).toBeLessThan(level1.indexOf(onFloor));
  });

  it("refuses a cursor with a numbered page, or with a sort no cursor pages", async () => {
    const res = await at.c1Engineer.get(`/v1/projects/${at.projectId}/work-items?sort=subject&cursor=x`);
    expect(res.statusCode).toBe(400);
  });
});
