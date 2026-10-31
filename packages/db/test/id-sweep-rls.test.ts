// The seam-2 id sweep (RP-1166), as the app role. Every `app.*` function the app role may execute is called, with
// the arguments a world gives it, by each outsider of three worlds, and must give none of the ids that outsider may
// not see: another Participant's internal Step, or a Company, Participant or Member it does not read (V3, V5, V14,
// V15, ADR 0022). Each world's insiders are swept the same way first and must read every one of those ids, so an
// empty sweep (a world not built, every call refused) can't pass. Writers are swept too, each call rolled back.
// A function the sweep can't call, or a kind of id it may give, is on SWEEP_ALLOW (packages/db/test-support/id-sweep.ts)
// with its reason; a new function on neither fails (the ratchet). The last describe puts RP-1138's old
// app.work_item_holder_unchecked back, inside one transaction nobody else sees, and the sweep catches it.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { databaseNameOf, withDatabaseName } from "../src/config.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";
import {
  argumentValue,
  callAs,
  callInTransaction,
  idsIn,
  leakProblems,
  readSweepCatalog,
  allowProblems,
  skippedNames,
  SWEEP_ALLOW,
  unexcusedHits,
  type CallResult,
  type CatalogFunction,
  type ForbiddenId,
  type SweepCall,
  type SweepViewer,
  type SweepWorld,
} from "../test-support/id-sweep.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
/** The Send Back (test) Workflow's Type: K1's engineer sends the item on to K1's manager, a later internal Step. */
const TYPE = `SW${letters(3)}`;
/** The Rabaed Default DAR: 1→1 → the Owner's review (the seam suites' global setup publishes it). */
const DAR = "DAR";

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RSW", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let catalog: CatalogFunction[] = [];
/** OW's Project Manager, who holds the DAR's Owner's review. */
let owPm = "";

type Viewer = SweepViewer & { label: string };
/** An id the outsiders may not read, with the insiders who must read it (the sweep's control). */
type Forbidden = ForbiddenId & { seenBy: Viewer[] };
/** A world: its item and arguments, its outsiders, its insiders (every `seenBy`), and the ids the outsiders may not read. */
type World = SweepWorld & { scenario: string; outsiders: Viewer[]; insiders: Viewer[]; forbidden: Forbidden[] };
/** Every call of every sweep, by scenario. */
const swept = new Map<string, { outsiders: SweepCall[]; insiders: SweepCall[] }>();

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) => tower.call<T>(as, query);
const takeable = async (as: string, id: string) =>
  (await call<{ key: string }>(as, sql`select transition_key as key from app.work_item_actions(${id}::uuid) where action = 'transition'`)).map((r) => r.key);
/** `as` takes `transition` on item `id`, picking the Step up first when it waits in a pool. */
async function act(as: string, id: string, transition: string, answers: object = {}): Promise<void> {
  if (!(await takeable(as, id)).includes(transition)) expect(await tower.pickUp(as, id), `${transition}: pick up`).toBe("picked_up");
  expect(await tower.take(as, id, transition, answers), transition).toBe("applied");
}

async function viewer(member: string, participant: string, company: string, label: string): Promise<Viewer> {
  const email = (await migrator.query("select email from member where id = $1", [member])).rows[0].email as string;
  return { member, participant, company, email, label };
}

