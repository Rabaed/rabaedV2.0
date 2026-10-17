// Seam 1 for the Snag List's desktop views (RP-94, SNAG-8; spec RP-619; glossary Snag,
// Comment, Snag List, Stage; visibility.md E1, V3, V14 and scenario RP-94-1).
//
// The Snag List reads through the work item query like every Module's List and Kanban,
// with what its toolbar and rows add: how many items each type chip holds, the Company
// and "Raised from" filters, each row's source (by Document Number and Subject, its
// Review Code only for a viewer who sees it) and first photo. All of it counts and
// names only what the viewer sees.
//
// C1 covers Building A, C2 Building B (V3); K1, the Consultant, raises Snags on both, and
// closes C1's Code B review whose two rows become Comments with C1.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { type WorkItemBoard, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif } from "../src/demo/exif-jpeg.ts";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, buildTower, detail, ok, only, projectMember, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const REVIEWED = "SLB";
const schema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

let c1: Company;
let at: Tower;
let buildingB = "";
let c2Participant = "";
let c2Engineer: Caller;

// The items, by name.
let source = ""; // C1's Code B review, closed at B.
let sourceNumber = "";
let comments: string[] = []; // Its two Comments, Open with C1.
let photographed = ""; // K1's Snag on C1, Building A, Electrical, with a photo: Open.
let started = ""; // K1's Snag on C1, Building A, Mechanical: In Progress with C1's PM.
let c2Snag = ""; // K1's Snag on C2, Building B.

const snagPath = () => `/v1/projects/${at.projectId}/modules/snag_list/work-items`;
const snags = async (by: Caller, query = ""): Promise<WorkItemList> => (await ok(by.get(`${snagPath()}${query}`), 200)).json();
const board = async (by: Caller, query = ""): Promise<WorkItemBoard> => (await ok(by.get(`${snagPath()}/kanban${query}`), 200)).json();
const ids = (list: WorkItemList) => list.items.map((i) => i.id).sort();
const sorted = (...values: string[]) => [...values].sort();
const total = (list: Pick<WorkItemList, "stages">) => list.stages.reduce((n, s) => n + s.count, 0);

/** K1's manager raises a Snag on `location`, of `trade`, with `photos` photos. */
async function snag(title: string, { trade, location, photos = 0 }: { trade: string; location: string; photos?: number }): Promise<string> {
  const id = (
    await ok(
      at.k1Manager.post(`/v1/projects/${at.projectId}/work-items`, { type: "SNG", title, answers: { description: title, trade, location } }),
      201,
    )
  ).json().id as string;
  for (let i = 0; i < photos; i++) {
    await uploadDocument(at.k1Manager, id, { fieldKey: "photos", fileName: `before-${i}.jpg`, contentType: "image/jpeg", body: jpegWithExif() });
  }
  await take(at.k1Manager, id, "raise");
  return id;
}

/** C1's review, Submitted to K1, who closes it at Code B with one Comment per row. */
async function closedAtB(title: string, rows: { comment: string }[]): Promise<string> {
  const id = (
    await ok(
      at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
        type: REVIEWED,
        title,
        answers: { model: title, trade: at.electrical, location: at.buildingA },
      }),
      201,
    )
  ).json().id as string;
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(at.k1Manager, id, "send_to_manager");
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(at.k1Manager, id, "approve_b", { answers: { remarks: "Approved with comments", items_to_create: rows } });
  return id;
}

