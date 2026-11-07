// Seam 1 for the Member ids on an item's events and Documents (RP-1139; visibility.md V14; scenarios
// RP-1139-2 to RP-1139-4): with `work_item_event.actor_member_id` and `document.uploaded_by_member_id`
// no longer granted, the api still names each viewer's own Company's people (the Documents' uploader,
// the history's actor, a closed card's closer) and another Company by its name only, and no response
// carries another Company's Member id. C1's Submittal goes through K1's Recommendation to the Owner's
// review, which closes it. Seam 2: packages/db/test/rp-1139-visibility-rls.test.ts.
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemBoard, WorkItemHistory } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, uploadDocument, type Caller } from "./support/harness.ts";
import { addOwnerReviewType } from "./support/owner-review.ts";
import { all, bilingual, buildTower, memberOnProject, ok, only, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const OWNER_TYPE = "RPMID";
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

let at: Tower;
let id = "";
type Person = { id: string; caller: Caller; name: string };
let c1Engineer: Person;
let c1Pm: Person;
let k1Manager: Person;
let owPm: Person;
let c2Engineer: Person;
const people: Person[] = [];
const named = (by: Caller) => people.find((p) => p.caller === by)?.name ?? "someone";
const pdf = (fileName: string) => ({ fileName, contentType: "application/pdf", body: `%PDF-1.7 ${fileName} (test)` });

type DocumentsRead = { documents: { id: string; uploadedBy: { companyName: { en: string }; memberName: { en: string } | null } }[] };
/** The uploader names `by` reads on the item's Documents; nothing when the item isn't theirs to read. */
const uploadersRead = async (by: Caller) => {
  const res = await by.get(`/v1/work-items/${id}/documents`);
  if (res.statusCode !== 200) return [];
  return (res.json() as DocumentsRead).documents.flatMap((d) => (d.uploadedBy.memberName ? [{ id: d.uploadedBy.memberName.en }] : []));
};
/** The actor names `by` reads in the item's history. */
const actorsRead = async (by: Caller) => {
  const res = await by.get(`/v1/work-items/${id}/history`);
  if (res.statusCode !== 200) return [];
  return (res.json() as WorkItemHistory).events.flatMap((e) => (e.by.memberName ? [{ id: e.by.memberName.en }] : []));
};
/** Every response `by` gets for the item that could carry a Member id, as one text. */
const responses = async (by: Caller) =>
  (
    await Promise.all(
      [`/v1/work-items/${id}/documents`, `/v1/work-items/${id}/history`, `/v1/work-items/${id}`, `/v1/projects/${at.projectId}/work-items/kanban`].map((url) =>
        by.get(url),
      ),
    )
  )
    .map((r) => r.body)
    .join("\n");

beforeAll(async () => {
  await addOwnerReviewType(migrator, OWNER_TYPE, schema);
  const c1 = await api.projectCreator();
  const onboard = async (name: string): Promise<Company> => {
    const onboarded = await api.onboardCompany({ legalName: bilingual(name) }); // not hidden-from: onboards the Company by its name
    return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  };
  const k1 = await onboard("Member Id Consultants LLC");
  const ow = await onboard("Member Id Owner Holding");
  const c2 = await onboard("Member Id Second Contractor");
  at = await buildTower(api, { c1, k1 }, "RPM");
  const owParticipant = await api.addParticipant(c1.caller, at.projectId, ow.company, "owner");
  await ok(c1.caller.request("PUT", `/v1/participants/${owParticipant}/visibility`, { trade: all, location: all }));
  // C2, a second Contractor, covers Mechanical only: C1's Electrical item is not theirs to see.
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: only(at.mechanical), location: all }));
  const person = async (company: Pick<Company, "caller">, participant: string, positions: string[], name: string): Promise<Person> => {
    const m = await memberOnProject(api, company, participant, positions, { name });
    const p = { id: m.id, caller: m.caller, name };
    people.push(p);
    return p;
  };
  c1Engineer = await person(c1, at.c1ParticipantId, ["engineer"], "Hadi Engineer C1");
  c1Pm = await person(c1, at.c1ParticipantId, ["project_manager"], "Rami Manager C1");
  k1Manager = await person(k1, at.k1ParticipantId!, ["manager"], "Sami Manager K1");
  owPm = await person(ow, owParticipant, ["project_manager"], "Nora Manager OW");
  c2Engineer = await person(c2, c2Participant, ["engineer"], "Omar Engineer C2");

  const answers = { model: "Switchgear", trade: at.electrical, location: at.buildingA };
  id = (await ok(c1Engineer.caller.post(`/v1/projects/${at.projectId}/work-items`, { type: OWNER_TYPE, title: "Switchgear", answers }), 201)).json().id as string;
  await uploadDocument(c1Engineer.caller, id, pdf("c1-datasheet.pdf"));
  await take(c1Engineer.caller, id, "send_for_review");
  await ok(c1Pm.caller.post(`/v1/work-items/${id}/pick-up`));
  await take(c1Pm.caller, id, "submit");
  await ok(k1Manager.caller.post(`/v1/work-items/${id}/pick-up`));
  await take(k1Manager.caller, id, "recommend_a");
});

