// Seam 2 for who holds an item at the Owner's review (ADR 0022; visibility.md V14, "With Owner review";
// scenario RP-598-1; RP-1138), as the app role. A new Project's DAR runs the Rabaed Default
// "1→1 → Owner review" (the seam suites' global setup publishes it). While OW's PM holds the review,
// the review's holder and the Consultant whose Recommendation brought it there read OW as the holder;
// C1 reads "Owner review" and no holder at all: not in the List row, app.work_item_holder or
// app.work_item_companies. Seam 1: apps/api/test/owner-review.test.ts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { expectHiddenFrom, joinProject, testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who.toLowerCase()}-${randomUUID().slice(0, 8)}@rabaed.test`;
const TYPE = "DAR";
/** OW's name, its own, so any read that names OW shows. */
const OW_NAME = `Waha Owner Holding ${randomUUID().slice(0, 8)}`;
/** What everyone but the review's holder and the recommending Consultant reads in place of the holder. */
const OWNER_REVIEW = { en: "Owner review", ar: "مراجعة المالك" };

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string };
let c1: Company; // Contractor, the Project's Host
let k1: Company; // Consultant
let ow: Company; // Owner
const people = { c1Engineer: "", c1Pm: "", k1Pm: "", owPm: "" };
const participant = { c1: "", k1: "", ow: "" };
let projectId = "";
let electrical = "";
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
  return { id, cr, ap };
}

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));
/** Whatever rows a read gives, untyped. */
const rows = (as: string, query: ReturnType<typeof sql<Record<string, unknown>>>) => call(as, query);
const outcome = (as: string, query: ReturnType<typeof sql<{ outcome: string }>>) => call(as, query).then((rows) => rows[0]!.outcome);

const take = (as: string, id: string, transition: string, answers: Record<string, unknown> = {}) =>
  outcome(
    as,
    sql`select app.take_transition(
      ${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, 'A note', app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now()) as outcome`,
  );
const pickUp = (as: string, id: string) => outcome(as, sql`select app.pick_up_step(${id}::uuid, now()) as outcome`);
const takeable = async (as: string, id: string) =>
  (await call<{ key: string }>(as, sql`select transition_key as key from app.work_item_actions(${id}::uuid) where action = 'transition'`)).map((r) => r.key).sort();

/** The item's row (RLS), its history and its Comments, as `as` reads them. */
async function asRead(as: string, id: string) {
  return {
    item: (await call<{ outcome: string | null; closed: boolean }>(as, sql`select outcome, closed_at is not null as closed from work_item where id = ${id}::uuid`))[0],
    events: await call<{ type: string; payload: Record<string, unknown> }>(as, sql`select type, payload from work_item_event where work_item_id = ${id}::uuid order by seq`),
    history: await call<{ seq: number; type: string; recommended_code: string | null; outcome: string | null }>(
      as,
      sql`select seq, type, recommended_code, outcome from app.work_item_history(${id}::uuid)`,
    ),
    comments: (await call<{ open: number; closed: number }>(as, sql`select open_count as open, closed_count as closed from app.work_item_comment_counts(${id}::uuid)`))[0],
  };
}

/** The item's List row as app.work_items_seen gives it to `as` (the List, its search and the Kanban read it). */
const seenRow = async (as: string, id: string) =>
  (
    await call<{ id: string; outcome: string | null; owner_review: unknown; holder_participant_id: string | null; holder_member_id: string | null; holder_company_name: unknown; step_id: string }>(
      as,
      sql`select id, outcome, owner_review, holder_participant_id, holder_member_id, holder_company_name, step_id
          from app.work_items_seen(${projectId}::uuid, '{submittals}'::text[], false, array[${id}::uuid])`,
    )
  ).filter((r) => r.id === id);

/** Codes A to D anywhere in what `as` reads of the item: an event's payload value, its history, its outcome, its List row. */
const codesRead = async (as: string, id: string) => {
  const read = await asRead(as, id);
  const found = new Set<string>();
  for (const e of read.events) for (const v of Object.values(e.payload)) if (typeof v === "string" && /^[A-D]$/.test(v)) found.add(v);
  for (const e of read.history) for (const v of [e.recommended_code, e.outcome]) if (v !== null) found.add(v);
  if (read.item?.outcome) found.add(read.item.outcome);
  for (const r of await seenRow(as, id)) if (r.outcome) found.add(r.outcome);
  return [...found].sort().map((code) => ({ id: code }));
};

