// Seam 1: the link question, `work_item_ref` (RP-293, spec RP-289; form-engine.md
// part 2b; ADR 0012 as amended 2026-10-05; visibility.md E1, scenarios 11, 80
// and 81). The filler picks items with Link search; each is a `relies_on` Link
// under the field's key, kept equal to the answer on every save, and frozen
// with the answers from Submit. An item Link search couldn't have offered is
// refused like an unknown option. A reader who can't see a chosen item gets it
// as its Document Number and Subject, never its id.
//
// MAR Form Version 3 (RP-294) brings the first Rabaed Default link question, so
// this file adds a test-only Type (the MAR's Workflow) whose Form has one.
// The Tower setup is support/tower.ts, as in links.test.ts.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { WorkItemHistory, WorkItemLinks } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, detail, draft, inInternalReview, ok, only, projectMember, submitted, tryTake, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "LINKQ";
const schema = {
  sections: [
    {
      key: "basis",
      title: { en: "Basis", ar: "الأساس" },
      fields: [
        { key: "relies", type: "yes_no", label: { en: "Relies on earlier submittals", ar: "يعتمد على تقديمات سابقة" } },
        {
          key: "related",
          type: "work_item_ref",
          label: { en: "Related submittals", ar: "التقديمات ذات الصلة" },
          required: true,
          visible_if: { field: "relies", op: "=", value: true },
        },
      ],
    },
    {
      key: "classification",
      title: { en: "Classification", ar: "التصنيف" },
      fields: [
        { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
        { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        { key: "scopes", type: "scopes", label: { en: "Scopes", ar: "النطاقات" } },
      ],
    },
  ],
};

/** The test-only Rabaed Default Type, with the Form above, following the MAR's Workflow. */
async function addType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Link question (test)", "ar": "سؤال ربط (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "Link question submittal", "ar": "اعتماد بسؤال ربط"}',
          workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$
  `.execute(migrator);
}

let c1: Company;
let k1: Company;
let c2: Company;
let tower: Tower;
let elsewhere: Tower;
let c2Engineer: Caller;
let c2Pm: Caller;
let k1Mechanical: Caller; // A K1 manager covering Mechanical only.
let c1Mechanical: Caller; // A C1 engineer covering Mechanical only.

/** The answers of a link-question item on the Tower, Mechanical: the C1 Mechanical engineer sees it. */
const lqAnswers = (answers: Record<string, unknown>) => ({ trade: tower.mechanical, location: tower.buildingA, ...answers });
const createLq = (by: Caller, answers: Record<string, unknown>) =>
  by.post(`/v1/projects/${tower.projectId}/work-items`, { type: TYPE, title: "Chilled water pipes", answers: lqAnswers(answers) });
const save = (by: Caller, id: string, answers: Record<string, unknown>) =>
  by.request("PUT", `/v1/work-items/${id}/answers`, { answers: lqAnswers(answers) });
const links = async (by: Caller, id: string): Promise<WorkItemLinks> => (await ok(by.get(`/v1/work-items/${id}/links`), 200)).json();
/** The item's link-question Links, as [field key, linked item id or null]. */
const questionLinks = async (by: Caller, id: string) =>
  (await links(by, id)).links.filter((l) => l.kind === "relies_on").map((l) => [l.fieldKey, l.workItemId]);
const number = async (id: string) => (await tower.c1Engineer.get(`/v1/work-items/${id}`)).json().documentNumber as string;

async function answerChanges(by: Caller, id: string) {
  const events: WorkItemHistory["events"] = (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
  return events.filter((e) => e.type === "answers_changed").map((e) => e.changes);
}

const refusal = (r: LightMyRequestResponse) => ({ status: r.statusCode, body: r.json() });
const unknownRelated = { status: 422, body: { error: "invalid_answers", fields: [{ key: "related", code: "unknown_option" }] } };

const item = { c1Draft: "", c1Internal: "", c1Submitted: "", c1Approved: "", c2Submitted: "", elsewhere: "" };
const numbers = { c1Submitted: "", c1Approved: "" };

beforeAll(async () => {
  await addType();
  c1 = await api.projectCreator();
  const onboard = async (legalName: string): Promise<Company> => {
    const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
    return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  };
  k1 = await onboard("Design Consultants LLC");
  c2 = await onboard("Second Contractor Co");
  tower = await buildTower(api, { c1, k1 }, "TWR");
  elsewhere = await buildTower(api, { c1, k1 }, "MAL");

  const c2ParticipantId = await api.addParticipant(c1.caller, tower.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  c2Pm = await projectMember(api, c2, c2ParticipantId, ["project_manager"]);
  const k1ParticipantId = (await tower.k1Manager.get(`/v1/projects/${tower.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  k1Mechanical = await projectMember(api, k1, k1ParticipantId, ["manager"], { trade: only(tower.mechanical) });
  c1Mechanical = await projectMember(api, c1, tower.c1ParticipantId, ["engineer"], { trade: only(tower.mechanical) });

  const { c1Engineer, c1Pm, k1Manager } = tower;
  item.c1Draft = await draft(tower, c1Engineer, "Cable trays, draft");
  item.c1Internal = await inInternalReview(tower, c1Engineer, "Cable trays, in internal review");
  item.c1Submitted = await submitted(tower, c1Engineer, c1Pm, "Cable trays, submitted");
  item.c1Approved = await submitted(tower, c1Engineer, c1Pm, "Cable trays, approved");
  await ok(k1Manager.post(`/v1/work-items/${item.c1Approved}/pick-up`));
  await verified(k1Manager, item.c1Approved);
  await ok(tryTake(k1Manager, item.c1Approved, "approve_a"));
  item.c2Submitted = await submitted(tower, c2Engineer, c2Pm, "Cable trays, second contractor");
  item.elsewhere = await submitted(elsewhere, elsewhere.c1Engineer, elsewhere.c1Pm, "Cable trays, another Project");
  numbers.c1Submitted = await number(item.c1Submitted);
  numbers.c1Approved = await number(item.c1Approved);
});

describe("a link question", () => {
  let lq = "";

  it("round-trips its items, each also a Link under the field's key", async () => {
    const created = await ok(createLq(tower.c1Engineer, { relies: true, related: [item.c1Submitted] }), 201);
    lq = created.json().id;
    expect((await detail(tower.c1Engineer, lq)).answers).toMatchObject({ related: [item.c1Submitted] });
    expect(await questionLinks(tower.c1Engineer, lq)).toEqual([["related", item.c1Submitted]]);
  });

  it("changes its Links with the answer: added and removed on save", async () => {
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [item.c1Approved, item.c1Submitted] }));
    expect((await detail(tower.c1Engineer, lq)).answers).toMatchObject({ related: [item.c1Approved, item.c1Submitted] });
    expect((await questionLinks(tower.c1Engineer, lq)).sort()).toEqual(
      [
        ["related", item.c1Approved],
        ["related", item.c1Submitted],
      ].sort(),
    );
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [item.c1Approved] }));
    expect(await questionLinks(tower.c1Engineer, lq)).toEqual([["related", item.c1Approved]]);
    // Cleared with its field: hidden by its condition, the answer and its Links go.
    await ok(save(tower.c1Engineer, lq, { relies: false, related: [item.c1Approved] }));
    expect((await detail(tower.c1Engineer, lq)).answers).not.toHaveProperty("related");
    expect(await questionLinks(tower.c1Engineer, lq)).toEqual([]);
  });

  it("lists Links made in one save by the linked item's Document Number, not by their random ids (scenario 73)", async () => {
    const both = (await ok(createLq(tower.c1Engineer, { relies: true, related: [item.c1Approved, item.c1Submitted] }), 201)).json().id;
    const byNumber = numbers.c1Submitted < numbers.c1Approved ? [item.c1Submitted, item.c1Approved] : [item.c1Approved, item.c1Submitted];
    expect(await questionLinks(tower.c1Engineer, both)).toEqual(byNumber.map((id) => ["related", id]));
  });

  it("refuses a hidden, Draft, internal, other-Project or made-up item, or the item itself, like an unknown option (scenarios 11, 80)", async () => {
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [item.c1Submitted] }));
    for (const refused of [item.c2Submitted, item.c1Draft, item.c1Internal, item.elsewhere, randomUUID(), lq]) {
      expect(refusal(await save(tower.c1Engineer, lq, { relies: true, related: [refused] })), refused).toEqual(unknownRelated);
      expect(refusal(await createLq(tower.c1Engineer, { relies: true, related: [refused] })), refused).toEqual(unknownRelated);
    }
    // C2 can't link C1's approved MAR, which it can't see (scenario 11).
    expect(refusal(await createLq(c2Engineer, { relies: true, related: [item.c1Approved] }))).toEqual(unknownRelated);
    expect((await detail(tower.c1Engineer, lq)).answers).toMatchObject({ related: [item.c1Submitted] });
    expect(await questionLinks(tower.c1Engineer, lq)).toEqual([["related", item.c1Submitted]]);
  });

  it("when required, blocks leaving Draft until an item is chosen", async () => {
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [] }));
    const r = await tryTake(tower.c1Engineer, lq, "send_for_review");
    expect(refusal(r)).toEqual({ status: 422, body: { error: "form_incomplete", fields: [{ key: "related", code: "required" }] } });
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [item.c1Submitted] }));
    await ok(tryTake(tower.c1Engineer, lq, "send_for_review"));
  });

  it("changes in the raiser's internal review, each change in the field-level history as numbers and Subjects, never ids", async () => {
    await ok(save(tower.c1Pm, lq, { relies: true, related: [item.c1Submitted, item.c1Approved] }));
    const submittedItem = { documentNumber: numbers.c1Submitted, subject: "Cable trays, submitted" };
    const approvedItem = { documentNumber: numbers.c1Approved, subject: "Cable trays, approved" };
    expect(await answerChanges(tower.c1Engineer, lq)).toEqual([[{ field: "related", old: [submittedItem], new: [submittedItem, approvedItem] }]]);
    const history = (await ok(tower.c1Engineer.get(`/v1/work-items/${lq}/history`), 200)).body;
    expect(history).not.toContain(item.c1Approved);
  });

  it("keeps an item the saver can't see when the answers come back as read, and lets them remove it", async () => {
    // The C1 Mechanical engineer sees the item, not the Electrical MARs it links to.
    const read = (await detail(c1Mechanical, lq)).answers;
    expect(read.related).toEqual([
      { documentNumber: numbers.c1Submitted, subject: "Cable trays, submitted" },
      { documentNumber: numbers.c1Approved, subject: "Cable trays, approved" },
    ]);
    await ok(save(c1Mechanical, lq, read));
    expect((await detail(tower.c1Engineer, lq)).answers).toMatchObject({ related: [item.c1Submitted, item.c1Approved] });
    await ok(save(c1Mechanical, lq, { ...read, related: [(read.related as unknown[])[1]] }));
    expect((await detail(tower.c1Engineer, lq)).answers).toMatchObject({ related: [item.c1Approved] });
    expect(await questionLinks(tower.c1Engineer, lq)).toEqual([["related", item.c1Approved]]);
    // Nor can they choose it anew by its id, which they never got.
    expect(refusal(await save(c1Mechanical, lq, { relies: true, related: [item.c1Submitted] }))).toEqual(unknownRelated);
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [item.c1Submitted, item.c1Approved] }));
  });

  it("is frozen with the answers from Submit", async () => {
    await ok(tower.c1Pm.post(`/v1/work-items/${lq}/pick-up`));
    await ok(tryTake(tower.c1Pm, lq, "submit"));
    const r = await save(tower.c1Engineer, lq, { relies: true, related: [item.c1Approved] });
    expect(refusal(r)).toEqual({ status: 409, body: { error: "not_editable" } });
    expect((await detail(tower.c1Engineer, lq)).answers).toMatchObject({ related: [item.c1Submitted, item.c1Approved] });
  });

  it("gives a reader who can't see a chosen item its number and Subject, never its id (scenario 81)", async () => {
    const res = await ok(k1Mechanical.get(`/v1/work-items/${lq}`), 200);
    expect(res.json().answers.related).toEqual([
      { documentNumber: numbers.c1Submitted, subject: "Cable trays, submitted" },
      { documentNumber: numbers.c1Approved, subject: "Cable trays, approved" },
    ]);
    for (const hidden of [item.c1Submitted, item.c1Approved]) {
      expect(res.body).not.toContain(hidden);
      expect((await ok(k1Mechanical.get(`/v1/work-items/${lq}/links`), 200)).body).not.toContain(hidden);
    }
    await expectHidden(k1Mechanical.get(`/v1/work-items/${item.c1Approved}`));
    // A reader who sees them gets their ids.
    expect((await detail(tower.k1Manager, lq)).answers).toMatchObject({ related: [item.c1Submitted, item.c1Approved] });
  });
});

