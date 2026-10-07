// Seam 1 for the Submission Date and Creation Date in the List (RP-348, spec
// RP-344; visibility.md "Creation Date" and scenario 61 through the List).
// Everyone who sees an item reads its Submission Date; only the raiser's
// Participant reads its Creation Date; when the Draft was started reaches
// nobody. An item not yet Submitted has no Submission Date and is left out of
// any date range. Sorting by Submission Date pages with the cursor.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { decodeWorkItemCursor, workItemSearchParams, type WorkItemBoard, type WorkItemList, type WorkItemQueryInput, type WorkItemRow } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, DEFAULT_PASSWORD, type Caller } from "./support/harness.ts";
import { all, bilingual, memberOnProject, ok, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const DAY = 86_400_000;
const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};

let c1: Company;
let c1Engineer: Caller;
let c1Pm: Caller;
let k1Engineer: Caller;
let projectId = "";
const emails = new Map<Caller, string>();

async function memberWithEmail(...args: Parameters<typeof memberOnProject>) {
  const { caller, email } = await memberOnProject(...args);
  emails.set(caller, email);
  return caller;
}

/** Moves the clock, signing every Member in again: it ends their sessions. */
async function later(ms: number) {
  api.advanceClock(ms);
  for (const [caller, email] of emails) caller.useSessionToken((await api.signIn(email, DEFAULT_PASSWORD)).sessionToken);
}

