// Seam 2 for the Form's `member` and `participant` fields (RP-266): the two
// functions behind them answer as their caller may see (V14, V15). Project B's
// Member gets nothing of Project A's answers or Participants, not even by
// naming Project A's item from their own Project.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "MARDB";

let migrator: pg.Client;
let app: Db;

type Side = { name: { en: string; ar: string }; ap: string; projectId: string; participantId: string; itemId: string };
let a: Side;
let b: Side;

const call = <T,>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A test-only Rabaed Default Type (the MAR's Workflow) whose Form has a `member` and a `participant` field. */
async function addPeopleType() {
  const schema = {
    sections: [
      {
        key: "people",
        title: { en: "People", ar: "الأشخاص" },
        fields: [
          { key: "who", type: "member", label: { en: "Who", ar: "من" } },
          { key: "through", type: "participant", label: { en: "Through", ar: "عن طريق" } },
        ],
      },
    ],
  };
  await migrator.query(
    `do $$
      declare v_definition uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = '${TYPE}') then return; end if;
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "People", "ar": "الأشخاص"}')
        returning id into v_definition;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_definition, 1, 'published', now(), '${JSON.stringify(schema)}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        select 'rabaed', module_key, '${TYPE}', '{"en": "People", "ar": "الأشخاص"}', workflow_definition_id, outcome_kind, v_definition
        from work_item_type where owner_kind = 'rabaed' and code = 'MAR';
      end
    $$`,
  );
}

/** A Company whose Authorized Person creates a Project and raises an item naming themselves and their Participant. */
async function side(engineer: string, en: string): Promise<Side> {
  const name = { en, ar: en };
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify(name), digits(10), `3${digits(13)}3`, engineer],
  );
  const ap = await one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', true) returning id",
    [companyId, email("ap"), JSON.stringify(name)],
  );
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, companyId]);
  const [created] = await call<{ project_id: string }>(
    ap,
    sql`select project_id from app.create_project(${JSON.stringify(name)}::jsonb, 'TWR', 'contractor')`,
  );
  const projectId = created!.project_id;
  const [electrical] = await call<{ value_id: string }>(
    ap,
    sql`select value_id from app.add_dimension_value(${projectId}::uuid, 'trade', null, 'EL', '{"en": "EL", "ar": "EL"}'::jsonb)`,
  );
  const participantId: string = (await migrator.query("select participant_id from project_member where project_id = $1", [projectId]))
    .rows[0].participant_id;
  for (const kind of ["trade", "location"]) {
    const set = await call<{ outcome: string }>(ap, sql`
      select app.set_participant_visibility(${participantId}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome
      union all
      select app.set_member_visibility(${participantId}::uuid, ${ap}::uuid, ${kind}, true, '{}'::uuid[], now())`);
    expect(set.map((r) => r.outcome)).toEqual(["set", "set"]);
  }
  const data = JSON.stringify({ who: ap, through: participantId });
  const [item] = await call<{ outcome: string; work_item_id: string }>(
    ap,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, 'Cable trays', app.latest_form_version(${TYPE}), ${data}::jsonb,
      ${electrical!.value_id}::uuid, null, now())`,
  );
  expect(item!.outcome).toBe("created");
  return { name, ap, projectId, participantId, itemId: item!.work_item_id };
}

const named = (as: string, itemId: string) =>
  call<{ field_key: string }>(as, sql`select * from app.work_item_named_answers(${itemId}::uuid) order by field_key`);

const choices = (as: string, projectId: string, itemId: string | null) =>
  call<{ participant_id: string }>(as, sql`select * from app.form_participant_choices(${projectId}::uuid, ${itemId}::uuid)`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addPeopleType();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Test Engineer') returning id", [email("engineer")]);
  a = await side(engineer, "Company A");
  b = await side(engineer, "Company B");
});

afterAll(async () => {
  await app.destroy();
  await migrator.end();
});

describe("app.work_item_named_answers", () => {
  it("names the caller's own Member and Participant", async () => {
    expect(await named(a.ap, a.itemId)).toEqual([
      { field_key: "through", field_type: "participant", company_name: a.name, member_name: null },
      { field_key: "who", field_type: "member", company_name: a.name, member_name: a.name },
    ]);
  });

  it("names no Company the caller may not see, nor its Member", async () => {
    // Written as the owner: the API never offers these, but the function mustn't rely on it.
    const hidden = { who: b.ap, through: b.participantId };
    await migrator.query("update work_item set data = $1 where id = $2", [JSON.stringify(hidden), a.itemId]);
    try {
      expect(await named(a.ap, a.itemId)).toEqual([
        { field_key: "through", field_type: "participant", company_name: null, member_name: null },
        { field_key: "who", field_type: "member", company_name: null, member_name: null },
      ]);
    } finally {
      await migrator.query("update work_item set data = $1 where id = $2", [JSON.stringify({ who: a.ap, through: a.participantId }), a.itemId]);
    }
  });

  it("answers nothing for an item the caller can't see", async () => {
    expect(await named(b.ap, a.itemId)).toEqual([]);
  });
});

// Answers are read only through app.work_item_answers, which strips every
// reference the caller may not see (ADR 0012, RP-275).
describe("reading the answers", () => {
  const answers = (as: string, itemId: string) =>
    call<{ answers: Record<string, unknown> | null }>(as, sql`select app.work_item_answers(${itemId}::uuid) as answers`).then(
      (rows) => rows[0]!.answers,
    );
  const own = { who: () => a.ap, through: () => a.participantId };
  const write = (data: Record<string, unknown>) => migrator.query("update work_item set data = $1 where id = $2", [JSON.stringify(data), a.itemId]);

  it("refuses the app role work_item.data directly", async () => {
    await expect(call(a.ap, sql`select data from work_item where id = ${a.itemId}::uuid`)).rejects.toThrow(/permission denied/);
  });

  it("gives the caller's own Company its answers in full", async () => {
    expect(await answers(a.ap, a.itemId)).toMatchObject({
      who: own.who(),
      through: own.through(),
    });
  });

  it("strips another Company's Member and a Participant the caller may not see, wherever they are", async () => {
    // Written as the owner: the API never offers these, but the database mustn't rely on it.
    await write({ who: b.ap, through: b.participantId });
    try {
      const read = await answers(a.ap, a.itemId);
      expect(read).not.toHaveProperty("who");
      expect(read).not.toHaveProperty("through");
      expect(JSON.stringify(read)).not.toContain(b.ap);
      expect(JSON.stringify(read)).not.toContain(b.participantId);
      // No other channel gives them either.
      const named = JSON.stringify(await call(a.ap, sql`select * from app.work_item_named_answers(${a.itemId}::uuid)`));
      expect(named).not.toContain(b.ap);
      expect(named).not.toContain(b.participantId);
    } finally {
      await write({ who: own.who(), through: own.through() });
    }
  });

  it("strips an id that names nobody", async () => {
    await write({ who: randomUUID(), through: randomUUID() });
    try {
      expect(await answers(a.ap, a.itemId)).not.toHaveProperty("who");
    } finally {
      await write({ who: own.who(), through: own.through() });
    }
  });

  it("answers null for an item the caller can't see", async () => {
    expect(await answers(b.ap, a.itemId)).toBeNull();
  });

  it("hashes the full answers, unstripped", async () => {
    await write({ who: b.ap, through: b.participantId });
    try {
      const [{ hash }] = (await call<{ hash: Buffer }>(a.ap, sql`select app.answers_sha256(${a.itemId}::uuid) as hash`)) as [{ hash: Buffer }];
      const full = (await migrator.query("select sha256(convert_to(app.work_item_full_answers($1)::text, 'UTF8')) as hash", [a.itemId])).rows[0]
        .hash as Buffer;
      expect(hash.equals(full)).toBe(true);
      expect(full.toString("hex")).not.toEqual(
        (
          await migrator.query("select sha256(convert_to($1::jsonb::text, 'UTF8')) as hash", [JSON.stringify(await answers(a.ap, a.itemId))])
        ).rows[0].hash.toString("hex"),
      );
      expect(await call(b.ap, sql`select app.answers_sha256(${a.itemId}::uuid) as hash`)).toEqual([{ hash: null }]);
    } finally {
      await write({ who: own.who(), through: own.through() });
    }
  });

  it("keeps the full answers out of the app role's reach", async () => {
    await expect(call(a.ap, sql`select app.work_item_full_answers(${a.itemId}::uuid)`)).rejects.toThrow(/permission denied/);
  });
});

describe("app.form_participant_choices", () => {
  it("offers the caller's own Participant on their Project", async () => {
    expect((await choices(a.ap, a.projectId, null)).map((r) => r.participant_id)).toEqual([a.participantId]);
    expect((await choices(a.ap, a.projectId, a.itemId)).map((r) => r.participant_id)).toEqual([a.participantId]);
  });

  it("offers nothing on a Project the caller isn't on, and nothing of another Project's item", async () => {
    expect(await choices(b.ap, a.projectId, null)).toEqual([]);
    expect(await choices(b.ap, a.projectId, a.itemId)).toEqual([]);
    expect((await choices(b.ap, b.projectId, a.itemId)).map((r) => r.participant_id)).toEqual([b.participantId]);
  });
});

// K1 sees C1's item (here A's), handling it at a Consultant Step. It reads C1's
// Participant, which is on the item, but never the id of the C1 Member named in
// it, nor of L1, a Participant on the Project but not on the item (V14, V15).
describe("reading the answers as another Company on the item", () => {
  let k: { ap: string; participantId: string };
  let l: { participantId: string };
  let engineer = "";

  /** A Company joining Project A in `role`; returns its Authorized Person and Participant. */
  async function joinA(en: string, role: string) {
    const crNumber = digits(10);
    const onboardedBy = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Test Engineer') returning id", [email("engineer")]);
    const companyId = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
      JSON.stringify({ en, ar: en }),
      crNumber,
      `3${digits(13)}3`,
      onboardedBy,
    ]);
    const ap = await one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      companyId,
      email("ap"),
      JSON.stringify({ en, ar: en }),
    ]);
    await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, companyId]);
    const participantId = await joinProject(app, a.projectId, { adminId: a.ap, crNumber, role }, ap);
    return { ap, participantId };
  }

  const write = (data: Record<string, unknown>) =>
    migrator.query("update work_item set data = $1 where id = $2", [JSON.stringify(data), a.itemId]);

  /** Everything K1 can read of the item: its answers, named answers, history, row, events and assignments. */
  const everythingK1Reads = async () =>
    JSON.stringify([
      await call(k.ap, sql`select app.work_item_answers(${a.itemId}::uuid) as answers`),
      await call(k.ap, sql`select app.answers_sha256(${a.itemId}::uuid) as hash`),
      await call(k.ap, sql`select * from app.work_item_named_answers(${a.itemId}::uuid)`),
      await call(k.ap, sql`select * from app.work_item_history(${a.itemId}::uuid)`),
      await call(
        k.ap,
        sql`select id, project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, workflow_version_id,
          form_version_id, document_number, outcome, closed_at, created_at from work_item where id = ${a.itemId}::uuid`,
      ),
      await call(k.ap, sql`select * from work_item_event where work_item_id = ${a.itemId}::uuid`),
      await call(k.ap, sql`select * from step_assignment where work_item_id = ${a.itemId}::uuid`),
    ]);

  beforeAll(async () => {
    const companyId: string = (await migrator.query("select company_id from member where id = $1", [a.ap])).rows[0].company_id;
    // A C1 Member who is named in the answer only: neither its creator nor an actor on it.
    engineer = await one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      companyId,
      email("c1-engineer"),
      JSON.stringify({ en: "C1 Engineer", ar: "C1 Engineer" }),
    ]);
    await call(a.ap, sql`select app.add_project_member(${a.participantId}::uuid, ${engineer}::uuid, now())`);
    await write({ who: engineer, through: a.participantId });

    k = await joinA("K1 Consultants", "consultant");
    l = await joinA("L1 Contracting", "contractor");
    await call(k.ap, sql`select app.add_project_member(${k.participantId}::uuid, ${k.ap}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      const set = await call<{ outcome: string }>(
        a.ap,
        sql`select app.set_participant_visibility(${k.participantId}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`,
      );
      const mine = await call<{ outcome: string }>(
        k.ap,
        sql`select app.set_member_visibility(${k.participantId}::uuid, ${k.ap}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`,
      );
      expect([...set, ...mine].map((r) => r.outcome)).toEqual(["set", "set"]);
    }
    // As the owner: the item handed to K1 at a Consultant Step, as a Transition would.
    await migrator.query(
      `update work_item w set current_step_id = s.id, current_stage_key = s.stage_key,
         participant_entered_step_id = s.id, participant_entered_at = now()
       from workflow_step s
       where w.id = $1 and s.workflow_version_id = w.workflow_version_id and s.actor_rule ->> 'base_role' = 'consultant'
         and s.id = (select min(x.id::text)::uuid from workflow_step x
                     where x.workflow_version_id = w.workflow_version_id and x.actor_rule ->> 'base_role' = 'consultant')`,
      [a.itemId],
    );
    await migrator.query(
      "insert into work_item_access (work_item_id, project_id, participant_id, since, reason) values ($1, $2, $3, now(), 'handling')",
      [a.itemId, a.projectId, k.participantId],
    );
  });

  it("sees the item", async () => {
    expect(await call(k.ap, sql`select app.sees_work_item(${a.itemId}::uuid) as sees`)).toEqual([{ sees: true }]);
  });

  it("gets C1's Participant, but no query returns the id of the C1 Member named", async () => {
    const [{ answers }] = (await call<{ answers: Record<string, unknown> }>(
      k.ap,
      sql`select app.work_item_answers(${a.itemId}::uuid) as answers`,
    )) as [{ answers: Record<string, unknown> }];
    expect(answers).toMatchObject({ through: a.participantId });
    expect(answers).not.toHaveProperty("who");
    await expect(call(k.ap, sql`select data from work_item where id = ${a.itemId}::uuid`)).rejects.toThrow(/permission denied/);
    expect(await everythingK1Reads()).not.toContain(engineer);
  });

  it("gets no id of a Participant on the Project but not on the item", async () => {
    // Written as the owner: the API never offers L1 here, but the database mustn't rely on it.
    await write({ who: engineer, through: l.participantId });
    try {
      const reads = await everythingK1Reads();
      expect(reads).not.toContain(l.participantId);
      expect(reads).not.toContain(engineer);
    } finally {
      await write({ who: engineer, through: a.participantId });
    }
  });

  it("gets no hash of the answers once they have left the raiser", async () => {
    expect(await call(k.ap, sql`select app.answers_sha256(${a.itemId}::uuid) as hash`)).toEqual([{ hash: null }]);
  });

  it("leaves C1's own Members their answers in full", async () => {
    expect(await call(a.ap, sql`select app.work_item_answers(${a.itemId}::uuid) ->> 'who' as who`)).toEqual([{ who: engineer }]);
  });
});
