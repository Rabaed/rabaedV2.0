// Seam 1 for the Site Observation (RP-627, SNAG-5; spec RP-619; glossary Site Observation,
// Trade, Visibility; visibility.md V3, V5, V14 and scenarios RP-627-1 and RP-627-2).
//
// A Project's Trades include "General" (GEN), added where the Trade Dimension is made and
// backfilled on Projects that existed. The Site Observation (Type OBS) runs its own copy of the
// Snag Workflow: Draft and Verify held by the raiser, Raise informing the Consultant; its Form is
// the Snag Form with the Trade starting on General, and its Resolve Screen holds After photos.
// A Contractor whose Visibility lists Trades without General never sees a General observation.
import { rabaedFormFile, rabaedWorkflowFile, sameDefinition } from "@rabaed/admin/services";
import { createDb, rabaedDefaultWorkflowId, readLatestPublishedDefinition } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { DimensionValues, StartedDocumentUpload, WorkItemList } from "@rabaed/domain";
import { formSchema, parseWorkflowDefinition, sameJson } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, readById, type Caller } from "./support/harness.ts";
import { all, buildTower, detail, ok, only, projectMember, take, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company;
let at: Tower;
let general = "";
let c2Engineer: Caller; // Another Contractor whose Trade Visibility lists Electrical only, not General.

const photo = jpegWithExif();
const observations = async (by: Caller): Promise<WorkItemList> => (await ok(by.get(`/v1/projects/${at.projectId}/modules/snag_list/work-items`), 200)).json();
const trades = async (by: Caller, projectId: string) => ((await ok(by.get(`/v1/projects/${projectId}/dimensions`), 200)).json() as DimensionValues).trade;
const who = (by: Caller) => (by === c2Engineer ? "C2 engineer" : by === at.c1Pm ? "C1 PM" : by === at.k1Manager ? "K1 manager" : "someone");

/** Item `id` is read by each of `seenBy`, then by none of `hiddenFrom`: in the Snag List, by id and its history. */
async function hiddenEverywhere(id: string, seenBy: Caller | Caller[], hiddenFrom: Caller | Caller[], label: string) {
  const historyOf = async (by: Caller) => (await readById<unknown>(`/v1/work-items/${id}/history`)(by)).map(() => ({ id }));
  const reads: [string, (by: Caller) => Promise<readonly { id: string }[]>][] = [
    ["Snag List", async (by) => (await observations(by)).items],
    ["by id", readById(`/v1/work-items/${id}`)],
    ["history", historyOf],
  ];
  for (const [read, rows] of reads) await expectHiddenFrom({ read: rows, target: id, seenBy, hiddenFrom, name: who, label: `${label}, ${read}` });
}

/** `by`'s Draft Site Observation on General, Building A. */
async function draftObservation(by: Caller, title: string): Promise<string> {
  const answers = { description: `${title}: see the photos`, trade: general, location: at.buildingA };
  return (await ok(by.post(`/v1/projects/${at.projectId}/work-items`, { type: "OBS", title, answers }), 201)).json().id as string;
}

/** Uploads an After photo to item `id` as `by`; its Document's id. */
async function addAfterPhoto(by: Caller, id: string): Promise<string> {
  const started = await by.post(`/v1/work-items/${id}/documents`, { fieldKey: "after_photos", reply: true, fileName: "after.jpg", contentType: "image/jpeg", sizeBytes: photo.byteLength });
  expect(started.statusCode, started.body).toBe(201);
  const { id: documentId, upload } = started.json() as StartedDocumentUpload;
  expect((await fetch(upload.url, { method: upload.method, headers: upload.headers, body: photo })).status).toBe(200);
  expect((await by.post(`/v1/work-items/${id}/documents/${documentId}/confirm`)).statusCode).toBe(204);
  return documentId;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "OBS");
  general = (await trades(c1.caller, at.projectId)).find((t) => t.code === "GEN")!.id;
  const c2 = await api.authorizedPerson();
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: only(at.electrical, at.mechanical), location: all }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
});

