// Seam 1 for "a close shares only what was handed over" (RP-955, ADR 0027; visibility.md V19;
// scenarios RP-955-1 and RP-955-2). After an item closes, the other Participants read it
// as it was at its last arrival with them: a Document or Link its holder added after that stays the
// holder's, after the close as well, by the documents list, a download by id, the Links and the
// Download (`/shared`). What they read is what the sealed Documental Record holds
// (app.documents_shared_before_close, RP-147). A shared reply file the closing Code took was handed
// over with the Code (ADR 0024), so everyone who sees the item reads it.
//
// The Type is test-only, on the test Workflow with a Send Back and a Cancel (addSendBackType).
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, SharedWorkItem, WorkItemLinks } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, readById, uploadDocument, type Caller, type TestFile } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import { all, bilingual, ok, projectMember, take, tryTake, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "CSHO";
const schema = {
  sections: [
    {
      key: "material",
      title: bilingual("Material"),
      fields: [
        { key: "model", type: "text", label: bilingual("Model") },
        { key: "datasheet", type: "attachments", label: bilingual("Datasheet"), contentTypes: ["application/pdf"] },
      ],
    },
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
let engineer: Caller; // C1 engineer: raises the items, and changes one while it is Sent Back.
let pm: Caller; // C1 PM: Submits.
let k1Engineer: Caller; // Picks up Consultant review: Sends Back, or sends to the manager.
let k1Manager: Caller; // Issues the Code.
let orEngineer: Caller;
let owner: Caller;
let c2Engineer: Caller;
let projectId = "";
let electrical = "";
let buildingA = "";
let x = "";
let y = "";

const pdf = (fileName: string): TestFile => ({ fieldKey: "datasheet", fileName, contentType: "application/pdf", body: `%PDF-1.7 ${fileName}` });

/** Who each caller is, in a failure. */
const names = new Map<Caller, string>();
const nameOf = (by: Caller) => names.get(by) ?? "a caller";

async function otherParticipant(role: "contractor" | "consultant" | "owner" | "owner_representative") {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return { company, participantId };
}

async function draftOf(model: string): Promise<string> {
  const res = await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { model, trade: electrical, location: buildingA } }), 201);
  return res.json().id as string;
}

async function submit(itemId: string) {
  await take(engineer, itemId, "send_for_review");
  await ok(pm.post(`/v1/work-items/${itemId}/pick-up`));
  await take(pm, itemId, "submit");
}

const addLink = async (from: string, to: string): Promise<string> => (await ok(engineer.post(`/v1/work-items/${from}/links`, { workItemId: to }), 201)).json().id as string;

/**
 * An item C1 Submitted with `shared.pdf` and a Link to X, that K1 Sent Back to C1's Draft, where C1
 * added `held.pdf` and a Link to Y: what it added has arrived nowhere yet.
 */
async function heldAfterSendBack(model: string) {
  const id = await draftOf(model);
  const shared = await uploadDocument(engineer, id, pdf(`${model}-shared.pdf`));
  const sharedLink = await addLink(id, x);
  await submit(id);
  await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Engineer, id, "send_back_to_draft");
  const held = await uploadDocument(engineer, id, pdf(`${model}-held.pdf`));
  const heldLink = await addLink(id, y);
  return { id, shared, sharedLink, held, heldLink };
}

/** The item's documents list as `by` reads it; none for a caller who doesn't see the item (404, as for a made-up id). */
const documentsOf = (id: string) => async (by: Caller) => {
  const [list] = await readById<DocumentList>(`/v1/work-items/${id}/documents`)(by);
  return list?.documents ?? [];
};
const linksOf = (id: string) => async (by: Caller) => ((await ok(by.get(`/v1/work-items/${id}/links`), 200)).json() as WorkItemLinks).links;
const sharedDocumentsOf = (id: string) => async (by: Caller) => ((await ok(by.get(`/v1/work-items/${id}/shared`), 200)).json() as SharedWorkItem).documents;
const download = (id: string, documentId: string) => readById(`/v1/work-items/${id}/documents/${documentId}/download`);

