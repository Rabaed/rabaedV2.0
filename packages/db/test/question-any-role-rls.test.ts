// Seam 2 for Questions asked by any role (RP-1108; decision RP-1004; workflow-engine.md §3.1, §5.1
// "Informed Participants"; visibility.md V1, V3, V5 and scenarios RP-1108-1 to RP-1108-4), as the
// app role. C1 (Contractor) and C2 (another Contractor of the same Trade, Building B only), K1
// (Consultant), O1 (Owner) and R1 (Owner Representative, Building A only). A QSO is held by R1
// where it covers the item, else by O1; the covering Consultant is informed of a Contractor's QSO
// and of the Owner side's QSC; C2 reads none of it.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string; member: string };
type Who = "c1" | "c2" | "k1" | "o1" | "r1";
let co: Record<Who, Company>;
let participant: Record<Who, string>;
let projectId = "";
let electrical = "";
let buildingA = "";
let buildingB = "";
let anchors: Partial<Record<Who, string>> = {}; // Each asker's own Draft, the item its furnished Questions link to.

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
  return { id, cr, ap, member: await member(id, "member") };
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
/** Who holds item `id`'s open Step, as the migrator reads it. */
const holder = async (id: string) =>
  (await migrator.query("select participant_id from step_assignment where work_item_id = $1 and status <> 'done'", [id])).rows.map((r) => r.participant_id as string);
/** The events of item `id` that `as` reads: type, audience and the Transition's key. */
const events = (as: string, id: string) =>
  call<{ type: string; audience: string; transition: string | null }>(
    as,
    sql`select e.type, e.audience, t.label ->> 'en' as transition
        from work_item_event e
        left join app.event_transitions(array(select x.id from work_item_event x where x.work_item_id = ${id}::uuid)) t on t.event_id = e.id
        where e.work_item_id = ${id}::uuid order by e.seq`,
  );
type Rows = Promise<readonly unknown[]>;
/** Each read `who` makes of item `id`: its row, events, Links, Steps, Stage and Documents. */
const itemReads = {
  row: (who: string, id: string): Rows => seen(who, id),
  events: (who: string, id: string): Rows => events(who, id),
  links: (who: string, id: string): Rows => call(who, sql<{ id: string }>`select id from app.work_item_links(${id}::uuid)`),
  steps: (who: string, id: string): Rows => call(who, sql<{ id: string }>`select id from step_assignment where work_item_id = ${id}::uuid`),
  stage: (who: string, id: string): Rows => call(who, sql<{ stage_key: string }>`select stage_key from app.step_as_seen(${id}::uuid)`),
  documents: (who: string, id: string): Rows => call(who, sql<{ id: string }>`select id from document where work_item_id = ${id}::uuid`),
};
type ItemRead = keyof typeof itemReads;
const everyRead = Object.keys(itemReads) as ItemRead[];
/** A Draft's reads: it has no event even its asker reads until the Ask, so that read would prove nothing there. */
const draftReads = everyRead.filter((read) => read !== "events");
/** How a Member is named in a failure. */
const whoIs = (member: string) => (Object.keys(co) as Who[]).find((who) => co[who].member === member) ?? member;

/**
 * Item `id` through each read in `reads` (all of them by default): read first by every one of `seenBy`, then
 * by none of `hiddenFrom` (RP-1095). An item has rows in its Documents and Links only once `furnished`.
 */
async function hiddenIn(id: string, seenBy: Who[], hiddenFrom: Who[], label: string, reads: ItemRead[] = everyRead) {
  for (const read of reads) {
    await expectHiddenFrom({
      read: async (member: string) => (await itemReads[read](member, id)).map(() => ({ id })),
      target: id,
      seenBy: seenBy.map((who) => co[who].member),
      hiddenFrom: hiddenFrom.map((who) => co[who].member),
      name: whoIs,
      label: `${label}, ${read}`,
    });
  }
}

/** The asker's own anchor Draft: a Link only ever names an item its maker sees. */
const anchorOf = (asker: string) => anchors[whoIs(asker) as Who]!;

