// Seam 1 for replacements (RP-435, WF-12; spec RP-423; workflow-engine.md §5.5
// and §6; visibility.md V1, E1, E3). An item closed with an outcome that offers a
// replacement (Code D in the Rabaed Defaults) lets its raiser create a NEW Work
// Item: not a Revision, so it takes a new Document Number when it first leaves
// Draft. It starts as a Draft prefilled with the source's answers and Documents
// and is linked to the source ("replaces"). Until it is Submitted nobody outside
// the raiser sees it, nor does the source's Linked from list it. What the item
// page offers (Create Revision, Create replacement) follows the outcome's
// follow-up actions in its Type's set, never a fixed code.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, LinkedFrom, TypeOutcomes, WorkItemLinks } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company; // Its Authorized Person created the Project: a Project Admin.
let engineer: Caller; // C1 engineer: raises the MARs and their replacements.
let pm: Caller; // C1 PM: Submits.
let viewer: Caller; // C1 Member without a Position: the Draft Step doesn't allow them.
let k1Engineer: Caller;
let k1Manager: Caller;
let orEngineer: Caller; // Owner Representative (oversight).
let stranger: Caller; // A Company on no Project of these.
let projectId = "";
let electrical = "";
let buildingA = "";

const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};

const saveOver = async (by: Caller, id: string, changes: Record<string, unknown>) =>
  ok(by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(by, id)).answers, ...changes } }));
const createReplacement = (by: Caller, id: string, idempotencyKey: string = randomUUID()) =>
  by.post(`/v1/work-items/${id}/replacements`, { idempotencyKey });
const createRevision = (by: Caller, id: string) => by.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() });
const replacementOf = async (id: string) => (await ok(createReplacement(engineer, id), 201)).json().id as string;
const links = async (by: Caller, id: string): Promise<WorkItemLinks> => (await ok(by.get(`/v1/work-items/${id}/links`), 200)).json();
const linkedFrom = async (by: Caller, id: string): Promise<LinkedFrom> => (await ok(by.get(`/v1/work-items/${id}/linked-from`), 200)).json();
const counters = async () => (await ok(c1.caller.get(`/v1/projects/${projectId}/numbering/counters`), 200)).json().counters;

/** Sends a Draft for review and Submits it to K1. */
async function submit(id: string) {
  await take(engineer, id, "send_for_review");
  await ok(pm.post(`/v1/work-items/${id}/claim`));
  await take(pm, id, "submit");
}

/** K1 verifies the submitted item and issues Code C. */
async function codeC(id: string) {
  await saveOver(k1Engineer, id, { sample_checked: true, matches_specification: false, verification_note: "Below the specified efficacy" });
  await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
  await take(k1Manager, id, "revise_c", { remarks: "Resubmit with 110 lm/W luminaires" });
}

/** A MAR with its datasheet, and the Attachments named, closed at Code C. */
async function closedAtCodeC(title: string, attachments: string[] = []): Promise<string> {
  const res = await ok(
    engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title, answers: { ...complete, trade: electrical, location: buildingA } }),
    201,
  );
  const id = res.json().id as string;
  await attachDatasheet(engineer, id);
  for (const fileName of attachments) await uploadDocument(engineer, id, { fileName, contentType: "application/pdf", body: `%PDF-1.7 ${fileName}` });
  await submit(id);
  await codeC(id);
  return id;
}

/**
 * A MAR closed with Code D. The default MAR Workflow ends in A and C only, so the
 * outcome is set directly, as the Workflow engine's own D Transition would leave it.
 */
async function closedAtCodeD(title: string, attachments: string[] = []): Promise<string> {
  const id = await closedAtCodeC(title, attachments);
  await sql`update work_item set outcome = 'D' where id = ${id}::uuid`.execute(migrator);
  return id;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const otherParticipant = async (role: "consultant" | "owner_representative") => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return { company, participantId };
  };
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  viewer = await projectMember(api, c1, own, []);
  const k1 = await otherParticipant("consultant");
  k1Engineer = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const or = await otherParticipant("owner_representative");
  orEngineer = await projectMember(api, or.company, or.participantId, ["engineer"]);
  stranger = (await api.authorizedPerson()).caller;
});

