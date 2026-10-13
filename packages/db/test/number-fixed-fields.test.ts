// Seam 2 for RP-581 (ADR 0021): a Trade or Location level the Document Number
// uses never changes once the item is numbered ("cancel and raise a new one").
// app.number_fixed_fields reads the pattern Version the item was numbered under;
// app.check_work_item_built_ins refuses the change as `number_part_fixed`.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;
let engineer = "";

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
    [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
  );
}

async function company(name: string) {
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

async function outcome(as: string, query: ReturnType<typeof sql<{ outcome: string }>>) {
  return (await call(as, query))[0]!.outcome;
}

/** A Project with Contractor C1, Trades EL and PL, and Location Z1 > B1 and Z1 > B2 (Zone, Building). */
async function tower(code: string) {
  const c1 = await company("C1");
  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, ${code}, 'contractor')`,
  );
  const projectId = created!.project_id;
  const p1 = await one("select id from participant where project_id = $1", [projectId]);
  const value = async (kind: string, valueCode: string, parent: string | null) => {
    const [row] = await call<{ value_id: string }>(
      c1.ap,
      sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, ${parent}::uuid, ${valueCode}, '{"en": "V", "ar": "ق"}'::jsonb)`,
    );
    return row!.value_id;
  };
  const el = await value("trade", "EL", null);
  const pl = await value("trade", "PL", null);
  const zone = await value("location", "Z1", null);
  const b1 = await value("location", "B1", zone);
  const b2 = await value("location", "B2", zone);
  expect(await outcome(c1.ap, sql`select app.add_project_member(${p1}::uuid, ${c1.member}::uuid, now()) as outcome`)).toBe("added");
  for (const kind of ["trade", "location"]) {
    expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p1}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    expect(
      await outcome(c1.ap, sql`select app.set_member_visibility(${p1}::uuid, ${c1.member}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`),
    ).toBe("set");
  }
  expect(
    await outcome(c1.ap, sql`select app.set_project_member_positions(${p1}::uuid, ${c1.member}::uuid, ${["engineer", "project_manager"]}::text[]) as outcome`),
  ).toBe("set");

  /** The engineer raises a MAR at EL, B1 and sends it for review, which numbers it. */
  async function numbered(): Promise<string> {
    const [draft] = await call<{ outcome: string; work_item_id: string }>(
      c1.member,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'MAR', 'Cable trays', app.latest_form_version('MAR'), '{"description": "Galvanised"}'::jsonb,
        ${el}::uuid, ${b1}::uuid, now(), '{}'::uuid[])`,
    );
    expect(draft!.outcome).toBe("created");
    const item = draft!.work_item_id;
    expect(
      await outcome(
        c1.member,
        sql`select app.take_transition(${item}::uuid, 'send_for_review', '{}'::jsonb, '', app.answers_sha256(${item}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
      ),
    ).toBe("applied");
    return item;
  }

  /** A Project pattern in effect now: the segments, then the Participant Code, counted by every position. */
  async function pattern(given: object[], from: "earlier" | "now" = "earlier") {
    const segments = [...given, { kind: "participant" }];
    await migrator.query(
      `insert into numbering_pattern (project_id, work_item_type_id, segments, separator, seq_digits, seq_scope, set_by_member_id, effective_from)
       values ($1, null, $2, '-', 4, $3, $4, now() - ($5 || ' minutes')::interval)`,
      [projectId, JSON.stringify(segments), JSON.stringify(segments.map((_, i) => i)), c1.ap, from === "earlier" ? "1" : "0"],
    );
  }

  /** The check as the migrator runs it (it is internal to the save and create functions). */
  async function check(item: string, tradeId: string, locationId: string | null): Promise<string> {
    const { rows } = await migrator.query(
      "select app.check_work_item_built_ins($1, $2, $3, $4, $5, '{}'::uuid[]) as outcome",
      [item, projectId, projectMember, tradeId, locationId],
    );
    return rows[0].outcome as string;
  }
  const projectMember = await one("select id from project_member where project_id = $1 and member_id = $2", [projectId, c1.member]);

  const fixed = async (item: string): Promise<string[]> =>
    (await migrator.query("select app.number_fixed_fields($1) as fields", [item])).rows[0].fields as string[];

  return { projectId, raiser: c1.member, el, pl, b1, b2, numbered, pattern, check, fixed };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  app = createDb(urls.app, { max: 2 });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const base = [{ kind: "project" }, { kind: "type" }];

describe("a Trade or Location the Document Number uses (RP-581)", () => {
  it("locks the Trade when the pattern holds it; the Location, not in the pattern, can still change", async () => {
    const t = await tower("NFT");
    await t.pattern([...base, { kind: "trade" }]);
    const item = await t.numbered();
    expect(await t.fixed(item)).toEqual(["trade"]);
    expect(await t.check(item, t.pl, t.b1)).toBe("number_part_fixed");
    expect(await t.check(item, t.el, t.b2)).toBe("ok");
    expect(await t.check(item, t.el, t.b1)).toBe("ok");
  });

  it("locks the Location when the pattern holds a Location level", async () => {
    const t = await tower("NFL");
    await t.pattern([...base, { kind: "location", level: 2 }]);
    const item = await t.numbered();
    expect(await t.fixed(item)).toEqual(["location"]);
    expect(await t.check(item, t.el, t.b2)).toBe("number_part_fixed");
    expect(await t.check(item, t.el, null)).toBe("number_part_fixed");
    expect(await t.check(item, t.pl, t.b1)).toBe("ok");
  });

  it("locks neither under the default pattern (Project, Type, Participant, sequence)", async () => {
    const t = await tower("NFD");
    const item = await t.numbered();
    expect(await t.fixed(item)).toEqual([]);
    expect(await t.check(item, t.pl, t.b2)).toBe("ok");
  });

  it("reads the pattern the item was numbered under, not the Project's current one", async () => {
    const t = await tower("NFV");
    await t.pattern([...base, { kind: "trade" }]);
    const item = await t.numbered();
    await t.pattern(base, "now");
    expect(await t.fixed(item)).toEqual(["trade"]);
    expect(await t.check(item, t.pl, t.b1)).toBe("number_part_fixed");
  });

  it("leaves a Draft never numbered free, with nothing fixed", async () => {
    const t = await tower("NFN");
    await t.pattern([...base, { kind: "trade" }, { kind: "location", level: 1 }]);
    const [draft] = await call<{ outcome: string; work_item_id: string }>(
      t.raiser,
      sql`select outcome, work_item_id from app.create_work_item(
        ${t.projectId}::uuid, 'MAR', 'Draft', app.latest_form_version('MAR'), '{}'::jsonb, ${t.el}::uuid, ${t.b1}::uuid, now(), '{}'::uuid[])`,
    );
    expect(draft!.outcome).toBe("created");
    expect(await t.fixed(draft!.work_item_id)).toEqual([]);
    expect(await t.check(draft!.work_item_id, t.pl, t.b2)).toBe("ok");
  });
});
