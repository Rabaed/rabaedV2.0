// Seam 2 for numbering counters and starting numbers (RP-315, spec RP-311;
// workflow-engine.md §8 "Starting numbers", data-model.md numbering_counter,
// visibility.md scenario 55). Counter values reveal a Company's volume: only the
// Project's Project Admins read them. A Project Admin creates a counter ahead
// with a starting number while it has issued nothing; after that it is locked.
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
let engineer = "";

type Company = { id: string; cr: string; ap: string; member: string };

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

async function member(companyId: string, who: string, creator = false): Promise<string> {
  return one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', $4) returning id",
    [companyId, email(who), JSON.stringify({ en: who, ar: who }), creator],
  );
}

async function company(name: string): Promise<Company> {
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

/**
 * A Project of C1's (its Authorized Person created it and is its Project Admin;
 * its Participant is 01) with C2 (02) and K1, a Consultant; C1's and C2's
 * engineers cover everything. Trade EL, Location Z1 > B1.
 */
async function tower(code: string) {
  const c1 = await company("C1");
  const c2 = await company("C2");
  const k1 = await company("K1");
  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, ${code}, 'contractor')`,
  );
  const projectId = created!.project_id;
  const p1 = await one("select id from participant where project_id = $1", [projectId]);
  const p2 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: c2.cr, role: "contractor" }, c2.ap);
  const pk = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
  const value = async (kind: string, valueCode: string, parent: string | null) => {
    const [row] = await call<{ value_id: string }>(
      c1.ap,
      sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, ${parent}::uuid, ${valueCode}, '{"en": "V", "ar": "ق"}'::jsonb)`,
    );
    return row!.value_id;
  };
  const trade = await value("trade", "EL", null);
  const zone = await value("location", "Z1", null);
  const building = await value("location", "B1", zone);
  const [scope] = await call<{ scope_id: string }>(
    c1.ap,
    sql`select scope_id from app.add_scope(${projectId}::uuid, ${trade}::uuid, null, '{"en": "S", "ar": "ن"}'::jsonb)`,
  );
  for (const [co, p, positions] of [
    [c1, p1, ["engineer", "project_manager"]],
    [c2, p2, ["engineer", "project_manager"]],
    [k1, pk, ["manager"]],
  ] as const) {
    expect(await outcome(co.ap, sql`select app.add_project_member(${p}::uuid, ${co.member}::uuid, now()) as outcome`)).toBe("added");
    for (const kind of ["trade", "location"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
      expect(
        await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${co.member}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`),
      ).toBe("set");
    }
    expect(
      await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${co.member}::uuid, ${[...positions]}::text[]) as outcome`),
    ).toBe("set");
  }

  /** `as` raises a MAR in B1 and sends it for review; returns its Document Number. */
  async function numbered(as: string): Promise<string> {
    const [draft] = await call<{ outcome: string; work_item_id: string }>(
      as,
      sql`select outcome, work_item_id from app.create_work_item(
        ${projectId}::uuid, 'MAR', 'Cable trays', app.latest_form_version('MAR'), '{"description": "Galvanised"}'::jsonb,
        ${trade}::uuid, ${building}::uuid, now(), ${[scope!.scope_id]}::uuid[])`,
    );
    expect(draft!.outcome).toBe("created");
    const item = draft!.work_item_id;
    expect(
      await outcome(
        as,
        sql`select app.take_transition(${item}::uuid, 'send_for_review', '{}', '', app.answers_sha256(${item}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
      ),
    ).toBe("applied");
    return (await migrator.query("select document_number from work_item where id = $1", [item])).rows[0].document_number as string;
  }

  /** Adds a Numbering Pattern row as the migrator, set by C1's Authorized Person. */
  async function pattern(segments: object[], seqScope: number[], seqDigits = 4, separator = "-") {
    await migrator.query(
      `insert into numbering_pattern (project_id, segments, separator, seq_digits, seq_scope, shared_counter_accepted_at, set_by_member_id)
       values ($1, $2, $3, $4, $5, now(), $6)`,
      [projectId, JSON.stringify(segments), separator, seqDigits, JSON.stringify(seqScope), c1.ap],
    );
  }

  /** `as` sets the starting number of the MAR counter `participant` (and the other values) count under. */
  async function setStart(
    as: string,
    start: number,
    values: { participant?: string | null; trade?: string | null; location?: string | null; type?: string } = {},
  ) {
    const [row] = await call<{ outcome: string; counter_key: string | null; next_number: string | null }>(
      as,
      sql`select outcome, counter_key, next_number from app.set_numbering_counter_start(
        ${projectId}::uuid, ${values.type ?? "MAR"}, ${values.participant === undefined ? p1 : values.participant}::uuid,
        ${values.trade ?? null}::uuid, ${values.location ?? null}::uuid, ${start}::integer, now())`,
    );
    return row!;
  }

  return { projectId, c1, c2, k1, p1, p2, trade, zone, building, numbered, pattern, setStart };
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

const counters = (as: string) =>
  call<{ project_id: string; counter_key: string; last_value: number }>(
    as,
    sql`select project_id, counter_key, last_value from numbering_counter order by counter_key`,
  );

describe("numbering_counter", () => {
  it("is read by the Project's Project Admin, and by no other Member (scenario 55)", async () => {
    const t = await tower("NCR");
    await t.numbered(t.c1.member);
    await t.numbered(t.c2.member);
    expect(await counters(t.c1.ap)).toEqual([
      { project_id: t.projectId, counter_key: "NCR-MAR-01", last_value: 1 },
      { project_id: t.projectId, counter_key: "NCR-MAR-02", last_value: 1 },
    ]);
    for (const who of [t.c1.member, t.c2.ap, t.c2.member, t.k1.ap, t.k1.member]) {
      expect(await counters(who), who).toEqual([]);
    }
  });

  it("is never written directly through the app role, not even by a Project Admin", async () => {
    const t = await tower("NCW");
    await expect(
      call(t.c1.ap, sql<object>`insert into numbering_counter (project_id, counter_key, last_value) values (${t.projectId}::uuid, 'X', 5)`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("app.set_numbering_counter_start", () => {
  it("creates a counter ahead, so the next number issued is the starting number", async () => {
    const t = await tower("NCS");
    expect(await t.setStart(t.c1.ap, 144)).toEqual({ outcome: "set", counter_key: "NCS-MAR-01", next_number: "NCS-MAR-01-0144" });
    expect(await t.numbered(t.c1.member)).toBe("NCS-MAR-01-0144");
    expect(await t.numbered(t.c1.member)).toBe("NCS-MAR-01-0145");
    // Another Participant's counter is its own.
    expect(await t.numbered(t.c2.member)).toBe("NCS-MAR-02-0001");
  });

  it("changes the starting number while the counter has issued nothing, then locks it", async () => {
    const t = await tower("NCL");
    expect((await t.setStart(t.c1.ap, 144)).outcome).toBe("set");
    expect((await t.setStart(t.c1.ap, 200)).next_number).toBe("NCL-MAR-01-0200");
    expect(await t.numbered(t.c1.member)).toBe("NCL-MAR-01-0200");
    expect(await t.setStart(t.c1.ap, 300)).toEqual({ outcome: "counter_used", counter_key: null, next_number: null });
    // A counter created by its first number is used too.
    await t.numbered(t.c2.member);
    expect((await t.setStart(t.c1.ap, 50, { participant: t.p2 })).outcome).toBe("counter_used");
    expect(await t.numbered(t.c1.member)).toBe("NCL-MAR-01-0201");
  });

  it("starts at 1 when asked, and refuses a starting number below 1", async () => {
    const t = await tower("NCO");
    expect((await t.setStart(t.c1.ap, 1)).next_number).toBe("NCO-MAR-01-0001");
    await expect(t.setStart(t.c1.ap, 0)).rejects.toThrow(/check constraint/);
    expect(await t.numbered(t.c1.member)).toBe("NCO-MAR-01-0001");
  });

  it("is refused as not_found to anyone but the Project's Project Admins (scenario 55)", async () => {
    const t = await tower("NCN");
    for (const who of [t.c1.member, t.c2.ap, t.c2.member, t.k1.ap, t.k1.member]) {
      expect(await t.setStart(who, 144), who).toEqual({ outcome: "not_found", counter_key: null, next_number: null });
    }
    expect(await t.numbered(t.c1.member)).toBe("NCN-MAR-01-0001");
  });

  it("builds the counter key under the pattern in effect, from the values it counts by", async () => {
    const t = await tower("NCP");
    await t.pattern(
      [{ kind: "project" }, { kind: "trade" }, { kind: "location", level: 2 }, { kind: "participant" }],
      [1, 2, 3],
      5,
      "/",
    );
    expect(await t.setStart(t.c1.ap, 144, { trade: t.trade, location: t.building })).toEqual({
      outcome: "set",
      counter_key: "EL-B1-01",
      next_number: "NCP/EL/B1/01/00144",
    });
    expect(await t.numbered(t.c1.member)).toBe("NCP/EL/B1/01/00144");
  });

  it("asks for each value the pattern counts by, and refuses values not of the Project", async () => {
    const t = await tower("NCV");
    const other = await tower("NCX");
    expect((await t.setStart(t.c1.ap, 5, { participant: null })).outcome).toBe("participant_required");
    expect((await t.setStart(t.c1.ap, 5, { participant: other.p1 })).outcome).toBe("value_not_found");
    expect((await t.setStart(t.c1.ap, 5, { type: "NOPE" })).outcome).toBe("type_not_found");
    await t.pattern([{ kind: "trade" }, { kind: "location", level: 1 }, { kind: "participant" }], [0, 1, 2]);
    expect((await t.setStart(t.c1.ap, 5, { location: t.zone })).outcome).toBe("trade_required");
    expect((await t.setStart(t.c1.ap, 5, { trade: t.trade })).outcome).toBe("location_required");
    expect((await t.setStart(t.c1.ap, 5, { trade: t.zone, location: t.zone })).outcome).toBe("value_not_found");
    expect((await t.setStart(t.c1.ap, 5, { trade: t.trade, location: t.trade })).outcome).toBe("value_not_found");
    expect((await t.setStart(t.c1.ap, 5, { trade: other.trade, location: t.zone })).outcome).toBe("value_not_found");
    expect((await t.setStart(t.c1.ap, 5, { trade: t.trade, location: t.zone })).next_number).toBe("EL-Z1-01-0005");
  });

  it("counts under the Participant Code once the Participant has one", async () => {
    const t = await tower("NCK");
    expect(await outcome(t.c1.ap, sql`select app.set_participant_code(${t.p1}::uuid, 'CCM') as outcome`)).toBe("set");
    expect(await t.setStart(t.c1.ap, 144)).toEqual({ outcome: "set", counter_key: "NCK-MAR-CCM", next_number: "NCK-MAR-CCM-0144" });
    expect(await t.numbered(t.c1.member)).toBe("NCK-MAR-CCM-0144");
  });

  it("is refused on a Closed Project", async () => {
    const t = await tower("NCC");
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [t.projectId]);
    expect((await t.setStart(t.c1.ap, 144)).outcome).toBe("project_closed");
  });
});

describe("app.numbering_counter", () => {
  it("shows a Project Admin the counter the values fall under, before and after it issues", async () => {
    const t = await tower("NCQ");
    const counter = (as: string) =>
      call(
        as,
        sql<object>`select outcome, counter_key, prefix, separator, seq_digits, last_value, issued
            from app.numbering_counter(${t.projectId}::uuid, 'MAR', ${t.p1}::uuid, null, null, now())`,
      );
    expect(await counter(t.c1.ap)).toEqual([
      { outcome: "found", counter_key: "NCQ-MAR-01", prefix: "NCQ-MAR-01", separator: "-", seq_digits: 4, last_value: null, issued: false },
    ]);
    await t.setStart(t.c1.ap, 144);
    expect((await counter(t.c1.ap))[0]).toMatchObject({ last_value: 143, issued: false });
    await t.numbered(t.c1.member);
    expect((await counter(t.c1.ap))[0]).toMatchObject({ last_value: 144, issued: true });
    for (const who of [t.c1.member, t.k1.ap]) {
      expect(await counter(who), who).toEqual([
        { outcome: "not_found", counter_key: null, prefix: null, separator: null, seq_digits: null, last_value: null, issued: null },
      ]);
    }
  });
});