async function list(by: Caller, query: WorkItemQueryInput = {}, project = projectId): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${project}/work-items?${workItemSearchParams(query)}`), 200)).json();
}
const ids = (l: WorkItemList) => l.items.map((i) => i.id);
const row = (l: WorkItemList, id: string): WorkItemRow => l.items.find((i) => i.id === id)!;

/** What the database recorded: the migrator reads every column. */
async function recorded(id: string) {
  const { rows } = await sql<{ created_at: Date; numbered_at: Date | null; submitted_at: Date | null }>`
    select created_at, numbered_at, submitted_at from work_item where id = ${id}::uuid
  `.execute(migrator);
  const r = rows[0]!;
  return { createdAt: r.created_at.toISOString(), numberedAt: r.numbered_at?.toISOString() ?? null, submittedAt: r.submitted_at?.toISOString() ?? null };
}

/** The Saudi calendar day of a time, as the filter takes it. */
const saudiDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date(iso));

async function draft(by: Caller, project: string, title: string, tradeId: string, locationId: string): Promise<string> {
  const res = await ok(
    by.post(`/v1/projects/${project}/work-items`, { type: "MAR", title, answers: { ...complete, trade: tradeId, location: locationId } }),
    201,
  );
  const id = res.json().id as string;
  await attachDatasheet(by, id);
  return id;
}

async function setUpProject(): Promise<{ project: string; tradeId: string; locationId: string; own: string }> {
  const project = (await api.createProject(c1.caller)).id;
  const tradeId = (await ok(c1.caller.post(`/v1/projects/${project}/trades`, { code: "EL", name: bilingual("Electrical") }), 201)).json().id;
  const locationId = (
    await ok(c1.caller.post(`/v1/projects/${project}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }), 201)
  ).json().id;
  const own = (await c1.caller.get(`/v1/projects/${project}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  return { project, tradeId, locationId, own };
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  emails.set(c1.caller, c1.company.authorizedPerson.email);
});

describe("Submission Date and Creation Date in the List (scenario 61)", () => {
  let first = ""; // Numbered on day 2, Submitted on day 12.
  let second = ""; // Numbered on day 2, Submitted on day 20.
  let numbered = ""; // Numbered, not Submitted: still in C1's internal review.
  let started = ""; // A Draft with no number yet.
  let firstSubmitted = "";
  let secondSubmitted = "";

  beforeAll(async () => {
    const { project, tradeId, locationId, own } = await setUpProject();
    projectId = project;
    c1Engineer = await memberWithEmail(api, c1, own, ["engineer"]);
    c1Pm = await memberWithEmail(api, c1, own, ["project_manager"]);
    const k1Company = await api.authorizedPerson();
    const k1 = await api.addParticipant(c1.caller, project, k1Company.company, "consultant");
    await ok(c1.caller.request("PUT", `/v1/participants/${k1}/visibility`, { trade: all, location: all }));
    k1Engineer = await memberWithEmail(api, k1Company, k1, ["engineer"]);
    await memberWithEmail(api, k1Company, k1, ["manager"]); // holds the review Step, so Submit has somewhere to go
    first = await draft(c1Engineer, project, "Fixtures", tradeId, locationId);
    second = await draft(c1Engineer, project, "Switchboards", tradeId, locationId);
    numbered = await draft(c1Engineer, project, "Busbars", tradeId, locationId);
    started = await draft(c1Engineer, project, "Cables", tradeId, locationId);
    await later(2 * DAY);
    for (const id of [first, second, numbered]) await take(c1Engineer, id, "send_for_review");
    await later(10 * DAY);
    await ok(c1Pm.post(`/v1/work-items/${first}/claim`));
    await take(c1Pm, first, "submit");
    await later(8 * DAY);
    await ok(c1Pm.post(`/v1/work-items/${second}/claim`));
    await take(c1Pm, second, "submit");
    firstSubmitted = (await recorded(first)).submittedAt!;
    secondSubmitted = (await recorded(second)).submittedAt!;
  });

  it("gives the raiser's Company both dates and another Company the Submission Date only", async () => {
    const mine = await list(c1Engineer);
    const r = await recorded(first);
    expect(row(mine, first)).toMatchObject({ submissionDate: r.submittedAt, creationDate: r.numberedAt });
    expect(r.numberedAt).not.toBe(r.submittedAt);
    const theirs = await list(k1Engineer);
    expect(row(theirs, first)).toMatchObject({ submissionDate: r.submittedAt, creationDate: null });
    expect(row(theirs, second)).toMatchObject({ submissionDate: secondSubmitted, creationDate: null });
    // K1 sees only what was Submitted.
    expect(ids(theirs).sort()).toEqual([first, second].sort());
  });

  it("leaves the Submission Date empty until the first Submit, and the Creation Date until it has a number", async () => {
    const mine = await list(c1Engineer);
    expect(row(mine, numbered)).toMatchObject({ submissionDate: null, creationDate: (await recorded(numbered)).numberedAt });
    expect(row(mine, started)).toMatchObject({ submissionDate: null, creationDate: null });
  });

  it("returns no row the time the Draft was started, to anyone", async () => {
    for (const by of [c1Engineer, c1Pm, k1Engineer]) {
      for (const query of [{}, { allRevisions: true }, { sort: "submissionDate" } as const]) {
        // Every field, stepEnteredAt too: a Draft with no number shows no Step.
        const json = JSON.stringify(await list(by, query));
        for (const id of [first, second, numbered, started]) expect(json, id).not.toContain((await recorded(id)).createdAt);
      }
    }
  });

  it("shows no Step or Step Age for a Draft with no number, in the List, the Kanban or the item's page", async () => {
    const detailOf = async (by: Caller, id: string) => (await ok(by.get(`/v1/work-items/${id}`), 200)).json();
    expect(row(await list(c1Engineer), started)).toMatchObject({ stepEnteredAt: null, stepAgeWeeks: null });
    expect(await detailOf(c1Engineer, started)).toMatchObject({ stepEnteredAt: null, stepAgeWeeks: null });
    const cards = ((await ok(c1Engineer.get(`/v1/projects/${projectId}/work-items/kanban`), 200)).json() as WorkItemBoard).columns.flatMap((c) =>
      c.lanes.flatMap((l) => l.cards),
    );
    expect(cards.find((c) => c.id === started)).toMatchObject({ stepEnteredAt: null, stepAgeWeeks: null });
    // Once numbered, it has its Step Age as before.
    expect(row(await list(c1Engineer), numbered).stepAgeWeeks).toBeGreaterThan(0);
    expect(cards.find((c) => c.id === numbered)!.stepEnteredAt).not.toBeNull();
    expect((await detailOf(c1Engineer, numbered)).stepAgeWeeks).toBeGreaterThan(0);
    // Nowhere on the board is the time it was started. (The item's page lists when its own answers were saved, the Member's
    // per-field times, which is a separate feature, so only its Step fields are checked there.)
    expect(JSON.stringify(cards)).not.toContain((await recorded(started)).createdAt);
  });

  it("never matches a Step Age filter for a Draft with no number", async () => {
    // Three weeks on, the numbered item is in its 3rd week at its Step; the Draft has no Step Age to match.
    expect(ids(await list(c1Engineer, { stepAgeMin: 2 }))).toContain(numbered);
    for (const stepAgeMin of [1, 2, 3, 4] as const) expect(ids(await list(c1Engineer, { stepAgeMin }))).not.toContain(started);
  });

  it("filters by Submission Date, both days included, and leaves out an item not yet Submitted", async () => {
    const [from, to] = [saudiDay(firstSubmitted), saudiDay(secondSubmitted)];
    expect(from).not.toBe(to);
    expect(ids(await list(c1Engineer, { submittedFrom: from })).sort()).toEqual([first, second].sort());
    expect(ids(await list(c1Engineer, { submittedFrom: to }))).toEqual([second]);
    expect(ids(await list(c1Engineer, { submittedTo: from }))).toEqual([first]);
    expect(ids(await list(c1Engineer, { submittedFrom: from, submittedTo: to })).sort()).toEqual([first, second].sort());
    expect(ids(await list(c1Engineer, { submittedFrom: "2999-01-01" }))).toEqual([]);
    expect(ids(await list(k1Engineer, { submittedTo: from }))).toEqual([first]);
    const filtered = await list(c1Engineer, { submittedFrom: from });
    expect(filtered.stages.reduce((sum, s) => sum + s.count, 0)).toBe(2);
  });

  it("takes a day in Saudi time: the evening before in UTC is the next day", async () => {
    // Saudi Arabia is UTC+3: a Submit at 22:00 UTC is 01:00 the next day there.
    const at = "2026-03-01T22:00:00.000Z";
    await sql`update work_item set submitted_at = ${at}::timestamptz where id = ${first}::uuid`.execute(migrator);
    try {
      expect(ids(await list(c1Engineer, { submittedFrom: "2026-03-02", submittedTo: "2026-03-02" }))).toEqual([first]);
      expect(ids(await list(c1Engineer, { submittedFrom: "2026-03-01", submittedTo: "2026-03-01" }))).toEqual([]);
    } finally {
      await sql`update work_item set submitted_at = ${firstSubmitted}::timestamptz where id = ${first}::uuid`.execute(migrator);
    }
  });

  it("sorts by Submission Date, the latest first, items not yet Submitted last", async () => {
    const mine = await list(c1Engineer, { sort: "submissionDate" });
    expect(ids(mine).slice(0, 2)).toEqual([second, first]);
    expect(mine.items.slice(2).every((i) => i.submissionDate === null)).toBe(true);
    expect(ids(await list(k1Engineer, { sort: "submissionDate" }))).toEqual([second, first]);
  });

  it("refuses a day that isn't one", async () => {
    for (const bad of ["submittedFrom=2026-02-30", "submittedTo=yesterday", "submittedFrom=2026-3-1"]) {
      expect((await c1Engineer.get(`/v1/projects/${projectId}/work-items?${bad}`)).statusCode, bad).toBe(400);
    }
  });
});

describe("cursor paging by Submission Date", () => {
  it("pages with no duplicates or gaps, across ties and into the items not yet Submitted", async () => {
    const { project, tradeId, locationId, own } = await setUpProject();
    const engineer = await memberWithEmail(api, c1, own, ["engineer"]);
    await memberWithEmail(api, c1, own, ["project_manager"]);
    const created: string[] = [];
    const subjects = new Map<string, string>();
    for (let i = 0; i < 53; i++) {
      // Five Subjects, shared, in an order unlike the order they were made in.
      const title = `Item ${"DBEAC"[(i * 7) % 5]}`;
      const res = await ok(engineer.post(`/v1/projects/${project}/work-items`, { type: "MAR", title, answers: { trade: tradeId, location: locationId } }), 201);
      created.push(res.json().id);
      subjects.set(res.json().id, title);
    }
    // Un-numbered Drafts and items not yet Submitted: by Subject, then id, never by when they were made (ADR 0015).
    // Code-unit order is `collate "C"`'s byte order for these ASCII Subjects and the ids' lowercase hex.
    const byCodeUnits = (a: string, b: string) => Number(a > b) - Number(a < b);
    const bySubject = (a: string, b: string) => byCodeUnits(subjects.get(a)!, subjects.get(b)!) || byCodeUnits(a, b);
    // 49 carry a Submission Date, in groups that share one (the id breaks the tie); 4 have none.
    const submitted = created.slice(0, 49);
    for (const [i, id] of submitted.entries()) {
      const at = new Date(Date.UTC(2026, 5, 1) + Math.floor(i / 7) * DAY).toISOString();
      await sql`update work_item set submitted_at = ${at}::timestamptz where id = ${id}::uuid`.execute(migrator);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await list(engineer, { sort: "submissionDate", ...(cursor ? { cursor } : {}) }, project);
      seen.push(...ids(page));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
      expect(page.items.length).toBe(cursor ? 50 : 3);
    } while (cursor);
    expect(pages).toBe(2);
    expect(new Set(seen).size).toBe(53);
    // The Submitted ones first, the latest first; then the rest.
    const times = seen.slice(0, 49).map((id) => created.indexOf(id)).map((n) => Math.floor(n / 7));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(seen.slice(49)).toEqual(created.slice(49).sort(bySubject));
    // Under the Step Age sort, a Draft with no number sorts last, by Subject, then id, and its cursor holds no time (scenarios 61 and 73).
    const stepAgeSeen: string[] = [];
    let stepAgeCursor: string | undefined;
    do {
      const page = await list(engineer, { ...(stepAgeCursor ? { cursor: stepAgeCursor } : {}) }, project);
      stepAgeSeen.push(...ids(page));
      stepAgeCursor = page.nextCursor ?? undefined;
      if (stepAgeCursor) expect(decodeWorkItemCursor(stepAgeCursor, "stepAge")![1]).toBe("");
    } while (stepAgeCursor);
    expect(new Set(stepAgeSeen).size).toBe(53);
    expect(stepAgeSeen).toEqual([...created].sort(bySubject));
    // So does the Document Number sort, where they have no number, and the Kanban.
    const numberSeen: string[] = [];
    let numberCursor: string | undefined;
    do {
      const page = await list(engineer, { sort: "documentNumber", ...(numberCursor ? { cursor: numberCursor } : {}) }, project);
      numberSeen.push(...ids(page));
      numberCursor = page.nextCursor ?? undefined;
    } while (numberCursor);
    expect(numberSeen).toEqual([...created].sort(bySubject));
    const board: WorkItemBoard = (await ok(engineer.get(`/v1/projects/${project}/work-items/kanban`), 200)).json();
    const cards = board.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards)).map((c) => c.id);
    expect(cards).toEqual([...created].sort(bySubject));
    // A date range pages the same way.
    const ranged = await list(engineer, { sort: "submissionDate", submittedFrom: "2026-06-01" }, project);
    expect(ranged.items.length).toBe(49);
    expect(ranged.nextCursor).toBeNull();
  });
});
