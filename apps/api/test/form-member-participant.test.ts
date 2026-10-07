// Seam 1 for the Form's `member` and `participant` fields (RP-266, spec RP-261;
// visibility.md V14, V15): a filler is offered only the Project Members and
// Participants they can see, an id they couldn't have been offered is refused
// exactly like a made-up one, and another Company reads a `member` answer as
// the Company's name, never the person, not even by id.
//
// The MAR Form Version 1 has text fields only, so this file adds a test-only
// Rabaed Default Type (the MAR's Workflow) whose Form has both fields. The
// Owner OW hosts the Project, so the Host Company isn't the filler's own.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { BaseRole, FormChoices, WorkItemDetail } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { detail, tryTake } from "./support/tower.ts";

const api = await createTestApi();
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARMP";
const bilingual = (text: string) => ({ en: text, ar: `${text} (ع)` });
const all = { isAll: true, valueIds: [] };

const schema = {
  sections: [
    {
      key: "material",
      title: { en: "Material", ar: "المادة" },
      fields: [
        { key: "manufacturer", type: "text", required: true, label: { en: "Manufacturer", ar: "المصنّع" } },
        { key: "site_engineer", type: "member", required: true, label: { en: "Site engineer", ar: "مهندس الموقع" } },
        { key: "supplier", type: "participant", label: { en: "Supplied through", ar: "التوريد عن طريق" } },
      ],
    },
    {
      // The Built-in Fields every Form places (RP-270).
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
async function addPeopleType() {
  await sql`
    do $$
      declare
        v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "People (test)", "ar": "الأشخاص (اختبار)"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), ${sql.lit(JSON.stringify(schema))}::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, ${sql.lit(TYPE)}, '{"en": "People submittal", "ar": "اعتماد الأشخاص"}',
          workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$
  `.execute(migrator);
}

async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

type Person = { id: string; caller: Caller; name: { en: string; ar: string } };
type Party = {
  participantId: string;
  name: { en: string; ar: string };
  /** Its Authorized Person. */
  ap: Caller;
  member(positions: string[]): Promise<Person>;
};

let projectId = "";
let electrical = "";
let buildingA = "";

/** The Built-in Fields, sent with every set of answers so the people fields are what each test varies. */
const builtIns = () => ({ trade: electrical, location: buildingA });
let ow: Party & { admin: Caller; adminId: string };
let c1: Party;
let c2: Party;
let k1: Party;
let or: Party;
let engineer: Person; // C1 Engineer: fills the Form.
let pm: Person; // C1 Project Manager.
let c2Engineer: Person;
let k1Engineer: Person;
let k1Manager: Person; // The Consultant pool a Submit goes to.
let orMember: Person;
let owMember: Person;

/** A Company with its own name, its Authorized Person signed in. */
async function company(name: string) {
  const onboarded = await api.onboardCompany({ legalName: bilingual(name) });
  return { onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
}

/** Adds a named Member of `ap`'s Company to the Participant, seeing all its Trades and Locations. */
function memberOf(ap: Caller, participantId: string) {
  return async (positions: string[]): Promise<Person> => {
    const name = bilingual(`Member ${randomUUID().slice(0, 6)}`);
    const invited = await api.inviteMember(ap, { fullName: name });
    const caller = await api.acceptInvitation(invited.invitationToken);
    await api.addProjectMember(ap, participantId, invited.id);
    await ok(ap.request("PUT", `/v1/participants/${participantId}/members/${invited.id}/visibility`, { trade: all, location: all }));
    if (positions.length) {
      await ok(ap.request("PUT", `/v1/participants/${participantId}/members/${invited.id}/positions`, { positions }));
    }
    return { id: invited.id, caller, name };
  };
}

async function participant(name: string, role: BaseRole): Promise<Party> {
  const { onboarded, caller } = await company(name);
  const participantId = await api.addParticipant(ow.admin, projectId, onboarded, role);
  await ok(ow.admin.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return { participantId, name: bilingual(name), ap: caller, member: memberOf(caller, participantId) };
}

const choices = async (by: Caller, url: string): Promise<FormChoices> => (await ok(by.get(url), 200)).json();
const ids = (list: { id: string }[]) => list.map((c) => c.id).sort();

const createDraft = (by: Caller, answers: Record<string, unknown>) =>
  by.post(`/v1/projects/${projectId}/work-items`, { type: TYPE, title: "Cable trays", answers: { ...builtIns(), ...answers } });

beforeAll(async () => {
  await addPeopleType();
  const host = await company("OW Holding");
  await ok(host.caller.patch(`/v1/members/${host.onboarded.authorizedPerson.id}`, { canCreateProjects: true }), 200);
  projectId = (await api.createProject(host.caller, { role: "owner" })).id;
  const own = (await host.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(host.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  ow = { participantId: own, name: bilingual("OW Holding"), ap: host.caller, member: memberOf(host.caller, own), admin: host.caller,
    adminId: host.onboarded.authorizedPerson.id };
  electrical = (await ow.admin.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (
    await ow.admin.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null })
  ).json().id;

  c1 = await participant("C1 Contracting", "contractor");
  c2 = await participant("C2 Contracting", "contractor");
  k1 = await participant("K1 Consultants", "consultant");
  or = await participant("OR Representatives", "owner_representative");
  engineer = await c1.member(["engineer"]);
  pm = await c1.member(["project_manager"]);
  c2Engineer = await c2.member(["engineer"]);
  k1Engineer = await k1.member(["engineer"]);
  k1Manager = await k1.member(["manager"]);
  orMember = await or.member([]);
  owMember = await ow.member([]);
});

describe("what a C1 Engineer is offered (V15)", () => {
  it("only C1's Project Members, and only C1 and the Host Company", async () => {
    const offered = await choices(engineer.caller, `/v1/projects/${projectId}/form-choices`);
    expect(ids(offered.members)).toEqual([engineer.id, pm.id].sort());
    expect(offered.members).toContainEqual({ id: pm.id, name: pm.name });
    // Their own Participant first, then the Host Company.
    expect(offered.participants).toEqual([
      { id: c1.participantId, name: c1.name },
      { id: ow.participantId, name: ow.name },
    ]);
  });

  it("never names C2, K1 or OR, nor any of their Members, anywhere in the answer", async () => {
    const body = (await ok(engineer.caller.get(`/v1/projects/${projectId}/form-choices`), 200)).body;
    for (const hidden of [c2, k1, or]) {
      expect(body).not.toContain(hidden.participantId);
      expect(body).not.toContain(hidden.name.en);
    }
    for (const hidden of [c2Engineer, k1Engineer, k1Manager, orMember, owMember]) {
      expect(body).not.toContain(hidden.id);
      expect(body).not.toContain(hidden.name.en);
    }
  });

  it("a Project Admin is offered no more Participants than anyone else, though they list them all", async () => {
    const offered = await choices(ow.admin, `/v1/projects/${projectId}/form-choices`);
    expect(offered.participants).toEqual([{ id: ow.participantId, name: ow.name }]);
    expect(ids(offered.members)).toEqual([ow.adminId, owMember.id].sort());
  });

  it("is a 404 for anyone not on the Project, as for a made-up one", async () => {
    const outsider = (await api.member((await company("Elsewhere")).caller)).caller;
    await expectHidden(outsider.get(`/v1/projects/${projectId}/form-choices`));
    await expectHidden(engineer.caller.get(`/v1/projects/${randomUUID()}/form-choices`));
  });
});

describe("saving an id the filler wasn't offered", () => {
  const refusal = async (res: Promise<LightMyRequestResponse>) => {
    const r = await res;
    return { status: r.statusCode, body: r.json() };
  };
  const madeUp = randomUUID();

  it("is refused on create with the same answer as a random id", async () => {
    const expected = await refusal(createDraft(engineer.caller, { site_engineer: madeUp, supplier: madeUp }));
    expect(expected).toEqual({
      status: 422,
      body: {
        error: "invalid_answers",
        fields: [
          { key: "site_engineer", code: "unknown_option" },
          { key: "supplier", code: "unknown_option" },
        ],
      },
    });
    for (const [member, party] of [
      [c2Engineer, c2],
      [k1Engineer, k1],
      [orMember, or],
    ] as const) {
      expect(await refusal(createDraft(engineer.caller, { site_engineer: member.id, supplier: party.participantId }))).toEqual(
        expected,
      );
    }
  });

  it("is refused on Save draft with the same answer as a random id, and changes nothing", async () => {
    const id = (await ok(createDraft(engineer.caller, { site_engineer: pm.id }), 201)).json().id;
    const save = (answers: Record<string, unknown>) =>
      refusal(engineer.caller.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), ...answers } }));
    const expected = await save({ site_engineer: madeUp });
    expect(expected).toEqual({ status: 422, body: { error: "invalid_answers", fields: [{ key: "site_engineer", code: "unknown_option" }] } });
    expect(await save({ site_engineer: k1Engineer.id })).toEqual(expected);
    expect(await save({ site_engineer: c1.participantId })).toEqual(expected); // a Participant's id is not a Member's
    expect(await save({ supplier: k1.participantId })).toEqual({
      status: 422,
      body: { error: "invalid_answers", fields: [{ key: "supplier", code: "unknown_option" }] },
    });
    expect((await detail(engineer.caller, id)).answers).toEqual({ ...builtIns(), site_engineer: pm.id });
  });

  it("is not asked of an answer already saved: a Member who has since left the Project stays, and can't be chosen again", async () => {
    const leaver = await c1.member([]);
    const id = (await ok(createDraft(engineer.caller, { site_engineer: leaver.id }), 201)).json().id;
    await ok(c1.ap.delete(`/v1/participants/${c1.participantId}/members/${leaver.id}`));
    await ok(engineer.caller.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...builtIns(), site_engineer: leaver.id, manufacturer: "ACME" } }));
    expect((await refusal(createDraft(engineer.caller, { site_engineer: leaver.id }))).body).toEqual({
      error: "invalid_answers",
      fields: [{ key: "site_engineer", code: "unknown_option" }],
    });
  });
});

