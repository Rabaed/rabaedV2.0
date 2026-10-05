// Seam 2 for the Consultant's own Form Section (RP-304, spec RP-299; visibility.md
// V19 and scenario 47; ADR 0013), as the app role: while K1 holds the item, a
// Contractor Member and the Owner read the answers as they arrived and none of
// K1's answers_changed events, whatever they query; K1 saves only its section;
// and K1 moves on only with the answers the API checked.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "MARKS";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the item.
let k1: Company; // Consultant: fills its section.
let ow: Company; // Owner (oversight).
let c1Pm = "";
let k1Other = ""; // A K1 Member who holds nothing.
let k1Manager = ""; // Holds Consultant approval.
let projectId = "";
let electrical = "";
let buildingA = "";
let item = "";

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
  const id = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), cr, `3${digits(13)}3`, engineer],
  );
  const ap = await member(id, "ap", true);
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, "engineer") };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

/** A test-only Type: Draft → Contractor review → Consultant review → Consultant approval → Approved, its Form with a Consultant section. */
async function addType() {
  const schema = {
    sections: [
      { key: "material", title: { en: "Material", ar: "المادة" }, fields: [{ key: "model", type: "text", label: { en: "Model", ar: "الطراز" } }] },
      {
        key: "verification",
        title: { en: "Consultant verification", ar: "تحقق الاستشاري" },
        editable_at: ["consultant_review"],
        fields: [{ key: "sample_checked", type: "yes_no", label: { en: "Sample checked", ar: "فحص العينة" }, required: true }],
      },
      {
        key: "classification",
        title: { en: "Classification", ar: "التصنيف" },
        fields: [
          { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
          { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
        ],
      },
    ],
  };
  await migrator.query(`
    do $$
      declare
        v_form uuid;
        v_definition uuid;
        v_version uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Consultant section", "ar": "قسم الاستشاري"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into workflow_definition (owner_kind, name) values ('rabaed', '{"en": "Consultant section", "ar": "قسم الاستشاري"}')
        returning id into v_definition;
        insert into workflow_version (workflow_definition_id, version_no, status, published_at)
        values (v_definition, 1, 'published', now()) returning id into v_version;
        insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode) values
          (v_version, 'draft', '{"en": "Draft", "ar": "مسودة"}', 'draft', '{"base_role": "contractor", "permission": "create"}', 'none'),
          (v_version, 'internal_review', '{"en": "Contractor review", "ar": "مراجعة المقاول"}', 'internal_review',
            '{"base_role": "contractor", "permission": "review"}', 'none'),
          (v_version, 'consultant_review', '{"en": "Consultant review", "ar": "مراجعة الاستشاري"}', 'pending_approval',
            '{"base_role": "consultant", "permission": "review"}', 'none'),
          (v_version, 'consultant_approval', '{"en": "Consultant approval", "ar": "اعتماد الاستشاري"}', 'internal_review',
            '{"base_role": "consultant", "permission": "approve"}', 'issue_code'),
          (v_version, 'approved', '{"en": "Approved", "ar": "معتمد"}', 'approved', '{}', 'none');
        insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort)
        select v_version, t.key, f.id, s.id, t.label::jsonb, t.kind, t.outcome, t.permission, t.sort
        from (values
          ('send_for_review', 'draft', 'internal_review', '{"en": "Send", "ar": "إرسال"}', 'send', null, 'create', 1),
          ('submit', 'internal_review', 'consultant_review', '{"en": "Submit", "ar": "تقديم"}', 'submit', null, 'submit', 2),
          ('send_to_manager', 'consultant_review', 'consultant_approval', '{"en": "Send", "ar": "إرسال"}', 'send', null, 'review', 3),
          ('approve_a', 'consultant_approval', 'approved', '{"en": "A", "ar": "A"}', 'close', 'A', 'approve', 4)
        ) as t (key, from_key, to_key, label, kind, outcome, permission, sort)
        join workflow_step f on f.workflow_version_id = v_version and f.key = t.from_key
        join workflow_step s on s.workflow_version_id = v_version and s.key = t.to_key;
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Consultant section", "ar": "قسم الاستشاري"}', v_definition, 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, transition: string, hash = sql`app.answers_sha256(${item}::uuid)`) =>
  outcome(as, sql`select app.take_transition(${item}::uuid, ${transition}, '', '', ${hash}, ${randomUUID()}::uuid, now()) as outcome`);
const save = (as: string, data: object) =>
  outcome(
    as,
    sql`select app.save_work_item_answers(${item}::uuid, ${JSON.stringify(data)}::jsonb, ${electrical}::uuid, ${buildingA}::uuid, '{}'::uuid[], now()) as outcome`,
  );
const answers = (as: string) =>
  call<{ answers: Record<string, unknown> }>(as, sql`select app.work_item_answers(${item}::uuid) as answers`).then((rows) => {
    const { trade: _t, location: _l, ...own } = rows[0]!.answers;
    return own;
  });
/** The answers_changed events `as` reads, from the table itself and from the history. */
const changes = async (as: string) => ({
  events: await call<{ seq: number }>(as, sql`select seq from work_item_event where work_item_id = ${item} and type = 'answers_changed'`),
  history: await call<{ seq: number }>(as, sql`select seq from app.work_item_history(${item}::uuid) where type = 'answers_changed'`),
});

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  ow = await company(engineer, "OW");
  c1Pm = await member(c1.id, "pm");
  k1Other = await member(k1.id, "other");
  k1Manager = await member(k1.id, "manager");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TWR', 'contractor')`,
  );
  projectId = created!.project_id;
  const participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    ow: await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap),
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
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, k1Other, ["engineer"]],
    [k1, participant.k1, k1Manager, ["manager"]],
    [ow, participant.ow, ow.member, ["representative"]],
  ];
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe(
        "set",
      );
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }

  const [draft] = await call<{ outcome: string; work_item_id: string }>(
    c1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, 'Fire doors', app.latest_form_version(${TYPE}), '{"model": "FD-90"}'::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(draft!.outcome).toBe("created");
  item = draft!.work_item_id;
  expect(await take(c1.member, "send_for_review")).toBe("applied");
  expect(await outcome(c1Pm, sql`select app.claim_step(${item}::uuid, now()) as outcome`)).toBe("claimed");
  expect(await take(c1Pm, "submit")).toBe("applied");
  expect(await outcome(k1.member, sql`select app.claim_step(${item}::uuid, now()) as outcome`)).toBe("claimed");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("K1 at the Step its section names", () => {
  it("can't change C1's sections, nor can C1 (scenario 50)", async () => {
    expect(await save(k1.member, { model: "FD-99", sample_checked: true })).toBe("not_editable");
    expect(await save(c1.member, { model: "FD-99" })).toBe("not_editable");
    expect(await save(c1Pm, { model: "FD-99" })).toBe("not_editable");
    expect(await answers(k1.member)).toEqual({ model: "FD-90" });
  });

  it("can't move on with answers the API didn't check", async () => {
    expect(await take(k1.member, "send_to_manager", sql`null`)).toBe("form_not_checked");
  });

  it("saves its section, any K1 Member, several times", async () => {
    expect(await save(k1.member, { model: "FD-90", sample_checked: true })).toBe("saved");
    expect(await save(k1Other, { model: "FD-90", sample_checked: false })).toBe("saved");
    for (const k of [k1.member, k1Other]) {
      expect(await answers(k)).toEqual({ model: "FD-90", sample_checked: false });
      expect(await changes(k)).toMatchObject({ events: [{}, {}], history: [{}, {}] });
    }
  });

  it("is hidden from a Contractor Member and the Owner (scenario 47)", async () => {
    for (const other of [c1.member, c1Pm, ow.member]) {
      expect(await answers(other)).toEqual({ model: "FD-90" });
      expect(await changes(other)).toEqual({ events: [], history: [] });
      expect(await call(other, sql<{ sha256: Buffer }>`select sha256 from (select app.answers_sha256(${item}::uuid) as sha256) h where sha256 is not null`)).toEqual([]);
    }
  });

  it("is never readable from the table itself", async () => {
    await expect(call(c1.member, sql<{ data_as_arrived: unknown }>`select data_as_arrived from work_item where id = ${item}`)).rejects.toThrow(/permission denied/);
  });

  it("becomes everyone's when the item leaves K1, its events still K1's", async () => {
    expect(await take(k1.member, "send_to_manager")).toBe("applied");
    expect(await answers(c1.member)).toEqual({ model: "FD-90" });
    expect(await outcome(k1Manager, sql`select app.claim_step(${item}::uuid, now()) as outcome`)).toBe("claimed");
    expect(await take(k1Manager, "approve_a")).toBe("applied");
    for (const other of [c1.member, ow.member]) {
      expect(await answers(other)).toEqual({ model: "FD-90", sample_checked: false });
      expect(await changes(other)).toEqual({ events: [], history: [] });
    }
  });
});
