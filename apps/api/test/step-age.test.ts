// Seam 1: Step Age follows the grouping (RP-255; visibility.md V14, scenario 35).
// Inside the Company holding the item, Step Age counts from its current internal
// Step. Every other Company counts it from when the item reached that Company, so
// the holder's internal moves never reset or reveal anything.
//
// The seeded MAR has one Consultant Step, so this file adds a test-only Work Item
// Type whose Workflow has two: the Consultant's Engineer, then its Manager, who
// can Return it to the Engineer. The Manager's Step is in another Stage, so the
// Stage too must stay the one the item arrived in.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemDetail, WorkItemSummary } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller, type OnboardedCompany } from "./support/harness.ts";
import { projectMember, tryTake } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

type Company = { company: OnboardedCompany; caller: Caller };
type Coverage = { isAll: boolean; valueIds: string[] };

const DAY = 86_400_000;
const TYPE = "MARIN";
const CONSULTANT = "Internal Steps Consultants";
const MANAGER_STEP = "Consultant manager review";
const RETURN_REASON = "Check the cable schedule";

const bilingual = (text: string) => ({ en: text, ar: text });
const all: Coverage = { isAll: true, valueIds: [] };

let projectId = "";
let electrical = "";
let buildingA = "";

let engineer: Caller; // C1 Engineer.
let pm: Caller; // C1 Project Manager: submits.
let k1Engineer: Caller; // K1 Engineer: holds the first Consultant Step.
let k1Manager: Caller; // K1 Manager (the Consultant's PM): holds the second.
let owner: Caller; // Owner, covering the whole Project: oversight.