describe("a Submitted item's member and participant answers", () => {
  let id = "";

  beforeAll(async () => {
    id = (
      await ok(
        createDraft(engineer.caller, { manufacturer: "ACME Cables", site_engineer: pm.id, supplier: ow.participantId }),
        201,
      )
    ).json().id;
    await ok(tryTake(engineer.caller, id, "send_for_review"));
    await ok(pm.caller.post(`/v1/work-items/${id}/claim`));
    await ok(tryTake(pm.caller, id, "submit"));
  });

  it("C1 reads its own Member by name", async () => {
    const item = await detail(engineer.caller, id);
    expect(item.answers).toEqual({ ...builtIns(), manufacturer: "ACME Cables", site_engineer: pm.id, supplier: ow.participantId });
    expect(item.namedAnswers).toEqual({
      site_engineer: { companyName: c1.name, memberName: pm.name },
      supplier: { companyName: ow.name, memberName: null },
    });
  });

  it("K1 reads C1's Member as the Company's name only, without the person's id (V14)", async () => {
    const res = await ok(k1Manager.caller.get(`/v1/work-items/${id}`), 200);
    const item: WorkItemDetail = res.json();
    expect(item.namedAnswers).toEqual({
      site_engineer: { companyName: c1.name, memberName: null },
      supplier: { companyName: ow.name, memberName: null },
    });
    expect(item.answers).toEqual({ ...builtIns(), manufacturer: "ACME Cables", supplier: ow.participantId });
    expect(res.body).not.toContain(pm.id);
    expect(res.body).not.toContain(pm.name.en);
  });

  it("on the item, K1 is offered the Companies on it, and still nobody else's people", async () => {
    const offered = await choices(k1Manager.caller, `/v1/work-items/${id}/form-choices`);
    expect(ids(offered.participants)).toEqual([k1.participantId, c1.participantId, ow.participantId].sort());
    expect(ids(offered.members)).toEqual([k1Engineer.id, k1Manager.id].sort());
  });

  it("anyone who can't see the item gets a 404 for its choices", async () => {
    await expectHidden(c2Engineer.caller.get(`/v1/work-items/${id}/form-choices`));
    await expectHidden(engineer.caller.get(`/v1/work-items/${randomUUID()}/form-choices`));
  });
});
