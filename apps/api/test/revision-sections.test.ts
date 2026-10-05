// Seam 1 for a Revision clearing the Form Sections another Participant filled
// (RP-305, spec RP-299; form-engine.md §4 "Settled 2026-10-05 (part 3)";
// visibility.md V19 and scenario 49; ADR 0013). The Revision starts with the
// raiser's answers only, so the Consultant's verdict on the previous Revision
// never arrives pre-filled; its field times and "as arrived" copy follow the
// answers it has; and the closed item still shows the Consultant's answers to
// everyone who can see it.
//
// `create_revision` is RP-103's: this test stands in for it with a new Draft of
// the same Type and app.fill_revision, the part RP-305 gives it. The Type is
// test-only (3-07 brings the MAR Form Version 4).
import { randomUUID } from "node:crypto";
import { publishFormVersion } from "@rabaed/admin/services";
import { createDb, withMember } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemDetail } from "@rabaed/domain";
import { sql } from "kysely";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi({ files: true });
const urls = testDatabaseUrls();
const migrator = createDb(urls.migrator, { max: 1 });
const app = createDb(urls.app, { max: 2 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
  await app.destroy();
});

const TYPE = "MARRV";
const bilingual = (text: string) => ({ en: text, ar: text });
const all = { isAll: true, valueIds: [] };
type Company = { company: OnboardedCompany; caller: Caller };
type Person = { id: string; caller: Caller };

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
let engineer: Person; // C1 engineer: raises the items.
let pm: Person; // C1 PM: holds Contractor review and Submits.
let k1Engineer: Person; // Holds Consultant review.
let k1Manager: Person; // Holds Consultant approval.
let orEngineer: Person; // Owner Representative (oversight).
let owner: Person;
let projectId = "";
let electrical = "";
let buildingA = "";

async function addType(): Promise<string> {
  const { id: formId } = await migrator
    .insertInto("form_definition")
    .values({ owner_kind: "rabaed", name: JSON.stringify(bilingual("Revision sections (test)")) })
    .returning("id")
    .executeTakeFirstOrThrow();
  await sql`
    do $$
      declare
        v_definition uuid;
        v_version uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into workflow_definition (owner_kind, name)
        values ('rabaed', '{"en": "Revision sections (test)", "ar": "أقسام المراجعة (اختبار)"}')
        returning id into v_definition;
        insert into workflow_version (workflow_definition_id, version_no, status, published_at)
        values (v_definition, 1, 'published', now())
        returning id into v_version;

        insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode) values
          (v_version, 'draft', '{"en": "Draft", "ar": "مسودة"}', 'draft',
            '{"base_role": "contractor", "permission": "create"}', 'none'),
          (v_version, 'internal_review', '{"en": "Contractor review", "ar": "مراجعة المقاول"}', 'internal_review',
            '{"base_role": "contractor", "permission": "review"}', 'none'),
          (v_version, 'consultant_review', '{"en": "Consultant review", "ar": "مراجعة الاستشاري"}', 'pending_approval',
            '{"base_role": "consultant", "permission": "review"}', 'none'),
          (v_version, 'consultant_approval', '{"en": "Consultant approval", "ar": "اعتماد الاستشاري"}', 'internal_review',
            '{"base_role": "consultant", "permission": "approve"}', 'issue_code'),
          (v_version, 'approved', '{"en": "Approved", "ar": "معتمد"}', 'approved', '{}', 'none'),
          (v_version, 'revise_resubmit', '{"en": "Revise & Resubmit", "ar": "مراجعة وإعادة تقديم"}', 'revise_resubmit', '{}', 'none');

        insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort)
        select v_version, t.key, f.id, s.id, t.label::jsonb, t.kind, t.outcome, t.permission, t.sort
        from (values
          ('send_for_review', 'draft', 'internal_review', '{"en": "Send for Review", "ar": "إرسال للمراجعة"}', 'send', null, 'create', 1),
          ('submit', 'internal_review', 'consultant_review', '{"en": "Submit", "ar": "تقديم"}', 'submit', null, 'submit', 2),
          ('send_to_manager', 'consultant_review', 'consultant_approval', '{"en": "Send to Manager", "ar": "إرسال للمدير"}',
            'send', null, 'review', 3),
          ('approve_a', 'consultant_approval', 'approved', '{"en": "Approve · A", "ar": "اعتماد · A"}', 'close', 'A', 'approve', 4),
          ('revise_c', 'consultant_approval', 'revise_resubmit', '{"en": "Revise · C", "ar": "مراجعة · C"}', 'close', 'C', 'approve', 5)
        ) as t (key, from_key, to_key, label, kind, outcome, permission, sort)
        join workflow_step f on f.workflow_version_id = v_version and f.key = t.from_key
        join workflow_step s on s.workflow_version_id = v_version and s.key = t.to_key;

        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', ${sql.lit(TYPE)}, '{"en": "Revision sections", "ar": "أقسام المراجعة"}',
          v_definition, 'review_code', ${sql.lit(formId)}::uuid);
      end
    $$
  `.execute(migrator);
  await migrator.updateTable("work_item_type").set({ form_definition_id: formId }).where("owner_kind", "=", "rabaed").where("code", "=", TYPE).execute();
  return formId;
}

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

async function projectMember(company: Company, participantId: string, positions: string[]): Promise<Person> {
  const { member, caller } = await api.member(company.caller);
  await api.addProjectMember(company.caller, participantId, member.id);
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/visibility`, { trade: all, location: all }));
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/positions`, { positions }));
  return { id: member.id, caller };
}

async function otherParticipant(role: "consultant" | "owner" | "owner_representative") {
  const company = await api.authorizedPerson();
  const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return { company, participantId };
}

