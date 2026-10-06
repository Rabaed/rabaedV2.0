// Seam 2 for the Consultant's own Form Section (RP-304, spec RP-299; visibility.md
// V19 and scenario 47; ADR 0013), as the app role: while K1 holds the item, a
// Contractor Member and the Owner read the answers as they arrived and none of
// K1's answers_changed events, whatever they query; K1 saves only its section;
// and K1 moves on only with the answers the API checked. A Send Back out of K1's
// Step discards what K1 wrote (RP-299 review). The field-times functions run
// only as the app role, and stamp only for a Member who may save.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addSendBackWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

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

/** A test-only Type on the test Workflow with a Send Back (addSendBackWorkflow), its Form with a Consultant section. */
async function addType() {
  const schema = {
    sections: [
      { key: "material", title: { en: "Material", ar: "المادة" }, fields: [{ key: "model", type: "text", label: { en: "Model", ar: "الطراز" } }] },
      {
        key: "verification",
        title: { en: "Consultant verification", ar: "تحقق الاستشاري" },
        editable_at: ["consultant_review"],
        // Published by SQL, past the publish check that keeps file fields out of another Participant's section:
        // the database refuses a file into it on its own.
        fields: [
          { key: "sample_checked", type: "yes_no", label: { en: "Sample checked", ar: "فحص العينة" }, required: true },
          { key: "evidence", type: "attachments", label: { en: "Evidence", ar: "الأدلة" } },
        ],
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
  const workflowId = await addSendBackWorkflow((text) => migrator.query(text));
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Consultant section", "ar": "قسم الاستشاري"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Consultant section", "ar": "قسم الاستشاري"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
}

const take = (as: string, transition: string, hash = sql`app.answers_sha256(${item}::uuid)`, id = item) =>
  outcome(as, sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', ${hash}, ${randomUUID()}::uuid, now()) as outcome`);
const save = (as: string, data: object, id = item) =>
  outcome(
    as,
    sql`select app.save_work_item_answers(${id}::uuid, ${JSON.stringify(data)}::jsonb, ${electrical}::uuid, ${buildingA}::uuid, '{}'::uuid[], now()) as outcome`,
  );
const recordTimes = (as: string, id: string) => outcome(as, sql`select app.record_field_times(${id}::uuid, now()) as outcome`);
const claim = (as: string, id: string) => outcome(as, sql`select app.claim_step(${id}::uuid, now()) as outcome`);
/** A new item, Submitted to K1 and claimed by its engineer. */
async function atConsultantReview(model: string): Promise<string> {
  const [draft] = await call<{ outcome: string; work_item_id: string }>(
    c1.member,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${model}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  const id = draft!.work_item_id;
  // As the API does after every save.
  expect(await recordTimes(c1.member, id)).toBe("recorded");
  expect(await take(c1.member, "send_for_review", sql`app.answers_sha256(${id}::uuid)`, id)).toBe("applied");
  expect(await claim(c1Pm, id)).toBe("claimed");
  expect(await take(c1Pm, "submit", sql`app.answers_sha256(${id}::uuid)`, id)).toBe("applied");
  expect(await claim(k1.member, id)).toBe("claimed");
  return id;
}
const answers = (as: string, id = item) =>
  call<{ answers: Record<string, unknown> }>(as, sql`select app.work_item_answers(${id}::uuid) as answers`).then((rows) => {
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

describe("the field-times functions", () => {
  const functions = [
    "app.work_item_field_times(uuid, boolean)",
    "app.record_field_times(uuid, timestamptz)",
    "app.answers_autosave(uuid)",
  ];

  it("run only as the app role: not as rabaed_admin, nor granted to everyone", async () => {
    for (const f of functions) {
      const { rows } = await migrator.query<{ app: boolean; admin: boolean; to_public: boolean }>(
        `select has_function_privilege('rabaed_app', $1, 'execute') as app,
           has_function_privilege('rabaed_admin', $1, 'execute') as admin,
           exists (select 1 from aclexplode((select proacl from pg_proc where oid = $1::regprocedure)) a where a.grantee = 0) as to_public`,
        [f],
      );
      expect(rows[0], f).toEqual({ app: true, admin: false, to_public: false });
    }
  });

  it("stamp the answers only for a Member who may save them, not one who only sees the item", async () => {
    const id = await atConsultantReview("FD-30");
    for (const onlySees of [c1.member, c1Pm, ow.member]) {
      expect(await recordTimes(onlySees, id), onlySees).toBe("not_editable");
    }
    expect(await recordTimes(k1.member, id)).toBe("recorded");
  });
});

describe("a file into a field of a section not editable now", () => {
  it("is refused to the raiser in Draft", async () => {
    const [draft] = await call<{ work_item_id: string }>(
      c1.member,
      sql`select work_item_id from app.create_work_item(
        ${projectId}::uuid, ${TYPE}, 'Evidence', app.latest_form_version(${TYPE}), '{}'::jsonb, ${electrical}::uuid, ${buildingA}::uuid, now())`,
    );
    expect(
      await outcome(
        c1.member,
        sql`select outcome from app.start_document_upload(${draft!.work_item_id}::uuid, 'evidence.pdf', 10, 'application/pdf', now(), 'evidence')`,
      ),
    ).toBe("not_editable");
  });
});

describe("a Send Back out of K1's Step", () => {
  let id = "";
  beforeAll(async () => {
    id = await atConsultantReview("FD-40");
    expect(await save(k1.member, { model: "FD-40", sample_checked: true }, id)).toBe("saved");
    expect(await recordTimes(k1.member, id)).toBe("recorded");
    expect(await take(k1.member, "send_back", sql`null`, id)).toBe("applied");
  });

  it("discards K1's answers: C1, holding it again, reads K1's section as it arrived", async () => {
    for (const who of [c1.member, c1Pm]) {
      expect(await answers(who, id)).toEqual({ model: "FD-40" });
    }
  });

  it("puts the field times of K1's section back, and hashes the answers it leaves with", async () => {
    const { rows } = await migrator.query<{ data: object; data_as_arrived: object | null; times: string[]; same_hash: boolean }>(
      `select w.data, w.data_as_arrived, array(select jsonb_object_keys(w.field_times) order by 1) as times,
         e.content_sha256 = sha256(convert_to(jsonb_build_object('title', w.title, 'data', w.data)::text, 'UTF8')) as same_hash
       from work_item w
       cross join lateral (
         select x.content_sha256 from work_item_event x where x.work_item_id = w.id and x.type = 'transition' order by x.seq desc limit 1
       ) e
       where w.id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ data: { model: "FD-40" }, data_as_arrived: null, times: ["location", "model", "trade"], same_hash: true });
  });
});

// RP-334: the Submission Date and the Creation Date (visibility.md "Creation
// Date", scenario 61; ADR 0014), as the app role.
describe("the Creation Date and the Submission Date (scenario 61)", () => {
  let id = "";
  let recorded: { numbered_at: Date; submitted_at: Date };
  beforeAll(async () => {
    id = await atConsultantReview("SC-61");
    recorded = (await migrator.query("select numbered_at, submitted_at from work_item where id = $1", [id])).rows[0];
    expect(recorded.numbered_at).toBeInstanceOf(Date);
    expect(recorded.submitted_at).toBeInstanceOf(Date);
  });
  const creationDate = (as: string) =>
    call<{ at: Date | null }>(as, sql`select app.work_item_creation_date(${id}::uuid) as at`).then((rows) => rows[0]!.at);

  it("gives the Creation Date to C1's Members only", async () => {
    for (const who of [c1.member, c1Pm]) expect(await creationDate(who)).toEqual(recorded.numbered_at);
    for (const who of [k1.member, k1Other, ow.member]) expect(await creationDate(who)).toBeNull();
  });

  it("lets everyone who sees the item read the Submission Date", async () => {
    for (const who of [c1.member, c1Pm, k1.member, k1Other, ow.member]) {
      expect(await call(who, sql<{ submitted_at: Date }>`select submitted_at from work_item where id = ${id}`)).toEqual([{ submitted_at: recorded.submitted_at }]);
    }
  });

  it("never lets anyone read when the Draft was started, nor the Creation Date, from the table or the history", async () => {
    for (const who of [c1.member, c1Pm, k1.member, ow.member]) {
      for (const column of ["created_at", "numbered_at"]) {
        await expect(call(who, sql<{ at: Date }>`select ${sql.ref(column)} as at from work_item where id = ${id}`)).rejects.toThrow(/permission denied/);
      }
      expect(await call(who, sql<{ seq: number }>`select seq from work_item_event where work_item_id = ${id} and type = 'created'`)).toEqual([]);
      expect(await call(who, sql<{ seq: number }>`select seq from app.work_item_history(${id}::uuid) where type = 'created'`)).toEqual([]);
    }
  });

  it("keeps the Submission Date after a Send Back and a second Submit", async () => {
    expect(await take(k1.member, "send_back", sql`null`, id)).toBe("applied");
    expect(await take(c1Pm, "submit", sql`app.answers_sha256(${id}::uuid)`, id)).toBe("applied");
    const { rows } = await migrator.query("select submitted_at from work_item where id = $1", [id]);
    expect(rows[0].submitted_at).toEqual(recorded.submitted_at);
  });
});

describe("a Draft", () => {
  it("is never deleted: the app role can't, and no function in app deletes one", async () => {
    const { rows } = await migrator.query(`
      select has_table_privilege('rabaed_app', 'work_item', 'DELETE') as app_deletes,
        array(select p.oid::regprocedure::text from pg_proc p
              where p.pronamespace = 'app'::regnamespace and p.prosrc ~* 'delete\\s+from\\s+(public\\.)?work_item\\M') as deleting`);
    expect(rows[0]).toEqual({ app_deletes: false, deleting: [] });
  });
});
