// Seam 2 for Handover (RP-108, spec RP-511 decision 3; ADR 0018; workflow-engine.md §9;
// visibility.md scenario RP-108-1), as the app role. Only a Company's Authorized Person
// reads which of its Steps a change leaves without a holder, and hands them over; never
// another Company's Steps or Members, and never to another Company's Member. A Handover
// is an internal event of the holding Participant (V5).
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who.toLowerCase().replaceAll(" ", "-")}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "HORLS";

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: raises the items; Ali and Khalid are its PMs.
let k1: Company; // Consultant: reviews them; its member and Nadia are its engineers.
let ali = "";
let khalid = "";
let nadia = "";
let projectId = "";
const participant = { c1: "", k1: "" };
let electrical = "";
let buildingA = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string): Promise<string> {
  return one("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
    companyId,
    email(who),
    JSON.stringify({ en: who, ar: who }),
  ]);
}

async function company(engineer: string, name: string): Promise<Company> {
  const cr = digits(10);
  const id = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id", [
    JSON.stringify({ en: name, ar: name }),
    cr,
    `3${digits(13)}3`,
    engineer,
  ]);
  const ap = await one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', true) returning id",
    [id, email("ap"), JSON.stringify({ en: `${name} AP`, ar: `${name} AP` })],
  );
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, id]);
  return { id, cr, ap, member: await member(id, `${name} engineer`) };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);
const take = (as: string, id: string, transition: string) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, '{}'::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);

type Needed = { assignment_id: string; work_item_id: string; title: string; candidates: { id: string }[] };
const pooledBefore = (as: string, who: string, p: string | null) =>
  call<{ ids: string[] }>(as, sql`select app.handover_pooled_before(${who}::uuid, ${p}::uuid) as ids`).then((r) => r[0]!.ids);
const needed = (as: string, who: string, p: string | null) =>
  call<Needed>(as, sql`select assignment_id, work_item_id, title, candidates from app.handovers_needed(${who}::uuid, ${p}::uuid, '{}'::uuid[])`);
const handOver = (as: string, assignment: string, from: string, to: string) =>
  outcome(as, sql`select app.hand_over_step(${assignment}::uuid, ${from}::uuid, ${to}::uuid, 'positions', now()) as outcome`);
const setPositions = (as: string, p: string, who: string, positions: string[]) =>
  outcome(as, sql`select app.set_project_member_positions(${p}::uuid, ${who}::uuid, ${positions}::text[]) as outcome`);