const builtIns = () => ({ trade: electrical, location: buildingA });
const take = (by: Person, id: string, transition: string) =>
  by.caller.post(`/v1/work-items/${id}/transitions`, { transition, idempotencyKey: randomUUID() });
const detail = async (by: Person, id: string): Promise<WorkItemDetail> => (await ok(by.caller.get(`/v1/work-items/${id}`), 200)).json();
/** The answers `by` reads, without the Built-in Fields. */
const answersOf = async (by: Person, id: string) => {
  const { trade: _trade, location: _location, ...own } = (await detail(by, id)).answers;
  return own;
};
const saveOver = async (by: Person, id: string, changes: Record<string, unknown>) =>
  by.caller.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(by, id)).answers, ...changes } });
const fill = (by: Person, revision: string, closed: string) =>
  withMember(app, by.id, (trx) =>
    sql<{ outcome: string }>`select app.fill_revision(${revision}::uuid, ${closed}::uuid, now()) as outcome`.execute(trx).then((r) => r.rows[0]!.outcome),
  );

/** An item of the test Type, closed at Code C after K1 filled its section. */
async function closedAtCodeC(model: string): Promise<string> {
  const res = await ok(engineer.caller.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: model, answers: { ...builtIns(), model } }), 201);
  const id = res.json().id as string;
  await ok(take(engineer, id, "send_for_review"));
  await ok(pm.caller.post(`/v1/work-items/${id}/claim`));
  await ok(take(pm, id, "submit"));
  await ok(k1Engineer.caller.post(`/v1/work-items/${id}/claim`));
  await ok(saveOver(k1Engineer, id, { sample_checked: false, verification_note: "Sample does not match" }));
  await ok(take(k1Engineer, id, "send_to_manager"));
  await ok(k1Manager.caller.post(`/v1/work-items/${id}/claim`));
  await ok(take(k1Manager, id, "revise_c"));
  return id;
}

const newDraft = async (title: string) =>
  (await ok(engineer.caller.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title, answers: { ...builtIns(), model: "to be replaced" } }), 201)).json()
    .id as string;

beforeAll(async () => {
  const formId = await addType();
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
  engineer = await projectMember(c1, own, ["engineer"]);
  pm = await projectMember(c1, own, ["project_manager"]);
  const k1 = await otherParticipant("consultant");
  k1Engineer = await projectMember(k1.company, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(k1.company, k1.participantId, ["manager"]);
  const or = await otherParticipant("owner_representative");
  orEngineer = await projectMember(or.company, or.participantId, ["engineer"]);
  const ow = await otherParticipant("owner");
  owner = await projectMember(ow.company, ow.participantId, ["representative"]);
});

describe("C1 creates a Revision of the item that got Code C (scenario 49)", () => {
  let closed = "";
  let revision = "";
  beforeAll(async () => {
    closed = await closedAtCodeC("FD-90");
    revision = await newDraft("FD-90 Rev 1");
    expect(await fill(engineer, revision, closed)).toBe("filled");
  });

  it("starts with the raiser's answers and the Consultant's section empty", async () => {
    for (const c1Member of [engineer, pm]) {
      expect(await answersOf(c1Member, revision)).toEqual({ model: "FD-90" });
    }
    const body = (await engineer.caller.get(`/v1/work-items/${revision}`)).body;
    expect(body).not.toContain("Sample does not match");
  });

  it("still shows the closed item's Consultant answers to everyone who can see it", async () => {
    for (const who of [engineer, pm, k1Engineer, k1Manager, orEngineer, owner]) {
      expect(await answersOf(who, closed)).toEqual({
        model: "FD-90",
        sample_checked: false,
        verification_note: "Sample does not match",
      });
    }
  });

  it("keeps field times and the 'as arrived' copy to the answers it has", async () => {
    const times = (await detail(engineer, revision)).fieldTimes;
    expect(Object.keys(times).sort()).toEqual(["location", "model", "trade"]);
    const row = await migrator
      .selectFrom("work_item")
      .select(["data", "data_as_arrived", "field_times"])
      .where("id", "=", revision)
      .executeTakeFirstOrThrow();
    expect(row.data_as_arrived).toBeNull();
    expect(row.data).toEqual({ model: "FD-90" });
    expect(Object.keys(row.field_times as object).sort()).toEqual(["location", "model", "trade"]);
  });

  it("leaves the closed item as it was", async () => {
    const row = await migrator.selectFrom("work_item").select(["data", "data_as_arrived"]).where("id", "=", closed).executeTakeFirstOrThrow();
    expect(row.data_as_arrived).toBeNull();
    expect(row.data).toMatchObject({ sample_checked: false, verification_note: "Sample does not match" });
  });

  it("is a Draft the raiser edits, but not in the Consultant's section", async () => {
    await ok(saveOver(engineer, revision, { model: "FD-91" }));
    expect(await answersOf(engineer, revision)).toEqual({ model: "FD-91" });
    expect((await saveOver(engineer, revision, { sample_checked: true })).statusCode).toBe(409);
  });
});

describe("filling a Revision", () => {
  it("is refused for an item without Code C, someone else's, or a Revision that isn't a fresh Draft", async () => {
    const closed = await closedAtCodeC("FD-92");
    const draft = await newDraft("FD-92 Rev 1");
    expect(await fill(engineer, draft, draft)).toBe("not_allowed");
    // K1 doesn't see C1's Draft.
    expect(await fill(k1Engineer, draft, closed)).toBe("not_found");
    expect(await fill(engineer, closed, closed)).toBe("not_allowed");
    // A Draft already sent for review isn't fresh.
    await ok(take(engineer, draft, "send_for_review"));
    expect(await fill(engineer, draft, closed)).toBe("not_allowed");
  });
});
