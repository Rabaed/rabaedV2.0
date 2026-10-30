// Seam 1 for scenario RP-435-1 (RP-435, WF-12; workflow-engine.md §5.5; visibility.md V1, E1, E3).
// K1 closes C1's MAR with Code D; C1's engineer creates a replacement (a new Draft linked "replaces"
// to it), later sends it for review, and the PM Submits it. While it is a Draft, K1 and the Owner, who
// see the rejected MAR, read nothing of the replacement (item, events, Documents, answers, history,
// Links), and the rejected MAR's Links and Linked from don't name it; they can't create one, nor can C1
// a second, and every refusal reads alike. It takes a new Document Number at its first Send (no Rev).
// Once Submitted, it is in the rejected MAR's Linked from by number and Subject (E3), and lists the
// rejected MAR under its Links (E1). Seam 2: packages/db/test/revision-rls.test.ts. The wider
// replacement behaviour: replacements.test.ts.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { expectHiddenFrom, LEGACY_MAR, testDatabaseUrls } from "@rabaed/db/test-support";
import type { ActivityFeed, DocumentList, LinkedFrom, RevisionChain, WorkItemLinks } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, readById, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, ok, projectMember, take, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const SUBJECT = "Rejected fixtures";
const complete = { manufacturer: "Philips", description: "LED fixtures", items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }] };

let c1: Company; // Its Authorized Person created the Project.
let engineer: Caller; // C1 engineer: raises the MAR and its replacement.
let pm: Caller; // C1 PM: Submits.
let k1Engineer: Caller;
let k1Manager: Caller; // Issues the Code.
let owPm: Caller; // The Owner.
let stranger: Caller; // A Company on no Project of these.
let projectId = "";
let rejected = "";
let base = ""; // The rejected MAR's Document Number.
let replacement = "";

