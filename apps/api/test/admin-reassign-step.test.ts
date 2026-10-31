// Seam 1: a Rabaed Engineer reassigns a stuck Step (RP-1162, UAT ADM-10; workflow-engine.md
// §5.6, ADR 0018), read through the api as each Company. C1 Submits a MAR to K1, whose managers
// share the pool and nobody picks it up. The Engineer (Rabaed Admin's database function, on the
// admin connection) hands it to one K1 manager, then back to K1's pool. K1 reads it in its
// history as Rabaed's, naming no Engineer; its new holder gets "Step reached". C1 reads nothing
// new anywhere: history, item, List, Activity Feed, bell (V5, V14). Rabaed Admin's own routes
// are apps/admin/test/steps.test.ts; the database's reads, packages/db/test/admin-reassign-step-rls.test.ts.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { drainOutbox, testDatabaseUrls } from "@rabaed/db/test-support";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { buildTower, memberOnProject, ok, submitted, type Tower } from "./support/tower.ts";

// With the file store: a MAR's Draft attaches its datasheet.
const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
// The worker connects as the app role, with no Member set.
const worker = createDb(urls.app, { max: 1 });
// Rabaed Admin's connection: the Engineer's command runs here.
const adminDb = createDb(urls.admin, { max: 1 });
const migrator = createDb(urls.migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await Promise.all([worker.destroy(), adminDb.destroy(), migrator.destroy()]);
});

const ENGINEER_NAME = "Nadia Rabaedengineer";
type Person = Awaited<ReturnType<typeof memberOnProject>>;
let tower: Tower;
let mar = "";
let engineerId = "";
let engineerEmail = "";
let khalid: Person;
let sara: Person;
let omar: Person;

/** The Engineer hands the MAR's Step to `to`, or back to K1's pool when it is null. */
const reassign = async (to: string | null) =>
  (
    await sql<{ result: string }>`
      select result from app.reassign_step_by_engineer(${mar}::uuid, ${to}::uuid, ${engineerId}::uuid, ${randomUUID()}::uuid, now())
    `.execute(adminDb)
  ).rows[0]!.result;

/** Everything `by` reads of the MAR (and the Project's feed and their bell), as the api gives it. */
async function everythingRead(by: Caller) {
  const read = async (url: string) => (await ok(by.get(url), 200)).json();
  return {
    item: await read(`/v1/work-items/${mar}`),
    history: await read(`/v1/work-items/${mar}/history`),
    list: await read(`/v1/projects/${tower.projectId}/work-items`),
    feed: await read(`/v1/projects/${tower.projectId}/activity`),
    bell: await read("/v1/notifications"),
  };
}
const historyOf = async (by: Caller) =>
  (await ok(by.get(`/v1/work-items/${mar}/history`), 200)).json().events as {
    type: string;
    by: { companyName: unknown; memberName: unknown; positions: unknown[] };
    handover: { from: { en: string } | null; to: { en: string } | null; because: string } | null;
  }[];
const bellKinds = async (person: Person) =>
  ((await ok(person.caller.get("/v1/notifications"), 200)).json().notifications as { workItemId: string; kind: string }[])
    .filter((n) => n.workItemId === mar)
    .map((n) => n.kind);

beforeAll(async () => {
  const c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  tower = await buildTower(api, { c1, k1 }, "ARS");
  khalid = await memberOnProject(api, k1, tower.k1ParticipantId!, ["manager"], { name: "Khalid Manager" });
  sara = await memberOnProject(api, k1, tower.k1ParticipantId!, ["manager"], { name: "Sara Manager" });
  omar = await memberOnProject(api, c1, tower.c1ParticipantId, ["engineer"], { name: "Omar Engineer" });
  mar = await submitted(tower, omar.caller, tower.c1Pm, "Cable tray, galvanised");
  engineerEmail = `nadia-${randomUUID().slice(0, 8)}@rabaed.test`;
  engineerId = (
    await sql<{ id: string }>`insert into rabaed_engineer (email, full_name) values (${engineerEmail}, ${ENGINEER_NAME}) returning id`.execute(migrator)
  ).rows[0]!.id;
  await drainOutbox(worker);
});

