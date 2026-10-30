// Seam 2 for the eight Rabaed Default submittal Workflows (RP-596, spec RP-598; ADR 0022;
// workflow-engine.md §1 "Rabaed Defaults" and §5.3a; visibility.md V5, V14, V20 and scenarios
// RP-596-1 and RP-596-2), as the app role. The seam suites' global setup runs the demo seed, which
// publishes them, so a new Project's DAR runs the Rabaed Default "1→1 → Owner review" itself (not a
// test Workflow, as owner-review-rls.test.ts does): K1's Recommended Code is read by K1 and the
// Owner only until the Owner confirms it. The eight are Rabaed's own data, read alike by every
// Member of any Project; what a Project binds or duplicates reaches that Project only.
// RP-598's "With Owner review" scenario, that nothing names the Owner holding the review, is tested
// at this seam in owner-review-holder-rls.test.ts (RP-1138).
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
/** The eight, by their keys within the Type (RP-596). */
const DEFAULT_KEYS = ["1-1", "1-1-owner", "1-2", "1-2-owner", "2-1", "2-1-owner", "2-2", "2-2-owner"];
/** OW's legal name, new on every run. */
const OW_NAME = `Waha Owner Holding ${randomUUID().slice(0, 8)}`;
/** How a failure names Member `as`. */
const whoIs = (as: string) =>
  ({ [people.c1Engineer]: "C1 engineer", [people.c1Pm]: "C1 PM", [people.k1Pm]: "K1 PM", [people.owPm]: "OW PM", [c1.ap]: "C1 (Tower's Admin)", [xc.ap]: "XC (another Project's Admin)" })[as] ?? as;

let migrator: pg.Client;
let app: Db;

type Company = { id: string; cr: string; ap: string };
let c1: Company; // Contractor, the Project's Host
let k1: Company; // Consultant
let ow: Company; // Owner
let xc: Company; // Another Company, Host of an unrelated Project
const people = { c1Engineer: "", c1Pm: "", k1Pm: "", owPm: "" };
const participant = { c1: "", k1: "", ow: "" };
let projectId = "";
let otherProjectId = "";
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

/** The Rabaed Default submittal Workflows of the DAR Type, as `as` reads them (RLS), with their latest published Version. */
const darDefaults = (as: string) =>
  call<{ id: string; name: unknown; default_key: string | null; project_id: string | null; company_id: string | null; version_no: number | null }>(
    as,
    sql`select d.id, d.name, d.default_key, d.project_id, d.company_id,
          (select max(v.version_no) from workflow_version v where v.workflow_definition_id = d.id and v.status = 'published') as version_no
        from workflow_definition d
        join work_item_type t on t.id = d.work_item_type_id and t.project_id is null and t.code = ${TYPE}
        where d.owner_kind = 'rabaed'
        order by d.default_key`,
  );
/** The Workflow the Rabaed DAR Type runs, as `as` reads it. */
const darRuns = async (as: string) =>
  (await call<{ id: string }>(as, sql`select workflow_definition_id as id from work_item_type where project_id is null and code = ${TYPE}`))[0]!.id;

