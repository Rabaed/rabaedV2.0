// Seam 2 for the Site Observation (RP-627, SNAG-5; spec RP-619; visibility.md V3, V5 and scenarios
// RP-627-1 and RP-627-2), as the app role. K1, the Consultant, raises a Site Observation on the Trade
// General, which C1 (Trade Visibility "all") covers and resolves. C2, a Contractor whose Trade
// Visibility lists Electrical but not General, never reads it, nor one C1 raised on itself.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor: works the Snag.
let k1: Company; // Consultant: raises and verifies it.
let c2: Company; // Another Contractor of the same Trade, covering Building B only (V3).
let c1Pm = "";
let participant: Record<"c1" | "k1" | "c2", string>;
let projectId = "";
let electrical = "";
let general = "";
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
const take = (as: string, id: string, transition: string, answers: object = {}) =>
  outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, '', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);
const seen = async (as: string, id: string) => (await call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`)).map((r) => r.id);
/** The events of item `id` that `as` reads: type, audience, the acting Participant and the Transition's key. */
const events = (as: string, id: string) =>
  call<{ type: string; audience: string; actor_participant_id: string; transition_key: string | null }>(
    as,
    sql`select e.type, e.audience, e.actor_participant_id, t.key as transition_key
        from work_item_event e
        left join workflow_transition t on t.id = e.transition_id
        where e.work_item_id = ${id}::uuid order by e.seq`,
  );
const stepAsSeen = async (as: string, id: string) =>
  (await call<{ stage_key: string; entered_at: Date }>(as, sql`select stage_key, entered_at from app.step_as_seen(${id}::uuid)`))[0];

/** `raiser`'s Site Observation on General, Building A, raised. */
async function raised(raiser: string, title: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    raiser,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, 'OBS', ${title}, app.latest_form_version('OBS'), ${JSON.stringify({ description: title })}::jsonb,
      ${general}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  expect(await take(raiser, created!.work_item_id, "raise")).toBe("applied");
  return created!.work_item_id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  c1 = await company(engineer, "C1");
  k1 = await company(engineer, "K1");
  c2 = await company(engineer, "C2");
  c1Pm = await member(c1.id, "pm");

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'SGT', 'contractor')`,
  );
  projectId = created!.project_id;
  participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    k1: await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap),
    c2: await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  general = (await migrator.query("select v.id from dimension_value v join visibility_dimension d on d.id = v.dimension_id where v.project_id = $1 and d.kind = 'trade' and v.code = 'GEN'", [projectId])).rows[0].id as string;
  buildingA = await value("location", "BA");
  const buildingB = await value("location", "BB");
  for (const p of Object.values(participant)) {
    for (const kind of ["trade", "location"]) {
      const onlyB = p === participant.c2 && kind === "location";
      const onlyEl = p === participant.c2 && kind === "trade";
      expect(
        await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, ${!onlyB && !onlyEl}, ${onlyB ? [buildingB] : onlyEl ? [electrical] : []}::uuid[], now()) as outcome`),
      ).toBe("set");
    }
  }
  const people: [Company, string, string, string[]][] = [
    [c1, participant.c1, c1.member, ["engineer"]],
    [c1, participant.c1, c1Pm, ["project_manager"]],
    [k1, participant.k1, k1.member, ["engineer"]],
    [c2, participant.c2, c2.member, ["engineer"]],
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

describe("a Site Observation on General reaches exactly who covers General", () => {
  it("RP-627-1: C2, whose Trade Visibility lists Electrical only, reads no item, Link, event, Document, Step or count of K1's Site Observation on General; C1 and K1 read it", async () => {
    const id = await raised(k1.member, "Rubbish on floor 3");
    expect(await seen(c2.member, id)).toEqual([]);
    expect(await events(c2.member, id)).toEqual([]);
    expect(await call(c2.member, sql<{ to_id: string }>`select * from app.work_item_links(${id}::uuid)`)).toEqual([]);
    expect(await call(c2.member, sql<{ id: string }>`select id from document where work_item_id = ${id}::uuid`)).toEqual([]);
    expect(await call(c2.member, sql<{ id: string }>`select id from step_assignment where work_item_id = ${id}::uuid`)).toEqual([]);
    expect(await stepAsSeen(c2.member, id)).toBeUndefined();
    expect(await seen(c1.member, id)).toEqual([id]);
    expect(await seen(k1.member, id)).toEqual([id]);
    expect(await pickUp(c1Pm, id)).toBe("picked_up");
    expect(await take(c1Pm, id, "resolve", { resolution_note: "Cleared" })).toBe("applied");
    expect(await take(k1.member, id, "close")).toBe("applied");
    expect(await seen(c2.member, id)).toEqual([]);
  });

  it("RP-627-2: C2 reads none of one C1 raised on itself, which informs K1 and no one else", async () => {
    const id = await raised(c1.member, "C1's own mess");
    expect(await seen(c2.member, id)).toEqual([]);
    expect(await events(c2.member, id)).toEqual([]);
    expect(await seen(k1.member, id)).toEqual([id]);
  });
});