/** C1's item, sent to C1's internal review (pooled between Ali and Khalid). */
async function inReview(title: string): Promise<string> {
  const [created] = await call<{ work_item_id: string }>(
    c1.member,
    sql`select work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: title })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(await take(c1.member, created!.work_item_id, "send_for_review")).toBe("applied");
  return created!.work_item_id;
}

const openAssignment = async (id: string) =>
  (await migrator.query("select id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up')", [id])).rows[0].id as string;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text));
  await migrator.query(`
    do $$
      declare
        v_form uuid;
      begin
        insert into form_definition (owner_kind, name) values ('rabaed', '{"en": "Handover (test)", "ar": "التسليم"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        values (v_form, 1, 'published', now(), '{"sections": [{"key": "material", "title": {"en": "Material", "ar": "المادة"},
          "fields": [{"key": "model", "type": "text", "label": {"en": "Model", "ar": "الطراز"}}]}]}'::jsonb);
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', '${TYPE}', '{"en": "Handover (test)", "ar": "التسليم"}', '${workflowId}', 'review_code', v_form);
      end
    $$`);
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  ali = await member(c1.id, "Ali Sonour");
  khalid = await member(c1.id, "Khalid Bakr");
  nadia = await member(k1.id, "Nadia Reviewer");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'HOT', 'contractor')`,
  );
  projectId = created!.project_id;
  participant.c1 = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  participant.k1 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
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
    [c1, participant.c1, ali, ["project_manager"]],
    [c1, participant.c1, khalid, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [k1, participant.k1, nadia, ["engineer"]],
  ];
  for (const [co, p, m, positions] of people) {
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await setPositions(co.ap, p, m, positions)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-108-1: a Handover reads and moves only the Authorized Person's own Company's Steps", () => {
  it("only an Authorized Person reads them, and only their own Company's", async () => {
    const id = await inReview("Own only");
    expect(await pickUp(ali, id)).toBe("picked_up");
    // Submitted to K1 and held by K1's member: Ali doesn't hold it, Nadia could.
    const atK1 = await inReview("At K1");
    expect(await pickUp(khalid, atK1)).toBe("picked_up");
    expect(await take(khalid, atK1, "submit")).toBe("applied");
    expect(await pickUp(k1.member, atK1)).toBe("picked_up");

    // Not an Authorized Person: refused outright, as for every Member command.
    for (const who of [ali, c1.member, k1.member]) {
      await expect(needed(who, ali, null)).rejects.toMatchObject({ code: "42501" });
      await expect(pooledBefore(who, ali, null)).rejects.toMatchObject({ code: "42501" });
    }
    // K1's Authorized Person reads nothing of C1's Ali, by Participant or by Member.
    for (const p of [null, participant.c1]) {
      expect(await pooledBefore(k1.ap, ali, p)).toEqual([]);
      expect(await needed(k1.ap, ali, p)).toEqual([]);
    }

    // As if Ali left the pool (rolled back): C1 reads its own Step only, with its own candidates.
    const rollBack = new Error("roll back");
    await withMember(app, c1.ap, async (trx) => {
      expect((await sql<{ outcome: string }>`select app.set_project_member_positions(${participant.c1}::uuid, ${ali}::uuid, '{engineer}') as outcome`.execute(trx)).rows[0]!.outcome).toBe("set");
      const rows = (await sql<Needed>`select assignment_id, work_item_id, title, candidates from app.handovers_needed(${ali}::uuid, null, '{}')`.execute(trx)).rows;
      expect(rows.map((r) => [r.work_item_id, r.candidates.map((c) => c.id)])).toEqual([[id, [khalid]]]);
      // C1 can't hand it to a K1 Member.
      expect((await sql<{ outcome: string }>`select app.hand_over_step(${rows[0]!.assignment_id}::uuid, ${ali}::uuid, ${nadia}::uuid, 'positions', now()) as outcome`.execute(trx)).rows[0]!.outcome).toBe("not_offered");
      throw rollBack;
    }).catch((error: unknown) => {
      if (error !== rollBack) throw error;
    });

    // K1's Authorized Person can't hand over C1's Step, even to C1's Khalid.
    const c1Assignment = await openAssignment(id);
    expect(await setPositions(c1.ap, participant.c1, ali, ["engineer"])).toBe("set");
    expect(await handOver(k1.ap, c1Assignment, ali, khalid)).toBe("not_offered");
    // Nor C1's, K1's Step.
    expect(await setPositions(k1.ap, participant.k1, k1.member, [])).toBe("set");
    expect(await handOver(c1.ap, await openAssignment(atK1), k1.member, nadia)).toBe("not_offered");
    // Each its own: done.
    expect(await handOver(c1.ap, c1Assignment, ali, khalid)).toBe("handed_over");
    expect(await handOver(k1.ap, await openAssignment(atK1), k1.member, nadia)).toBe("handed_over");

    // Each Handover is internal to its holding Participant (V5).
    const handovers = (as: string) =>
      call<{ work_item_id: string }>(as, sql`select work_item_id from work_item_event where work_item_id = any(${[id, atK1]}::uuid[]) and payload ? 'handover' order by work_item_id`);
    expect(await handovers(c1.member)).toEqual([{ work_item_id: id }]);
    expect(await handovers(nadia)).toEqual([{ work_item_id: atK1 }]);
    const names = (as: string, item: string) =>
      call<{ handover: unknown }>(as, sql`select handover from app.work_item_history(${item}::uuid) where handover is not null`);
    expect(await names(nadia, atK1)).toHaveLength(1);
    expect(JSON.stringify(await names(nadia, atK1))).not.toMatch(/Ali Sonour|Khalid Bakr/);
    expect(await names(c1.member, atK1)).toEqual([]);
  });
});