describe("scenario RP-1139-2: C1 at the Owner's review, and after it closes, reads no other Company's actor", () => {
  it("the history names K1's manager to K1 only, and C1's PM to C1 only", async () => {
    const cOne = [c1Engineer.caller, c1Pm.caller];
    await expectHiddenFrom({ read: actorsRead, target: k1Manager.name, seenBy: k1Manager.caller, hiddenFrom: [...cOne, c2Engineer.caller], name: named, label: "K1's manager in the history" });
    await expectHiddenFrom({ read: actorsRead, target: c1Pm.name, seenBy: cOne, hiddenFrom: [k1Manager.caller, owPm.caller, c2Engineer.caller], name: named, label: "C1's PM in the history" });
  });

  it("closed by the Owner: the card names the Owner's person to the Owner, the Owner by name only to C1 and K1", async () => {
    await ok(owPm.caller.post(`/v1/work-items/${id}/pick-up`));
    await take(owPm.caller, id, "confirm_a");
    const closer = async (by: Caller) => {
      const res = await by.get(`/v1/projects/${at.projectId}/work-items/kanban`);
      const card = (res.json() as WorkItemBoard).columns.flatMap((c) => c.lanes.flatMap((l) => l.cards)).find((c) => c.id === id);
      return card?.closedBy?.kind === "own" ? [{ id: card.closedBy.name.en }] : [];
    };
    await expectHiddenFrom({ read: closer, target: owPm.name, seenBy: owPm.caller, hiddenFrom: [c1Engineer.caller, c1Pm.caller, k1Manager.caller, c2Engineer.caller], name: named, label: "the Owner's closer" });
  });
});

describe("scenario RP-1139-3: another Company reads a Document's Company, never its uploader", () => {
  it("names C1's engineer to C1 only", async () => {
    const cOne = [c1Engineer.caller, c1Pm.caller];
    await expectHiddenFrom({ read: uploadersRead, target: c1Engineer.name, seenBy: cOne, hiddenFrom: [k1Manager.caller, owPm.caller, c2Engineer.caller], name: named, label: "C1's uploader" });
  });

  it("gives K1 C1's Document with C1's Company name", async () => {
    const res = (await ok(k1Manager.caller.get(`/v1/work-items/${id}/documents`), 200)).json() as DocumentsRead;
    const ids = (r: DocumentsRead) => r.documents.map((d) => d.id).sort();
    const c1Read = (await ok(c1Engineer.caller.get(`/v1/work-items/${id}/documents`), 200)).json() as DocumentsRead;
    // K1 reads C1's Document (a Company, no person), so the hidden name above is the column, not the row.
    expect(ids(res)).toEqual(expect.arrayContaining(ids(c1Read)));
    expect(res.documents.find((d) => d.id === c1Read.documents[0]!.id)!.uploadedBy.memberName).toBeNull();
  });
});

describe("scenario RP-1139-4: no response carries another Company's Member id", () => {
  it("each Member's id shows to its own Company only, across documents, history, the item and the Kanban", async () => {
    const idsIn = (memberId: string) => async (by: Caller) => ((await responses(by)).includes(memberId) ? [{ id: memberId }] : []);
    // A Member's own id may reach its own Company's reads (an own uploader); only other Companies' reads are asked.
    for (const [target, hiddenFrom] of [
      [k1Manager, [c1Engineer, c1Pm, owPm, c2Engineer]],
      [c1Engineer, [k1Manager, owPm, c2Engineer]],
      [owPm, [c1Engineer, c1Pm, k1Manager, c2Engineer]],
    ] as const) {
      for (const by of hiddenFrom) expect(await idsIn(target.id)(by.caller), `${by.name} reads ${target.name}'s id`).toEqual([]); // not hidden-from: these reads give no Member id to anyone, so none can be the control; seam 2's tests prove the ids with one
    }
  });
});