describe("what the item page offers follows the outcome's follow-up actions", () => {
  it("offers a Revision after Code C and a replacement after Code D, never both", async () => {
    const c = await closedAtCodeC("Offered after C");
    const d = await closedAtCodeD("Offered after D");
    expect((await detail(engineer, c)).actions).toMatchObject({ createRevision: true, createReplacement: false });
    expect((await detail(engineer, d)).actions).toMatchObject({ createRevision: false, createReplacement: true });
    expect((await createReplacement(engineer, c)).statusCode).toBe(409);
    expect((await createRevision(engineer, d)).statusCode).toBe(409);
  });

  it("is offered to the Members the Draft Step allows, and to nobody else", async () => {
    const d = await closedAtCodeD("Offered to the raiser");
    for (const who of [engineer, pm]) expect((await detail(who, d)).actions.createReplacement).toBe(true);
    for (const who of [viewer, k1Engineer, k1Manager, orEngineer]) expect((await detail(who, d)).actions.createReplacement).toBe(false);
  });

  it("is refused alike for every reason but a hidden item (404), and for an item still open", async () => {
    const d = await closedAtCodeD("Refused");
    for (const who of [viewer, k1Manager, orEngineer]) {
      const res = await createReplacement(who, d);
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "replacement_not_allowed" } });
    }
    await expectHidden(createReplacement(stranger, d));
    await expectHidden(createReplacement(engineer, randomUUID()));
    const open = (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Open", answers: { ...complete, trade: electrical } }), 201))
      .json().id as string;
    expect((await createReplacement(engineer, open)).statusCode).toBe(409);
    expect((await detail(engineer, open)).actions.createReplacement).toBe(false);
  });

  it("follows the Type's outcome set: a Project Admin makes Code C offer a replacement instead of a Revision", async () => {
    const base = `/v1/projects/${projectId}/work-item-types/MAR/outcomes`;
    const path = `${base}/C`;
    const set: TypeOutcomes = (await ok(c1.caller.get(base), 200)).json();
    const c = set.outcomes.find((o) => o.code === "C")!;
    expect(c.actions).toEqual([{ kind: "offer_revision" }]);
    const item = await closedAtCodeC("Offered by the set");
    expect((await detail(engineer, item)).actions).toMatchObject({ createRevision: true, createReplacement: false });
    try {
      await ok(c1.caller.request("PATCH", path, { name: c.name, actions: [{ kind: "offer_replacement" }] }));
      expect((await detail(engineer, item)).actions).toMatchObject({ createRevision: false, createReplacement: true });
      expect((await createRevision(engineer, item)).statusCode).toBe(409);
      expect((await ok(createReplacement(engineer, item), 201)).json().id).toEqual(expect.any(String));
    } finally {
      await ok(c1.caller.request("PATCH", path, { name: c.name, actions: c.actions }));
    }
  });
});