describe("the Trade General", () => {
  it("is among a new Project's Trades, named in both languages", async () => {
    const found = (await trades(c1.caller, at.projectId)).find((t) => t.code === "GEN");
    expect(found?.name).toEqual({ en: "General", ar: "عام" });
  });

  it("is among the Trades of every Project that exists, the older ones too", async () => {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from visibility_dimension d
      where d.kind = 'trade' and not exists (select 1 from dimension_value v where v.dimension_id = d.id and v.code = 'GEN')
    `.execute(migrator);
    expect(rows[0]!.n).toBe(0);
  });
});

describe("a Consultant's Site Observation on General (seam 1)", () => {
  it("goes to the only Contractor covering General, is resolved with After photos and closed by the Consultant", async () => {
    const id = await draftObservation(at.k1Manager, "Rubbish on floor 3");
    const draft = await detail(at.k1Manager, id);
    expect(draft.type.code).toBe("OBS");
    expect(draft.trade.code).toBe("GEN");
    await take(at.k1Manager, id, "raise");

    expect((await detail(at.c1Pm, id)).documentNumber).toMatch(/-OBS-/);
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    const after = await addAfterPhoto(at.c1Pm, id);
    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Cleared and swept" } });

    const atVerify = await detail(at.k1Manager, id);
    expect(atVerify.step?.key).toBe("verify");
    expect(atVerify.actions.transitions.map((t) => t.key)).toEqual(expect.arrayContaining(["close", "return_to_open"]));
    const { documents } = (await ok(at.k1Manager.get(`/v1/work-items/${id}/documents`), 200)).json();
    expect(documents.filter((d: { fieldKey: string }) => d.fieldKey === "after_photos").map((d: { id: string }) => d.id)).toEqual([after]);
    await take(at.k1Manager, id, "close");
    expect((await detail(at.c1Pm, id)).outcome).toBe("closed");
  });

  it("is a Contractor's own too: C1 raises one on itself, holds every Step, and the Consultant is informed", async () => {
    const id = await draftObservation(at.c1Pm, "Waste left at the riser");
    await expectHiddenFrom({ read: readById(`/v1/work-items/${id}`), target: id, seenBy: at.c1Pm, hiddenFrom: at.k1Manager, name: who, label: "a Draft" });
    await take(at.c1Pm, id, "raise");
    if ((await detail(at.c1Pm, id)).actions.pickUp) await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    const read = await detail(at.k1Manager, id);
    expect(read.stage.key).toBe("open");
    expect(read.actions.transitions).toEqual([]); // not hidden-from: K1 reads the item, and holds no Transition
    expect((await tryTake(at.k1Manager, id, "resolve", { answers: { resolution_note: "Not K1's" } })).statusCode).toBe(409);
    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Removed" } });
    // The raiser verifies: it holds Verify, as the Snag's Version 3 has it (picks it up when pooled).
    if ((await detail(at.c1Pm, id)).actions.pickUp) await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "close");
    expect((await detail(at.k1Manager, id)).outcome).toBe("closed");
  });
});

describe("a Contractor not covering General never sees a General observation (scenarios RP-627-1, RP-627-2)", () => {
  it("RP-627-1: C2, whose Trade Visibility lists Trades without General, sees it in no list, by id or history, at any Step", async () => {
    const id = await draftObservation(at.k1Manager, "Skip full of rubbish");
    // K1, the raiser, reads it at every Step.
    const hidden = (step: string) => hiddenEverywhere(id, at.k1Manager, c2Engineer, step);
    await hidden("draft");
    await take(at.k1Manager, id, "raise");
    await hidden("open");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "resolve", { answers: { resolution_note: "Skip emptied" } });
    await hidden("verify");
    await take(at.k1Manager, id, "close");
    await hidden("closed");
    // Its Stage counts: K1 counts it, C2 counts nothing (C2 sees no Snag List item on this Project).
    const counted = async (by: Caller) => (await observations(by)).stages.reduce((n, s) => n + s.count, 0);
    expect(await counted(at.k1Manager)).toBeGreaterThan(0);
    expect(await counted(c2Engineer)).toBe(0);
  });

  it("RP-627-2: C2 never sees one C1 raised on itself either, and cannot raise one on General", async () => {
    const id = await draftObservation(at.c1Pm, "C1's own mess");
    await take(at.c1Pm, id, "raise");
    await hiddenEverywhere(id, [at.c1Pm, at.k1Manager], c2Engineer, "open");
    const refused = await c2Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: "OBS",
      title: "Not mine to raise",
      answers: { description: "x", trade: general, location: at.buildingA },
    });
    expect(refused.statusCode, refused.body).toBeGreaterThanOrEqual(400);
  });
});

describe("the Rabaed Default Site Observation Workflow and Form", () => {
  it("are the documents `pnpm defaults:publish` publishes, as their latest Versions", async () => {
    const definitionId = (await rabaedDefaultWorkflowId(migrator, "OBS"))!;
    const latest = (await readLatestPublishedDefinition(migrator, definitionId))!;
    const file = parseWorkflowDefinition(rabaedWorkflowFile("OBS.json"));
    expect(file.ok && sameDefinition(latest.definition, file.definition)).toBe(true);

    const { rows } = await sql<{ schema: unknown }>`
      select v.schema from form_version v
      join work_item_type t on t.form_definition_id = v.form_definition_id
      where t.owner_kind = 'rabaed' and t.code = 'OBS' and v.status = 'published'
      order by v.version_no desc limit 1
    `.execute(migrator);
    expect(sameJson(formSchema.parse(rows[0]!.schema), formSchema.parse(rabaedFormFile("OBS.json")))).toBe(true);
  });

  it("is a copy of the Snag Workflow's shape that a Project can change on its own", async () => {
    const obs = (await rabaedDefaultWorkflowId(migrator, "OBS"))!;
    const snag = (await rabaedDefaultWorkflowId(migrator, "SNG"))!;
    expect(obs).not.toBe(snag);
    const [a, b] = [parseWorkflowDefinition(rabaedWorkflowFile("OBS.json")), parseWorkflowDefinition(rabaedWorkflowFile("SNG.json"))];
    expect(a.ok && b.ok && sameDefinition(a.definition, b.definition)).toBe(true);
  });
});
