// Seam 2 for Draft Work Items (RP-192): a Contractor's Draft MAR is seen only by
// its own Company's Members whose Visibility covers it (visibility.md V1, V3, V4),
// even when calling the database directly as the app role; and its history is
// append-only, with a hash chain that shows tampering.
import { randomInt, randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
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
let c1: Company; // Contractor, Electrical. Its Authorized Person created the Project.
let c2: Company; // Second Contractor, Electrical too.
let k1: Company; // Consultant.
let or: Company; // Owner Representative.
let c1Narrow = ""; // A C1 engineer who covers Building B only.
let projectId = "";
const participant = { c1: "", c2: "", k1: "", or: "" };
const loc = { tower1: "", buildingA: "", buildingB: "" };
const trade = { electrical: "", mechanical: "" };
const scope = { lighting: "", indoor: "", power: "", hvac: "" }; // Indoor is a Sub-scope of Lighting; HVAC is Mechanical's.

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

async function addScope(tradeId: string, name: string, parent: string | null = null): Promise<string> {
  const [row] = await call<{ outcome: string; scope_id: string }>(
    c1.ap,
    sql`select outcome, scope_id from app.add_scope(${projectId}::uuid, ${tradeId}::uuid, ${parent}::uuid, ${JSON.stringify({ en: name, ar: name })}::jsonb)`,
  );
  expect(row!.outcome).toBe("added");
  return row!.scope_id;
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

type BuiltIns = { trade?: string | null; location?: string | null; scopes?: readonly string[] };

const createDraft = (as: string, input: BuiltIns & { title?: string } = {}) =>
  call<Created>(
    as,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, 'MAR', ${input.title ?? "Cable trays"}, app.latest_form_version('MAR'), '{"description": "Galvanised, 300 mm"}'::jsonb,
      ${input.trade === undefined ? trade.electrical : input.trade}::uuid,
      ${input.location === undefined ? loc.buildingA : input.location}::uuid, now(),
      ${input.scopes ?? [scope.lighting]}::uuid[])`,
  ).then((rows) => rows[0]!);

/** Save draft: the Form's own answers, and its Built-in Fields (by default as createDraft sets them). */
const saveAnswers = (as: string, item: string, data: object, builtIns: BuiltIns = {}) =>
  call<{ outcome: string }>(
    as,
    sql`select app.save_work_item_answers(
      ${item}::uuid, ${JSON.stringify(data)}::jsonb,
      ${builtIns.trade === undefined ? trade.electrical : builtIns.trade}::uuid,
      ${builtIns.location === undefined ? loc.buildingA : builtIns.location}::uuid,
      ${builtIns.scopes ?? [scope.lighting]}::uuid[], now()) as outcome`,
  ).then((rows) => rows[0]!.outcome);

const sendDraftForReview = (as: string, item: string, hash: RawBuilder<unknown>) =>
  call<{ outcome: string }>(
    as,
    sql`select app.take_transition(${item}::uuid, 'send_for_review', '{}', '', ${hash}, ${randomUUID()}::uuid, now()) as outcome`,
  ).then((rows) => rows[0]!.outcome);

/** The ids `as` sees in `table` for the item, unfiltered but for RLS. */
const seen = (as: string, table: string, column = "work_item_id") =>
  call<{ id: string }>(as, sql`select distinct ${sql.ref(column)} as id from ${sql.table(table)}`).then((rows) =>
    rows.map((r) => r.id),
  );

const itemTables = ["work_item_dimension_value", "work_item_scope", "work_item_access", "step_assignment", "work_item_event"];

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
    participant[key] = await joinProject(app, projectId, { adminId: c1.ap, crNumber: co.cr, role }, co.ap);
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
  scope.lighting = await addScope(trade.electrical, "Lighting");
  scope.indoor = await addScope(trade.electrical, "Indoor", scope.lighting);
  scope.power = await addScope(trade.electrical, "Power");
  scope.hvac = await addScope(trade.mechanical, "HVAC");

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

// visibility.md V15, on the Tower setup: C1's Authorized Person is the Project Admin.
describe("participant (scenarios 28 and 29)", () => {
  it("shows each Participant's Member only their own Participant: never C2, K1 or OR to C1 (scenario 28)", async () => {
    for (const [who, own] of [
      [c1.member, participant.c1],
      [c2.member, participant.c2],
      [k1.member, participant.k1],
      [or.member, participant.or],
    ] as const) {
      expect(await seen(who, "participant", "id"), who).toEqual([own]);
    }
  });

  it("shows the Project Admin every Participant (scenario 29)", async () => {
    expect((await seen(c1.ap, "participant", "id")).sort()).toEqual(Object.values(participant).sort());
  });
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

  it("never gives the app role the current Step, Stage or their times directly: only app.step_as_seen (V14)", async () => {
    for (const column of [
      "current_step_id",
      "current_stage_key",
      "step_entered_at",
      "participant_entered_at",
      "participant_entered_step_id",
      "updated_at",
    ]) {
      await expect(
        withMember(app, c1.member, (trx) => sql`select ${sql.ref(column)} from work_item`.execute(trx)),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("starts at the Draft Step, held by its creator, with one internal 'created' event", async () => {
    const [item] = await call<{ stage: string; holder: string; status: string }>(
      c1.member,
      sql`select seen.stage_key as stage, a.assignee_member_id as holder, a.status
          from app.step_as_seen(${draft}::uuid) seen join step_assignment a on a.work_item_id = ${draft}`,
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
    expect((await createDraft(c1.member, { trade: trade.mechanical, scopes: [] })).outcome).toBe("outside_visibility");
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
      sql`select app.take_transition(${item}::uuid, ${transition}, ${JSON.stringify(reason ? { reason } : {})}::jsonb, '', app.answers_sha256(${item}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
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

  // RP-300: the Action Form answers are checked by the API; the database still
  // refuses what its schema can't hold, so the app role can't write them.
  it("refuses a Return without its reason, or with answers its Action Form doesn't ask for, and writes nothing", async () => {
    expect(await claim(pm)).toBe("claimed");
    const before = await eventCount();
    const takeWith = (answers: string) =>
      call<{ outcome: string }>(
        pm,
        sql`select app.take_transition(${item}::uuid, 'return', ${answers}::jsonb, '', null, ${randomUUID()}::uuid, now()) as outcome`,
      ).then((rows) => rows[0]!.outcome);
    for (const answers of ['{}', '{"reason": "  "}', '{"reason": null}', '{"reason": "Fine", "remarks": "Not asked"}', '[]', 'null']) {
      expect(await takeWith(answers), answers).toBe("invalid_action_form");
    }
    expect(await eventCount()).toBe(before);
  });

  // The domain validator is the reference: an empty object is an answer (of the
  // wrong type, which only the API checks), not a missing one.
  it("counts a required answer missing as the domain does: null, an empty or blank text, an empty list", async () => {
    const schema = JSON.stringify({ sections: [{ key: "action", fields: [{ key: "reason", type: "textarea", required: true }] }] });
    const fits = async (answer: string) => {
      const { rows } = await migrator.query<{ fits: boolean }>(
        "select app.action_form_fits($1::jsonb, jsonb_build_object('reason', $2::jsonb)) as fits",
        [schema, answer],
      );
      return rows[0]!.fits;
    };
    for (const missing of ["null", '""', '"  "', "[]"]) expect(await fits(missing), missing).toBe(false);
    for (const answered of ["{}", '"Wrong tray size"']) expect(await fits(answered), answered).toBe(true);
  });
});

// RP-194: Submit to the Consultant and Code A, called as the app role.
describe("Submit and Code A", () => {
  let item = "";
  let pm = "";
  let manager = "";
  const take = (as: string, transition: string) =>
    call<{ outcome: string }>(
      as,
      sql`select app.take_transition(${item}::uuid, ${transition}, '{}', '', app.answers_sha256(${item}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
    ).then((rows) => rows[0]!.outcome);
  const claim = (as: string) =>
    call<{ outcome: string }>(as, sql`select app.claim_step(${item}::uuid, now()) as outcome`).then((rows) => rows[0]!.outcome);
  const setPositions = (ap: string, p: string, m: string, keys: string[]) =>
    call<{ outcome: string }>(ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${keys}::text[]) as outcome`).then(
      (rows) => expect(rows[0]!.outcome).toBe("set"),
    );
  const events = async () =>
    (
      await migrator.query(
        "select id, type, audience, actor_participant_id, payload from work_item_event where work_item_id = $1 order by seq",
        [item],
      )
    ).rows;
  const signerName = (as: string, eventId: string) =>
    call<{ name: { en: string } | null }>(as, sql`select app.code_signer_name(${eventId}::uuid) as name`).then(
      (rows) => rows[0]!.name,
    );

  beforeAll(async () => {
    pm = await member(c1.id, "submitting-pm");
    manager = await member(k1.id, "khalid-signer");
    await call<{ outcome: string }>(c1.ap, sql`select app.add_project_member(${participant.c1}::uuid, ${pm}::uuid, now())`);
    await call<{ outcome: string }>(k1.ap, sql`select app.add_project_member(${participant.k1}::uuid, ${manager}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      await grant(c1.ap, "member", [participant.c1, pm], kind, "all");
      await grant(k1.ap, "member", [participant.k1, manager], kind, "all");
    }
    await setPositions(c1.ap, participant.c1, c1.member, ["engineer"]);
    await setPositions(c1.ap, participant.c1, pm, ["project_manager"]);
    await setPositions(k1.ap, participant.k1, manager, ["manager"]);
    item = (await createDraft(c1.member, { title: "Busbars" })).work_item_id!;
    expect(await take(c1.member, "send_for_review")).toBe("applied");
    expect(await claim(pm)).toBe("claimed");
    expect(await take(pm, "submit")).toBe("applied");
  });

  it("gives the Consultant handling access and the Owner Representative oversight, and nobody else (V2, V3)", async () => {
    const { rows } = await migrator.query(
      "select participant_id, reason from work_item_access where work_item_id = $1 order by participant_id",
      [item],
    );
    expect(Object.fromEntries(rows.map((r) => [r.participant_id, r.reason]))).toEqual({
      [participant.c1]: "raised",
      [participant.k1]: "handling",
      [participant.or]: "oversight",
    });
    for (const who of [k1.member, manager, or.member]) expect(await seen(who, "work_item", "id"), who).toContain(item);
    expect(await seen(c2.member, "work_item", "id")).not.toContain(item);
    for (const table of itemTables) expect(await seen(c2.member, table), table).not.toContain(item);
  });

  it("shows the Consultant only the shared Submit of the Contractor's history (V5)", async () => {
    const visible = await call<{ type: string; audience: string }>(
      k1.member,
      sql`select type, audience from work_item_event where work_item_id = ${item}::uuid order by seq`,
    );
    expect(visible).toEqual([{ type: "transition", audience: "shared" }]);
  });

  it("closes the item with Code A in a shared issue_code event, still chained", async () => {
    expect(await claim(manager)).toBe("claimed");
    expect(await take(manager, "approve_a")).toBe("applied");
    const { rows } = await migrator.query(
      "select outcome, closed_at, current_stage_key from work_item where id = $1",
      [item],
    );
    expect(rows[0]).toMatchObject({ outcome: "A", current_stage_key: "approved" });
    expect(rows[0].closed_at).not.toBeNull();
    expect(
      (await migrator.query("select count(*)::int as n from step_assignment where work_item_id = $1 and status <> 'done'", [item]))
        .rows[0].n,
    ).toBe(0);
    const last = (await events()).at(-1);
    expect(last).toMatchObject({ type: "issue_code", audience: "shared", actor_participant_id: participant.k1, payload: { outcome: "A" } });
    expect((await migrator.query("select app.work_item_chain_intact($1) as ok", [item])).rows[0].ok).toBe(true);
    expect(await take(manager, "revise_c")).toBe("item_closed");
  });

  // RP-290: what Link search offers. Submitted, closed after Submit too; a Draft
  // never is; an item the Member can't see answers false, like a made-up id.
  it("counts as Submitted, closed or not, to those who see it, and to nobody else (app.work_item_submitted)", async () => {
    const submitted = (as: string, id: string) =>
      call<{ submitted: boolean }>(as, sql`select app.work_item_submitted(${id}::uuid) as submitted`).then((rows) => rows[0]!.submitted);
    for (const who of [c1.member, pm, k1.member, manager, or.member]) expect(await submitted(who, item), who).toBe(true);
    expect(await submitted(c2.member, item)).toBe(false);
    expect(await submitted(c1.member, draft)).toBe(false);
    expect(await submitted(c1.member, randomUUID())).toBe(false);
  });

  it("names the Code's signer to those who see it, and to nobody else, for no other event (V14)", async () => {
    const all = await events();
    const code = all.find((e) => e.type === "issue_code")!;
    const submit = all.find((e) => e.audience === "shared" && e.type === "transition")!;
    expect(await signerName(c1.member, code.id)).toMatchObject({ en: "khalid-signer" });
    expect(await signerName(or.member, code.id)).toMatchObject({ en: "khalid-signer" });
    expect(await signerName(c2.member, code.id)).toBeNull();
    expect(await signerName(k1.member, submit.id)).toBeNull();
  });

  it("names only the Companies that appear on the item, and only to those who see it (V14, V15)", async () => {
    const named = (as: string) =>
      call<{ participant_id: string }>(as, sql`select participant_id from app.work_item_companies(${item}::uuid)`).then((rows) =>
        rows.map((r) => r.participant_id).sort(),
      );
    // The raiser and the Consultant it was "With"; the Owner Representative's oversight names nobody.
    expect(await named(c1.member)).toEqual([participant.c1, participant.k1].sort());
    expect(await named(or.member)).toEqual([participant.c1, participant.k1].sort());
    expect(await named(c2.member)).toEqual([]);
  });

  it("keeps actor resolution out of the app role's reach", async () => {
    await expect(
      withMember(app, c1.member, (trx) => sql`select app.next_step_holder(${item}::uuid, ${randomUUID()}::uuid)`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withMember(app, c1.member, (trx) =>
        sql`select app.participant_covers_item(${participant.k1}::uuid, ${item}::uuid)`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

// RP-239: an Internal Note written with a Transition, called as the app role
// (visibility.md V5, scenarios 7, 8 and 34).
describe("Internal Note", () => {
  let item = "";
  let pm = "";
  let manager = "";
  const take = (as: string, transition: string, internalNote: string, reason = "") =>
    call<{ outcome: string }>(
      as,
      sql`select app.take_transition(
        ${item}::uuid, ${transition}, ${JSON.stringify(reason ? { reason } : {})}::jsonb, ${internalNote}, app.answers_sha256(${item}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
    ).then((rows) => rows[0]!.outcome);
  const claim = (as: string) =>
    call<{ outcome: string }>(as, sql`select app.claim_step(${item}::uuid, now()) as outcome`).then((rows) => rows[0]!.outcome);
  const setPositions = (ap: string, p: string, m: string, keys: string[]) =>
    call<{ outcome: string }>(ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${keys}::text[]) as outcome`).then(
      (rows) => expect(rows[0]!.outcome).toBe("set"),
    );
  /** The item's events `as` may read, through RLS. */
  const visible = (as: string) =>
    call<{ type: string; payload: Record<string, unknown> }>(
      as,
      sql`select type, payload from work_item_event where work_item_id = ${item}::uuid order by seq`,
    );
  const intact = async () => (await migrator.query("select app.work_item_chain_intact($1) as ok", [item])).rows[0].ok as boolean;

  beforeAll(async () => {
    pm = await member(c1.id, "noting-pm");
    manager = await member(k1.id, "noting-manager");
    await call<{ outcome: string }>(c1.ap, sql`select app.add_project_member(${participant.c1}::uuid, ${pm}::uuid, now())`);
    await call<{ outcome: string }>(k1.ap, sql`select app.add_project_member(${participant.k1}::uuid, ${manager}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      await grant(c1.ap, "member", [participant.c1, pm], kind, "all");
      await grant(k1.ap, "member", [participant.k1, manager], kind, "all");
    }
    await setPositions(c1.ap, participant.c1, c1.member, ["engineer"]);
    await setPositions(c1.ap, participant.c1, pm, ["project_manager"]);
    await setPositions(k1.ap, participant.k1, manager, ["manager"]);
    item = (await createDraft(c1.member, { title: "Transformers" })).work_item_id!;
    expect(await take(c1.member, "send_for_review", "sent note")).toBe("applied");
    expect(await claim(pm)).toBe("claimed");
    expect(await take(pm, "return", "returned note", "Wrong rating")).toBe("applied");
    expect(await take(c1.member, "send_for_review", "")).toBe("applied");
    expect(await claim(pm)).toBe("claimed");
    expect(await take(pm, "submit", "submitted note")).toBe("applied");
  });

  it("is an internal event of the writer's Participant, just before its Transition, even for Submit", async () => {
    const { rows } = await migrator.query(
      `select type, audience, audience_participant_id, actor_member_id, transition_id, payload
       from work_item_event where work_item_id = $1 order by seq`,
      [item],
    );
    const notes = rows.flatMap((r, i) => (r.type === "internal_note" ? [[r, rows[i + 1]]] : []));
    expect(notes.map(([n]) => n.payload)).toEqual([{ internal_note: "sent note" }, { internal_note: "returned note" }, { internal_note: "submitted note" }]);
    for (const [note, next] of notes) {
      expect(note).toMatchObject({ audience: "internal", audience_participant_id: participant.c1 });
      expect(next).toMatchObject({ type: "transition", transition_id: note.transition_id, actor_member_id: note.actor_member_id });
    }
    expect(notes.at(-1)![1].audience).toBe("shared");
    expect(notes.map(([n]) => n.actor_member_id)).toEqual([c1.member, pm, pm]);
  });

  it("is read only by the writer's Participant: the Consultant and Owner Representative see just the Submit (scenario 34)", async () => {
    expect((await visible(c1.member)).filter((e) => e.type === "internal_note")).toHaveLength(3);
    for (const who of [k1.member, manager, or.member]) {
      expect(await visible(who), who).toEqual([{ type: "transition", payload: {} }]);
    }
    expect(await visible(c2.member)).toEqual([]);
  });

  it("written with the Code, is read only by the Consultant (scenario 8)", async () => {
    expect(await claim(manager)).toBe("claimed");
    expect(await take(manager, "approve_a", "coded note")).toBe("applied");
    expect((await visible(k1.member)).map((e) => e.payload.internal_note).filter(Boolean)).toEqual(["coded note"]);
    for (const who of [c1.member, pm, or.member]) {
      expect(JSON.stringify(await visible(who)), who).not.toContain("coded note");
    }
  });

  it("is in the hash chain: changing an Internal Note breaks it", async () => {
    expect(await intact()).toBe(true);
    await migrator.query("begin");
    try {
      await migrator.query("alter table work_item_event disable trigger work_item_event_append_only");
      await migrator.query(
        `update work_item_event set payload = '{"internal_note": "forged"}' where work_item_id = $1 and type = 'internal_note'
         and payload ->> 'internal_note' = 'submitted note'`,
        [item],
      );
      expect(await intact()).toBe(false);
    } finally {
      await migrator.query("rollback");
    }
    expect(await intact()).toBe(true);
  });
});

// The Form's answers (RP-262, RP-268): written only by the raiser's Participant
// until Submit, pinned to the latest Form Version, and leaving Draft only with answers
// the API checked.
describe("a Draft's answers", () => {
  let item = "";
  const save = (as: string, data: object) => saveAnswers(as, item, data);
  const sendForReview = (as: string, hash: RawBuilder<unknown>) => sendDraftForReview(as, item, hash);
  const stored = async () => (await migrator.query("select data from work_item where id = $1", [item])).rows[0].data;

  beforeAll(async () => {
    await call<{ outcome: string }>(c1.ap, sql`select app.set_project_member_positions(${participant.c1}::uuid, ${c1.member}::uuid, ${["engineer"]}::text[]) as outcome`);
    item = (await createDraft(c1.member, { title: "Answers" })).work_item_id!;
  });

  it("is pinned to the MAR's latest published Form Version", async () => {
    const { rows } = await migrator.query(
      "select form_version_id = app.latest_form_version('MAR') as latest from work_item where id = $1",
      [item],
    );
    expect(rows).toEqual([{ latest: true }]);
  });

  it("refuses a Form Version that isn't the latest when creating", async () => {
    const [row] = await call<{ outcome: string }>(
      c1.member,
      sql`select outcome from app.create_work_item(
        ${projectId}::uuid, 'MAR', 'Old', ${randomUUID()}::uuid, '{}'::jsonb, ${trade.electrical}::uuid, null, now())`,
    );
    expect(row!.outcome).toBe("form_version_not_latest");
  });

  it("are saved by the raiser in Draft", async () => {
    expect(await save(c1.member, { description: "Updated" })).toBe("saved");
    expect(await stored()).toEqual({ description: "Updated" });
  });

  it("can't be saved by anyone who can't see the item", async () => {
    for (const who of [c2.member, k1.member, or.member, c1Narrow]) expect(await save(who, { description: "x" })).toBe("not_found");
    expect(await stored()).toEqual({ description: "Updated" });
  });

  it("can't be updated directly by the app role", async () => {
    await expect(
      withMember(app, c1.member, (trx) => sql`update work_item set data = '{}' where id = ${item}::uuid`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it("leave Draft only with the hash of the answers as they are now", async () => {
    expect(await sendForReview(c1.member, sql`null`)).toBe("form_not_checked");
    expect(await sendForReview(c1.member, sql`sha256('{}'::bytea)`)).toBe("form_not_checked");
    expect(await sendForReview(c1.member, sql`app.answers_sha256(${item}::uuid)`)).toBe("applied");
  });

  // RP-268: open to the raiser until Submit, every change after Draft on the record.
  describe("after Draft", () => {
    let pm = "";
    const diffs = async () =>
      (
        await migrator.query(
          `select id, actor_member_id, actor_participant_id, payload, audience, audience_participant_id, content_sha256
           from work_item_event where work_item_id = $1 and type = 'answers_changed' order by seq`,
          [item],
        )
      ).rows;
    const intact = async () => (await migrator.query("select app.work_item_chain_intact($1) as ok", [item])).rows[0].ok as boolean;

    beforeAll(async () => {
      pm = await member(c1.id, "answers-pm");
      await call<{ outcome: string }>(c1.ap, sql`select app.add_project_member(${participant.c1}::uuid, ${pm}::uuid, now())`);
      for (const kind of ["trade", "location"]) await grant(c1.ap, "member", [participant.c1, pm], kind, "all");
      await call<{ outcome: string }>(c1.ap, sql`select app.set_project_member_positions(${participant.c1}::uuid, ${pm}::uuid, ${["project_manager"]}::text[])`);
      expect(await call<{ outcome: string }>(pm, sql`select app.claim_step(${item}::uuid, now()) as outcome`)).toEqual([{ outcome: "claimed" }]);
    });

    it("are saved by the raiser's Members at its internal Steps, each change a diff internal to the raiser", async () => {
      expect(await diffs()).toEqual([]);
      expect(await save(pm, { description: "Later", model: "CT-300" })).toBe("saved");
      expect(await stored()).toEqual({ description: "Later", model: "CT-300" });
      const [diff, ...more] = await diffs();
      expect(more).toEqual([]);
      expect(diff).toMatchObject({
        actor_member_id: pm,
        actor_participant_id: participant.c1,
        audience: "internal",
        audience_participant_id: participant.c1,
        payload: {
          changes: [
            { field: "description", old: "Updated", new: "Later" },
            { field: "model", old: null, new: "CT-300" },
          ],
        },
      });
      expect(diff.content_sha256).toHaveLength(32);
      // A save that changes nothing records nothing.
      expect(await save(pm, { description: "Later", model: "CT-300" })).toBe("saved");
      expect(await diffs()).toHaveLength(1);
    });

    it("are append-only for the app role, and in the hash chain", async () => {
      const [diff] = await diffs();
      for (const statement of [
        sql`update work_item_event set payload = '{}' where id = ${diff.id}::uuid`,
        sql`delete from work_item_event where id = ${diff.id}::uuid`,
      ]) {
        await expect(withMember(app, c1.member, (trx) => statement.execute(trx))).rejects.toThrow(/permission denied/);
      }
      expect(await intact()).toBe(true);
      await migrator.query("begin");
      try {
        await migrator.query("alter table work_item_event disable trigger work_item_event_append_only");
        await migrator.query(`update work_item_event set payload = '{"changes": []}' where id = $1`, [diff.id]);
        expect(await intact()).toBe(false);
      } finally {
        await migrator.query("rollback");
      }
      expect(await intact()).toBe(true);
    });

    it("keeps recording changes in a Draft it was Returned to", async () => {
      const take = (as: string, transition: string, reason = "") =>
        call<{ outcome: string }>(
          as,
          sql`select app.take_transition(${item}::uuid, ${transition}, ${JSON.stringify(reason ? { reason } : {})}::jsonb, '', app.answers_sha256(${item}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
        ).then((rows) => rows[0]!.outcome);
      expect(await take(pm, "return", "Check the model")).toBe("applied");
      expect(await save(c1.member, { description: "Later", model: "CT-301" })).toBe("saved");
      expect((await diffs()).at(-1)).toMatchObject({
        actor_member_id: c1.member,
        payload: { changes: [{ field: "model", old: "CT-300", new: "CT-301" }] },
      });
      expect(await take(c1.member, "send_for_review")).toBe("applied");
      expect(await call<{ outcome: string }>(pm, sql`select app.claim_step(${item}::uuid, now()) as outcome`)).toEqual([{ outcome: "claimed" }]);
    });

    it("can't be Submitted except with the answers checked", async () => {
      const submit = (hash: RawBuilder<unknown>) =>
        call<{ outcome: string }>(
          pm,
          sql`select app.take_transition(${item}::uuid, 'submit', '{}', '', ${hash}, ${randomUUID()}::uuid, now()) as outcome`,
        ).then((rows) => rows[0]!.outcome);
      expect(await submit(sql`null`)).toBe("form_not_checked");
      expect(await submit(sql`app.answers_sha256(${item}::uuid)`)).toBe("applied");
    });

    it("are read-only for everyone from Submit onwards, and the diffs stay with the raiser (V5)", async () => {
      for (const who of [c1.member, pm, k1.member, or.member]) {
        expect(await save(who, { description: "After Submit" }), who).toBe("not_editable");
      }
      expect(await stored()).toEqual({ description: "Later", model: "CT-301" });
      for (const who of [k1.member, or.member]) {
        const visible = await call<{ type: string }>(who, sql`select type from work_item_event where work_item_id = ${item}::uuid`);
        expect(visible.map((e) => e.type), who).toEqual(["transition"]);
      }
    });
  });
});

// The Built-in Fields (RP-270): Trade, Location and Scopes are answers, kept
// where visibility reads them; the database keeps Trade required, the values in
// the Project and within the writer's own Visibility, and Scopes in the Trade.
describe("a Draft's Built-in Fields", () => {
  let item = "";
  const answers = (as: string) =>
    call<{ answers: Record<string, unknown> | null }>(as, sql`select app.work_item_answers(${item}::uuid) as answers`).then(
      (rows) => rows[0]!.answers,
    );
  const save = (builtIns: BuiltIns, as = c1.member) => saveAnswers(as, item, { description: "Galvanised" }, builtIns);

  beforeAll(async () => {
    item = (await createDraft(c1.member, { title: "Built-ins", scopes: [scope.lighting, scope.indoor] })).work_item_id!;
  });

  it("are among the answers, as ids, for those who see the item", async () => {
    expect(await answers(c1.member)).toEqual({
      description: "Galvanised, 300 mm",
      trade: trade.electrical,
      location: loc.buildingA,
      scopes: [scope.lighting, scope.indoor].sort(),
    });
    for (const who of [c2.member, k1.member, or.member, c1Narrow]) expect(await answers(who), who).toBeNull();
  });

  it("refuses a Draft without a Trade, a Scope of another Trade, or a Sub-scope without its Scope", async () => {
    for (const [input, outcome] of [
      [{ trade: null }, "trade_required"],
      [{ scopes: [scope.hvac] }, "value_not_found"],
      [{ scopes: [scope.indoor] }, "value_not_found"],
      [{ scopes: [loc.buildingA] }, "value_not_found"],
      [{ trade: trade.mechanical, scopes: [] }, "outside_visibility"],
    ] as const) {
      expect((await createDraft(c1.member, input)).outcome, JSON.stringify(input)).toBe(outcome);
    }
  });

  it("are saved with the answers, and replace what was there", async () => {
    expect(await save({ trade: trade.electrical, location: loc.buildingB, scopes: [scope.power] })).toBe("saved");
    expect(await answers(c1.member)).toEqual({
      description: "Galvanised",
      trade: trade.electrical,
      location: loc.buildingB,
      scopes: [scope.power],
    });
    // Now in Building B: the narrow engineer sees it too.
    expect((await answers(c1Narrow))?.location).toBe(loc.buildingB);
  });

  it("refuse a save that would drop the Trade, leave the Trade, or step outside the saver's Visibility", async () => {
    expect(await save({ trade: null, location: loc.buildingB })).toBe("trade_required");
    expect(await save({ trade: trade.electrical, location: loc.buildingB, scopes: [scope.hvac] })).toBe("value_not_found");
    expect(await save({ trade: trade.electrical, location: loc.buildingA, scopes: [] }, c1Narrow)).toBe("outside_visibility");
    expect((await answers(c1.member))?.scopes).toEqual([scope.power]);
  });

  it("keep a deactivated Scope already on the item, but never take it anew", async () => {
    await call<{ outcome: string }>(c1.ap, sql`select app.update_scope(${scope.power}::uuid, null, false, now()) as outcome`);
    try {
      expect(await save({ trade: trade.electrical, location: loc.buildingB, scopes: [scope.power] })).toBe("saved");
      expect((await createDraft(c1.member, { scopes: [scope.power] })).outcome).toBe("value_not_found");
    } finally {
      await call<{ outcome: string }>(c1.ap, sql`select app.update_scope(${scope.power}::uuid, null, true, now()) as outcome`);
    }
  });

  it("can't be written directly by the app role", async () => {
    await expect(
      withMember(app, c1.member, (trx) =>
        sql`insert into work_item_scope (work_item_id, project_id, scope_id) values (${item}::uuid, ${projectId}::uuid, ${scope.lighting}::uuid)`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("are in the hash a Transition out of Draft checks: a Location changed since is refused", async () => {
    await call<{ outcome: string }>(c1.ap, sql`select app.set_project_member_positions(${participant.c1}::uuid, ${c1.member}::uuid, ${["engineer"]}::text[]) as outcome`);
    const [{ hash }] = (await call<{ hash: Buffer }>(c1.member, sql`select app.answers_sha256(${item}::uuid) as hash`)) as [
      { hash: Buffer },
    ];
    expect(await save({ trade: trade.electrical, location: loc.buildingA, scopes: [scope.power] })).toBe("saved");
    expect(await sendDraftForReview(c1.member, item, sql`${hash}::bytea`)).toBe("form_not_checked");
    expect(await sendDraftForReview(c1.member, item, sql`app.answers_sha256(${item}::uuid)`)).toBe("applied");
  });
});