beforeAll(async () => {
  await addSendBackType(migrator, REVIEWED, { en: "Snag List review", ar: "مراجعة قائمة الملاحظات" }, schema, { withApproveB: true });
  c1 = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "SLV");
  buildingB = (await ok(c1.caller.post(`/v1/projects/${at.projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }), 201)).json().id;
  // One Contractor per Building, so each Snag has one to go to (no Visibility Overlap).
  await ok(c1.caller.request("PUT", `/v1/participants/${at.c1ParticipantId}/visibility`, { trade: all, location: only(at.buildingA) }));
  c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: only(buildingB) }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);

  source = await closedAtB("Lighting fixtures", [{ comment: "Provide the IP65 certificate" }, { comment: "Update the luminaire schedule" }]);
  sourceNumber = (await detail(at.k1Manager, source)).documentNumber!;
  comments = (await snags(at.c1Pm)).items.filter((i) => i.type.code === "CMT").map((i) => i.id);
  photographed = await snag("Cable tray not bonded", { trade: at.electrical, location: at.buildingA, photos: 1 });
  started = await snag("Duct insulation torn", { trade: at.mechanical, location: at.buildingA });
  await ok(at.c1Pm.post(`/v1/work-items/${started}/pick-up`));
  await take(at.c1Pm, started, "start_work");
  if ((await detail(at.c1Pm, started)).actions.pickUp) await ok(at.c1Pm.post(`/v1/work-items/${started}/pick-up`));
  c2Snag = await snag("Paint drips on skirting", { trade: at.electrical, location: buildingB });
});

describe("the Snag List's rows (seam 1)", () => {
  it("are the Snags and Comments C1 sees, each Comment with the item it was raised from and its Code, each Snag by hand", async () => {
    expect(comments).toHaveLength(2);
    const list = await snags(at.c1Pm);
    expect(ids(list)).toEqual(sorted(...comments, photographed, started));
    for (const id of comments) {
      expect(list.items.find((i) => i.id === id)!.raisedFrom).toEqual({
        documentNumber: sourceNumber,
        subject: "Lighting fixtures",
        workItemId: source,
        outcome: { code: "B", name: expect.objectContaining({ en: expect.any(String) }), look: "b" },
      });
    }
    expect(list.items.find((i) => i.id === photographed)!.raisedFrom).toBeNull();
  });

  it("carry the first photo the viewer sees, and none for an item with no photo", async () => {
    const list = await snags(at.c1Pm);
    const photo = list.items.find((i) => i.id === photographed)!.photo;
    expect(photo).toEqual({ documentId: expect.any(String), contentType: "image/jpeg" });
    const download = await at.c1Pm.get(`/v1/work-items/${photographed}/documents/${photo!.documentId}/download`);
    expect(download.statusCode).toBe(200);
    expect(list.items.find((i) => i.id === started)!.photo).toBeNull();
  });

  it("count each Type the viewer sees for the type chips, the Stages too", async () => {
    const list = await snags(at.c1Pm);
    expect(list.typeCounts).toEqual([
      { code: "CMT", count: 2 },
      { code: "SNG", count: 2 },
    ]);
    expect(total(list)).toBe(4);
    expect(list.filters.types.map((t) => t.code)).toEqual(expect.arrayContaining(["CMT", "SNG"]));
    expect((await board(at.c1Pm)).typeCounts).toEqual(list.typeCounts);
  });

  it("offer the Companies holding them and the items they were raised from", async () => {
    const c1Sees = await snags(at.c1Pm);
    expect(c1Sees.filters.companies).toEqual([{ participantId: at.c1ParticipantId, name: expect.any(Object), own: true }]);
    expect(c1Sees.filters.raisedFrom).toEqual([{ documentNumber: sourceNumber, subject: "Lighting fixtures" }]);
    const k1Sees = await snags(at.k1Manager);
    expect(k1Sees.filters.companies!.map((c) => [c.participantId, c.own]).sort()).toEqual(
      sorted(at.c1ParticipantId, c2Participant).map((id) => [id, false]),
    );
  });

  it("'+ New' offers only the Snag List Types the viewer may raise: the Consultant the Snag, the Contractor none", async () => {
    const raisable = async (by: Caller, module?: string) =>
      (await ok(by.get(`/v1/projects/${at.projectId}/raisable-types${module ? `?module=${module}` : ""}`), 200)).json().types.map((t: { code: string }) => t.code);
    expect(await raisable(at.k1Manager, "snag_list")).toContain("SNG");
    expect(await raisable(at.c1Engineer, "snag_list")).not.toContain("SNG");
    // The Submittals stay the default.
    expect(await raisable(at.c1Engineer)).toEqual(await raisable(at.c1Engineer, "submittals"));
    expect((await at.c1Engineer.get(`/v1/projects/${at.projectId}/raisable-types?module=nothing`)).statusCode).toBe(400);
  });

  it("are left out of other Modules' reads", async () => {
    const submittals: WorkItemList = (await ok(at.c1Pm.get(`/v1/projects/${at.projectId}/modules/submittals/work-items`), 200)).json();
    expect(submittals.typeCounts).toBeUndefined();
    expect(submittals.filters.companies).toBeUndefined();
    expect(submittals.items.every((i) => i.raisedFrom === undefined && i.photo === undefined)).toBe(true);
  });
});

describe("the Snag List's filters and search, over the items the viewer sees (seam 1)", () => {
  it("filter by Type, keeping every Type's count for the chips", async () => {
    const list = await snags(at.c1Pm, "?type=SNG");
    expect(ids(list)).toEqual(sorted(photographed, started));
    expect(total(list)).toBe(2);
    expect(list.typeCounts).toEqual([
      { code: "CMT", count: 2 },
      { code: "SNG", count: 2 },
    ]);
  });

  it("filter by Trade, Location and Stage, and the type chips count within them", async () => {
    const mechanical = await snags(at.c1Pm, `?trade=${at.mechanical}`);
    expect(ids(mechanical)).toEqual([started]);
    expect(mechanical.typeCounts).toEqual([{ code: "SNG", count: 1 }]);
    expect(ids(await snags(at.c1Pm, `?location=${at.buildingA}`))).toEqual(sorted(...comments, photographed, started));
    expect(ids(await snags(at.c1Pm, `?location=${buildingB}`))).toEqual([]);
    expect(ids(await snags(at.c1Pm, "?stage=in_progress"))).toEqual([started]);
  });

  it("filter by the Company holding the item", async () => {
    expect(ids(await snags(at.k1Manager, `?company=${c2Participant}`))).toEqual([c2Snag]);
    expect(ids(await snags(at.k1Manager, `?company=${at.c1ParticipantId}`))).toEqual(sorted(...comments, photographed, started));
    expect(ids(await snags(at.c1Pm, `?company=${at.c1ParticipantId}`))).toEqual(sorted(...comments, photographed, started));
  });

  it("filter by what it was raised from, or raised by hand", async () => {
    expect(ids(await snags(at.c1Pm, `?raisedFrom=${sourceNumber}`))).toEqual(sorted(...comments));
    expect(ids(await snags(at.c1Pm, "?raisedFrom=manual"))).toEqual(sorted(photographed, started));
    const both = await board(at.c1Pm, `?raisedFrom=manual,${sourceNumber}`);
    expect(both.columns.reduce((n, c) => n + c.shown, 0)).toBe(4);
  });

  it("filter by Need My Action", async () => {
    const mine = ids(await snags(at.c1Pm, "?needMyAction=true"));
    expect(mine).toContain(started);
    expect(mine.every((id) => [...comments, photographed, started].includes(id))).toBe(true);
  });

  it("search by Document Number and by Subject", async () => {
    const number = (await detail(at.c1Pm, photographed)).documentNumber!;
    expect(ids(await snags(at.c1Pm, `?q=${encodeURIComponent(number)}`))).toEqual([photographed]);
    const bySubject = await snags(at.c1Pm, "?q=insulation");
    expect(ids(bySubject)).toEqual([started]);
    // A search counts no more than it shows: no type chip counts.
    expect(bySubject.typeCounts).toBeUndefined();
  });
});

describe("C2's Snag List names and counts none of C1's items (scenario RP-94-1)", () => {
  it("RP-94-1: C2's Stage and type chip counts, Company and Raised from choices hold its own Snag only, in the List and the Kanban", async () => {
    const list = await snags(c2Engineer);
    expect(ids(list)).toEqual([c2Snag]);
    expect(total(list)).toBe(1);
    expect(list.typeCounts).toEqual([{ code: "SNG", count: 1 }]);
    expect(list.filters.companies).toEqual([{ participantId: c2Participant, name: expect.any(Object), own: true }]);
    expect(list.filters.raisedFrom).toEqual([]);
    const kanban = await board(c2Engineer);
    expect(kanban.typeCounts).toEqual([{ code: "SNG", count: 1 }]);
    expect(kanban.stages.reduce((n, s) => n + s.count, 0)).toBe(1);
    for (const read of [JSON.stringify(list), JSON.stringify(kanban)]) {
      for (const hidden of [source, sourceNumber, ...comments, photographed, started, at.c1ParticipantId]) expect(read).not.toContain(hidden);
    }
  });

  it("RP-94-1: filtering by C1's source or C1 finds nothing, and counts nothing", async () => {
    for (const query of [`?raisedFrom=${sourceNumber}`, `?company=${at.c1ParticipantId}`, "?type=CMT"]) {
      const list = await snags(c2Engineer, query);
      expect(list.items, query).toEqual([]);
      expect(total(list), query).toBe(0);
      expect(list.typeCounts!.filter((t) => t.code === "CMT"), query).toEqual([]);
    }
  });
});
