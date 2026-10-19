// Seam 1 for the Rabaed Default MAR Workflow Version 3 and MAR Form Version 5 (RP-437,
// WF-14; spec RP-423, RP-511; ADR 0019, ADR 0020; workflow-engine.md §1, §5.7;
// visibility.md V5, V14, scenario RP-437-1).
//
// The seam suites' global setup runs the demo seed, which publishes the Rabaed Defaults
// (`pnpm defaults:publish`), so a new MAR runs the documents in apps/admin: Draft →
// Send for Review → Internal Review / Contractor PM; a Return goes to the Contractor
// Engineer Step, where the Datasheet can be replaced until the Submit; the Submit's
// Screen has the shared Cover Note; the Consultant Engineer answers in the "Consultant
// review" Screen (verification, internal) with a Recommended Code and sends it to the
// Manager, who may Return it to the Engineer or issue A, B, C or D on its Code Screen,
// whose final verification is pre-filled from the Engineer's reply and shared with
// the Code.
import { readFileSync } from "node:fs";
import { publishRabaedDefaults, rabaedDefaultTypes } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { sql } from "kysely";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { DocumentList, FormVersion, WorkItemHistory } from "@rabaed/domain";
import { DEMO_ENGINEER_EMAIL } from "../src/demo/seed.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, uploadDocument, type Caller } from "./support/harness.ts";
import { all, bilingual, detail, ok, projectMember, take, tryTake, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let projectId = "";
let electrical = "";
let buildingA = "";
let hafiz: Caller; // C1 Contractor Engineer: the author.
let ali: Caller; // C1's only Project Manager: holds Contractor PM at once.
let ahmed: Caller; // K1 Consultant Engineer.
let mohammed: Caller; // K1's only Manager: holds Consultant Manager at once.
let faisal: Caller; // O1, Owner Representative: oversight.
let yousef: Caller; // C2, a second Contractor covering the same.

let supplier = ""; // Electrical's approved supplier: the MAR Form asks for one to leave Draft (RP-595).
const answers = (title: string) => ({
  manufacturer: "Philips",
  supplier,
  model: title,
  description: "LED panels",
  items: [{ fixture_type: "Recessed panel", quantity: 10, unit: "pcs" }],
  trade: electrical,
  location: buildingA,
});
const datasheet = (by: Caller, id: string, fileName: string) =>
  uploadDocument(by, id, { fieldKey: "datasheet", fileName, contentType: "application/pdf", body: `%PDF-1.7 ${fileName}` });
const history = async (by: Caller, id: string): Promise<WorkItemHistory["events"]> =>
  ((await ok(by.get(`/v1/work-items/${id}/history`), 200)).json() as WorkItemHistory).events;
const transitionsOf = async (by: Caller, id: string) => (await detail(by, id)).actions.transitions;

/** A MAR raised by Hafiz with its Datasheet and sent; Ali Submits it with `coverNote` and an Internal Note. */
async function submitted(title: string, coverNote = "Panels for Level 2, as drawing E-201") {
  const id = (await ok(hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title, answers: answers(title) }), 201)).json().id as string;
  await datasheet(hafiz, id, `${title}.pdf`);
  await take(hafiz, id, "send_for_review");
  await take(ali, id, "submit", { answers: { cover_note: coverNote }, internalNote: "PM: quantities checked against BOQ" });
  return id;
}

const verified = { sample_checked: true, matches_specification: true };
const notMatching = { sample_checked: true, matches_specification: false, verification_note: "Wrong colour temperature" };

/** Ahmed, K1's only Consultant Engineer, holds the MAR at once and sends it to the Manager with his reply, a Recommended Code and an Internal Note. */
async function reviewed(id: string, reply: Record<string, unknown>, recommendedCode: string) {
  await take(ahmed, id, "send_to_manager", { answers: reply, recommendedCode, internalNote: "Engineer: compared with the approved sample" });
}