/** The asker's Draft `id` gets an Attachment and a Link to `to`, as made in the Draft: its Documents and Links have rows. */
async function furnished(asker: string, id: string, to: string): Promise<void> {
  const [started] = await call<{ outcome: string; document_id: string }>(
    asker,
    sql`select outcome, document_id from app.start_document_upload(${id}::uuid, 'sketch.pdf', 10, 'application/pdf', now())`,
  );
  expect(started!.outcome).toBe("started");
  const fingerprint = createHash("sha256").update(`sketch-${id}`, "utf8").digest();
  expect(
    await outcome(asker, sql`select app.confirm_document_upload(${id}::uuid, ${started!.document_id}::uuid, 10, 'application/pdf', ${fingerprint}, now()) as outcome`),
  ).toBe("confirmed");
  const { rows } = await migrator.query(
    `insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
     select f.project_id, f.id, t.id, 'related', f.created_by_member_id, f.created_at from work_item f, work_item t where f.id = $1 and t.id = $2 returning id`,
    [id, to],
  );
  await migrator.query("update work_item_link set arrival = 0 where id = $1", [rows[0].id]);
}

/** `asker`'s Draft of `type`, furnished with an Attachment and a Link, then asked. */
async function askedFurnished(asker: string, type: string, title: string, location = buildingA): Promise<string> {
  const id = await drafted(asker, type, title, location);
  await furnished(asker, id, anchorOf(asker));
  expect(await take(asker, id, "ask")).toBe("applied");
  return id;
}

/** `asker`'s Draft Question of `type` on Electrical, at `location` (Building A unless named). */
async function drafted(asker: string, type: string, title: string, location = buildingA): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    asker,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify({ question: title })}::jsonb,
      ${electrical}::uuid, ${location}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