describe("C1 creates a replacement of a MAR that got Code D", () => {
  let rejected = "";
  let base = "";
  let replacement = "";
  beforeAll(async () => {
    rejected = await closedAtCodeD("Rejected fixtures", ["wiring.pdf", "drawings.pdf"]);
    base = (await detail(engineer, rejected)).documentNumber!;
    replacement = await replacementOf(rejected);
  });

  it("is a new Draft with no number yet, not a Revision, with the raiser's answers and none of the Consultant's", async () => {
    const d = await detail(engineer, replacement);
    expect(d).toMatchObject({
      title: "Rejected fixtures",
      documentNumber: null,
      revisionNo: 0,
      stage: { key: "draft" },
      outcome: null,
      answers: { ...complete, trade: electrical, location: buildingA },
    });
    for (const key of ["sample_checked", "matches_specification", "verification_note"]) expect(d.answers).not.toHaveProperty(key);
    expect(d.actions).toMatchObject({ saveAnswers: true, discardRevision: false, createReplacement: false });
    // The rejected item stays closed, with its Code and number.
    expect(await detail(engineer, rejected)).toMatchObject({ outcome: "D", revisionNo: 0, documentNumber: base });
  });

  it("has the Documents copied as new rows the raiser can still change", async () => {
    const original: DocumentList = (await ok(engineer.get(`/v1/work-items/${rejected}/documents`), 200)).json();
    const copied: DocumentList = (await ok(engineer.get(`/v1/work-items/${replacement}/documents`), 200)).json();
    expect(copied.documents.map((d) => [d.fileName, d.fieldKey, d.frozen])).toEqual([
      ["datasheet.pdf", "datasheet", false],
      ["wiring.pdf", null, false],
      ["drawings.pdf", null, false],
    ]);
    expect(copied.documents.map((d) => d.id)).not.toEqual(expect.arrayContaining(original.documents.map((d) => d.id)));
    expect(copied.canChange).toBe(true);
    const url = async (item: string, id: string) => (await ok(engineer.get(`/v1/work-items/${item}/documents/${id}/download`), 200)).json().url as string;
    const copy = await fetch(await url(replacement, copied.documents[0]!.id));
    const source = await fetch(await url(rejected, original.documents[0]!.id));
    expect(copy.status).toBe(200);
    expect(await copy.text()).toBe(await source.text());
  });

  it("links to the rejected item as 'replaces', which only the raiser reads while it is a Draft", async () => {
    expect((await links(engineer, replacement)).links).toEqual([
      expect.objectContaining({ kind: "replaces", documentNumber: base, workItemId: rejected }),
    ]);
    // The rejected item's own Links and Linked from don't reach the Draft (V1).
    for (const who of [engineer, k1Manager, orEngineer]) {
      expect(JSON.stringify(await links(who, rejected))).not.toContain(replacement);
      expect(JSON.stringify(await linkedFrom(who, rejected))).not.toContain(replacement);
    }
    // Nor can the Link be removed like a free Link.
    const link = (await links(engineer, replacement)).links[0]!;
    await expectHidden(engineer.request("DELETE", `/v1/work-items/${replacement}/links/${link.id}`));
  });

  it("is hidden from K1, the Owner Representative and strangers while it is a Draft (V1)", async () => {
    for (const who of [k1Engineer, k1Manager, orEngineer, stranger]) {
      await expectHidden(who.get(`/v1/work-items/${replacement}`));
      await expectHidden(who.get(`/v1/work-items/${replacement}/history`));
      await expectHidden(who.get(`/v1/work-items/${replacement}/documents`));
      await expectHidden(who.get(`/v1/work-items/${replacement}/links`));
    }
    for (const who of [k1Manager, orEngineer]) {
      const list = (await ok(who.get(`/v1/projects/${projectId}/work-items`), 200)).json();
      expect(list.items.map((i: { id: string }) => i.id)).not.toContain(replacement);
    }
  });

  it("is offered once: no second replacement while this one stands, and the same key answers with the same one", async () => {
    const again = await createReplacement(engineer, rejected);
    expect({ status: again.statusCode, body: again.json() }).toEqual({ status: 409, body: { error: "replacement_not_allowed" } });
    expect((await detail(engineer, rejected)).actions.createReplacement).toBe(false);

    const other = await closedAtCodeD("Idempotent");
    const key = randomUUID();
    const first = (await ok(createReplacement(engineer, other, key), 201)).json().id;
    expect((await ok(createReplacement(engineer, other, key), 201)).json().id).toBe(first);
    // A key used for another item is refused as such.
    const reused = await createReplacement(engineer, rejected, key);
    expect({ status: reused.statusCode, body: reused.json() }).toEqual({ status: 422, body: { error: "idempotency_key_reused" } });
  });

  it("takes a NEW Document Number when it first leaves Draft, not the rejected item's with a Rev", async () => {
    const before = await counters();
    await take(engineer, replacement, "send_for_review");
    const number = (await detail(engineer, replacement)).documentNumber!;
    expect(number).not.toBe(base);
    expect(number).not.toContain("Rev");
    expect(number).toMatch(/-\d{4}$/);
    expect(await counters()).not.toEqual(before);
    expect((await detail(engineer, replacement)).revisionNo).toBe(0);
  });

  it("shows the replacement and the rejected item to each other once it is Submitted (E1, E3)", async () => {
    await expectHidden(k1Manager.get(`/v1/work-items/${replacement}`));
    await ok(pm.post(`/v1/work-items/${replacement}/claim`));
    await take(pm, replacement, "submit");
    const number = (await detail(k1Manager, replacement)).documentNumber!;
    for (const who of [engineer, k1Manager, orEngineer]) {
      expect((await links(who, replacement)).links).toEqual([expect.objectContaining({ kind: "replaces", documentNumber: base, workItemId: rejected })]);
      expect((await linkedFrom(who, rejected)).items).toEqual([expect.objectContaining({ documentNumber: number, workItemId: replacement })]);
    }
  });
});

describe("a replacement that is cancelled", () => {
  it("frees the rejected item for another", async () => {
    const rejected = await closedAtCodeD("Cancelled once");
    const first = await replacementOf(rejected);
    expect((await createReplacement(engineer, rejected)).statusCode).toBe(409);
    // The default MAR Workflow has no Cancel Transition; a Workflow that has one leaves the item so.
    await sql`update work_item set outcome = 'cancelled', closed_at = now() where id = ${first}::uuid`.execute(migrator);
    expect((await detail(engineer, rejected)).actions.createReplacement).toBe(true);
    const second = await replacementOf(rejected);
    expect(second).not.toBe(first);
  });
});
