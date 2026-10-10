// Seam 2 for Screens (RP-516; ADR 0019; workflow-engine.md §5.7; visibility.md V5, V20,
// scenario RP-516-1), as the app role and the migrator:
// - the app role writes no Screen table directly: a Screen and its Versions change only
//   through the app.* commands;
// - a Project's published Screens are read by its Members, never another Project's, and a
//   draft Version by nobody through the tables;
// - a published Screen Version never changes, not even for the tables' owner;
// - a Code's reply keeps its internal answers in an event internal to the Consultant: the
//   Contractor reads the shared ones only, in the events table and in the history.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestScreen, addTestWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "SCRLS";
const label = (en: string) => ({ en, ar: en });
const codeReply = {
  sections: [
    {
      key: "reply",
      title: label("Reply"),
      fields: [
        { key: "remarks", type: "textarea", label: label("Remarks") },
        { key: "verification_note", type: "textarea", label: label("Verification note") },
      ],
    },
  ],
};

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the item; Project Admin of Tower.
let k1: Company; // Consultant: issues the Code with its reply.
let outsider: Company; // On another Project only.
let c1Pm = "";
let projectId = "";
let otherProjectId = "";
let electrical = "";
let buildingA = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
    [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
  );
}

async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: name, ar: name }),
    cr,
    `3${digits(13)}3`,
    engineer,
  ]);
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);
const take = (as: string, id: string, transition: string, answers: object = {}, note = "") =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, ${note}, app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