describe("RP-1162-2: the Engineer never hands K1's Step to another Company", () => {
  it("RP-1162-2: C1's Members are not_offered, and neither C1 nor K1 reads any change", async () => {
    const c1Before = await everythingRead(omar.caller);
    const k1Before = await everythingRead(khalid.caller);
    for (const to of [omar.id, randomUUID()]) expect(await reassign(to)).toBe("not_offered");
    await drainOutbox(worker);
    expect(await everythingRead(omar.caller)).toEqual(c1Before);
    expect(await everythingRead(khalid.caller)).toEqual(k1Before);
    // Positive control: C1 reads the MAR and its shared Submit.
    expect(c1Before.history.events.map((e: { type: string }) => e.type)).toContain("transition");
  });
});

describe("RP-1162-1: a reassign by Rabaed is K1's own, and names no Engineer", () => {
  let c1Before: Awaited<ReturnType<typeof everythingRead>>;
  let c1PmBefore: Awaited<ReturnType<typeof everythingRead>>;

  beforeAll(async () => {
    c1Before = await everythingRead(omar.caller);
    c1PmBefore = await everythingRead(tower.c1Pm);
    expect(await reassign(khalid.id)).toBe("reassigned");
    await drainOutbox(worker);
  });

  it("RP-1162-1: the new holder has Step reached, once, and holds it; the other manager's is withdrawn", async () => {
    expect(await bellKinds(khalid)).toEqual(["step_reached"]);
    expect(await bellKinds(sara)).toEqual([]);
    const item = (await ok(khalid.caller.get(`/v1/work-items/${mar}`), 200)).json();
    expect(JSON.stringify(item)).toContain("Khalid Manager");
  });

  it("RP-1162-1: K1's history reads it as Rabaed's, to Khalid, by no Company and no person", async () => {
    const reassigned = (await historyOf(sara.caller)).filter((e) => e.type === "admin_reassigned");
    expect(reassigned).toEqual([
      expect.objectContaining({
        by: { companyName: null, memberName: null, positions: [] },
        handover: { from: null, to: expect.objectContaining({ en: "Khalid Manager" }), because: "reassigned" },
      }),
    ]);
  });

  it("RP-1162-1: C1 reads nothing new: not in the history, the item, the List, the feed or the bell", async () => {
    expect(await everythingRead(omar.caller)).toEqual(c1Before);
    expect(await everythingRead(tower.c1Pm)).toEqual(c1PmBefore);
    expect((await historyOf(omar.caller)).map((e) => e.type)).not.toContain("admin_reassigned");
  });

  it("RP-1162-1: no Company reads the Engineer's name or email anywhere", async () => {
    for (const by of [omar.caller, tower.c1Pm, khalid.caller, sara.caller, tower.k1Manager]) {
      const text = JSON.stringify(await everythingRead(by));
      expect(text).not.toContain(ENGINEER_NAME);
      expect(text).not.toContain(engineerEmail);
      expect(text).not.toContain(engineerId);
    }
  });

  it("RP-1162-1: back to K1's pool, the Step waits on K1's managers and C1 still reads nothing new", async () => {
    expect(await reassign(null)).toBe("returned_to_pool");
    await drainOutbox(worker);
    expect((await historyOf(khalid.caller)).filter((e) => e.type === "admin_reassigned").map((e) => [e.handover?.from?.en ?? null, e.handover?.to?.en ?? null])).toEqual([
      [null, "Khalid Manager"],
      ["Khalid Manager", null],
    ]);
    // It waits on K1's pool again: each manager is told, the old holder too.
    expect(await bellKinds(sara)).toEqual(["step_reached"]);
    expect(await bellKinds(khalid)).toEqual(["step_reached"]);
    expect(await everythingRead(omar.caller)).toEqual(c1Before);
  });
});