const reply = { sample_checked: true, matches_specification: true };
const comments = { items_to_create: [{ comment: "Seal the cable entries" }, { comment: "Label the circuits" }] };

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [email("eng")]);
  [c1, k1, ow, xc] = [await company(engineer, "C1"), await company(engineer, "K1"), await company(engineer, OW_NAME), await company(engineer, "XC")];

  const [created] = await call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project('{"en": "Tower", "ar": "برج"}'::jsonb, 'TSD', 'contractor')`);
  projectId = created!.project_id;
  participant.c1 = (await migrator.query("select id from participant where project_id = $1", [projectId])).rows[0].id as string;
  participant.k1 = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
  participant.ow = await joinProject(app, projectId, { adminId: c1.ap, crNumber: ow.cr, role: "owner" }, ow.ap);
  const [other] = await call<{ project_id: string }>(xc.ap, sql`select project_id from app.create_project('{"en": "Villa", "ar": "فيلا"}'::jsonb, 'VSD', 'contractor')`);
  otherProjectId = other!.project_id;

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

describe("scenario RP-596-1: a new Project's DAR runs the Rabaed Default 1→1 → Owner review; K1 recommends B, OW confirms it", () => {
  it("the eight are Rabaed's own, carrying no Company's; the DAR runs 1→1 → Owner review itself", async () => {
    const { rows } = await migrator.query(
      `select d.id, d.default_key, d.project_id, d.company_id from workflow_definition d
       join work_item_type t on t.id = d.work_item_type_id and t.project_id is null and t.code = $1
       where d.owner_kind = 'rabaed' order by d.default_key`,
      [TYPE],
    );
    expect(rows.map((r) => [r.default_key, r.project_id, r.company_id])).toEqual(DEFAULT_KEYS.map((key) => [key, null, null]));
    const running = (await migrator.query("select workflow_definition_id as id from work_item_type where project_id is null and code = $1", [TYPE])).rows[0].id;
    expect(rows.find((r) => r.id === running)?.default_key).toBe("1-1-owner");
    // Tower binds no Workflow for it: its DAR runs the Type's own, the Rabaed Default.
    const { rows: bound } = await migrator.query(
      "select b.id from workflow_binding b join work_item_type t on t.id = b.work_item_type_id and t.code = $2 where b.project_id = $1",
      [projectId, TYPE],
    );
    expect(bound).toEqual([]); // not hidden-from: the migrator reads every binding; none was made for Tower's DAR
  });

  it("OW's PM holds the Owner's Step; the Code is read by K1 and OW only until OW confirms it; it then closes at B for everyone, with its Comments", async () => {
    const id = await atConsultant("Cable sizing calculation");
    // The item's map: the Rabaed Default 1→1 → Owner review at its Version, as C1 reads it.
    const { rows: defaultRow } = await migrator.query(
      `select d.name, (select max(v.version_no) from workflow_version v where v.workflow_definition_id = d.id and v.status = 'published') as version_no
       from workflow_definition d join work_item_type t on t.id = d.work_item_type_id and t.project_id is null and t.code = $1
       where d.owner_kind = 'rabaed' and d.default_key = '1-1-owner'`,
      [TYPE],
    );
    expect(await rows(people.c1Pm, sql`select name, version_no from app.work_item_workflow(${id}::uuid)`)).toEqual(defaultRow);
    expect(await takeable(people.k1Pm, id)).toEqual(["recommend_a", "recommend_b", "recommend_c", "recommend_d"]);

    expect(await take(people.k1Pm, id, "recommend_b", { ...reply, remarks: "B, with two comments", ...comments })).toBe("applied");

    // The Recommended Code and every Code: K1 and OW read B, C1 reads none.
    const recommended = async (as: string) =>
      (await asRead(as, id)).history.filter((e) => e.type === "recommend_code").map((e) => ({ id: `${e.type}:${e.recommended_code}` }));
    await expectHiddenFrom({ name: whoIs, label: "Recommended Code", read: recommended, target: "recommend_code:B", seenBy: [people.k1Pm, people.owPm], hiddenFrom: [people.c1Pm, people.c1Engineer] });
    await expectHiddenFrom({ name: whoIs, label: "Code", read: (as: string) => codesRead(as, id), target: "B", seenBy: [people.k1Pm, people.owPm], hiddenFrom: [people.c1Pm, people.c1Engineer] });
    expect((await asRead(people.c1Pm, id)).item).toEqual({ outcome: null, closed: false });
    // C1 reads "Owner review" in place of the holder; K1, which recommended, and OW, which holds it, read the holder.
    // (That no other read names OW as the holder: owner-review-holder-rls.test.ts, RP-1138.)
    const ownerReview = (as: string) => rows(as, sql`select app.with_owner_review(${id}::uuid) as label`);
    for (const by of [people.c1Pm, people.c1Engineer]) expect(await ownerReview(by), whoIs(by)).toEqual([{ label: { en: "Owner review", ar: "مراجعة المالك" } }]);
    for (const by of [people.k1Pm, people.owPm]) expect(await ownerReview(by), whoIs(by)).toEqual([{ label: null }]);

    // OW's PM, the Owner's only approver, holds the Owner's Step, offered only the Confirm and its Send Back.
    const { rows: holding } = await migrator.query(
      "select participant_id, status from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up', 'vacant')",
      [id],
    );
    expect(holding.map((r) => r.participant_id)).toEqual([participant.ow]);
    if (holding[0].status !== "picked_up") expect(await pickUp(people.owPm, id)).toBe("picked_up");
    const { rows: holder } = await migrator.query(
      "select participant_id, assignee_member_id from step_assignment where work_item_id = $1 and status = 'picked_up'",
      [id],
    );
    expect(holder).toEqual([{ participant_id: participant.ow, assignee_member_id: people.owPm }]);
    expect(await takeable(people.owPm, id)).toEqual(["confirm_b", "owner_send_back"]);

    expect(await take(people.owPm, id, "confirm_b")).toBe("applied");
    for (const by of [people.c1Pm, people.c1Engineer, people.k1Pm, people.owPm]) {
      expect((await asRead(by, id)).item, by).toEqual({ outcome: "B", closed: true });
    }
    const c1After = await asRead(people.c1Pm, id);
    expect(c1After.history.at(-1)).toMatchObject({ type: "issue_code", outcome: "B" });
    // C1 still reads no Recommendation: the issued Code only.
    await expectHiddenFrom({ name: whoIs, label: "Recommended Code, after", read: recommended, target: "recommend_code:B", seenBy: [people.k1Pm, people.owPm], hiddenFrom: [people.c1Pm] });
    // Its Comments, one per row of K1's Recommendation, raised by K1, held by C1's Step Pool and read by C1.
    expect(c1After.comments).toEqual({ open: 2, closed: 0 });
    const { rows: raised } = await migrator.query(
      `select p.company_id, a.participant_id as holder, c.title from work_item_link l
       join work_item c on c.id = l.from_id
       join participant p on p.id = c.raised_by_participant_id
       join step_assignment a on a.work_item_id = c.id and a.status in ('pooled', 'picked_up')
       where l.to_id = $1 and l.kind = 'raised_from' order by c.title`,
      [id],
    );
    expect(raised).toEqual([
      { company_id: k1.id, holder: participant.c1, title: "Label the circuits" },
      { company_id: k1.id, holder: participant.c1, title: "Seal the cable entries" },
    ]);
  });
});

describe("scenario RP-596-2: every Member of any Project reads the eight Rabaed Defaults of a submittal Type alike", () => {
  it("C1's engineer and a Project Admin of an unrelated Project read the same eight, their names and Versions, the running one marked; none names a Project or Company", async () => {
    const { rows: all } = await migrator.query(
      `select d.id, d.name, d.default_key, d.project_id, d.company_id,
         (select max(v.version_no) from workflow_version v where v.workflow_definition_id = d.id and v.status = 'published') as version_no
       from workflow_definition d join work_item_type t on t.id = d.work_item_type_id and t.project_id is null and t.code = $1
       where d.owner_kind = 'rabaed' order by d.default_key`,
      [TYPE],
    );
    expect(all.map((d) => [d.default_key, d.project_id, d.company_id, d.version_no !== null])).toEqual(DEFAULT_KEYS.map((key) => [key, null, null, true]));
    const running = (await migrator.query("select workflow_definition_id as id from work_item_type where project_id is null and code = $1", [TYPE])).rows[0].id;
    for (const by of [people.c1Engineer, xc.ap]) {
      expect(await darDefaults(by), by).toEqual(all);
      expect(await darRuns(by), by).toBe(running);
    }
    // The unrelated Project Admin reads them as a Member of its own Project, which has no part in Tower.
    const { rows: xcOnTower } = await migrator.query(
      "select p.id from participant p where p.project_id = $1 and p.company_id = $2",
      [projectId, xc.id],
    );
    expect(xcOnTower).toEqual([]); // not hidden-from: the migrator's read that XC is no Participant of Tower
    expect((await call<{ id: string }>(xc.ap, sql`select id from project where id = ${otherProjectId}::uuid`)).map((p) => p.id)).toEqual([otherProjectId]);
  });

  it("what Tower binds or duplicates of them reaches Tower only", async () => {
    const byKey = new Map((await darDefaults(c1.ap)).map((d) => [d.default_key, d.id]));
    const darType = (await migrator.query("select id from work_item_type where project_id is null and code = $1", [TYPE])).rows[0].id as string;
    // Bound for C1's own raises only.
    expect(await outcome(c1.ap, sql`select app.bind_workflow(${projectId}::uuid, ${darType}::uuid, ${participant.c1}::uuid, ${byKey.get("1-1")!}::uuid, now()) as outcome`)).toBe("bound");
    const [copied] = await call<{ outcome: string; workflow_definition_id: string }>(
      c1.ap,
      sql`select outcome, workflow_definition_id from app.duplicate_workflow(${byKey.get("2-1")!}::uuid, ${projectId}::uuid, '{"en": "2→1 copy", "ar": "نسخة 2→1"}'::jsonb, now())`,
    );
    expect(copied!.outcome).toBe("duplicated");
    const binding = (await migrator.query("select id from workflow_binding where project_id = $1 and work_item_type_id = $2", [projectId, darType])).rows[0].id as string;

    await expectHiddenFrom({
      name: whoIs,
      label: "Tower's binding",
      read: (as: string) => call<{ id: string }>(as, sql`select id from workflow_binding`),
      target: binding,
      seenBy: c1.ap,
      hiddenFrom: xc.ap,
    });
    await expectHiddenFrom({
      name: whoIs,
      label: "Tower's copy",
      read: (as: string) => call<{ id: string }>(as, sql`select id from workflow_definition`),
      target: copied!.workflow_definition_id,
      seenBy: c1.ap,
      hiddenFrom: xc.ap,
    });
    // The Rabaed Defaults themselves are unchanged, alike for both Projects: the copy is none of them.
    expect(await darRuns(xc.ap)).toBe(byKey.get("1-1-owner"));
    expect(await darDefaults(xc.ap)).toEqual(await darDefaults(c1.ap));
    expect((await darDefaults(c1.ap)).map((d) => d.id)).toEqual([...byKey.values()]);
    // Unbound again: Tower's DAR, raised by C1, runs the Type's own Workflow.
    expect(await outcome(c1.ap, sql`select app.unbind_workflow(${projectId}::uuid, ${darType}::uuid, ${participant.c1}::uuid, now()) as outcome`)).toBe("unbound");
  });
});
