// Seam 1 for the MAR Form Version 4 (RP-306, spec RP-299; form-engine.md §4 "MAR
// Form Version 4"; visibility.md V19 and scenarios 46 and 48): Version 3 plus the
// Consultant verification section, filled in only by the Consultant at its review
// Step. New MARs pin Version 4; earlier MARs keep their Version. Version 4 passes the
// publish checks against Versions 1 to 3 and against the MAR's Workflow (`editable_at`
// names a Step the Workflow has). Issuing a Code is refused while the verification
// is incomplete; once issued, the answers and the Remarks are everyone's.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import {
  formSchema,
  publishProblems,
  type FormToFill,
  type FormVersion,
  type WorkflowStepHolder,
  type WorkItemHistory,
} from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller } from "./support/harness.ts";
import { detail, projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };

let engineer: Caller; // C1 engineer: raises the MARs.
let pm: Caller; // C1 PM: Submits.
let k1Engineer: Caller; // Fills the Consultant verification.
let k1Manager: Caller; // Issues the Code.
let orEngineer: Caller; // Owner Representative (oversight).
let projectId = "";
let electrical = "";
let buildingA = "";

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

/** The MAR Form's published Versions, oldest first, as stored. */
async function marVersions() {
  const { rows } = await sql<{ id: string; version_no: number; schema: unknown }>`
    select v.id, v.version_no, v.schema from form_version v
    join work_item_type t on t.form_definition_id = v.form_definition_id
    where t.owner_kind = 'rabaed' and t.code = 'MAR' and v.status = 'published'
    order by v.version_no
  `.execute(migrator);
  return rows;
}

/** The Steps of every published Version of the MAR Workflow, oldest first: an item keeps the Version it pinned. */
async function marWorkflows(): Promise<WorkflowStepHolder[][]> {
  const { rows } = await sql<WorkflowStepHolder & { version_no: number }>`
    select v.version_no, s.key, s.actor_rule ->> 'base_role' as role, app.is_draft_step(s.id) as draft
    from work_item_type t
    join workflow_version v on v.workflow_definition_id = t.workflow_definition_id and v.status = 'published'
    join workflow_step s on s.workflow_version_id = v.id
    where t.owner_kind = 'rabaed' and t.code = 'MAR'
    order by v.version_no, s.key
  `.execute(migrator);
  const byVersion = new Map<number, WorkflowStepHolder[]>();
  for (const { version_no, key, role, draft } of rows) byVersion.set(version_no, [...(byVersion.get(version_no) ?? []), { key, role, draft }]);
  return [...byVersion.values()];
}

const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};
const created = async (title: string) =>
  (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title, answers: { ...complete, trade: electrical, location: buildingA } }), 201))
    .json().id as string;
const history = async (by: Caller, id: string): Promise<WorkItemHistory> => (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json();
/** Saves `changes` over the answers `by` reads, as the web form does. */
const saveOver = async (by: Caller, id: string, changes: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(by, id)).answers, ...changes } });

/** A MAR Submitted to the Consultant, its verification still empty. */
async function atConsultantReview(title: string): Promise<string> {
  const id = await created(title);
  await attachDatasheet(engineer, id);
  await ok(tryTake(engineer, id, "send_for_review"));
  await ok(pm.post(`/v1/work-items/${id}/claim`));
  await ok(tryTake(pm, id, "submit"));
  return id;
}

beforeAll(async () => {
  const c1 = await api.projectCreator();
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
    return { caller: company.caller, participantId };
  };
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  const k1 = await otherParticipant("consultant");
  k1Engineer = await projectMember(api, k1, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(api, k1, k1.participantId, ["manager"]);
  const or = await otherParticipant("owner_representative");
  orEngineer = await projectMember(api, or, or.participantId, ["engineer"]);
});

describe("the MAR Form Version 4", () => {
  it("is the MAR's latest Version, and passes the publish checks against Versions 1 to 3 and every MAR Workflow Version", async () => {
    const versions = await marVersions();
    expect(versions.map((v) => v.version_no)).toEqual([1, 2, 3, 4]);
    const [v1, v2, v3, v4] = versions.map((v) => formSchema.parse(v.schema));
    const { rows: lists } = await sql<{ id: string }>`select id from option_list`.execute(migrator);
    const workflows = await marWorkflows();
    expect(workflows.length).toBeGreaterThanOrEqual(2);
    for (const steps of workflows) expect(steps.map((s) => s.key)).toContain("consultant_review");
    expect(publishProblems(v4!, [v1!, v2!, v3!], { optionListIds: new Set(lists.map((l) => l.id)), workflows })).toEqual([]);
  });

  it("is Version 3 plus the Consultant verification, labelled in English and Arabic, editable at the Consultant review Step", async () => {
    const form: FormVersion = (await ok(engineer.get(`/v1/projects/${projectId}/work-item-types/MAR/form`), 200)).json();
    expect(form.versionNo).toBe(4);
    const section = form.schema.sections.find((s) => s.key === "consultant_verification")!;
    expect(section).toMatchObject({
      title: { en: "Consultant verification", ar: "تحقق الاستشاري" },
      editable_at: ["consultant_review"],
    });
    expect(section.fields).toMatchObject([
      { key: "sample_checked", type: "yes_no", required: true, label: { en: "Sample checked", ar: expect.any(String) } },
      { key: "matches_specification", type: "yes_no", required: true, label: { en: "Matches specification", ar: expect.any(String) } },
      {
        key: "verification_note",
        type: "textarea",
        required: { field: "matches_specification", op: "=", value: false },
        label: { en: "Verification note", ar: expect.any(String) },
      },
    ]);
    // Everything else is Version 3's, unchanged.
    const v3 = formSchema.parse((await marVersions())[2]!.schema);
    expect(form.schema.sections.filter((s) => s.key !== "consultant_verification")).toEqual(v3.sections);
  });
});