/** Everything `as` reads of the item, as one string, so a read that names OW shows. */
const everything = async (as: string, id: string) =>
  JSON.stringify({
    read: await asRead(as, id),
    row: await seenRow(as, id),
    holder: await rows(as, sql`select * from app.work_item_holder(${id}::uuid)`),
    companies: await rows(as, sql`select * from app.work_item_companies(${id}::uuid)`),
    step: await rows(as, sql`select * from app.step_as_seen(${id}::uuid)`),
    map: await rows(as, sql`select * from app.work_item_workflow(${id}::uuid)`),
  });

/** A DAR raised by C1's engineer, sent, and Submitted by C1's PM: at K1's PM. */
async function atConsultant(title: string): Promise<string> {
  const [created] = await call<{ outcome: string; work_item_id: string }>(
    people.c1Engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}),
      ${JSON.stringify({ document_type: "calculation", document_title: title })}::jsonb,
      ${electrical}::uuid, ${buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  const id = created!.work_item_id;
  expect(await take(people.c1Engineer, id, "send_for_review")).toBe("applied");
  expect(await takeable(people.c1Pm, id)).toEqual(["cancel_review", "submit"]);
  expect(await take(people.c1Pm, id, "submit", { cover_note: "Calculation for Level 2" })).toBe("applied");
  return id;
}

const reply = { sample_checked: true, matches_specification: true };

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  [c1, k1, ow] = [await company(engineer, "C1"), await company(engineer, "K1"), await company(engineer, OW_NAME)];

  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TOH', 'contractor')`);
  projectId = created!.project_id;
  participant.c1 = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  participant.k1 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
  participant.ow = await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap);

  const value = async (kind: string, code: string) =>
    (
      await call<{ value_id: string }>(
        c1.ap,
        sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify({ en: code, ar: code })}::jsonb)`,
      )
    )[0]!.value_id;
  electrical = await value("trade", "EL");
  buildingA = await value("location", "BA");
  for (const p of [participant.c1, participant.k1, participant.ow]) {
    for (const kind of ["location", "trade"]) {
      expect(await outcome(c1.ap, sql`select app.set_participant_visibility(${p}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
    }
  }
  const staff: [Company, string, keyof typeof people, string[]][] = [
    [c1, participant.c1, "c1Engineer", ["engineer"]],
    [c1, participant.c1, "c1Pm", ["project_manager"]],
    [k1, participant.k1, "k1Pm", ["manager"]],
    [ow, participant.ow, "owPm", ["project_manager"]],
  ];
  for (const [co, p, who, positions] of staff) {
    people[who] = await member(co.id, who);
    await call(co.ap, sql<{ outcome: string }>`select app.add_project_member(${p}::uuid, ${people[who]}::uuid, now())`);
    for (const kind of ["location", "trade"]) {
      expect(
        await outcome(co.ap, sql`select app.set_member_visibility(${p}::uuid, ${people[who]}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`),
      ).toBe("set");
    }
    expect(await outcome(co.ap, sql`select app.set_project_member_positions(${p}::uuid, ${people[who]}::uuid, ${positions}::text[]) as outcome`)).toBe("set");
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-598-1: K1's PM recommends Code A to OW, whose PM holds the Owner's review", () => {
  it("C1 reads it with \"Owner review\", never OW nor a Code; K1 and OW read OW as the holder; confirmed, it is with nobody", async () => {
    const title = "Lighting control calculation";
    const id = await atConsultant(title);
    expect(await take(people.k1Pm, id, "recommend_a", reply)).toBe("applied");

    // The label in place of the holder: C1 reads it, OW (which holds it) and K1 (which recommended) don't.
    for (const by of [people.c1Pm, people.c1Engineer]) {
      expect(await rows(by, sql`select app.with_owner_review(${id}::uuid) as label`), by).toEqual([{ label: OWNER_REVIEW }]);
      expect((await seenRow(by, id)).map((r) => r.owner_review), by).toEqual([OWNER_REVIEW]);
    }
    for (const by of [people.k1Pm, people.owPm]) {
      expect(await rows(by, sql`select app.with_owner_review(${id}::uuid) as label`), by).toEqual([{ label: null }]);
      expect((await seenRow(by, id)).map((r) => r.owner_review), by).toEqual([null]);
    }

    // The holder, OW's Participant: in the List row (what the List, its search, the Kanban card and lane, and
    // the "With" filter's Companies read), app.work_item_holder (the item's "With" and its map) and
    // app.work_item_companies (the Kanban's search on the card's owner). K1 and OW read it; C1 doesn't.
    const viewers = { seenBy: [people.k1Pm, people.owPm], hiddenFrom: [people.c1Pm, people.c1Engineer], target: participant.ow };
    await expectHiddenFrom({
      ...viewers,
      label: "List row's holder",
      read: async (as: string) => (await seenRow(as, id)).flatMap((r) => (r.holder_participant_id === null ? [] : [{ id: r.holder_participant_id }])),
    });
    await expectHiddenFrom({
      ...viewers,
      label: "app.work_item_holder",
      read: (as: string) => call<{ id: string }>(as, sql`select participant_id as id from app.work_item_holder(${id}::uuid)`),
    });
    await expectHiddenFrom({
      ...viewers,
      label: "app.work_item_companies",
      read: (as: string) => call<{ id: string }>(as, sql`select participant_id as id from app.work_item_companies(${id}::uuid)`),
    });
    // Nothing C1 reads of the item names OW, by its name, its Company or its Participant.
    for (const by of [people.k1Pm, people.owPm]) expect((await everything(by, id)).includes(OW_NAME), by).toBe(true);
    for (const by of [people.c1Pm, people.c1Engineer]) {
      const read = await everything(by, id);
      expect([read.includes(OW_NAME), read.includes(ow.id), read.includes(participant.ow)], by).toEqual([false, false, false]);
    }
    // A search by OW's name finds nothing of it; one by its Subject does.
    const search = (as: string, q: string) => call<{ id: string }>(as, sql`select app.search_work_items(${projectId}::uuid, ${q}) as id`);
    for (const by of [people.c1Pm, people.c1Engineer]) {
      expect((await search(by, title)).some((r) => r.id === id), by).toBe(true);
      expect((await search(by, OW_NAME)).some((r) => r.id === id), by).toBe(false);
    }
    // And no Code anywhere for C1, while K1 and OW read the Recommended A.
    await expectHiddenFrom({ label: "Code", read: (as: string) => codesRead(as, id), target: "A", seenBy: [people.k1Pm, people.owPm], hiddenFrom: [people.c1Pm, people.c1Engineer] });

    // Confirmed: closed at A, and with nobody.
    if ((await takeable(people.owPm, id)).length === 0) expect(await pickUp(people.owPm, id)).toBe("picked_up");
    expect(await take(people.owPm, id, "confirm_a")).toBe("applied");
    for (const by of [people.c1Pm, people.k1Pm, people.owPm]) {
      expect(await seenRow(by, id), by).toEqual([
        expect.objectContaining({ id, outcome: "A", owner_review: null, holder_participant_id: null, holder_member_id: null, holder_company_name: null }),
      ]);
      expect(await rows(by, sql`select participant_id from app.work_item_holder(${id}::uuid)`), by).toEqual([]); // not hidden-from: a closed item has no holder for anyone
    }
  });

});