/** The Documents the item's Documental Record holds, as the record job reads them (RP-147). */
const recordDocuments = async (id: string): Promise<string[]> =>
  (await sql<{ id: string }>`select id from app.documents_shared_before_close(${id}::uuid)`.execute(migrator)).rows.map((r) => r.id).sort();

/** Every other Participant on the item: K1, the Owner Representative and the Owner. */
const others = () => [k1Engineer, k1Manager, orEngineer, owner];

/** Once closed, `held` and its Link are C1's; what was handed over is everyone's, and the Record's. */
async function expectHandedOverOnly(item: Awaited<ReturnType<typeof heldAfterSendBack>>, label: string) {
  const { id } = item;
  await expectHiddenFrom({ read: documentsOf(id), target: item.held, seenBy: [engineer, pm], hiddenFrom: others(), name: nameOf, label: `${label}, the documents list` });
  await expectHiddenFrom({ read: download(id, item.held), idOf: () => item.held, target: item.held, seenBy: [engineer, pm], hiddenFrom: others(), name: nameOf, label: `${label}, a download by id` });
  await expectHiddenFrom({ read: linksOf(id), target: item.heldLink, seenBy: [engineer, pm], hiddenFrom: others(), name: nameOf, label: `${label}, the Links` });
  // What was handed over before is still everyone's.
  for (const viewer of [engineer, pm, ...others()]) {
    expect((await documentsOf(id)(viewer)).map((d) => d.id), `${label}: ${nameOf(viewer)} reads shared.pdf`).toContain(item.shared);
    expect((await linksOf(id)(viewer)).map((l) => l.id), `${label}: ${nameOf(viewer)} reads the Link to X`).toContain(item.sharedLink);
  }
  // The Download (`/shared`) is the item as everyone but its holder reads it: the holder too gets only shared.pdf.
  for (const viewer of [engineer, k1Engineer, owner]) expect((await sharedDocumentsOf(id)(viewer)).map((d) => d.id), `${label}: ${nameOf(viewer)}'s Download`).toEqual([item.shared]);
  // The live item and the sealed Record agree.
  expect((await documentsOf(id)(k1Engineer)).map((d) => d.id).sort(), `${label}: K1's Documents are the Record's`).toEqual(await recordDocuments(id));
  // C2, another Contractor, never sees the item.
  await expectHiddenFrom({ read: readById(`/v1/work-items/${id}`), target: id, seenBy: [engineer, k1Engineer], hiddenFrom: c2Engineer, name: nameOf, label: `${label}, the item` });
}

beforeAll(async () => {
  await addSendBackType(migrator, TYPE, { en: "Close shares handed over", ar: "الإغلاق يشارك ما سُلّم" }, schema, { withCancel: true });
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await otherParticipant("consultant");
  k1Engineer = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const or = await otherParticipant("owner_representative");
  orEngineer = await projectMember(api, or.company, or.participantId, ["engineer"]);
  const ow = await otherParticipant("owner");
  owner = await projectMember(api, ow.company, ow.participantId, ["representative"]);
  const c2 = await otherParticipant("contractor");
  c2Engineer = await projectMember(api, c2.company, c2.participantId, ["engineer"]);
  for (const [by, name] of [
    [engineer, "the C1 engineer"],
    [pm, "the C1 PM"],
    [k1Engineer, "the K1 engineer"],
    [k1Manager, "the K1 manager"],
    [orEngineer, "the OR engineer"],
    [owner, "the Owner's representative"],
    [c2Engineer, "the C2 engineer"],
  ] as const)
    names.set(by, name);

  x = await draftOf("CSHO-X");
  await submit(x);
  y = await draftOf("CSHO-Y");
  await submit(y);
});

