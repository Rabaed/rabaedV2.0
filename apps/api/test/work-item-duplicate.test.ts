// Seam 1 for the List's row menu Duplicate (RP-409, the owner's design;
// visibility.md V5, V13, V19 and scenario RP-409-1). A Member of the raiser's
// Company makes a new Draft of the same Type from an item, with only what their
// own Participant wrote: its Subject and the answers whose last writer is of their
// own Participant, in the sections the raiser fills. Never another Company's
// answers (the Consultant's verification, or its write to a section both may
// change), nor any Internal Note, Document, Link or history: the new Draft starts
// its own, naming where it came from to its own Company, with no time. The same
// key again answers with the same Draft. Nobody else may duplicate it, and the row
// menu offers it only where allowed.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { buildTower, detail, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let at: Tower;
let k1: Company;
let c2Engineer: Caller; // Another Contractor on the Project.
let stranger: Caller;
let closed = "";
let copy = "";
const key = randomUUID();

const answers = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};
const duplicate = (by: Caller, id: string, idempotencyKey: string = randomUUID()) => by.post(`/v1/work-items/${id}/duplicate`, { idempotencyKey });
const history = async (by: Caller, id: string): Promise<WorkItemHistory> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json();

beforeAll(async () => {
  const c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "DUP");
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: { isAll: true, valueIds: [] }, location: { isAll: true, valueIds: [] } }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  stranger = (await api.authorizedPerson()).caller;

  const res = await ok(
    at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, { type: "MAR", title: "Fixtures", answers: { ...answers, trade: at.electrical, location: at.buildingA } }),
    201,
  );
  closed = res.json().id;
  await attachDatasheet(at.c1Engineer, closed);
  await take(at.c1Engineer, closed, "send_for_review", { internalNote: "C1 only: check the price" });
  await ok(at.c1Pm.post(`/v1/work-items/${closed}/claim`));
  await take(at.c1Pm, closed, "submit", { internalNote: "C1 only: submitted early" });
  const item = await detail(at.k1Manager, closed);
  await ok(
    at.k1Manager.request("PUT", `/v1/work-items/${closed}/answers`, {
      answers: { ...item.answers, sample_checked: true, matches_specification: false, verification_note: "Below the specified efficacy" },
    }),
  );
  await ok(at.k1Manager.post(`/v1/work-items/${closed}/claim`));
  await take(at.k1Manager, closed, "revise_c", { remarks: "Resubmit", internalNote: "K1 only: their price is high" });
});

