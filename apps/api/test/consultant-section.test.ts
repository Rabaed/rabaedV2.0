// Seam 1 for the Consultant filling its own Form Section (RP-304, spec RP-299;
// form-engine.md §4 "Settled 2026-10-05 (part 3)"; visibility.md V19 and
// scenarios 47 and 50; ADR 0013). At a Step a section names, any Member of the
// Participant holding it who sees the item saves that section, and only it. While
// the item is with that Participant, everyone else reads the answers as they
// arrived, and none of its `answers_changed` events. When it leaves, they are
// everyone's. Required fields are checked per section, on a forward Transition out
// of a Step the section names, never on a Send Back. A Send Back out of the
// Consultant's Step discards what it wrote there: its section goes back to how
// it arrived (RP-299 review; ADR 0014).
//
// The Type is test-only (3-07 brings the MAR Form Version 4), on the test
// Workflow with a Send Back (addTestWorkflow): Draft → Contractor review →
// Consultant review ⇄ (Send Back) Contractor review; Consultant review →
// Consultant approval → Approved or Revise & Resubmit.
import { publishFormVersion } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { addTestWorkflow, testDatabaseUrls } from "@rabaed/db/test-support";
import type { FormToFill, WorkItemHistory } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller, type OnboardedCompany } from "./support/harness.ts";
import { detail, projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARCS";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };
type Company = { company: OnboardedCompany; caller: Caller };

const schema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "verification",
      title: bilingual("Consultant verification"),
      editable_at: ["consultant_review"],
      fields: [
        { key: "sample_checked", type: "yes_no", label: bilingual("Sample checked"), required: true },
        { key: "verification_note", type: "textarea", label: bilingual("Verification note") },
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
let engineer: Caller; // C1 engineer: raises the items.
let pm: Caller; // C1 PM: holds Contractor review and Submits.
let k1Engineer: Caller; // Holds Consultant review.
let k1Pm: Caller; // Another K1 Member who sees the item, holding nothing.
let k1Manager: Caller; // Holds Consultant approval.
let orEngineer: Caller; // Owner Representative (oversight).
let owner: Caller; // Owner (oversight).
let projectId = "";
let electrical = "";
let buildingA = "";

/** The test-only Type, on its own Workflow, filled with a new Form. */
async function addConsultantSectionType(): Promise<string> {
  const { id: formId } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify(bilingual("Consultant section (test)")) })
    .returning("id")
    .executeTakeFirstOrThrow();
  const existing = await migrator
    .selectFrom("work_item_type")
    .select("id")
    .where("owner_kind", "=", "rabaed")
    .where("code", "=", TYPE)
    .executeTakeFirst();
  if (!existing) {
    const workflowId = await addTestWorkflow((text) => sql.raw(text).execute(migrator));
    await migrator
      .insertInto("work_item_type")
      .values({
        owner_kind: "rabaed",
        module_key: "submittals",
        code: TYPE,
        name: JSON.stringify({ en: "Consultant section submittal", ar: "اعتماد قسم الاستشاري" }),
        workflow_definition_id: workflowId,
        outcome_kind: "review_code",
        form_definition_id: formId,
      })
      .execute();
  }
  // A new Form on every run, so its Versions start from 1.
  await migrator.updateTable("work_item_type").set({ form_definition_id: formId }).where("owner_kind", "=", "rabaed").where("code", "=", TYPE).execute();
  return formId;
}

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

async function otherParticipant(role: "consultant" | "owner" | "owner_representative") {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return { company, participantId };
}

const builtIns = () => ({ trade: electrical, location: buildingA });
/** The answers `by` reads, without the Built-in Fields. */
const answersOf = async (by: Caller, id: string) => {
  const { trade: _trade, location: _location, ...own } = (await detail(by, id)).answers;
  return own;
};
const diffs = async (by: Caller, id: string) =>
  ((await ok(by.get(`/v1/work-items/${id}/history`), 200)).json() as WorkItemHistory).events.filter((e) => e.type === "answers_changed");
/** Save, with the answers `by` reads and `changes` over them. */
const saveOver = async (by: Caller, id: string, changes: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(by, id)).answers, ...changes } });