/** What a world gives arguments named for the item's Workflow, Type, Form, last event, holder and Transition. */
async function itemArguments(id: string): Promise<Record<string, unknown>> {
  const one = async (text: string) => (await migrator.query(text, [id])).rows[0] as Record<string, string | null> | undefined;
  const item = (await one(
    `select w.workflow_version_id, v.workflow_definition_id, w.work_item_type_id, w.form_version_id, t.module_key, w.title
     from work_item w join workflow_version v on v.id = w.workflow_version_id join work_item_type t on t.id = w.work_item_type_id where w.id = $1`,
  ))!;
  const event = await one("select id, transition_id from work_item_event where work_item_id = $1 order by seq desc limit 1");
  const held = await one("select id, step_id from step_assignment where work_item_id = $1 and status in ('pooled', 'picked_up', 'vacant') limit 1");
  const transition = held && (await migrator.query("select key from workflow_transition where from_step_id = $1 order by sort limit 1", [held.step_id])).rows[0];
  const modules = (await migrator.query("select app.module_keys() as keys")).rows[0].keys as string[];
  return {
    p_definition_id: item.workflow_definition_id,
    p_version_id: item.workflow_version_id,
    p_type_id: item.work_item_type_id,
    p_work_item_type_id: item.work_item_type_id,
    p_form_version_id: item.form_version_id,
    p_module_key: item.module_key,
    p_module_keys: modules,
    p_type_codes: null,
    p_event_id: event?.id ?? null,
    p_reply_event_id: event?.id ?? null,
    p_after_event_id: null,
    p_transition_id: event?.transition_id ?? null,
    p_assignment_id: held?.id ?? null,
    p_transition_key: transition?.key ?? "x",
    p_trade_id: tower.tradeId,
    p_fixed_trade_id: tower.tradeId,
    p_location_id: tower.buildingA,
    p_kind: "trade",
    p_code: "A",
  };
}

/** Every swept function called once by each of `viewers` in `world`, through `exec`. */
async function sweep(world: World, viewers: readonly Viewer[], exec: (as: string, f: CatalogFunction, values: unknown[]) => Promise<CallResult>): Promise<SweepCall[]> {
  const skipped = skippedNames(SWEEP_ALLOW);
  const calls: SweepCall[] = [];
  for (const f of catalog.filter((c) => !skipped.has(c.name))) {
    for (const v of viewers) {
      const result = await exec(v.member, f, f.args.map((a) => argumentValue(a, world, v)));
      calls.push({ name: f.name, signature: f.signature, world: world.scenario, viewer: v.label, hits: idsIn(result, world.forbidden), error: result.error });
    }
  }
  return calls;
}

/** The forbidden ids `as` read in the world's sweep, as rows for expectHiddenFrom; ids an allow entry excuses don't count. */
const idsRead = (calls: readonly SweepCall[], as: Viewer) => calls.filter((c) => c.viewer === as.label).flatMap((c) => unexcusedHits(c, SWEEP_ALLOW).map((h) => ({ id: h.id })));