async function asked(asker: string, type: string, title: string, location = buildingA): Promise<string> {
  const id = await drafted(asker, type, title, location);
  expect(await take(asker, id, "ask")).toBe("applied");
  return id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  co = {
    c1: await company(engineer, "C1"),
    c2: await company(engineer, "C2"),
    k1: await company(engineer, "K1"),
    o1: await company(engineer, "O1"),
    r1: await company(engineer, "R1"),
  };
  const [created] = await call<{ project_id: string }>(
    co.c1.ap,
    sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'QAR', 'contractor')`,
  );
  projectId = created!.project_id;
  const joined = (who: Who, role: string) => joinProject(app, projectId, { adminId: co.c1.ap, crNumber: co[who].cr, role }, co[who].ap);
  participant = {
    c1: (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string,
    c2: await joined("c2", "contractor"),
    k1: await joined("k1", "consultant"),
    o1: await joined("o1", "owner"),
    r1: await joined("r1", "owner_representative"),
  };
  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        co.c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  buildingB = await value("location", "BB");
  const onlyLocation: Partial<Record<Who, string>> = { c2: buildingB, r1: buildingA };
  for (const who of Object.keys(participant) as Who[]) {
    for (const kind of ["trade", "location"]) {
      const limited = kind === "location" ? onlyLocation[who] : undefined;
      expect(
        await outcome(
          co.c1.ap,
          sql`select app.set_participant_visibility(${participant[who]}::uuid, ${kind}, ${!limited}, ${limited ? [limited] : []}::uuid[], now()) as outcome`,
        ),
      ).toBe("set");
    }
  }
  const positions: Record<Who, string[]> = { c1: ["engineer"], c2: ["engineer"], k1: ["engineer"], o1: ["project_manager"], r1: ["engineer"] };
  for (const who of Object.keys(participant) as Who[]) {
    const { ap, member: m } = co[who];
    const p = participant[who];
    await call(ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${m}::uuid, now())`);
    for (const kind of ["trade", "location"]) {
      expect(await outcome(ap, sql`select app.set_member_visibility(${p}::uuid, ${m}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
    expect(await outcome(ap, sql`select app.set_project_member_positions(${p}::uuid, ${m}::uuid, ${positions[who]}::text[]) as outcome`)).toBe("set");
  }
  // Each asker's own Draft, of a Type it may start, for its furnished Questions' Links.
  anchors = {
    c1: await drafted(co.c1.member, "QSN", "C1's anchor"),
    k1: await drafted(co.k1.member, "QSC", "K1's anchor"),
    o1: await drafted(co.o1.member, "QSN", "O1's anchor"),
    r1: await drafted(co.r1.member, "QSN", "R1's anchor"),
  };
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("who may start which Question (seam 2)", () => {
  /** Whether `who` may start a Draft of `type`, as app.create_work_item judges it. */
  async function starts(who: Who, type: string): Promise<boolean> {
    try {
      await drafted(co[who].member, type, `${who} ${type}`);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "42501") return false;
      throw error;
    }
  }

  it("each role starts the Questions that ask another role, never its own; the Owner side no Snag or Site Observation", async () => {
    const matrix: Record<string, Record<Who, boolean>> = {};
    for (const type of ["QSN", "QSC", "QSO", "SNG", "OBS"]) {
      matrix[type] = { c1: false, c2: false, k1: false, o1: false, r1: false };
      for (const who of ["c1", "k1", "o1", "r1"] as const) matrix[type][who] = await starts(who, type);
    }
    expect(matrix).toEqual({
      QSN: { c1: true, c2: false, k1: false, o1: true, r1: true },
      QSC: { c1: false, c2: false, k1: true, o1: true, r1: true },
      QSO: { c1: true, c2: false, k1: true, o1: false, r1: false },
      SNG: { c1: true, c2: false, k1: true, o1: false, r1: false },
      OBS: { c1: true, c2: false, k1: true, o1: false, r1: false },
    });
  });
});

describe("a Contractor's Question to Owner (scenario RP-1108-1)", () => {
  it("RP-1108-1: lands with R1, read by O1 and by K1 (informed, shared Transitions only); C2 reads nothing at any Step", async () => {
    const id = await drafted(co.c1.member, "QSO", "Which façade colour");
    await furnished(co.c1.member, id, anchorOf(co.c1.member));
    await hiddenIn(id, ["c1"], ["c2", "k1", "o1", "r1"], "draft", draftReads);
    expect(await take(co.c1.member, id, "ask")).toBe("applied");
    expect(await holder(id)).toEqual([participant.r1]);
    for (const who of ["k1", "o1", "r1"] as const) expect(await seen(co[who].member, id), who).toEqual([id]);
    await hiddenIn(id, ["c1", "r1"], ["c2"], "open");
    // K1 holds nothing: its try is refused as any non-holder's.
    expect(await take(co.k1.member, id, "answer", { answer: "Grey" })).toBe("not_holder");

    expect(await take(co.r1.member, id, "answer", { answer: "RAL 7016" })).toBe("applied");
    expect(await pickUp(co.c1.member, id)).toBe("picked_up");
    expect(await take(co.c1.member, id, "close")).toBe("applied");
    await hiddenIn(id, ["c1", "r1"], ["c2"], "closed");
    const access = await migrator.query("select participant_id, reason from work_item_access where work_item_id = $1 order by reason", [id]);
    expect(access.rows.find((r) => r.participant_id === participant.k1)?.reason).toBe("informed");
    expect((await events(co.k1.member, id)).map((e) => [e.type, e.audience, e.transition])).toEqual([
      ["transition", "shared", "Ask"],
      ["transition", "shared", "Answer"],
      ["transition", "shared", "Close"],
    ]);
  });

  it("with no Owner Representative covering it (Building B), lands with the Owner", async () => {
    const id = await askedFurnished(co.c1.member, "QSO", "Which paving", buildingB);
    expect(await holder(id)).toEqual([participant.o1]);
    // R1 covers Building A only: it reads none of it; C1 and O1, holding it, do.
    await hiddenIn(id, ["c1", "o1"], ["r1"], "Building B");
    expect(await take(co.o1.member, id, "answer", { answer: "Interlock" })).toBe("applied");
  });
});

describe("the Owner side asks (scenarios RP-1108-2 to RP-1108-4)", () => {
  it("RP-1108-2: O1's QSC to C1 is read by C1, R1 and K1 (informed); C2 reads nothing", async () => {
    const id = await askedFurnished(co.o1.member, "QSC", "When is the slab poured");
    expect(await holder(id)).toEqual([participant.c1]);
    for (const who of ["c1", "k1", "r1"] as const) expect(await seen(co[who].member, id), who).toEqual([id]);
    await hiddenIn(id, ["o1", "c1"], ["c2"], "open");
    expect(await pickUp(co.c1.member, id)).toBe("picked_up");
    expect(await take(co.c1.member, id, "answer", { answer: "Sunday" })).toBe("applied");
    expect(await take(co.o1.member, id, "close")).toBe("applied");
    await hiddenIn(id, ["o1", "c1"], ["c2"], "closed");
  });

  it("RP-1108-3: K1's QSO and O1's QSN are read by no Contractor, and inform nobody", async () => {
    const toOwner = await askedFurnished(co.k1.member, "QSO", "Is the alternate tile accepted");
    const toConsultant = await askedFurnished(co.o1.member, "QSN", "Has the mock-up been approved");
    for (const [id, asker, asked] of [
      [toOwner, "k1", "r1"],
      [toConsultant, "o1", "k1"],
    ] as const) {
      await hiddenIn(id, [asker, asked], ["c1", "c2"], `${asker}'s`);
      const informed = await migrator.query("select 1 from work_item_access where work_item_id = $1 and reason = 'informed'", [id]);
      expect(informed.rowCount).toBe(0);
    }
    expect(await holder(toOwner)).toEqual([participant.r1]);
    expect(await holder(toConsultant)).toEqual([participant.k1]);
  });

  it("RP-1108-4: R1's Draft is R1's alone until the Ask", async () => {
    const id = await drafted(co.r1.member, "QSN", "Which sample is the reference");
    await furnished(co.r1.member, id, anchorOf(co.r1.member));
    await hiddenIn(id, ["r1"], ["c1", "c2", "k1", "o1"], "draft", draftReads);
    expect(await take(co.r1.member, id, "ask")).toBe("applied");
    expect(await seen(co.k1.member, id)).toEqual([id]);
    await hiddenIn(id, ["r1", "k1"], ["c1", "c2"], "open");
  });
});