describe("scenario RP-1138-1: OW's PM Sends the item Back to K1's PM from the Owner's review", () => {
  it("C1 reads K1 as the holder and still nothing of OW; K1 and OW read OW among the item's Companies", async () => {
    const id = await atConsultant("Earthing calculation");
    expect(await take(people.k1Pm, id, "recommend_a", reply)).toBe("applied");
    if ((await takeable(people.owPm, id)).length === 0) expect(await pickUp(people.owPm, id)).toBe("picked_up");
    expect(await take(people.owPm, id, "owner_send_back", { reason: "Check the cable sizes" })).toBe("applied");

    // Back with K1: everyone reads K1 as the holder, and C1 reads no label.
    for (const by of [people.c1Pm, people.c1Engineer, people.k1Pm, people.owPm]) {
      expect((await seenRow(by, id)).map((r) => [r.owner_review, r.holder_participant_id]), by).toEqual([[null, participant.k1]]);
    }
    // The review's finished assignment names OW to OW and K1 only.
    await expectHiddenFrom({
      label: "app.work_item_companies after the Send Back",
      read: (as: string) => call<{ id: string }>(as, sql`select participant_id as id from app.work_item_companies(${id}::uuid)`),
      target: participant.ow,
      seenBy: [people.k1Pm, people.owPm],
      hiddenFrom: [people.c1Pm, people.c1Engineer],
    });
    for (const by of [people.c1Pm, people.c1Engineer]) {
      const read = await everything(by, id);
      expect([read.includes(OW_NAME), read.includes(ow.id), read.includes(participant.ow)], by).toEqual([false, false, false]);
    }
  });
});