let worlds: World[] = [];

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1166 id sweep ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Id sweep (RP-1166)"))]))
    .rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Id sweep (RP-1166)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, ow, c2 } = tower;

  // OW's Project Manager, to hold the DAR's Owner's review.
  owPm = (
    await migrator.query("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      ow.id,
      `ow-pm-${randomUUID().slice(0, 8)}@rabaed.test`,
      JSON.stringify(bilingual("OW PM")),
    ])
  ).rows[0].id as string;
  await call(ow.ap, sql<{ outcome: string }>`select app.add_project_member(${ow.participantId}::uuid, ${owPm}::uuid, now())`);
  for (const kind of ["trade", "location"]) {
    expect(await tower.outcome(ow.ap, sql`select app.set_member_visibility(${ow.participantId}::uuid, ${owPm}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
  expect(await tower.outcome(ow.ap, sql`select app.set_project_member_positions(${ow.participantId}::uuid, ${owPm}::uuid, ${["project_manager"]}::text[]) as outcome`)).toBe("set");

  const create = async (type: string, title: string, answers: object) => {
    const [created] = await call<{ outcome: string; work_item_id: string }>(
      c1.members.engineer,
      sql`select outcome, work_item_id from app.create_work_item(
        ${tower.projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify(answers)}::jsonb,
        ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
    );
    expect(created!.outcome, title).toBe("created");
    return created!.work_item_id;
  };

  // Item X: Submitted to K1, whose engineer sends it on to K1's manager (consultant_approval, K1's later internal Step).
  const x = await create(TYPE, "Cable trays", { model: "CT-1" });
  await act(c1.members.engineer, x, "send_for_review");
  await act(c1.members.project_manager, x, "submit");
  await act(k1.members.engineer, x, "send_to_manager");
  expect(await tower.pickUp(k1.members.manager, x)).toBe("picked_up");
  const laterStep = (await migrator.query("select step_id from step_assignment where work_item_id = $1 and status = 'picked_up'", [x])).rows[0].step_id as string;

  // Item Y: a DAR K1's manager recommends to OW, whose PM holds the Owner's review (RP-598-1).
  const y = await create(DAR, "Lighting control calculation", { document_type: "calculation", document_title: "Lighting control calculation" });
  await act(c1.members.engineer, y, "send_for_review");
  await act(c1.members.project_manager, y, "submit", { cover_note: "Calculation for Level 2" });
  await act(k1.members.manager, y, "recommend_a", { sample_checked: true, matches_specification: true });

  const v = {
    c1Engineer: await viewer(c1.members.engineer, c1.participantId, c1.id, "C1's engineer"),
    c1Pm: await viewer(c1.members.project_manager, c1.participantId, c1.id, "C1's PM"),
    k1Engineer: await viewer(k1.members.engineer, k1.participantId, k1.id, "K1's engineer"),
    k1Manager: await viewer(k1.members.manager, k1.participantId, k1.id, "K1's manager"),
    owPm: await viewer(owPm, ow.participantId, ow.id, "OW's PM"),
    c2Engineer: await viewer(c2.members.engineer, c2.participantId, c2.id, "C2's engineer"),
    c2Ap: await viewer(c2.ap, c2.participantId, c2.id, "C2's Authorized Person"),
  };
  const world = async (id: string, scenario: string, outsiders: Viewer[], forbidden: Forbidden[]): Promise<World> => ({
    item: id,
    projectId: tower.projectId,
    typeCode: id === y ? DAR : TYPE,
    title: id === y ? "Lighting control calculation" : "Cable trays",
    argumentsByName: await itemArguments(id),
    scenario,
    outsiders,
    insiders: [...new Set(forbidden.flatMap((f) => f.seenBy))],
    forbidden,
  });
  const k1Engineer: Forbidden = { id: k1.members.engineer, kind: "member", what: "K1's engineer", seenBy: [v.k1Engineer] };
  const k1Manager: Forbidden = { id: k1.members.manager, kind: "member", what: "K1's manager", seenBy: [v.k1Manager] };
  const later: Forbidden = { id: laterStep, kind: "step", what: "K1's later internal Step (consultant_approval)", seenBy: [v.k1Manager] };
  worlds = [
    await world(x, "5", [v.c2Engineer, v.c2Ap], [
      { id: c1.participantId, kind: "participant", what: "C1's Participant (the Host Company's)", seenBy: [v.c1Pm, v.k1Manager] },
      { id: c1.id, kind: "company", what: "C1's Company", seenBy: [v.c1Pm] },
      { id: c1.members.project_manager, kind: "member", what: "C1's PM", seenBy: [v.c1Pm] },
      { id: k1.participantId, kind: "participant", what: "K1's Participant", seenBy: [v.k1Manager, v.c1Pm] },
      { id: k1.id, kind: "company", what: "K1's Company", seenBy: [v.k1Manager] },
      k1Engineer,
      k1Manager,
      later,
    ]),
    await world(x, "35", [v.c1Engineer, v.c1Pm], [k1Engineer, k1Manager, later]),
    await world(y, "RP-598-1", [v.c1Engineer, v.c1Pm, v.c2Engineer], [
      { id: ow.participantId, kind: "participant", what: "OW's Participant", seenBy: [v.owPm, v.k1Manager] },
      { id: ow.id, kind: "company", what: "OW's Company", seenBy: [v.owPm] },
      { id: owPm, kind: "member", what: "OW's PM", seenBy: [v.owPm] },
      k1Engineer,
      k1Manager,
    ]),
  ];

  catalog = await readSweepCatalog(app);
  for (const w of worlds) {
    const exec = (as: string, f: CatalogFunction, values: unknown[]) => callAs(app, as, f, values);
    swept.set(w.scenario, { insiders: await sweep(w, w.insiders, exec), outsiders: await sweep(w, w.outsiders, exec) });
  }
}, 900_000);

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** The world's leaks, then its control: each forbidden id is read by each viewer who may see it, and by no outsider. */
async function expectNoLeaks(scenario: string): Promise<void> {
  const w = worlds.find((x) => x.scenario === scenario)!;
  const { insiders, outsiders } = swept.get(scenario)!;
  expect(leakProblems(outsiders, SWEEP_ALLOW), `scenario ${scenario}`).toEqual([]); // not hidden-from: a list of leaks, each naming its function; the reads are proved just below
  for (const f of w.forbidden) {
    await expectHiddenFrom({
      label: `scenario ${scenario}, ${f.what}`,
      target: f.id,
      seenBy: f.seenBy,
      hiddenFrom: w.outsiders,
      name: (as: Viewer) => as.label,
      read: async (as: Viewer) => idsRead(w.insiders.includes(as) ? insiders : outsiders, as),
    });
  }
}