describe("scenario RP-955-1: Rabaed cancels an item Sent Back to C1, because a Company left the Project", () => {
  it("keeps what C1 added after the Send Back C1's own; everyone else reads what was handed over, as the Record does", async () => {
    const item = await heldAfterSendBack("CSHO-1");
    // A Member's Cancel isn't offered once the item was Submitted (RP-433), so this is the one close today
    // that can find the holder's own additions.
    await ok(engineer.post(`/v1/work-items/${item.id}/pick-up`));
    const cancel = await tryTake(engineer, item.id, "cancel");
    expect([cancel.statusCode, cancel.json().error]).toEqual([409, "transition_not_available"]);
    // Rabaed's cancel (workflow-engine.md §9, RP-952; its command isn't built yet), as every close
    // writes it: the open Steps done, at the moment the item closes. The withdrawal itself isn't built
    // either, so C1's Members still see the item here: the rule is about its holder, whoever left.
    await sql`
      with closing as (select now() as at)
      , steps as (
        update step_assignment set status = 'done', done_at = (select at from closing), updated_at = (select at from closing)
        where work_item_id = ${item.id}::uuid and status in ('pooled', 'picked_up', 'vacant')
      )
      update work_item set outcome = 'cancelled', closed_at = (select at from closing), updated_at = (select at from closing) where id = ${item.id}::uuid
    `.execute(migrator);
    await expectHandedOverOnly(item, "RP-955-1");
  });
});

describe("scenario RP-955-2: a reply file the closing Code took is handed over with it", () => {
  it("is read by C1 and every other Participant who sees the item, and the Record holds it; C2 reads none", async () => {
    const id = await draftOf("CSHO-3");
    const shared = await uploadDocument(engineer, id, pdf("CSHO-3-shared.pdf"));
    await submit(id);
    await ok(k1Engineer.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Engineer, id, "send_to_manager");
    await ok(k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(k1Manager, id, "approve_a");
    // A file K1's manager put in the Code's reply Screen while holding the item, taken by the Code
    // (ADR 0024): the test Workflow's Code has no Screen, so the row is written as the take writes it.
    const reply = (
      await sql<{ id: string }>`
        insert into document (id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
          uploaded_by_member_id, uploaded_by_participant_id, confirmed_at, reply, field_key, reply_event_id)
        select d.id, e.project_id, e.work_item_id, 'CSHO-3-code.pdf', 10, 'application/pdf',
          app.document_storage_key(e.project_id, e.work_item_id, d.id),
          e.actor_member_id, e.actor_participant_id, e.created_at, true, 'code_files', e.id
        from work_item_event e, (select gen_random_uuid() as id) d
        where e.work_item_id = ${id}::uuid and e.type in ('transition', 'issue_code') and e.audience = 'shared'
        order by e.created_at desc, e.seq desc limit 1
        returning id
      `.execute(migrator)
    ).rows[0]!.id;
    // Added during the arrival the close follows (the insert stamps the current one, which the close
    // counts), and frozen by the Code.
    await sql`
      update document d set arrival = w.arrivals - 1, frozen_at = d.confirmed_at
      from work_item w where w.id = d.work_item_id and d.id = ${reply}::uuid
    `.execute(migrator);

    await expectHiddenFrom({ read: documentsOf(id), target: reply, seenBy: [engineer, pm, ...others()], hiddenFrom: c2Engineer, name: nameOf, label: "RP-955-2, the documents list" });
    await expectHiddenFrom({ read: download(id, reply), idOf: () => reply, target: reply, seenBy: [engineer, pm, ...others()], hiddenFrom: c2Engineer, name: nameOf, label: "RP-955-2, a download by id" });
    expect((await documentsOf(id)(engineer)).map((d) => d.id).sort(), "C1's Documents are the Record's").toEqual(await recordDocuments(id));
    expect(await recordDocuments(id)).toEqual([shared, reply].sort());
  });
});