beforeAll(async () => {
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const o1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  projectId = (await api.createProject(c1.caller, { code: "MV3" })).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id as string;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  supplier = await post("approved-suppliers", { tradeId: electrical, scopeId: null, name: bilingual("Philips Lighting") });
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id as string;
  const participant = async (company: Company, role: "consultant" | "owner_representative" | "contractor") => {
    const id = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${id}/visibility`, { trade: all, location: all }));
    return id;
  };
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await participant(k1, "consultant");
  const o1ParticipantId = await participant(o1, "owner_representative");
  const c2ParticipantId = await participant(c2, "contractor");
  // C2 covers Mechanical only, and never sees C1's Electrical items (V3).
  const mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: { isAll: false, valueIds: [mechanical] }, location: all }));
  hafiz = await projectMember(api, c1, c1ParticipantId, ["engineer"], { name: "Hafiz Hamdan" });
  ali = await projectMember(api, c1, c1ParticipantId, ["project_manager"], { name: "Ali Sonour" });
  ahmed = await projectMember(api, k1, k1ParticipantId, ["engineer"], { name: "Ahmed bin Said" });
  mohammed = await projectMember(api, k1, k1ParticipantId, ["manager"], { name: "Mohammed Al Shamsi" });
  faisal = await projectMember(api, o1, o1ParticipantId, ["engineer"], { name: "Faisal Al Otaibi" });
  yousef = await projectMember(api, c2, c2ParticipantId, ["engineer"], { name: "Yousef Karim" });
});

describe("the Rabaed Defaults as documents (`pnpm defaults:publish`)", () => {
  it("are what the seed step published, so running it again publishes nothing", async () => {
    const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
    try {
      const engineer = await migrator.selectFrom("rabaed_engineer").select("id").where("email", "=", DEMO_ENGINEER_EMAIL).executeTakeFirstOrThrow();
      const again = await publishRabaedDefaults(migrator, { engineerId: engineer.id, reason: "RP-437 test: nothing to publish" });
      expect(again.ok).toBe(true);
      expect(again.ok && again.done.filter((d) => d.published)).toEqual([]);
      expect(again.ok && again.moved).toEqual([
        { type: "CMT", moved: 0 },
        { type: "MAR", moved: 0 },
      ]);
      // Each submittal Type: the Workflow it runs, then its seven other Rabaed Defaults (RP-596), in the list's order.
      const others = (type: string, run: string) =>
        ["1-1", "1-2", "2-1", "2-2", "1-1-owner", "1-2-owner", "2-1-owner", "2-2-owner"].filter((k) => k !== run).map((k) => [`${type}:${k}`, 1]);
      expect(again.ok && again.done.filter((d) => d.kind === "workflow").map((d) => [d.name, d.versionNo])).toEqual([
        ["MAR", 3],
        ...others("MAR", "2-2"),
        ["SAR", 1],
        ...others("SAR", "2-2"),
        ["DAR", 1],
        ...others("DAR", "1-1-owner"),
        ["WIR", 4],
        ["CMT", 2],
        ["SNG", 1],
        ["OBS", 1],
        ["QSN", 1],
        ["QSC", 1],
      ]);
    } finally {
      await migrator.destroy();
    }
  });

  it("name the Types the migration adds, each with its own Form or the MAR's (the two lists agree)", async () => {
    const sqlFile = readFileSync(new URL("../../../packages/db/migrations/20270118000000_rabaed_default_types.sql", import.meta.url), "utf8");
    const added = [...sqlFile.matchAll(/^\s*\(\d+, '\w+', '([A-Z]+)',/gm)].map((m) => m[1]);
    expect(added).toEqual(["SAR", "DAR", "WIR"]);
    expect(added.every((code) => rabaedDefaultTypes.some((t) => t.type === code))).toBe(true);
    const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
    try {
      const types = await migrator
        .selectFrom("work_item_type")
        .select(["code", "form_definition_id"])
        .where("owner_kind", "=", "rabaed")
        .where("code", "in", rabaedDefaultTypes.map((t) => t.type))
        .execute();
      const formOf = (code: string) => types.find((t) => t.code === code)?.form_definition_id;
      for (const { type, form } of rabaedDefaultTypes) {
        expect(formOf(type), type).toBeTruthy();
        if (type !== "MAR") expect(formOf(type) === formOf("MAR"), type).toBe(form === null);
      }
    } finally {
      await migrator.destroy();
    }
  });
});

describe("the MAR Form Version 5", () => {
  it("is Version 4 without the Consultant verification: the Form is the raiser's (ADR 0019)", async () => {
    const form: FormVersion = (await ok(hafiz.get(`/v1/projects/${projectId}/work-item-types/MAR/form`), 200)).json();
    expect(form.versionNo).toBe(5);
    expect(form.schema.sections.map((s) => s.key)).toEqual(["material", "quantities", "documents", "references", "classification"]);
  });
});

describe("the MAR Workflow Version 3 (seam 1 acceptance)", () => {
  it("returns to the Contractor Engineer, never the Draft: the author holds it with its number and replaces the Datasheet before the Submit", async () => {
    const id = (await ok(hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Returned", answers: answers("Returned") }), 201)).json()
      .id as string;
    await datasheet(hafiz, id, "wrong-revision.pdf");
    await take(hafiz, id, "send_for_review");
    expect(await detail(ali, id)).toMatchObject({ stage: { key: "internal_review" }, workflow: { versionNo: 3 } });
    const number = (await detail(ali, id)).documentNumber;
    await take(ali, id, "return", { reason: "Use the 2026 datasheet" });

    const returned = await detail(hafiz, id);
    expect(returned).toMatchObject({ stage: { key: "internal_review" }, documentNumber: number });
    expect(returned.heldBy?.memberName?.en).toBe("Hafiz Hamdan");
    expect(returned.actions.transitions.map((t) => t.key).sort()).toEqual(["cancel_engineer", "send_for_review_again"]);
    const [old] = ((await ok(hafiz.get(`/v1/work-items/${id}/documents`), 200)).json() as DocumentList).documents;
    await ok(hafiz.delete(`/v1/work-items/${id}/documents/${old!.id}`));
    await datasheet(hafiz, id, "datasheet-2026.pdf");
    await take(hafiz, id, "send_for_review_again");
    await take(ali, id, "submit", { answers: { cover_note: "Resubmitted internally with the 2026 datasheet" } });

    const seen = (await ok(ahmed.get(`/v1/work-items/${id}/documents`), 200)).json() as DocumentList;
    expect(seen.documents.map((d) => [d.fileName, d.frozen])).toEqual([["datasheet-2026.pdf", true]]);
    expect((await detail(ahmed, id)).stage.key).toBe("pending_approval");
  });

  it("the Consultant Engineer Step's pool is the Consultant's Engineers only, so its only Engineer holds it at once and the Manager doesn't (RP-511 decision 1)", async () => {
    const id = await submitted("Pool of one");
    expect((await detail(ahmed, id)).heldBy?.memberName?.en).toBe("Ahmed bin Said");
    expect((await detail(ahmed, id)).actions).toMatchObject({ pickUp: false });
    expect((await detail(mohammed, id)).actions).toMatchObject({ pickUp: false, transitions: [] });
  });

  it("A: the Manager's Code Screen starts from the Engineer's verification; the item closes Approved", async () => {
    const id = await submitted("Code A");
    await reviewed(id, verified, "A");
    const approve = (await transitionsOf(mohammed, id)).find((t) => t.key === "approve_a")!;
    expect(approve.prefill).toEqual(verified);
    // Remarks are optional with A only.
    await take(mohammed, id, "approve_a", { answers: approve.prefill });
    expect(await detail(hafiz, id)).toMatchObject({ stage: { key: "approved" }, outcome: "A" });
  });

  it("B: needs its Remarks and Comments, each Comment one in the Snag List for the Contractor", async () => {
    const id = await submitted("Code B");
    await reviewed(id, verified, "B");
    const comments = [{ comment: "Label the drivers" }, { comment: "Add the IP rating" }];
    const none = await tryTake(mohammed, id, "approve_b", { answers: { ...verified, remarks: "See the Comments" } });
    expect(none.statusCode, none.body).toBe(422);
    const noRemarks = await tryTake(mohammed, id, "approve_b", { answers: { ...verified, items_to_create: comments } });
    expect(noRemarks.statusCode, noRemarks.body).toBe(422);
    expect(noRemarks.json()).toEqual({ error: "invalid_action_form", fields: [{ key: "remarks", code: "required" }] });
    await take(mohammed, id, "approve_b", { answers: { ...verified, remarks: "See the Comments", items_to_create: comments } });
    expect(await detail(hafiz, id)).toMatchObject({ outcome: "B", raisedItems: [{ type: { code: "CMT" }, open: 2, closed: 0 }] });
  });

  it("C: needs its Remarks, and offers the raiser a Revision", async () => {
    const id = await submitted("Code C");
    await reviewed(id, notMatching, "C");
    const noRemarks = await tryTake(mohammed, id, "revise_c", { answers: notMatching });
    expect(noRemarks.statusCode, noRemarks.body).toBe(422);
    await take(mohammed, id, "revise_c", { answers: { ...notMatching, remarks: "Use 4000 K" } });
    expect(await detail(hafiz, id)).toMatchObject({ stage: { key: "revise_resubmit" }, outcome: "C", actions: { createRevision: true } });
  });

  it("D: closes Rejected and offers the raiser a replacement", async () => {
    const id = await submitted("Code D");
    await reviewed(id, notMatching, "D");
    const noRemarks = await tryTake(mohammed, id, "reject_d", { answers: notMatching });
    expect(noRemarks.statusCode, noRemarks.body).toBe(422);
    await take(mohammed, id, "reject_d", { answers: { ...notMatching, remarks: "Not the specified product" } });
    expect(await detail(hafiz, id)).toMatchObject({ stage: { key: "rejected" }, outcome: "D", actions: { createReplacement: true, createRevision: false } });
  });

  it("the Manager Returns it to the Engineer who replied, inside the Consultant", async () => {
    const id = await submitted("Return to Engineer");
    await reviewed(id, notMatching, "C");
    await take(mohammed, id, "return_to_engineer", { reason: "Check against the revised specification" });
    expect((await detail(ahmed, id)).heldBy?.memberName?.en).toBe("Ahmed bin Said");
    await take(ahmed, id, "send_to_manager", { answers: verified, recommendedCode: "A" });
    expect((await transitionsOf(mohammed, id)).find((t) => t.key === "approve_a")!.prefill).toEqual(verified);
  });

  it("Cancel is offered at the raiser's Steps until the Submit, and never after", async () => {
    const id = (await ok(hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Cancelled", answers: answers("Cancelled") }), 201)).json()
      .id as string;
    expect((await transitionsOf(hafiz, id)).map((t) => t.key)).toContain("cancel");
    await datasheet(hafiz, id, "cancelled.pdf");
    await take(hafiz, id, "send_for_review");
    expect((await transitionsOf(ali, id)).map((t) => t.key)).toContain("cancel_review");
    await take(ali, id, "cancel_review");
    expect(await detail(hafiz, id)).toMatchObject({ stage: { key: "cancelled" }, outcome: "cancelled" });
  });
});

// Scenario RP-437-1 (visibility.md): the Consultant Engineer's reply and Recommended Code
// stay inside the Consultant (V5); the Consultant and oversight read the Contractor's
// Cover Note, by the Contractor's Company only, never its Internal Note (V5, V14); the
// Contractor reads the Manager's shared reply once the Code is issued.
describe("RP-437-1: who reads the replies of a MAR on Version 3", () => {
  let id = "";
  const answersSeen = (events: WorkItemHistory["events"]) => JSON.stringify(events.map((e) => [e.type, e.answers, e.recommendedCode, e.internalNote]));

  beforeAll(async () => {
    id = await submitted("Visibility", "Covers Level 2 only");
  });

  it("the Consultant and oversight read the Cover Note with the Contractor's Company only, and never its Internal Note or Return", async () => {
    for (const who of [ahmed, mohammed, faisal]) {
      const submit = (await history(who, id)).find((e) => e.answers?.cover_note !== undefined);
      expect(submit).toMatchObject({ audience: "shared", answers: { cover_note: "Covers Level 2 only" }, by: { memberName: null } });
      expect(submit!.by.companyName).not.toBeNull();
      expect(JSON.stringify(await history(who, id))).not.toContain("quantities checked against BOQ");
    }
    await expectHidden(yousef.get(`/v1/work-items/${id}/history`));
  });

  it("the Contractor and oversight never read the Consultant Engineer's reply or Recommended Code, before or after the Code", async () => {
    const before = { hafiz: await history(hafiz, id), faisal: await history(faisal, id) };
    await reviewed(id, notMatching, "C");
    // The Consultant reads its own reply, internal.
    const own = await history(ahmed, id);
    expect(own.find((e) => e.type === "internal_answers")).toMatchObject({ audience: "internal", answers: notMatching });
    expect(own.find((e) => e.type === "recommend_code")).toMatchObject({ recommendedCode: "C" });
    // Nothing of it reaches the Contractor or oversight, nor does the Manager's pre-fill.
    expect(await history(hafiz, id)).toEqual(before.hafiz);
    expect(await history(faisal, id)).toEqual(before.faisal);
    for (const who of [hafiz, ali]) expect((await detail(who, id)).actions.transitions).toEqual([]);

    await take(mohammed, id, "revise_c", { answers: { ...verified, remarks: "Resubmit with 4000 K" } });
    for (const who of [hafiz, ali, faisal]) {
      const events = await history(who, id);
      expect(answersSeen(events)).not.toContain("Wrong colour temperature");
      expect(events.some((e) => e.type === "internal_answers" || e.type === "recommend_code")).toBe(false);
      expect(JSON.stringify(events)).not.toContain("compared with the approved sample");
    }
  });

  it("the Contractor and oversight read the Manager's shared reply after the Code: the Code, Remarks and final verification", async () => {
    for (const who of [hafiz, faisal]) {
      expect((await history(who, id)).at(-1)).toMatchObject({
        type: "issue_code",
        outcome: "C",
        remarks: "Resubmit with 4000 K",
        answers: { ...verified, remarks: "Resubmit with 4000 K" },
        by: { memberName: { en: "Mohammed Al Shamsi" } },
      });
    }
  });

  it("labels each reply's answers in the history with the Screen it was given in, only on answers the reader may read (leak channel: the history's answersForm)", async () => {
    const sections = (e: WorkItemHistory["events"][number] | undefined) => e?.answersForm?.sections.map((s) => s.key);
    // Another Company reads the Submit's Cover Note and the Code's shared reply, each with its own Screen,
    // although the Consultant's internal events before the Code are not theirs to read.
    for (const who of [hafiz, faisal, ahmed]) {
      const events = await history(who, id);
      expect(sections(events.find((e) => e.answers?.cover_note !== undefined))).toEqual(["cover"]);
      expect(sections(events.find((e) => e.type === "issue_code"))).toEqual(["final_verification", "code_remarks"]);
      for (const e of events) if (!e.answers) expect(e.answersForm).toBeUndefined();
    }
    for (const who of [hafiz, faisal]) expect((await history(who, id)).some((e) => sections(e)?.includes("verification"))).toBe(false);
    // The Consultant reads its Engineer's internal reply labelled by the "Consultant review" Screen.
    expect(sections((await history(ahmed, id)).find((e) => e.type === "internal_answers"))).toEqual(["verification"]);
  });

  it("a Member of another Company is never handed the pre-fill: the Submit comes from the Contractor", async () => {
    const other = await submitted("No pre-fill across Companies");
    expect((await transitionsOf(ahmed, other)).find((t) => t.key === "send_to_manager")!.prefill).toBeUndefined();
  });
});

// A WIR's Workflow, Passed with Comments and Failed: apps/api/test/wir-workflow-v2.test.ts (RP-170).
describe("the Inspections' Rabaed Defaults (RP-437)", () => {
  it("have no NCR: it gets its own Workflow and Form (RP-553)", async () => {
    expect((await hafiz.get(`/v1/projects/${projectId}/work-item-types/WIR/form`)).statusCode).toBe(200);
    expect((await hafiz.get(`/v1/projects/${projectId}/work-item-types/NCR/form`)).statusCode).toBe(404);
  });
});

// Items in flight on a Version retired with ADR 0019 (RP-437 review): `pnpm defaults:publish`
// moves them on (apps/admin/src/in-flight.ts). Seeded here as such items are: an item
// pinned to the old Versions, as the migrator rewrites it.
describe("items in flight on a retired Version", () => {
  const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
  afterAll(() => migrator.destroy());

  /** Pins item `id` (of Type `type`, at its current Step) to that Type's Workflow Version `workflowNo` and Form Version `formNo`, Steps by key. */
  async function pinTo(id: string, type: string, workflowNo: number, formNo: number) {
    await sql`
      with old as (
        select v.id as version_id, s.key, s.id as step_id from work_item_type t
        join workflow_version v on v.workflow_definition_id = t.workflow_definition_id and v.version_no = ${workflowNo}
        join workflow_step s on s.workflow_version_id = v.id
        where t.owner_kind = 'rabaed' and t.code = ${type}
      ),
      moved_assignments as (
        update step_assignment a set step_id = o.step_id
        from workflow_step cur, old o
        where a.work_item_id = ${id}::uuid and cur.id = a.step_id and o.key = cur.key
        returning a.id
      )
      update work_item w set
        workflow_version_id = (select distinct version_id from old),
        current_step_id = (select o.step_id from old o join workflow_step cur on cur.key = o.key where cur.id = w.current_step_id),
        participant_entered_step_id = (select o.step_id from old o join workflow_step cur on cur.key = o.key where cur.id = w.participant_entered_step_id),
        form_version_id = (
          select f.id from work_item_type t join form_version f on f.form_definition_id = t.form_definition_id
          where t.owner_kind = 'rabaed' and t.code = ${type} and f.version_no = ${formNo})
      where w.id = ${id}::uuid
    `.execute(migrator);
  }
  const moveInFlight = async () => {
    const engineer = await migrator.selectFrom("rabaed_engineer").select("id").where("email", "=", DEMO_ENGINEER_EMAIL).executeTakeFirstOrThrow();
    const result = await publishRabaedDefaults(migrator, { engineerId: engineer.id, reason: "RP-437 test: move items in flight" });
    expect(result.ok && result.done.filter((d) => d.published)).toEqual([]);
    return result.ok ? result.moved : [];
  };

  it("an open Comment on the Comment Form Version 1 moves to the Version 2 Workflow and Form, so its Resolve can be taken", async () => {
    const mar = await submitted("Comment in flight");
    await reviewed(mar, verified, "B");
    await take(mohammed, mar, "approve_b", { answers: { ...verified, remarks: "See the Comment", items_to_create: [{ comment: "Seal the conduit entries" }] } });
    const comment = (await migrator.selectFrom("work_item").select("id").where("title", "=", "Seal the conduit entries").executeTakeFirstOrThrow()).id;
    await pinTo(comment, "CMT", 1, 1);
    expect(await detail(ali, comment)).toMatchObject({ stage: { key: "open" }, workflow: { versionNo: 1 } });
    await ok(ali.post(`/v1/work-items/${comment}/pick-up`));
    // On Version 1 its Resolve needs the Form's Resolution section, which nobody may save any more.
    expect((await tryTake(ali, comment, "resolve")).statusCode).toBe(422);

    expect(await moveInFlight()).toContainEqual({ type: "CMT", moved: 1 });
    expect(await detail(ali, comment)).toMatchObject({ stage: { key: "open" }, workflow: { versionNo: 2 }, heldBy: { memberName: { en: "Ali Sonour" } } });
    await take(ali, comment, "resolve", { answers: { resolution_note: "Sealed with intumescent mastic" } });
    expect((await detail(ahmed, comment)).stage.key).toBe("resolved");
    expect(await moveInFlight()).toContainEqual({ type: "CMT", moved: 0 });
  });

  it("an open MAR on the Form Version 4 at the Consultant moves to the Workflow Version 3's Consultant Engineer Step, whose reply records the verification", async () => {
    const id = (await ok(hafiz.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "MAR in flight", answers: { ...answers("MAR in flight"), supplier: undefined } }), 201)).json()
      .id as string;
    await datasheet(hafiz, id, "in-flight.pdf");
    await pinTo(id, "MAR", 2, 4);
    await take(hafiz, id, "send_for_review");
    await take(ali, id, "submit");
    // On Workflow Version 2, at the Consultant's one review Step.
    expect(await detail(ahmed, id)).toMatchObject({ step: { key: "consultant_review" }, workflow: { versionNo: 2 } });

    expect(await moveInFlight()).toContainEqual({ type: "MAR", moved: 1 });
    const moved = await detail(ahmed, id);
    expect(moved).toMatchObject({ stage: { key: "pending_approval" }, step: { key: "consultant_engineer" }, workflow: { versionNo: 3 } });
    expect(moved.heldBy?.memberName?.en).toBe("Ahmed bin Said");
    await reviewed(id, notMatching, "C");
    const revise = (await transitionsOf(mohammed, id)).find((t) => t.key === "revise_c")!;
    expect(revise.prefill).toEqual(notMatching);
    await take(mohammed, id, "revise_c", { answers: { ...notMatching, remarks: "Use 4000 K" } });
    expect(await detail(hafiz, id)).toMatchObject({ outcome: "C" });
    expect((await history(hafiz, id)).at(-1)).toMatchObject({ type: "issue_code", answers: { ...notMatching, remarks: "Use 4000 K" } });
  });
});