/** The Screens of `ids` `as` reads through the table. */
const screensSeen = async (as: string, ids: string[]) =>
  (await call<{ id: string }>(as, sql`select id from screen where id = any(${ids}::uuid[]) order by id`)).map((r) => r.id);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const screenVersion = await addTestScreen((text) => migrator.query(text), `code_reply_${digits(6)}`, codeReply, ["verification_note"]);
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { screens: { approve_a: screenVersion } });
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Screens (test)", "ar": "الشاشات"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '{"sections": [{"key": "material", "title": {"en": "Material", "ar": "المادة"},
          "fields": [{"key": "model", "type": "text", "label": {"en": "Model", "ar": "الطراز"}}]}]}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Screens (test)", "ar": "الشاشات"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  outsider = await company(engineer, "Outsider");
  c1Pm = await member(c1.id, "pm");

  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'SCT', 'contractor')`);
  projectId = created!.project_id;
  const [elsewhere] = await call<{ project_id: string }>(
    outsider.ap,
    sql`select project_id from app.create_project('{"en": "Elsewhere", "ar": "مكان آخر"}'::jsonb, 'SCE', 'contractor')`,
  );
  otherProjectId = elsewhere!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, k1.ap, ["manager"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("Screens through the app role", () => {
  let screenId = "";

  it("are written only through the commands, never the tables", async () => {
    await expect(
      call(c1.ap, sql<object>`insert into screen (owner_kind, project_id, key, name) values ('project', ${projectId}::uuid, 'direct', '{"en": "x", "ar": "x"}')`),
    ).rejects.toMatchObject({ code: "42501" });
    const [created] = await call<{ outcome: string; screen_id: string }>(
      c1.ap,
      sql`select outcome, screen_id from app.create_screen(${projectId}::uuid, 'tower_reply', '{"en": "Tower reply", "ar": "رد البرج"}'::jsonb,
        ${JSON.stringify(codeReply)}::jsonb, '{verification_note}'::text[], now())`,
    );
    expect(created!.outcome).toBe("created");
    screenId = created!.screen_id;
    // Nobody but its Project Admins creates one, as for a made-up Project.
    const [refused] = await call<{ outcome: string }>(
      c1.member,
      sql`select outcome from app.create_screen(${projectId}::uuid, 'mine', '{"en": "Mine", "ar": "لي"}'::jsonb, '{}'::jsonb, '{}'::text[], now())`,
    );
    expect(refused!.outcome).toBe("not_found");
  });

  it("are read by the Project's Members once published, never another Project's; a draft by nobody (V20)", async () => {
    // Never published, it is its authors' only (as a Workflow, RP-427-5).
    expect(await screensSeen(c1.ap, [screenId])).toEqual([screenId]);
    for (const reader of [c1.member, k1.member, outsider.member]) expect(await screensSeen(reader, [screenId])).toEqual([]);
    expect(await outcome(c1.ap, sql`select outcome from app.publish_screen(${screenId}::uuid, now())`)).toBe("published");
    for (const reader of [c1.ap, c1.member, k1.member]) expect(await screensSeen(reader, [screenId])).toEqual([screenId]);
    expect(await screensSeen(outsider.ap, [screenId])).toEqual([]);
    expect(otherProjectId).not.toBe(projectId);

    expect(await outcome(c1.ap, sql`select outcome from app.save_screen_draft(${screenId}::uuid, ${JSON.stringify(codeReply)}::jsonb, '{}'::text[], now())`)).toBe(
      "saved",
    );
    for (const reader of [c1.ap, k1.member]) {
      const versions = await call<{ version_no: number }>(reader, sql`select version_no from screen_version where screen_id = ${screenId}::uuid`);
      expect(versions.map((v) => v.version_no)).toEqual([1]);
    }
    // Its author reads the draft through app.screen_draft; nobody else does.
    expect(await call<{ version_no: number }>(c1.ap, sql`select version_no from app.screen_draft(${screenId}::uuid)`)).toEqual([{ version_no: 2 }]);
    expect(await call<{ version_no: number }>(k1.member, sql`select version_no from app.screen_draft(${screenId}::uuid)`)).toEqual([]);
  });

  it("keep a published Version as it is, even for the tables' owner", async () => {
    const published = await one("select id from screen_version where screen_id = $1 and status = 'published'", [screenId]);
    await expect(migrator.query("update screen_version set schema = '{}' where id = $1", [published])).rejects.toMatchObject({ code: "42501" });
    await expect(migrator.query("delete from screen_version where id = $1", [published])).rejects.toMatchObject({ code: "42501" });
  });
});

describe("a reply's internal answers stay with the acting Participant (scenario RP-516-1)", () => {
  let id = "";

  beforeAll(async () => {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, ${TYPE}, 'Replied', app.latest_form_version(${TYPE}), '{"model": "R-1"}'::jsonb,
        ${electrical}::uuid, ${buildingA}::uuid, now())`,
    );
    id = created!.work_item_id;
    expect(await take(c1.member, id, "send_for_review")).toBe("applied");
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "submit")).toBe("applied");
    expect(await pickUp(k1.member, id)).toBe("picked_up");
    expect(await take(k1.member, id, "send_to_manager")).toBe("applied");
    expect(await pickUp(k1.ap, id)).toBe("picked_up");
    expect(
      await take(k1.ap, id, "approve_a", { remarks: "Matches the sample.", verification_note: "Batch 7 at the plant." }, "Recommended A."),
    ).toBe("applied");
  });

  const events = (as: string) =>
    call<{ type: string; payload: Record<string, unknown> }>(as, sql`select type, payload from work_item_event where work_item_id = ${id}::uuid order by seq`);
  const history = (as: string) =>
    call<{ type: string; answers: Record<string, unknown> | null }>(as, sql`select type, answers from app.work_item_history(${id}::uuid)`);

  it("the Contractor reads the Code's shared answers only, in the events table and the history", async () => {
    for (const contractor of [c1.member, c1Pm]) {
      const rows = await events(contractor);
      expect(rows.map((r) => r.type)).not.toContain("internal_answers");
      expect(rows.find((r) => r.type === "issue_code")?.payload).toEqual({ remarks: "Matches the sample.", outcome: "A" });
      expect(JSON.stringify(rows)).not.toContain("Batch 7");
      const read = await history(contractor);
      expect(read.find((r) => r.type === "issue_code")?.answers).toEqual({ remarks: "Matches the sample." });
      expect(JSON.stringify(read)).not.toContain("Batch 7");
    }
  });

  it("the Consultant reads its internal answers too, in their own event", async () => {
    for (const consultant of [k1.ap, k1.member]) {
      const read = await history(consultant);
      expect(read.find((r) => r.type === "internal_answers")?.answers).toEqual({ verification_note: "Batch 7 at the plant." });
      expect(read.find((r) => r.type === "issue_code")?.answers).toEqual({ remarks: "Matches the sample." });
    }
  });
});