/** The test-only Rabaed Default Type: Draft → Contractor review → Consultant engineer ⇄ Consultant manager → Approved. */
async function addInternalConsultantStepsType() {
  await sql`
    do $$
      declare
        v_definition uuid;
        v_version uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          -- Written before Types had Forms: it fills the MAR's.
          update work_item_type set form_definition_id = (select form_definition_id from work_item_type where code = 'MAR')
          where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)} and form_definition_id is null;
          -- Written before Action Forms (RP-300): its Return asks for a reason, as the MAR's.
          update workflow_transition tr set action_form = (
            select mar.action_form from workflow_transition mar
            join work_item_type t on t.code = 'MAR' and t.owner_kind = 'rabaed'
            join workflow_version v on v.workflow_definition_id = t.workflow_definition_id and v.id = mar.workflow_version_id
            where v.version_no = 1 and mar.key = 'return')
          where tr.key = 'return_to_engineer' and tr.action_form is null and tr.workflow_version_id in (
            select v.id from workflow_version v join work_item_type t on t.workflow_definition_id = v.workflow_definition_id
            where t.owner_kind = 'rabaed' and t.code = ${sql.lit(TYPE)});
          return;
        end if;
        insert into workflow_definition (owner_kind, name)
        values ('rabaed', '{"en": "Internal Consultant Steps (test)", "ar": "خطوات داخلية (اختبار)"}')
        returning id into v_definition;
        insert into workflow_version (workflow_definition_id, version_no, status)
        values (v_definition, 1, 'draft')
        returning id into v_version;

        insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode) values
          (v_version, 'draft', '{"en": "Draft", "ar": "مسودة"}', 'draft',
            '{"base_role": "contractor", "permission": "create"}', 'none'),
          (v_version, 'internal_review', '{"en": "Contractor review", "ar": "مراجعة المقاول"}', 'internal_review',
            '{"base_role": "contractor", "permission": "review"}', 'none'),
          (v_version, 'consultant_engineer', '{"en": "Consultant engineer review", "ar": "مراجعة مهندس الاستشاري"}',
            'pending_approval', '{"base_role": "consultant", "permission": "review"}', 'none'),
          (v_version, 'consultant_manager', ${sql.lit(JSON.stringify(bilingual(MANAGER_STEP)))}::jsonb,
            'internal_review', '{"base_role": "consultant", "permission": "approve"}', 'issue_code'),
          (v_version, 'approved', '{"en": "Approved", "ar": "معتمد"}', 'approved', '{}', 'none');

        -- Its Return asks for a reason, as the MAR's (RP-300).
        insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form)
        select v_version, t.key, f.id, s.id, t.label::jsonb, t.kind, t.outcome, t.permission, t.sort,
          case when t.kind = 'return' then (
            select mar.action_form from workflow_transition mar
            join work_item_type wt on wt.code = 'MAR' and wt.owner_kind = 'rabaed'
            join workflow_version v on v.workflow_definition_id = wt.workflow_definition_id and v.id = mar.workflow_version_id
            where v.version_no = 1 and mar.key = 'return') end
        from (values
          ('send_for_review', 'draft', 'internal_review', '{"en": "Send for Review", "ar": "إرسال للمراجعة"}', 'send', null, 'create', 1),
          ('submit', 'internal_review', 'consultant_engineer', '{"en": "Submit", "ar": "تقديم"}', 'submit', null, 'submit', 2),
          ('send_to_manager', 'consultant_engineer', 'consultant_manager', '{"en": "Send to Manager", "ar": "إرسال للمدير"}',
            'send', null, 'review', 3),
          ('return_to_engineer', 'consultant_manager', 'consultant_engineer', '{"en": "Return", "ar": "إعادة"}',
            'return', null, 'approve', 4),
          ('approve_a', 'consultant_manager', 'approved', '{"en": "Approve · A", "ar": "اعتماد · A"}', 'close', 'A', 'approve', 5)
        ) as t (key, from_key, to_key, label, kind, outcome, permission, sort)
        join workflow_step f on f.workflow_version_id = v_version and f.key = t.from_key
        join workflow_step s on s.workflow_version_id = v_version and s.key = t.to_key;

        -- Published once its parts are in: a published Version takes none (RP-424).
        update workflow_version set status = 'published', published_at = now() where id = v_version;

        -- It is filled with the MAR's Form.
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', ${sql.lit(TYPE)}, '{"en": "Internal Steps Submittal", "ar": "اعتماد بخطوات داخلية"}',
          v_definition, 'review_code', (select form_definition_id from work_item_type where code = 'MAR'));
      end
    $$
  `.execute(migrator);
}

async function ok(res: Promise<{ statusCode: number; body: string }>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
}

async function participant(c1: Company, role: "consultant" | "owner", legalName: string) {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  const company = { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  const participantId = await api.addParticipant(c1.caller, projectId, onboarded, role);
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return { company, participantId };
}

/** Everything a caller learns of the item: its list row, detail and history. */
async function seenBy(by: Caller, id: string) {
  const list = await by.get(`/v1/projects/${projectId}/work-items`);
  const res = await by.get(`/v1/work-items/${id}`);
  const hist = await by.get(`/v1/work-items/${id}/history`);
  for (const r of [list, res, hist]) expect(r.statusCode, r.body).toBe(200);
  return {
    row: list.json().items.find((i: WorkItemSummary) => i.id === id) as WorkItemSummary,
    detail: res.json() as WorkItemDetail,
    history: hist.json().events as unknown[],
    body: [list.body, res.body, hist.body].join("\n"),
  };
}

beforeAll(async () => {
  await addInternalConsultantStepsType();
  const c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });

  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  engineer = await projectMember(api, c1, c1ParticipantId, ["engineer"]);
  pm = await projectMember(api, c1, c1ParticipantId, ["project_manager"]);

  const k1 = await participant(c1, "consultant", CONSULTANT);
  k1Engineer = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const ow = await participant(c1, "owner", "Test Owner");
  owner = await projectMember(api, ow.company, ow.participantId, ["representative"]);
});