describe("scenario RP-409-1: C1 duplicates a MAR K1 verified and closed with Code C", () => {
  it("is offered to the raiser's Company only", async () => {
    expect((await detail(at.c1Engineer, closed)).actions.duplicate).toBe(true);
    expect((await detail(at.k1Manager, closed)).actions.duplicate).toBe(false);
  });

  it("makes a new Draft of the same Type with C1's own Subject and answers", async () => {
    copy = (await ok(duplicate(at.c1Engineer, closed, key), 201)).json().id;
    const d = await detail(at.c1Engineer, copy);
    expect(d).toMatchObject({
      title: "Fixtures",
      type: { code: "MAR" },
      documentNumber: null,
      revisionNo: 0,
      stage: { key: "draft" },
      outcome: null,
      answers: { ...answers, trade: at.electrical, location: at.buildingA },
    });
  });

  it("answers the same request again with the same Draft", async () => {
    expect((await ok(duplicate(at.c1Engineer, closed, key), 201)).json().id).toBe(copy);
  });

  it("never copies K1's answers, an Internal Note, a Document or the history", async () => {
    const d = await detail(at.c1Engineer, copy);
    for (const field of ["sample_checked", "matches_specification", "verification_note"]) expect(d.answers).not.toHaveProperty(field);
    const documents: DocumentList = (await ok(at.c1Engineer.get(`/v1/work-items/${copy}/documents`), 200)).json();
    expect(documents.documents).toEqual([]);
    const events = await history(at.c1Engineer, copy);
    expect(events.events.every((e) => e.internalNote === null && e.remarks === null && e.transition === null)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/C1 only|K1 only|Resubmit/);
  });

  it("names where it came from to C1, with no time and no event", async () => {
    const source = (await detail(at.c1Engineer, closed)).documentNumber;
    for (const who of [at.c1Engineer, at.c1Pm]) {
      expect((await detail(who, copy)).duplicatedFrom).toEqual({ workItemId: closed, documentNumber: source, subject: "Fixtures" });
    }
    expect((await history(at.c1Engineer, copy)).events.map((e) => e.type)).not.toContain("duplicated");
  });

  it("answers the same request made twice at once with one Draft", async () => {
    const twice = randomUUID();
    const [a, b] = await Promise.all([duplicate(at.c1Engineer, closed, twice), duplicate(at.c1Engineer, closed, twice)]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().id).toBe(b.json().id);
  });

  it("makes a new Draft for the same request once the first was deleted", async () => {
    const again = randomUUID();
    const first = (await ok(duplicate(at.c1Engineer, closed, again), 201)).json().id as string;
    await ok(at.c1Engineer.post(`/v1/work-items/${first}/discard-draft`));
    const second = (await ok(duplicate(at.c1Engineer, closed, again), 201)).json().id as string;
    expect(second).not.toBe(first);
    expect((await ok(duplicate(at.c1Engineer, closed, again), 201)).json().id).toBe(second);
  });

  it("never tells when its Draft was started, once numbered (scenario 61)", async () => {
    const started = (await ok(duplicate(at.c1Engineer, closed), 201)).json().id as string;
    // As if the Draft had been started long ago: no read may give that time once it is numbered.
    await sql`update work_item set created_at = '2020-01-02T03:04:05Z' where id = ${started}::uuid`.execute(migrator);
    await attachDatasheet(at.c1Engineer, started);
    await take(at.c1Engineer, started, "send_for_review");
    for (const who of [at.c1Engineer, at.c1Pm]) {
      const reads = [
        await detail(who, started),
        await history(who, started),
        (await ok(who.get(`/v1/projects/${at.projectId}/activity`), 200)).json(),
        (await ok(who.get(`/v1/projects/${at.projectId}/work-items`), 200)).json(),
      ];
      expect(JSON.stringify(reads)).not.toContain("2020-01-02");
    }
    expect((await detail(at.c1Pm, started)).duplicatedFrom).toMatchObject({ workItemId: closed });
  });

  it("copies a Built-in Field only when C1 wrote it last, as any other field", async () => {
    // As if K1's manager had written the location last.
    await sql`
      update work_item set field_times = jsonb_set(field_times, '{location}', jsonb_build_object('at', now(), 'by', ${k1.company.authorizedPerson.id}::text))
      where id = ${closed}::uuid
    `.execute(migrator);
    const d = await detail(at.c1Engineer, (await ok(duplicate(at.c1Engineer, closed), 201)).json().id);
    expect(d.answers).not.toHaveProperty("location");
    expect(d.answers).toMatchObject({ trade: at.electrical, manufacturer: "Philips" });
  });

  it("never copies a field another Company wrote last, even in a section C1 fills", async () => {
    // As if K1's manager had written the manufacturer last (a section both may change).
    await sql`
      update work_item set field_times = jsonb_set(field_times, '{manufacturer}', jsonb_build_object('at', now(), 'by', ${k1.company.authorizedPerson.id}::text))
      where id = ${closed}::uuid
    `.execute(migrator);
    const second = (await ok(duplicate(at.c1Engineer, closed), 201)).json().id as string;
    const d = await detail(at.c1Engineer, second);
    expect(d.answers).not.toHaveProperty("manufacturer");
    expect(d.answers).toMatchObject({ description: "LED fixtures", trade: at.electrical });
  });

  it("is C1's Draft: K1, another Contractor and a stranger can't see it", async () => {
    for (const who of [at.k1Manager, c2Engineer, stranger]) await expectHidden(who.get(`/v1/work-items/${copy}`));
  });

  it("is refused to K1, who sees the item but didn't raise it, and to anyone who can't see it", async () => {
    const refused = await duplicate(at.k1Manager, closed);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "duplicate_not_allowed" });
    for (const who of [c2Engineer, stranger]) await expectHidden(duplicate(who, closed));
  });
});