/** A new item of the test Type, Submitted to K1 with the Consultant's section empty: none of it was required to get here. */
async function atConsultantReview(model: string): Promise<string> {
  const res = await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { ...builtIns(), model } }), 201);
  const id = res.json().id as string;
  await ok(tryTake(engineer, id, "send_for_review"));
  await ok(pm.post(`/v1/work-items/${id}/claim`));
  await ok(tryTake(pm, id, "submit"));
  await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
  return id;
}

beforeAll(async () => {
  const formId = await addConsultantSectionType();
  expect(await publishFormVersion(migrator, formId, schema)).toMatchObject({ ok: true, versionNo: 1 });
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await otherParticipant("consultant");
  k1Engineer = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Pm = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const or = await otherParticipant("owner_representative");
  orEngineer = await projectMember(api, or.company, or.participantId, ["engineer"]);
  const ow = await otherParticipant("owner");
  owner = await projectMember(api, ow.company, ow.participantId, ["representative"]);
});

describe("the Consultant's section at its Step", () => {
  it("is the only one the Consultant may change", async () => {
    const id = await atConsultantReview("FD-60");
    for (const k1 of [k1Engineer, k1Pm]) {
      const form: FormToFill = (await ok(k1.get(`/v1/work-items/${id}/form`), 200)).json();
      expect(form.editableSections).toEqual(["verification"]);
      expect((await detail(k1, id)).actions.saveAnswers).toBe(true);
    }
    // Not to C1, nor the oversight Participants.
    for (const other of [engineer, pm, orEngineer, owner]) {
      expect((await detail(other, id)).actions.saveAnswers).toBe(false);
    }
  });

  it("refuses, as a whole, a K1 save that changes C1's sections", async () => {
    const id = await atConsultantReview("FD-61");
    const res = await saveOver(k1Engineer, id, { model: "FD-99", sample_checked: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "not_editable" });
    expect(await answersOf(k1Engineer, id)).toEqual({ model: "FD-61" });
  });

  it("refuses a C1 save into C1's own sections while K1 holds the item (scenario 50)", async () => {
    const id = await atConsultantReview("FD-62");
    for (const c1Member of [engineer, pm]) {
      const res = await saveOver(c1Member, id, { model: "FD-99" });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: "not_editable" });
    }
    expect(await answersOf(engineer, id)).toEqual({ model: "FD-62" });
  });
});

describe("K1 fills its section and saves twice, without issuing a Code (scenario 47)", () => {
  let id = "";
  beforeAll(async () => {
    id = await atConsultantReview("FD-90");
    await ok(saveOver(k1Engineer, id, { sample_checked: true }));
    // Any K1 Member who sees the item, not only the holder.
    await ok(saveOver(k1Pm, id, { verification_note: "Matches the sample" }));
  });

  it("shows K1 the saved answers and both changes", async () => {
    for (const k1 of [k1Engineer, k1Pm, k1Manager]) {
      expect(await answersOf(k1, id)).toEqual({ model: "FD-90", sample_checked: true, verification_note: "Matches the sample" });
      expect((await diffs(k1, id)).map((e) => e.changes)).toEqual([
        [{ field: "sample_checked", old: null, new: true }],
        [{ field: "verification_note", old: null, new: "Matches the sample" }],
      ]);
    }
  });

  it("shows C1, OR and OW the section as it arrived, and none of the changes", async () => {
    for (const other of [engineer, pm, orEngineer, owner]) {
      expect(await answersOf(other, id)).toEqual({ model: "FD-90" });
      expect(await diffs(other, id)).toEqual([]);
      const body = (await other.get(`/v1/work-items/${id}`)).body + (await other.get(`/v1/work-items/${id}/history`)).body;
      expect(body).not.toContain("Matches the sample");
    }
  });

  it("stays with K1 when K1 moves the item internally", async () => {
    await ok(tryTake(k1Engineer, id, "send_to_manager"));
    expect(await answersOf(engineer, id)).toEqual({ model: "FD-90" });
    expect(await answersOf(owner, id)).toEqual({ model: "FD-90" });
    expect(await answersOf(k1Manager, id)).toMatchObject({ sample_checked: true });
  });

  it("is everyone's once K1 issues the Code, its changes still K1's", async () => {
    await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Manager, id, "revise_c"));
    for (const other of [engineer, pm, orEngineer, owner]) {
      expect(await answersOf(other, id)).toEqual({ model: "FD-90", sample_checked: true, verification_note: "Matches the sample" });
      expect(await diffs(other, id)).toEqual([]);
    }
  });
});