describe("K1 moves the Submitted item internally (scenario 35)", () => {
  let id = "";
  let submittedAt = "";
  type Seen = Record<"pm" | "owner", Awaited<ReturnType<typeof seenBy>>>;
  let atSubmit: Seen;
  let withManager: Seen; // While the K1 Manager holds it.

  beforeAll(async () => {
    const res = await engineer.post(`/v1/projects/${projectId}/work-items`, {
      type: TYPE,
      title: "Cable trays",
      answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade: electrical, location: buildingA },
    });
    expect(res.statusCode, res.body).toBe(201);
    id = res.json().id;
    await attachDatasheet(engineer, id);
    await ok(tryTake(engineer, id, "send_for_review"));
    await ok(pm.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(pm, id, "submit"));
    atSubmit = { pm: await seenBy(pm, id), owner: await seenBy(owner, id) };
    submittedAt = atSubmit.pm.detail.stepEnteredAt!;

    // Two weeks later the K1 Engineer sends it to the K1 Manager…
    await api.later(15 * DAY);
    await ok(k1Engineer.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Engineer, id, "send_to_manager"));
    withManager = { pm: await seenBy(pm, id), owner: await seenBy(owner, id) };
    // …who, a week later, Returns it to the Engineer.
    await api.later(8 * DAY);
    await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Manager, id, "return_to_engineer", { reason: RETURN_REASON }));
  });

  it("shows the C1 PM and the Owner Step Age counted from the Submit: no reset", async () => {
    for (const caller of [pm, owner]) {
      const { row, detail } = await seenBy(caller, id);
      // 23 days after the Submit: its fourth week.
      expect(row).toMatchObject({ stepEnteredAt: submittedAt, stepAgeWeeks: 4 });
      expect(detail).toMatchObject({ stepEnteredAt: submittedAt, stepAgeWeeks: 4 });
    }
  });

  it("shows the C1 PM and the Owner nothing of the internal moves: only the age changed", async () => {
    for (const who of ["pm", "owner"] as const) {
      const caller = who === "pm" ? pm : owner;
      const before = atSubmit[who];
      for (const now of [withManager[who], await seenBy(caller, id)]) {
        expect({ ...now.detail, stepAgeWeeks: 1 }).toEqual({ ...before.detail, stepAgeWeeks: 1 });
        expect({ ...now.row, stepAgeWeeks: 1 }).toEqual({ ...before.row, stepAgeWeeks: 1 });
        expect(now.history).toEqual(before.history);
        for (const secret of [MANAGER_STEP, RETURN_REASON, "Send to Manager"]) expect(now.body).not.toContain(secret);
      }
    }
  });

  it("shows K1's own Members Step Age counted from the current internal Step", async () => {
    for (const caller of [k1Engineer, k1Manager]) {
      const { row, detail } = await seenBy(caller, id);
      expect(row.stepAgeWeeks).toBe(1);
      expect(detail).toMatchObject({ step: { key: "consultant_engineer" }, stage: { key: "pending_approval" }, stepAgeWeeks: 1 });
      expect(Date.parse(detail.stepEnteredAt!)).toBeGreaterThan(Date.parse(submittedAt) + 22 * DAY);
    }
  });

  it("keeps K1's own history of the internal moves", async () => {
    const { history } = await seenBy(k1Engineer, id);
    expect(JSON.stringify(history)).toContain(RETURN_REASON);
  });

  it("counts again from the Code for everyone once K1 closes the item", async () => {
    await ok(tryTake(k1Engineer, id, "send_to_manager"));
    await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(k1Manager, id, "approve_a"));
    for (const caller of [pm, owner, k1Engineer, k1Manager]) {
      const { detail } = await seenBy(caller, id);
      expect(detail).toMatchObject({ outcome: "A", stepAgeWeeks: 1 });
      expect(Date.parse(detail.stepEnteredAt!)).toBeGreaterThan(Date.parse(submittedAt) + 22 * DAY);
    }
  });
});