describe("an item already chosen that goes back to its raiser's Draft (Sent Back)", () => {
  let target = "";
  let lq = "";

  beforeAll(async () => {
    target = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Cable trays, taken back");
    lq = (await ok(createLq(tower.c1Engineer, { relies: true, related: [target] }), 201)).json().id;
    // As the owner: back with its raiser, in Draft, as a Send Back to Draft would leave it.
    await sql`
      update work_item w set participant_entered_step_id = (
        select s.id from workflow_step s where s.workflow_version_id = w.workflow_version_id and app.is_draft_step(s.id)
        order by s.id limit 1)
      where w.id = ${target}::uuid
    `.execute(migrator);
  });

  it("stays in the answer and its Links when the answers are saved again", async () => {
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [target] }));
    expect((await detail(tower.c1Engineer, lq)).answers).toMatchObject({ related: [target] });
    expect(await questionLinks(tower.c1Engineer, lq)).toEqual([["related", target]]);
  });

  // Submitted at least once, it stays in Link search (RP-295, scenario 58).
  it("can still be chosen anew, as Link search still offers it", async () => {
    await ok(createLq(tower.c1Engineer, { relies: true, related: [target] }), 201);
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [] }));
    expect(await questionLinks(tower.c1Engineer, lq)).toEqual([]);
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [target] }));
    expect(await questionLinks(tower.c1Engineer, lq)).toEqual([["related", target]]);
  });

  it("is refused by its id to a saver who can't see it, even while chosen", async () => {
    const approved = await submitted(tower, tower.c1Engineer, tower.c1Pm, "Cable trays, chosen and hidden");
    await ok(save(tower.c1Engineer, lq, { relies: true, related: [approved] }));
    expect(refusal(await save(c1Mechanical, lq, { relies: true, related: [approved] }))).toEqual(unknownRelated);
  });
});

/** The Consultant's verification (MAR Form Version 4, RP-306), saved by the Code's signer before the Code. */
async function verified(by: Caller, id: string) {
  const answers = (await by.get(`/v1/work-items/${id}`)).json().answers as Record<string, unknown>;
  const saved = await by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...answers, sample_checked: true, matches_specification: true } });
  expect(saved.statusCode, saved.body).toBe(204);
}
