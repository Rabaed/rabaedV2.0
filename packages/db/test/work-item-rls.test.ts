// Seam 2 for Draft Work Items (RP-192): a Contractor's Draft MAR is seen only by
// its own Company's Members whose Visibility covers it (visibility.md V1, V3, V4),
// even when calling the database directly as the app role; and its history is
// append-only, with a hash chain that shows tampering.
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

type Company = { id: string; cr: string; ap: string; member: string };
let c1: Company; // Contractor, Electrical. Its Authorized Person created the Project.
let c2: Company; // Second Contractor, Electrical too.
let k1: Company; // Consultant.
let or: Company; // Owner Representative.
let c1Narrow = ""; // A C1 engineer who covers Building B only.
let projectId = "";
const participant = { c1: "", c2: "", k1: "", or: "" };
const loc = { tower1: "", buildingA: "", buildingB: "" };
const trade = { electrical: "", mechanical: "" };

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

async function value(kind: "trade" | "location", code: string, parent: string | null = null): Promise<string> {
  const [row] = await call<{ value_id: string }>(
    c1.ap,
    sql`select value_id from app.add_dimension_value(
      ${projectId}::uuid, ${kind}, ${parent}::uuid, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
  );
  return row!.value_id;
}

async function grant(as: string, fn: "participant" | "member", subject: string[], kind: string, values: string[] | "all") {
  const isAll = values === "all";
  const ids = isAll ? [] : values;
  const [row] =
    fn === "participant"
      ? await call<{ outcome: string }>(
          as,
          sql`select app.set_participant_visibility(${subject[0]}::uuid, ${kind}, ${isAll}, ${ids}::uuid[], now()) as outcome`,
        )
      : await call<{ outcome: string }>(
          as,
          sql`select app.set_member_visibility(${subject[0]}::uuid, ${subject[1]}::uuid, ${kind}, ${isAll}, ${ids}::uuid[], now()) as outcome`,
        );
  expect(row!.outcome).toBe("set");
}

type Created = { outcome: string; work_item_id: string | null };

const createDraft = (as: string, input: { trade?: string | null; location?: string | null; title?: string } = {}) =>
  call<Created>(
    as,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, 'MAR', ${input.title ?? "Cable trays"}, 'Galvanised, 300 mm',
      ${input.trade === undefined ? trade.electrical : input.trade}::uuid,
      ${input.location === undefined ? loc.buildingA : input.location}::uuid, now())`,
  ).then((rows) => rows[0]!);

/** The ids `as` sees in `table` for the item, unfiltered but for RLS. */
const seen = (as: string, table: string, column = "work_item_id") =>
  call<{ id: string }>(as, sql`select distinct ${sql.ref(column)} as id from ${sql.table(table)}`).then((rows) =>
    rows.map((r) => r.id),
  );

const itemTables = ["work_item_dimension_value", "work_item_access", "step_assignment", "work_item_event"];

let draft = "";

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [
    email("eng"),
  ]);
  c1 = await company(engineer, "C1");
  c2 = await company(engineer, "C2");
  k1 = await company(engineer, "K1");
  or = await company(engineer, "OR");
  c1Narrow = await member(c1.id, "narrow");
  app = createDb(urls.app, { max: 2 });

  const [created] = await call<{ project_id: string }>(
    c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TWR', 'contractor')`,
  );
  projectId = created!.project_id;
  participant.c1 = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id;
  for (const [key, co, role] of [
    ["c2", c2, "contractor"],
    ["k1", k1, "consultant"],
    ["or", or, "owner_representative"],
  ] as const) {
    const [row] = await call<{ participant_id: string }>(
      c1.ap,
      sql`select participant_id from app.add_participant(${projectId}::uuid, ${co.cr}, ${role})`,
    );
    participant[key] = row!.participant_id;
  }
  const addProjectMember = (as: string, p: string, m: string) =>
    call<{ outcome: string }>(as, sql`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
  await addProjectMember(c1.ap, participant.c1, c1.member);
  await addProjectMember(c1.ap, participant.c1, c1Narrow);
  await addProjectMember(c2.ap, participant.c2, c2.member);
  await addProjectMember(k1.ap, participant.k1, k1.member);
  await addProjectMember(or.ap, participant.or, or.member);

  trade.electrical = await value("trade", "EL");
  trade.mechanical = await value("trade", "ME");
  loc.tower1 = await value("location", "T1");
  loc.buildingA = await value("location", "BA", loc.tower1);
  loc.buildingB = await value("location", "BB", loc.tower1);

  // Every Participant covers Electrical everywhere; Members get all of their Participant's.
  for (const p of Object.values(participant)) {
    await grant(c1.ap, "participant", [p], "trade", [trade.electrical]);
    await grant(c1.ap, "participant", [p], "location", "all");
  }
  for (const [co, p, m] of [
    [c1, participant.c1, c1.member],
    [c2, participant.c2, c2.member],
    [k1, participant.k1, k1.member],
    [or, participant.or, or.member],
  ] as const) {
    await grant(co.ap, "member", [p, m], "trade", "all");
    await grant(co.ap, "member", [p, m], "location", "all");
  }
  await grant(c1.ap, "member", [participant.c1, c1Narrow], "trade", "all");
  await grant(c1.ap, "member", [participant.c1, c1Narrow], "location", [loc.buildingB]);

  const result = await createDraft(c1.member);
  expect(result.outcome).toBe("created");
  draft = result.work_item_id!;
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a Draft Work Item", () => {
  it("is seen, with its history, by its raiser's Members whose Visibility covers it (V1)", async () => {
    expect(await seen(c1.member, "work_item", "id")).toEqual([draft]);
    for (const table of itemTables) expect(await seen(c1.member, table), table).toEqual([draft]);
  });

  it("is seen by nobody else, in any of its tables (V1, V3)", async () => {
    for (const who of [c2.member, c2.ap, k1.member, or.member]) {
      expect(await seen(who, "work_item", "id")).toEqual([]);
      for (const table of itemTables) expect(await seen(who, table), table).toEqual([]);
    }
  });

  it("stays hidden from another Participant even with an access row, while at the raiser's internal Steps (V1)", async () => {
    await migrator.query(
      "insert into work_item_access (work_item_id, project_id, participant_id, since, reason) values ($1, $2, $3, now(), 'handling')",
      [draft, projectId, participant.k1],
    );
    try {
      expect(await seen(k1.member, "work_item", "id")).toEqual([]);
    } finally {
      await migrator.query("delete from work_item_access where work_item_id = $1 and participant_id = $2", [
        draft,
        participant.k1,
      ]);
    }
  });

  it("is not seen by a raising-Company Member whose Visibility excludes its Location (V4)", async () => {
    expect(await seen(c1Narrow, "work_item", "id")).toEqual([]);
    for (const table of itemTables) expect(await seen(c1Narrow, table), table).toEqual([]);
  });

  it("is not seen by a Member of the raising Company who is not on the Project", async () => {
    expect(await seen(await member(c1.id, "off-project"), "work_item", "id")).toEqual([]);
  });

  it("is not seen with no Member set", async () => {
    const rows = await app.transaction().execute((trx) => sql`select id from work_item`.execute(trx));
    expect(rows.rows).toEqual([]);
  });

  it("starts at the Draft Step, held by its creator, with one internal 'created' event", async () => {
    const [item] = await call<{ stage: string; holder: string; status: string }>(
      c1.member,
      sql`select w.current_stage_key as stage, a.assignee_member_id as holder, a.status
          from work_item w join step_assignment a on a.work_item_id = w.id where w.id = ${draft}`,
    );
    expect(item).toEqual({ stage: "draft", holder: c1.member, status: "claimed" });
    const events = await call<{ seq: number; type: string; audience: string; audience_participant_id: string }>(
      c1.member,
      sql`select seq, type, audience, audience_participant_id from work_item_event where work_item_id = ${draft}`,
    );
    expect(events).toEqual([{ seq: 1, type: "created", audience: "internal", audience_participant_id: participant.c1 }]);
  });
});

describe("creating a Draft", () => {
  it("is refused to a Participant whose role doesn't raise this Work Item Type", async () => {
    await expect(createDraft(k1.member)).rejects.toThrow(/only a Contractor/);
  });

  it("needs a Trade, and values of the right dimension", async () => {
    expect((await createDraft(c1.member, { trade: null })).outcome).toBe("trade_required");
    expect((await createDraft(c1.member, { trade: loc.buildingA })).outcome).toBe("value_not_found");
    expect((await createDraft(c1.member, { location: trade.electrical })).outcome).toBe("value_not_found");
  });

  it("stays within the creator's own Visibility", async () => {
    expect((await createDraft(c1.member, { trade: trade.mechanical })).outcome).toBe("outside_visibility");
    expect((await createDraft(c1Narrow, { location: loc.buildingA })).outcome).toBe("outside_visibility");
  });

  it("answers not_found on a Project the Member is not on", async () => {
    const outsider = await member(c1.id, "outsider");
    expect((await createDraft(outsider)).outcome).toBe("not_found");
  });
});

describe("the app role", () => {
  it("cannot write Work Items or their tables directly", async () => {
    for (const table of ["work_item", ...itemTables]) {
      await expect(
        withMember(app, c1.member, (trx) => sql`delete from ${sql.table(table)}`.execute(trx)),
        table,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("cannot UPDATE, DELETE or INSERT work_item_event", async () => {
    for (const statement of [
      sql`update work_item_event set payload = '{}'`,
      sql`delete from work_item_event`,
      sql`insert into work_item_event (project_id, work_item_id, type, actor_member_id, audience, hash)
          values (${projectId}, ${draft}, 'created', ${c1.member}, 'shared', '\\x00')`,
    ]) {
      await expect(withMember(app, c1.member, (trx) => statement.execute(trx))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("work_item_event", () => {
  const intact = async (id: string) =>
    (await migrator.query("select app.work_item_chain_intact($1) as ok", [id])).rows[0].ok as boolean;

  it("chains every event to the one before it", async () => {
    expect(await intact(draft)).toBe(true);
    const { rows } = await migrator.query("select seq, prev_hash, hash from work_item_event where work_item_id = $1", [draft]);
    expect(rows).toHaveLength(1);
    expect(rows[0].prev_hash).toBeNull();
    expect(rows[0].hash).toHaveLength(32);
  });

  it("is append-only even for the table's owner", async () => {
    await expect(migrator.query("update work_item_event set payload = '{}' where work_item_id = $1", [draft])).rejects.toThrow(
      /append-only/,
    );
    await expect(migrator.query("delete from work_item_event where work_item_id = $1", [draft])).rejects.toThrow(/append-only/);
  });

  it("shows a changed event as a broken chain", async () => {
    await migrator.query("begin");
    try {
      await migrator.query("alter table work_item_event disable trigger work_item_event_append_only");
      await migrator.query(`update work_item_event set payload = '{"title": "forged"}' where work_item_id = $1`, [draft]);
      expect(await intact(draft)).toBe(false);
    } finally {
      await migrator.query("rollback");
    }
    expect(await intact(draft)).toBe(true);
  });
});

// RP-193: Send for Review and Return, called as the app role.
describe("Send for Review and Return", () => {
  let item = "";
  let pm = "";
  const take = (as: string, transition: string, reason = "") =>
    call<{ outcome: string }>(
      as,
      sql`select app.take_transition(${item}::uuid, ${transition}, ${reason}, ${randomUUID()}::uuid, now()) as outcome`,
    ).then((rows) => rows[0]!.outcome);
  const claim = (as: string) =>
    call<{ outcome: string }>(as, sql`select app.claim_step(${item}::uuid, now()) as outcome`).then((rows) => rows[0]!.outcome);
  const setPositions = (m: string, keys: string[]) =>
    call<{ outcome: string }>(
      c1.ap,
      sql`select app.set_project_member_positions(${participant.c1}::uuid, ${m}::uuid, ${keys}::text[]) as outcome`,
    ).then((rows) => expect(rows[0]!.outcome).toBe("set"));
  const eventCount = async () =>
    (await migrator.query("select count(*)::int as n from work_item_event where work_item_id = $1", [item])).rows[0].n as number;

  beforeAll(async () => {
    pm = await member(c1.id, "pm");
    await call<{ outcome: string }>(c1.ap, sql`select app.add_project_member(${participant.c1}::uuid, ${pm}::uuid, now()) as outcome`);
    await grant(c1.ap, "member", [participant.c1, pm], "trade", "all");
    await grant(c1.ap, "member", [participant.c1, pm], "location", "all");
    await setPositions(c1.member, ["engineer"]);
    await setPositions(pm, ["project_manager"]);
    item = (await createDraft(c1.member, { title: "Switchgear" })).work_item_id!;
    expect(await take(c1.member, "send_for_review")).toBe("applied");
    expect(await claim(pm)).toBe("claimed");
    expect(await take(pm, "return", "Wrong rating")).toBe("applied");
    expect(await take(c1.member, "send_for_review")).toBe("applied");
  });

  it("keeps the item and every row of it inside the raiser's Participant at Internal Review (V1, V5)", async () => {
    expect(await seen(pm, "work_item", "id")).toContain(item);
    for (const who of [c2.member, k1.member, or.member]) {
      expect(await seen(who, "work_item", "id")).toEqual([]);
      for (const table of itemTables) expect(await seen(who, table), table).toEqual([]);
    }
  });

  it("answers not_found to another Participant's Members, and writes nothing", async () => {
    const before = await eventCount();
    for (const who of [c2.member, k1.member, or.member]) {
      expect(await take(who, "return", "x")).toBe("not_found");
      expect(await claim(who)).toBe("not_found");
    }
    expect(await eventCount()).toBe(before);
  });

  it("records each move as an internal event of the raiser, still chained", async () => {
    const { rows } = await migrator.query(
      "select type, audience, audience_participant_id, payload from work_item_event where work_item_id = $1 order by seq",
      [item],
    );
    expect(rows.map((r) => r.type)).toEqual(["created", "transition", "claimed", "transition", "transition"]);
    expect(rows.every((r) => r.audience === "internal" && r.audience_participant_id === participant.c1)).toBe(true);
    expect(rows[3].payload).toEqual({ reason: "Wrong rating" });
    expect(rows[1].payload.document_number).toMatch(/^TWR-MAR-01-\d{4}$/);
    expect((await migrator.query("select app.work_item_chain_intact($1) as ok", [item])).rows[0].ok).toBe(true);
  });

  it("never lets the app role read counters or idempotency keys, or write Positions", async () => {
    for (const table of ["numbering_counter", "command_idempotency"]) {
      expect(await seen(c1.member, table, "project_id"), table).toEqual([]);
    }
    for (const table of ["position", "position_permission", "project_member_position", "numbering_counter", "command_idempotency"]) {
      await expect(
        withMember(app, c1.ap, (trx) => sql`delete from ${sql.table(table)}`.execute(trx)),
        table,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("shows a Participant's Project Member Positions only to that Participant's Company (V14)", async () => {
    expect(await seen(c1.ap, "project_member_position", "project_member_id")).not.toEqual([]);
    for (const who of [c2.ap, k1.ap, or.member]) {
      expect(await seen(who, "project_member_position", "project_member_id")).toEqual([]);
    }
  });
});