describe("a new MAR, and one on an earlier Version", () => {
  it("pins Version 4, and leaves Draft without the Consultant's section", async () => {
    const [, , , v4] = await marVersions();
    const id = await created("Lighting fixtures");
    expect((await detail(engineer, id)).formVersionId).toBe(v4!.id);
    await attachDatasheet(engineer, id);
    await ok(tryTake(engineer, id, "send_for_review"));
    expect((await detail(engineer, id)).stage.key).not.toBe("draft");
  });

  it("keeps Version 3: no Consultant verification to show, fill or require", async () => {
    const id = await atConsultantReview("Luminaires, Version 3");
    const v3 = (await marVersions())[2]!;
    await sql`update work_item set form_version_id = ${v3.id}::uuid where id = ${id}::uuid`.execute(migrator);
    const form: FormToFill = (await ok(k1Engineer.get(`/v1/work-items/${id}/form`), 200)).json();
    expect(form.versionNo).toBe(3);
    expect(form.editableSections).toEqual([]);
    expect(form.filledBy).toEqual({});
    await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Manager, id, "approve_a"));
    expect(await detail(engineer, id)).toMatchObject({ stage: { key: "approved" }, outcome: "A" });
  });
});

describe("a Draft MAR on Version 4 (scenario 46)", () => {
  it("shows the Contractor 'Consultant verification' empty, read-only and marked 'Filled in by the Consultant'", async () => {
    const id = await created("Draft fixtures");
    const form: FormToFill = (await ok(engineer.get(`/v1/work-items/${id}/form`), 200)).json();
    expect(form.versionNo).toBe(4);
    expect(form.editableSections).not.toContain("consultant_verification");
    expect(form.editableSections).toContain("material");
    expect(form.filledBy.consultant_verification).toMatchObject({ en: "Consultant" });
    const seen = (await detail(engineer, id)).answers;
    expect(seen).not.toHaveProperty("sample_checked");
  });

  it("refuses an answer saved into it, as a whole, and writes nothing", async () => {
    const id = await created("Draft fixtures, refused");
    const res = await saveOver(engineer, id, { sample_checked: true });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: "not_editable" });
    expect(await detail(engineer, id)).toMatchObject({ answers: { manufacturer: "Philips" } });
    expect((await detail(engineer, id)).answers).not.toHaveProperty("sample_checked");
  });
});

describe("issuing a Code (scenario 48)", () => {
  it("is refused while the verification is incomplete, with what is missing", async () => {
    const id = await atConsultantReview("Fixtures, incomplete");
    await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
    const res = await tryTake(k1Manager, id, "approve_a");
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toEqual({
      error: "form_incomplete",
      fields: [
        { key: "sample_checked", code: "required" },
        { key: "matches_specification", code: "required" },
      ],
    });
    // Matches specification: No makes the note required.
    await ok(saveOver(k1Manager, id, { sample_checked: true, matches_specification: false }));
    const noNote = await tryTake(k1Manager, id, "approve_a");
    expect(noNote.statusCode, noNote.body).toBe(422);
    expect(noNote.json()).toEqual({ error: "form_incomplete", fields: [{ key: "verification_note", code: "required" }] });
    expect((await detail(engineer, id)).stage.key).toBe("pending_approval");
  });

  it("with Code C and Remarks, after the verification, shows C1 and OR the answers and the Remarks, never an Internal Note", async () => {
    const id = await atConsultantReview("Fixtures, Code C");
    // K1 fills it while C1 and OR still read it empty.
    await ok(saveOver(k1Engineer, id, { sample_checked: true, matches_specification: false }));
    await ok(saveOver(k1Engineer, id, { verification_note: "Efficacy is below the specified value" }));
    for (const other of [engineer, pm, orEngineer]) {
      expect((await detail(other, id)).answers).not.toHaveProperty("sample_checked");
      expect((await detail(other, id)).answers).not.toHaveProperty("verification_note");
      expect((await history(other, id)).events.filter((e) => e.type === "answers_changed")).toEqual([]);
    }
    await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Manager, id, "revise_c", { answers: { remarks: "Resubmit with 110 lm/W luminaires" }, internalNote: "Internal: supplier is on probation" }));
    for (const other of [engineer, pm, orEngineer]) {
      expect(await detail(other, id)).toMatchObject({
        stage: { key: "revise_resubmit" },
        outcome: "C",
        answers: { sample_checked: true, matches_specification: false, verification_note: "Efficacy is below the specified value" },
      });
      const seen = await history(other, id);
      expect(seen.events.at(-1)).toMatchObject({ type: "issue_code", remarks: "Resubmit with 110 lm/W luminaires" });
      expect(JSON.stringify(seen)).not.toContain("supplier is on probation");
      expect(seen.events.filter((e) => e.type === "answers_changed")).toEqual([]);
    }
  });
});