describe("the id sweep: every app.* function, as each outsider (RP-1166)", () => {
  it("scenario 5 (V3): C2 reads nothing of C1's item at K1's later internal Step: no Participant, Company, Member or Step of C1's or K1's", async () => {
    await expectNoLeaks("5");
  });

  it("scenario 35 (V14): C1 reads neither K1's later internal Step nor any K1 Member while K1's manager holds the item", async () => {
    await expectNoLeaks("35");
  });

  it("scenario RP-598-1: at the Owner's review neither C1 nor C2 reads an id of OW's, its Participant, Company or PM, nor of a K1 Member", async () => {
    await expectNoLeaks("RP-598-1");
  });

  it("sweeps every function the app role may execute, each reached without an error by some caller, or the allow list says why not (the ratchet); every allow entry still excuses something", () => {
    // The insiders' calls count for "reached" (an outsider may be refused with an error), never for what an entry excuses.
    const outsiders = [...swept.values()].flatMap((s) => s.outsiders);
    const insiders = [...swept.values()].flatMap((s) => s.insiders.map((c) => ({ ...c, hits: [] })));
    expect(catalog.length).toBeGreaterThan(200);
    expect(allowProblems(catalog, [...outsiders, ...insiders], SWEEP_ALLOW)).toEqual([]); // not hidden-from: a list of ratchet problems
  });
});

describe("the id sweep catches RP-1138's leak: the old app.work_item_holder_unchecked, put back in one transaction that is rolled back", () => {
  /** The old body, as 20271019000000_reads_at_scale.sql created it (before RP-1138's 20271121000000_owner_review_hides_holder.sql). */
  const oldHolder = () => {
    const text = readFileSync(join(import.meta.dirname, "..", "migrations", "20271019000000_reads_at_scale.sql"), "utf8");
    const start = text.indexOf("create function app.work_item_holder_unchecked(");
    const end = text.indexOf("$$;", text.indexOf("as $$", start)) + 3;
    expect(start).toBeGreaterThan(-1);
    return text.slice(start, end).replace("create function", "create or replace function");
  };

  it("scenario RP-598-1: the sweep finds OW's Participant in what C1 reads through app.work_item_holder and app.work_items_seen", async () => {
    const w = worlds.find((x) => x.scenario === "RP-598-1")!;
    // The superuser, so the function can be replaced and the role switched in one transaction; nothing is committed.
    const owner = new pg.Client({ connectionString: withDatabaseName(urls.superuser, databaseNameOf(urls.migrator)) });
    await owner.connect();
    let leaks: string[];
    try {
      await owner.query("begin");
      await owner.query(oldHolder());
      const calls = await sweep(w, w.outsiders, (as, f, values) => callInTransaction(owner, app, as, f, values));
      leaks = leakProblems(calls, SWEEP_ALLOW);
    } finally {
      await owner.query("rollback");
      await owner.end();
    }
    console.log(`The sweep on RP-1138's old app.work_item_holder_unchecked:\n${leaks.join("\n")}`);
    const leaking = [...new Set(leaks.filter((l) => l.includes("OW's Participant")).map((l) => l.slice(0, l.indexOf(" gave "))))].sort();
    expect(leaking).toEqual(["app.work_item_holder(p_work_item_id uuid)", "app.work_items_seen(p_project_id uuid, p_module_keys text[], p_all_revisions boolean, p_work_item_ids uuid[])"]);
  });
});
