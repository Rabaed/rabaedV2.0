// Seam 1 for the UAT tool's `uat:age` (RP-922, tests 3 and 4) through the api: after an item is moved
// back, every reader of Step Age follows it, since they all read app.step_as_seen: the List's row, its
// `stepAgeMin` filter and its Step Age order paged by cursor, and Home's "4+ weeks". The Creation Date
// moves with the item; the raiser's Participant reads no answer or Document time earlier than it, and
// another Company still reads no Creation Date (visibility.md "Creation Date"). The tool writes as the
// migrator (packages/db/dev-tools); everything here is read through the api.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type DocumentList, type Home, type WorkItemList, type WorkItemQueryInput } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ageChanges, ageItems, findAgeCandidates } from "../../../packages/db/dev-tools/index.ts";
import { createTestApi, type Caller } from "./support/harness.ts";
import { buildTower, detail, inInternalReview, ok, submitted, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let tw: Tower;

/** `uat:age --item <number> --weeks <weeks>`, as the CLI runs it. */
async function age(number: string, weeks: number): Promise<void> {
  const changes = ageChanges({ items: [number], weeks }, await findAgeCandidates(migrator, [number]), new Date());
  if ("errors" in changes) throw new Error(changes.errors.join("; "));
  await ageItems(migrator, changes.items, { dryRun: false });
}

/** What the database holds: the migrator reads every column. */
async function recorded(id: string) {
  const { rows } = await sql<{ document_number: string; numbered_at: Date; submitted_at: Date | null }>`
    select document_number, numbered_at, submitted_at from work_item where id = ${id}::uuid`.execute(migrator);
  return rows[0]!;
}

async function list(by: Caller, query: WorkItemQueryInput = {}): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${tw.projectId}/work-items?${workItemSearchParams(query)}`), 200)).json();
}
const ids = (l: WorkItemList) => l.items.map((i) => i.id);

/** Every page of the List in its Step Age order (the oldest first), read cursor by cursor. */
async function everyPage(by: Caller): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 20; pages++) {
    const page = await list(by, { sort: "stepAge", ...(cursor ? { cursor } : {}) });
    out.push(...ids(page));
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
  throw new Error("more than 20 pages");
}

const home = async (by: Caller): Promise<Home> => (await ok(by.get("/v1/home"), 200)).json();

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  tw = await buildTower(api, { c1, k1 }, "UAG");
});

describe("Step Age through the api after uat:age (test 3)", () => {
  let four = "";
  let three = "";
  let fresh = "";
  let longAtStepBefore = 0;

  beforeAll(async () => {
    four = await submitted(tw, tw.c1Engineer, tw.c1Pm, "Aged to four");
    three = await submitted(tw, tw.c1Engineer, tw.c1Pm, "Aged to three");
    fresh = await submitted(tw, tw.c1Engineer, tw.c1Pm, "Not aged");
    longAtStepBefore = (await home(tw.k1Manager)).counts.longAtStep;
    await age((await recorded(four)).document_number, 4);
    await age((await recorded(three)).document_number, 3);
  });

  it("the holder's List row reads Step Age 4, and so does the raiser's: moved alike", async () => {
    const row = async (by: Caller, id: string) => (await list(by)).items.find((i) => i.id === id)!;
    expect((await row(tw.k1Manager, four)).stepAgeWeeks).toBe(4);
    expect((await row(tw.k1Manager, three)).stepAgeWeeks).toBe(3);
    expect((await row(tw.k1Manager, fresh)).stepAgeWeeks).toBe(1);
    expect((await row(tw.c1Engineer, four)).stepAgeWeeks).toBe(4);
  });

  it("stepAgeMin 4 lists the item at Step Age 4 and not the one at 3; stepAgeMin 3 lists both", async () => {
    const atFour = ids(await list(tw.k1Manager, { stepAgeMin: 4 }));
    expect(atFour).toContain(four);
    expect(atFour).not.toContain(three); // not hidden-from: K1 sees it; it is at Step Age 3
    expect(atFour).not.toContain(fresh); // not hidden-from: K1 sees it; it is at Step Age 1
    const atThree = ids(await list(tw.k1Manager, { stepAgeMin: 3 }));
    expect(atThree).toEqual(expect.arrayContaining([four, three]));
    expect(atThree).not.toContain(fresh); // not hidden-from: K1 sees it; it is at Step Age 1
  });

  it("the cursor pages them oldest first, each once", async () => {
    const pages = await everyPage(tw.k1Manager);
    const ours = pages.filter((id) => [four, three, fresh].includes(id));
    expect(ours).toEqual([four, three, fresh]);
  });

  it("Home's 4+ weeks count rises by one for the holder's Company", async () => {
    expect((await home(tw.k1Manager)).counts.longAtStep).toBe(longAtStepBefore + 1);
  });
});

describe("the Creation Date after uat:age (test 4)", () => {
  it("moves with the item; its raiser reads no answer or Document time earlier than it", async () => {
    const id = await inInternalReview(tw, tw.c1Engineer, "Aged in internal review");
    await ok(tw.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    const before = await recorded(id);
    await age(before.document_number, 4);
    const after = await recorded(id);
    expect(after.numbered_at.getTime()).toBeLessThan(before.numbered_at.getTime());

    const read = await detail(tw.c1Pm, id);
    expect(read.creationDate).toBe(after.numbered_at.toISOString());
    const creation = Date.parse(read.creationDate!);
    const { documents } = (await ok(tw.c1Pm.get(`/v1/work-items/${id}/documents`), 200)).json() as DocumentList;
    const times = [...Object.values(read.fieldTimes).map((t) => t.at), ...documents.map((d) => d.uploadedAt)];
    expect(times.length).toBeGreaterThan(0);
    for (const at of times) expect(Date.parse(at)).toBeGreaterThanOrEqual(creation);
  });

  it("another Company reads the moved Submission Date and still no Creation Date", async () => {
    const id = await submitted(tw, tw.c1Engineer, tw.c1Pm, "Aged at K1");
    await age((await recorded(id)).document_number, 4);
    const read = await detail(tw.k1Manager, id);
    expect(read.creationDate).toBeNull();
    expect(read.submissionDate).toBe((await recorded(id)).submitted_at!.toISOString());
    expect((await detail(tw.c1Engineer, id)).creationDate).toBe((await recorded(id)).numbered_at.toISOString());
  });
});