const names = new Map<Caller, string>();
const named = (by: Caller) => names.get(by) ?? "someone";
type Read = (by: Caller) => Promise<readonly { id: string }[]>;
/** A read by id that gives no list of ids: one row of `id` when `by` may read it. */
const asItem = (path: string, id: string): Read => async (by) => (await readById<unknown>(path)(by)).map(() => ({ id }));
const item = (id: string): Read => readById(`/v1/work-items/${id}`);
const documentsOf = (id: string): Read => async (by) => (await readById<DocumentList>(`/v1/work-items/${id}/documents`)(by)).flatMap((l) => l.documents);
const chainOf = (id: string): Read => async (by) => (await readById<RevisionChain>(`/v1/work-items/${id}/revisions`)(by)).flatMap((c) => c.revisions);
const listed: Read = async (by) => (await ok(by.get(`/v1/projects/${projectId}/work-items`), 200)).json().items;
/** The Activity Feed's entries, as the items they are of. */
const activity: Read = async (by) => ((await ok(by.get(`/v1/projects/${projectId}/activity`), 200)).json() as ActivityFeed).entries.map((e) => ({ id: e.workItem.id }));
const links = async (by: Caller, id: string): Promise<WorkItemLinks> => (await ok(by.get(`/v1/work-items/${id}/links`), 200)).json();
const linkedFrom = async (by: Caller, id: string): Promise<LinkedFrom> => (await ok(by.get(`/v1/work-items/${id}/linked-from`), 200)).json();
const linkedFromOf = (id: string): Read => async (by) => (await linkedFrom(by, id)).items.map((i) => ({ id: i.workItemId ?? "" }));
const createReplacement = (by: Caller, id: string) => by.post(`/v1/work-items/${id}/replacements`, { idempotencyKey: randomUUID() });
const refusal = async (by: Caller, id: string) => {
  const res = await createReplacement(by, id);
  return { status: res.statusCode, body: res.json() };
};

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  const buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })).json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`)).json().participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const participant = async (role: "consultant" | "owner") => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return { company, participantId };
  };
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await participant("consultant");
  k1Engineer = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const ow = await participant("owner");
  owPm = await projectMember(api, ow.company, ow.participantId, ["project_manager"]);
  stranger = (await api.authorizedPerson()).caller;
  for (const [by, name] of [[engineer, "C1 engineer"], [pm, "C1 PM"], [k1Engineer, "K1 engineer"], [k1Manager, "K1 manager"], [owPm, "Owner"], [stranger, "stranger"]] as const)
    names.set(by, name);

  // C1's MAR, Submitted to K1, who closes it. The default MAR Workflow ends in A and C only, so the
  // outcome is set to D directly, as the Workflow engine's own D Transition would leave it (as replacements.test.ts).
  rejected = (
    await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: LEGACY_MAR, title: SUBJECT, answers: { ...complete, trade: electrical, location: buildingA } }), 201)
  ).json().id;
  await attachDatasheet(engineer, rejected);
  await uploadDocument(engineer, rejected, { fileName: "wiring.pdf", contentType: "application/pdf", body: "%PDF-1.7 wiring" });
  await take(engineer, rejected, "send_for_review");
  await ok(pm.post(`/v1/work-items/${rejected}/pick-up`));
  await take(pm, rejected, "submit");
  await ok(k1Manager.post(`/v1/work-items/${rejected}/pick-up`));
  await take(k1Manager, rejected, "revise_c", { remarks: "Rejected: not to specification" });
  await sql`update work_item set outcome = 'D' where id = ${rejected}::uuid`.execute(migrator);
  base = (await detail(engineer, rejected)).documentNumber!;
  replacement = (await ok(createReplacement(engineer, rejected), 201)).json().id;
});

describe("scenario RP-435-1: a replacement of C1's MAR that K1 closed with Code D", () => {
  it("is C1's Draft, linked 'replaces' to the rejected MAR, which K1 and the Owner see", async () => {
    expect(await detail(engineer, replacement)).toMatchObject({ documentNumber: null, revisionNo: 0, stage: { key: "draft" }, title: SUBJECT });
    expect((await links(engineer, replacement)).links).toEqual([expect.objectContaining({ kind: "replaces", documentNumber: base, workItemId: rejected })]);
    for (const who of [k1Engineer, k1Manager, owPm]) expect(await detail(who, rejected), named(who)).toMatchObject({ id: rejected, outcome: "D", documentNumber: base });
  });

  it("gives K1 and the Owner nothing of it while it is a Draft: item, answers, events, Documents, history, Links", async () => {
    const seenBy = [engineer, pm];
    const hiddenFrom = [k1Engineer, k1Manager, owPm, stranger];
    const hidden = (read: Read, target: string, label: string) => expectHiddenFrom({ read, target, seenBy, hiddenFrom, name: named, label });
    await hidden(item(replacement), replacement, "the replacement (with its answers)");
    await hidden(asItem(`/v1/work-items/${replacement}/form`, replacement), replacement, "its Form and answers");
    await hidden(asItem(`/v1/work-items/${replacement}/history`, replacement), replacement, "its history");
    await hidden(asItem(`/v1/work-items/${replacement}/workflow`, replacement), replacement, "its Workflow map");
    await hidden(asItem(`/v1/work-items/${replacement}/links`, replacement), replacement, "its Links");
    await hidden(asItem(`/v1/work-items/${replacement}/linked-from`, replacement), replacement, "its Linked from");
    await hidden(chainOf(replacement), replacement, "its drop-down");
    const copy = (await documentsOf(replacement)(engineer))[0]!.id;
    await hidden(documentsOf(replacement), copy, "its copied Document");
    await hidden(asItem(`/v1/work-items/${replacement}/documents/${copy}/download`, copy), copy, "its copied Document's download");
    const onProject = (read: Read, label: string) => expectHiddenFrom({ read, target: replacement, seenBy, hiddenFrom: [k1Engineer, k1Manager, owPm], name: named, label });
    await onProject(listed, "the item List");
  });

  it("is named by neither the rejected MAR's Links nor its Linked from while it is a Draft, for C1 too", async () => {
    for (const who of [engineer, k1Manager, owPm]) {
      expect((await links(who, rejected)).links, named(who)).toEqual([]); // not hidden-from: the rejected MAR has no Link of its own, for C1 either (seam 2)
      expect((await linkedFromOf(rejected)(who)).map((r) => r.id), named(who)).not.toContain(replacement); // not hidden-from: nobody reads it before Submit, C1 included; the same read names it once Submitted (below)
      expect(JSON.stringify(await linkedFrom(who, rejected)), named(who)).not.toContain(replacement); // not hidden-from: nor its id anywhere in it, for C1 either; named once Submitted (below)
    }
  });

  it("can't be created by K1 or the Owner, nor a second time by C1, and every refusal reads alike", async () => {
    const refused = { status: 409, body: { error: "replacement_not_allowed" } };
    for (const who of [k1Engineer, k1Manager, owPm]) {
      expect((await detail(who, rejected)).actions.createReplacement, named(who)).toBe(false);
      expect(await refusal(who, rejected), named(who)).toEqual(refused);
    }
    expect((await detail(engineer, rejected)).actions.createReplacement).toBe(false);
    expect(await refusal(engineer, rejected)).toEqual(refused);
    // Whoever can't see the rejected MAR gets the plain 404.
    await expectHiddenFrom({ read: item(rejected), target: rejected, seenBy: [engineer, k1Manager, owPm], hiddenFrom: stranger, name: named, label: "the rejected MAR" });
    await expectHidden(createReplacement(stranger, rejected)); // not hidden-from: a refused write; the read above proves the row with expectHiddenFrom
    // K1 and the Owner still read nothing of the one C1 has.
    await expectHiddenFrom({ read: item(replacement), target: replacement, seenBy: engineer, hiddenFrom: [k1Manager, owPm], name: named, label: "the replacement" });
  });

  it("takes a new Document Number at its first Send, with no Rev, and stays C1's in its review", async () => {
    await take(engineer, replacement, "send_for_review");
    const d = await detail(engineer, replacement);
    expect(d.documentNumber).not.toBe(base);
    expect(d.documentNumber).not.toContain("Rev"); // not hidden-from: the number's own text, a new number and not a Revision's
    expect(d.documentNumber).toMatch(/-\d{4}$/);
    expect(d.revisionNo).toBe(0);
    await expectHiddenFrom({ read: item(replacement), target: replacement, seenBy: [engineer, pm], hiddenFrom: [k1Engineer, k1Manager, owPm], name: named, label: "in C1's review" });
    // Its Send is the first event of it the Activity Feed lists: C1's alone.
    await expectHiddenFrom({ read: activity, target: replacement, seenBy: [engineer, pm], hiddenFrom: [k1Engineer, k1Manager, owPm], name: named, label: "the Activity Feed's events" });
    for (const who of [engineer, k1Manager, owPm]) expect((await linkedFromOf(rejected)(who)).map((r) => r.id), named(who)).not.toContain(replacement); // not hidden-from: nobody reads it before Submit; the same read names it below
  });

  it("once Submitted, is in the rejected MAR's Linked from by number and Subject (E3), and lists it under its Links (E1)", async () => {
    await ok(pm.post(`/v1/work-items/${replacement}/pick-up`));
    await take(pm, replacement, "submit");
    const number = (await detail(engineer, replacement)).documentNumber!;
    for (const who of [engineer, k1Manager, owPm]) {
      expect(await detail(who, replacement), named(who)).toMatchObject({ id: replacement, documentNumber: number });
      expect((await linkedFrom(who, rejected)).items, named(who)).toEqual([{ documentNumber: number, subject: SUBJECT, workItemId: replacement }]);
      expect((await links(who, replacement)).links, named(who)).toEqual([
        expect.objectContaining({ kind: "replaces", documentNumber: base, subject: SUBJECT, workItemId: rejected }),
      ]);
    }
  });
});