describe("required fields, per section, by the Step being left", () => {
  it("never hold up the raiser over the Consultant's section", async () => {
    // atConsultantReview got here with `sample_checked` (required) empty.
    const id = await atConsultantReview("FD-70");
    expect(await answersOf(k1Engineer, id)).toEqual({ model: "FD-70" });
  });

  it("hold up K1's forward Transition out of the Step its section names", async () => {
    const id = await atConsultantReview("FD-71");
    const res = await tryTake(k1Engineer, id, "send_to_manager");
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "form_incomplete", fields: [{ key: "sample_checked", code: "required" }] });
    await ok(saveOver(k1Engineer, id, { sample_checked: false }));
    await ok(tryTake(k1Engineer, id, "send_to_manager"));
  });

  it("don't hold up a Send Back", async () => {
    const id = await atConsultantReview("FD-72");
    await ok(tryTake(k1Engineer, id, "send_back"));
  });
});

describe("K1 fills in part of its section, then Sends the item Back to C1 (scenario 57)", () => {
  let id = "";
  beforeAll(async () => {
    id = await atConsultantReview("FD-50");
    await ok(saveOver(k1Engineer, id, { sample_checked: false, verification_note: "Wrong fire rating" }));
    await ok(tryTake(k1Engineer, id, "send_back"));
  });

  const unseen = async (other: Caller) => {
    expect(await answersOf(other, id)).toEqual({ model: "FD-50" });
    expect(await diffs(other, id)).toEqual([]);
    const body = (await other.get(`/v1/work-items/${id}`)).body + (await other.get(`/v1/work-items/${id}/history`)).body;
    expect(body).not.toContain("Wrong fire rating");
  };

  const sendBackEvents = async (viewer: Caller) =>
    ((await ok(viewer.get(`/v1/work-items/${id}/history`), 200)).json() as WorkItemHistory).events.filter(
      (e) => e.transition?.en === "Send Back",
    );

  it("moves the item to the Contractor review, the same item with its Document Number, by a shared Transition", async () => {
    const back = await detail(pm, id);
    expect(back.step.key).toBe("internal_review");
    expect(back.documentNumber).not.toBeNull();
    for (const c1Member of [engineer, pm]) {
      expect(await sendBackEvents(c1Member)).toMatchObject([{ type: "transition", audience: "shared" }]);
    }
  });

  it("shows C1, holding it again, the section as it arrived: empty, and none of K1's changes", async () => {
    for (const c1Member of [engineer, pm]) await unseen(c1Member);
  });

  // OR and OW see the item again once it is Submitted (V2).
  it("shows OR and OW the section as it arrived once C1 Submits again", async () => {
    await ok(pm.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(pm, id, "submit"));
    for (const other of [orEngineer, owner, engineer]) await unseen(other);
  });

  it("shows K1, OR and OW the Send Back in the history once C1 Submits again", async () => {
    for (const other of [k1Pm, orEngineer, owner]) {
      expect(await sendBackEvents(other)).toMatchObject([{ type: "transition", audience: "shared" }]);
    }
  });

  it("starts K1 from the section as it arrived, with no field times for it, its earlier changes still in K1's history", async () => {
    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    expect(await answersOf(k1Engineer, id)).toEqual({ model: "FD-50" });
    const times = (await detail(k1Engineer, id)).fieldTimes;
    expect(Object.keys(times)).not.toContain("sample_checked");
    expect(Object.keys(times)).not.toContain("verification_note");
    expect((await diffs(k1Engineer, id)).map((e) => e.changes)).toEqual([
      [
        { field: "sample_checked", old: null, new: false },
        { field: "verification_note", old: null, new: "Wrong fire rating" },
      ],
    ]);
  });
});