describe("the Snag List's one Questions chip (RP-1109, scenario RP-1109-1)", () => {
  /** The Questions `as` reads on the Project, by id: the rows the chip's filter lists. */
  const questionIds = async (as: string) =>
    (
      await call<{ id: string }>(
        as,
        sql`select w.id from work_item w join work_item_type t on t.id = w.work_item_type_id
            where w.project_id = ${projectId}::uuid and t.code in ('QSN', 'QSC', 'QSO') order by w.id`,
      )
    ).map((r) => r.id);
  /** The chip's number: the Question Types' counts `as` reads, added up as the chip does. */
  const chip = async (as: string) =>
    (
      await call<{ code: string; n: number }>(
        as,
        sql`select t.code, count(*)::int as n from work_item w join work_item_type t on t.id = w.work_item_type_id
            where w.project_id = ${projectId}::uuid and t.code in ('QSN', 'QSC', 'QSO') group by t.code`,
      )
    ).reduce((sum, c) => sum + c.n, 0);

  it("RP-1109-1: C2's chip counts its own Question only; C1's and K1's count what they read, never C2's", async () => {
    const c1Qso = await asked(co.c1.member, "QSO", "Which façade lighting colour");
    const k1Qsc = await asked(co.k1.member, "QSC", "Confirm cable tray route");
    const c2Qsn = await asked(co.c2.member, "QSN", "Clarify socket height", buildingB);
    // C2 reads its own Question and none of the Project's others (V3): an exact set, by id.
    expect(await questionIds(co.c2.member)).toEqual([c2Qsn]);
    expect(await chip(co.c2.member)).toBe(1);
    const c1 = await questionIds(co.c1.member);
    expect(c1).toEqual(expect.arrayContaining([c1Qso, k1Qsc]));
    const questions = async (member: string) => (await questionIds(member)).map((id) => ({ id }));
    await expectHiddenFrom({ read: questions, target: c2Qsn, seenBy: [co.c2.member, co.k1.member], hiddenFrom: co.c1.member, name: whoIs });
    expect(await chip(co.c1.member)).toBe(c1.length);
    const k1 = await questionIds(co.k1.member);
    expect(k1).toEqual(expect.arrayContaining([c1Qso, k1Qsc, c2Qsn]));
    expect(await chip(co.k1.member)).toBe(k1.length);
  });
});
