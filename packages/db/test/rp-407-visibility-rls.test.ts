// Seam 2 for Home across my Projects (RP-407, spec RP-447; visibility.md "Home across Projects", V3, V5, V14, V15;
// scenarios RP-407-1 to RP-407-8), as the app role. Home has no read of its own (apps/api/src/home/home.ts): the API
// sums and merges what the database gives each Member: app.work_items_waiting_on_me (Need My Action, the Projects
// page's count), app.work_items_seen (the List: the card's count, and its rows held and aged give 4+ weeks and Waiting
// with others), app.activity_feed (recent activity) and the Projects row-level security lets them read. Each read is
// called here as the Member, checked by id. Seam 1 (apps/api/test/home.test.ts) checks the counts, lists and payload
// Home builds of them. On the test Send Back Workflow (addTestWorkflow) with a Cancel and a send on to the Owner
// Representative, as seam 1's.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, c2Draft, digits, expectHiddenFrom, joinProject, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RH${letters(3)}`;
const FOUR_WEEKS = 4 * 7 * 24 * 3600 * 1000;

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower<{ k1Manager: true }>;
/** A second Project of C1's: its Engineer and PM, and K1's manager A, are on it; K1's manager B is not. */
let second = { projectId: "", tradeId: "", location: "" };
let mechanical = "";
let k1B = "";
let mechanicalOnly = "";
let orEngineer = "";
const names = new Map<string, string>();

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const one = async (text: string, values: unknown[]) => (await migrator.query(text, values)).rows[0].id as string;
const newMember = (companyId: string, who: string) =>
  one("insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', false) returning id", [
    companyId,
    `${who.toLowerCase().replaceAll(" ", "-")}-${randomUUID().slice(0, 8)}@rabaed.test`,
    JSON.stringify(bilingual(who)),
  ]);

/** `admin` puts Member `memberId` on Participant `participantId` in `position`, seeing every Location and `trades` (all when null). */
async function onProject(admin: string, participantId: string, memberId: string, position: string, trades: string[] | null = null) {
  await tower.call(admin, sql<{ outcome: string }>`select app.add_project_member(${participantId}::uuid, ${memberId}::uuid, now()) as outcome`);
  for (const kind of ["trade", "location"]) {
    const narrow = kind === "trade" && trades !== null;
    const set = sql<{ outcome: string }>`select app.set_member_visibility(${participantId}::uuid, ${memberId}::uuid, ${kind}, ${!narrow}, ${narrow ? trades : []}::uuid[], now()) as outcome`;
    expect(await tower.outcome(admin, set)).toBe("set");
  }
  expect(await tower.outcome(admin, sql`select app.set_project_member_positions(${participantId}::uuid, ${memberId}::uuid, ${[position]}::text[]) as outcome`)).toBe("set");
}

const setParticipantVisibility = async (participantId: string) => {
  for (const kind of ["trade", "location"])
    expect(await tower.outcome(tower.c1.ap, sql`select app.set_participant_visibility(${participantId}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
};

type At = { projectId: string; tradeId: string; location: string };
const atTower = (): At => ({ projectId: tower.projectId, tradeId: tower.tradeId, location: tower.buildingA });

/** C1's Engineer raises a Draft on `at` (the Tower's Trade and Building A unless given). */
async function draft(title: string, at: At = atTower()): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${at.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "M-1" })}::jsonb,
      ${at.tradeId}::uuid, ${at.location}::uuid, now())`,
  );
  expect(created!.outcome, title).toBe("created");
  return created!.work_item_id;
}
const step = async (as: string, id: string, transition: string) => expect(await tower.take(as, id, transition), `${transition} by ${names.get(as)}`).toBe("applied");
const pick = async (as: string, id: string) => expect(await tower.pickUp(as, id), `pick up by ${names.get(as)}`).toBe("picked_up");
async function inReview(title: string, at?: At) {
  const id = await draft(title, at);
  await step(tower.c1.members.engineer, id, "send_for_review");
  return id;
}
async function submitted(title: string, at?: At) {
  const id = await inReview(title, at);
  await pick(tower.c1.members.project_manager, id);
  await step(tower.c1.members.project_manager, id, "submit");
  return id;
}
/** K1's manager sends item `id` to its approval Step and issues `code` there, which closes it. */
async function coded(id: string, code: "approve_a" | "revise_c") {
  const manager = tower.k1.members.manager;
  await pick(manager, id);
  await step(manager, id, "send_to_manager");
  await pick(manager, id);
  await step(manager, id, code);
}
/** The item has been at its Step, and with its holder, since `weeks` weeks ago. */
const aged = (id: string, weeks: number) =>
  migrator.query("update work_item set step_entered_at = now() - make_interval(weeks => $2), participant_entered_at = now() - make_interval(weeks => $2) where id = $1", [id, weeks]);
/** The event item `id`'s Transition `key` wrote, as the migrator reads it. */
const eventOf = (id: string, key: string) =>
  one("select e.id from work_item_event e join workflow_transition t on t.id = e.transition_id where e.work_item_id = $1 and t.key = $2 order by e.seq desc limit 1", [id, key]);

type Listed = { id: string; category: string; entered_at: Date | null; document_number: string | null; submitted_at: Date | null; held_by_own: boolean; raised_by_own: boolean; need: string | null };
/** Project `projectId`'s Submittals List as `as` reads it (app.work_items_seen, the latest Revision of each chain), with what Home reads of each row. */
const listOf = (as: string, projectId: string) =>
  tower.call<Listed>(
    as,
    sql`select s.id, st.category, s.entered_at, s.document_number, s.submitted_at, app.need_my_action(s.id) as need,
        coalesce(s.holder_participant_id = any(array(select app.current_participant_ids())), false) as held_by_own,
        coalesce(s.raised_by_participant_id = any(array(select app.current_participant_ids())), false) as raised_by_own
      from app.work_items_seen(${projectId}::uuid, array['submittals'], false) s
      join work_item_type t on t.id = s.work_item_type_id
      join stage st on st.project_id = s.project_id and st.module_key = t.module_key and st.key = s.stage_key`,
  );
const isOpen = (r: Listed) => r.category === "draft" || r.category === "in_progress";
/** 4+ weeks (home.ts): my own Participant holds it, open and past its Draft, at its Step 4+ weeks as I see it (V14). */
const isAged = (r: Listed) => r.category === "in_progress" && r.document_number !== null && r.held_by_own && r.entered_at !== null && Date.now() - r.entered_at.getTime() >= FOUR_WEEKS;
/** Waiting with others (home.ts): my own Participant raised it, it is open, and another Participant holds it. */
const isWithOthers = (r: Listed) => r.raised_by_own && isOpen(r) && !r.held_by_own;

/** A read of Home's: the List, its Need My Action toggle, Need My Action, 4+ weeks, Waiting with others, the feed. */
type Via = "list" | "toggle" | "waiting" | "aged" | "others" | "feed";
type View = { as: string; via: Via };
type Row = { id: string; event?: string; audience?: string; company_name?: unknown; member_name?: unknown };

/** What `as` reads through `via` across `projects` (the Tower's and the second Project); a row's `id` is its item's. */
async function read({ as, via }: View, projects = [tower.projectId, second.projectId]): Promise<Row[]> {
  if (via === "waiting")
    return (await tower.call<{ work_item_id: string }>(as, sql`select work_item_id from app.work_items_waiting_on_me(${projects}::uuid[])`)).map((r) => ({ id: r.work_item_id }));
  const rows: Row[] = [];
  for (const projectId of projects) {
    if (via !== "feed") {
      const listed = await listOf(as, projectId);
      rows.push(...listed.filter(via === "list" ? () => true : via === "toggle" ? (r) => r.need !== null : via === "aged" ? isAged : isWithOthers));
      continue;
    }
    // Every page of the Project's feed, newest first.
    for (let after: string | null = null; ; ) {
      type Entry = { id: string; work_item_id: string; audience: string; company_name: unknown; member_name: unknown };
      const page: Entry[] = await tower.call<Entry>(
        as,
        sql<Entry>`select id, work_item_id, audience, company_name, member_name from app.activity_feed(${projectId}::uuid, null, '{}'::text[], false, ${after}::uuid, 100)`,
      );
      rows.push(...page.map(({ id, work_item_id, ...rest }) => ({ id: work_item_id, event: id, ...rest })));
      if (page.length < 100) break;
      after = page.at(-1)!.id;
    }
  }
  return rows;
}
const named = (v: View) => `${names.get(v.as) ?? v.as} (${v.via})`;
const views = (via: Via, ...members: string[]) => members.map((as) => ({ as, via }));
const hidden = (label: string, target: string, seenBy: View | View[], hiddenFrom: View | View[], byEvent = false) =>
  expectHiddenFrom<View, Row>({ read: (v) => read(v), target, seenBy, hiddenFrom, name: named, label, ...(byEvent ? { idOf: (r) => r.event! } : {}) });
const ids = async (v: View, projects?: string[]) => (await read(v, projects)).map((r) => r.id).sort();

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-407 Home ${digits(6)}`), withCancel: true, forward: true });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Home (RP-407)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    "insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id) values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)",
    [TYPE, JSON.stringify(bilingual("Home (RP-407)")), workflowId, formId],
  );
  // C2 sees every Trade and Location: it still reads none of C1's items (V3).
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RHM", k1Manager: true, c2OtherLocation: false });
  const { c1, k1, c2 } = tower;
  const value = async (projectId: string, kind: string, code: string) =>
    (await tower.call<{ value_id: string }>(c1.ap, sql`select value_id from app.add_dimension_value(${projectId}::uuid, ${kind}, null, ${code}, ${JSON.stringify(bilingual(code))}::jsonb)`))[0]!.value_id;
  mechanical = await value(tower.projectId, "trade", "ME");

  k1B = await newMember(k1.id, "K1 manager B");
  await onProject(k1.ap, k1.participantId, k1B, "manager");
  mechanicalOnly = await newMember(c1.id, "C1 mechanical engineer");
  await onProject(c1.ap, c1.participantId, mechanicalOnly, "engineer", [mechanical]);

  // The Owner Representative (OR), whom K1 sends items on to.
  const orCr = digits(10);
  const orId = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, (select id from rabaed_engineer limit 1)) returning id", [
    JSON.stringify(bilingual("OR")),
    orCr,
    `3${digits(13)}3`,
  ]);
  const orAp = await newMember(orId, "OR ap");
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [orAp, orId]);
  const orParticipant = await joinProject(app, tower.projectId, { adminId: c1.ap, crNumber: orCr, role: "owner_representative" }, orAp);
  await setParticipantVisibility(orParticipant);
  orEngineer = await newMember(orId, "OR engineer");
  await onProject(orAp, orParticipant, orEngineer, "engineer");

  // The second Project: C1's, with K1 its Consultant; K1's manager A only.
  const [made] = await tower.call<{ project_id: string }>(c1.ap, sql`select project_id from app.create_project(${JSON.stringify(bilingual("Villa"))}::jsonb, 'RHV', 'contractor')`);
  const projectId = made!.project_id;
  const c1There = await one("select id from participant where project_id = $1", [projectId]);
  const k1There = await joinProject(app, projectId, { adminId: c1.ap, crNumber: k1.cr, role: "consultant" }, k1.ap);
  second = { projectId, tradeId: await value(projectId, "trade", "EL"), location: await value(projectId, "location", "BA") };
  for (const p of [c1There, k1There]) await setParticipantVisibility(p);
  await onProject(c1.ap, c1There, c1.members.engineer, "engineer");
  await onProject(c1.ap, c1There, c1.members.project_manager, "project_manager");
  await onProject(k1.ap, k1There, k1.members.manager, "manager");

  for (const [as, name] of [
    [c1.members.engineer, "C1 engineer"],
    [c1.members.project_manager, "C1 PM"],
    [mechanicalOnly, "C1 Mechanical-only engineer"],
    [k1.members.manager, "K1 manager A"],
    [k1B, "K1 manager B"],
    [orEngineer, "OR engineer"],
    [c2.members.engineer, "C2 engineer"],
  ] as const)
    names.set(as, name);
});

describe("scenario RP-407-1: C2 opens Home while C1 has items Submitted to K1 and in its own review", () => {
  it("reads none of C1's items through any of Home's reads, and C1's name only as the Host Company", async () => {
    const { c1, k1, c2 } = tower;
    const sent = await submitted("C1 switchboards");
    const internal = await inReview("C1 busbars");
    await aged(internal, 5);
    const c2Engineer = c2.members.engineer;
    // C2's reads work: its own Draft is read by C2, and not by C1.
    const own = await c2Draft(tower, { type: TYPE, title: "C2 own Draft" });
    await hidden("C2's own Draft", own, { as: c2Engineer, via: "list" }, { as: c1.members.engineer, via: "list" });
    // No row, count or activity entry of a C1 item: Need My Action, 4+ weeks, the List and the feed (seam 1 checks Subjects in the body).
    for (const [target, holder] of [
      [sent, k1.members.manager],
      [internal, c1.members.project_manager],
    ] as const) {
      await hidden("Need My Action", target, { as: holder, via: "waiting" }, { as: c2Engineer, via: "waiting" });
      await hidden("the List", target, { as: c1.members.engineer, via: "list" }, { as: c2Engineer, via: "list" });
      await hidden("recent activity", target, { as: holder, via: "feed" }, { as: c2Engineer, via: "feed" });
    }
    await hidden("4+ weeks", internal, { as: c1.members.project_manager, via: "aged" }, { as: c2Engineer, via: "aged" });
    // V15: C2 reads the Host Company's name for its card, which is C1's.
    const [host] = await tower.call<{ name: unknown }>(c2Engineer, sql`select app.project_host_company_name(${tower.projectId}::uuid) as name`);
    expect(host!.name).toEqual((await migrator.query("select legal_name from company where id = $1", [c1.id])).rows[0].legal_name);
  });
});

describe("scenario RP-407-2: a C1 engineer's Draft, six weeks a Draft", () => {
  it("is on its raiser's Need My Action toggle, but never in anyone's Need My Action or 4+ weeks", async () => {
    const { c1, k1, c2 } = tower;
    const mine = await draft("Lighting, still a Draft");
    await aged(mine, 6);
    const raiser = c1.members.engineer;
    await hidden("a Draft", mine, { as: raiser, via: "toggle" }, [
      ...views("waiting", raiser, c1.members.project_manager, k1.members.manager, k1B, c2.members.engineer),
      ...views("aged", raiser, c1.members.project_manager),
      ...views("feed", k1.members.manager, k1B, c2.members.engineer),
      ...views("list", k1.members.manager, k1B, c2.members.engineer),
    ]);
    expect(await tower.call<{ need: string | null }>(raiser, sql`select app.need_my_action(${mine}::uuid) as need`)).toEqual([{ need: "own_draft" }]);
  });
});

describe("scenario RP-407-3: the Project closes while a C1 item waits, five weeks old, at C1's review", () => {
  it("drops it from Need My Action and the active Projects; the Project stays, closed, and its List is still read", async () => {
    // Its own Tower: closing it would close the shared one.
    const closing = await buildSeamTwoTower(app, migrator, { projectCode: "RHC" });
    const pm = closing.c1.members.project_manager;
    const [created] = await closing.call<{ outcome: string; work_item_id: string }>(
      closing.c1.members.engineer,
      sql`select outcome, work_item_id from app.create_work_item(${closing.projectId}::uuid, ${TYPE}, 'Closing pumps', app.latest_form_version(${TYPE}), '{}'::jsonb,
        ${closing.tradeId}::uuid, ${closing.buildingA}::uuid, now())`,
    );
    const id = created!.work_item_id;
    expect(await closing.take(closing.c1.members.engineer, id, "send_for_review")).toBe("applied");
    await aged(id, 5);
    const snapshot = async () => ({
      waiting: (await closing.call<{ id: string }>(pm, sql`select work_item_id as id from app.work_items_waiting_on_me(${[closing.projectId]}::uuid[])`)),
      active: await closing.call<{ id: string }>(pm, sql`select id from project where status = 'active'`),
      projects: await closing.call<{ id: string; status: string }>(pm, sql`select id, status from project`),
      list: await closing.call<{ id: string }>(pm, sql`select id from app.work_items_seen(${closing.projectId}::uuid, array['submittals'], false)`),
    });
    const before = await snapshot();
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [closing.projectId]);
    const after = await snapshot();
    type Phase = "before" | "after";
    const phases = { label: "a closed Project", seenBy: "before" as Phase, hiddenFrom: "after" as Phase };
    await expectHiddenFrom<Phase, { id: string }>({ ...phases, read: async (p) => (p === "before" ? before : after).waiting, target: id });
    await expectHiddenFrom<Phase, { id: string }>({ ...phases, read: async (p) => (p === "before" ? before : after).active, target: closing.projectId });
    // Still on the Projects list, as closed, and its List still the Member's to read (its card's count, RP-408-1).
    expect(after.projects.find((p) => p.id === closing.projectId)?.status).toBe("closed");
    expect(after.list.map((r) => r.id)).toEqual(before.list.map((r) => r.id));
    expect(after.list.map((r) => r.id)).toContain(id);
    // Seam 1 checks Home's 4+ weeks and activity are 0 after: the API reads them over active Projects only.
  });
});

describe("scenario RP-407-4: a C1 item five weeks at C1's review, then Submitted to K1", () => {
  it("is C1's 4+ weeks while at C1, then K1's Step Age runs from when it reached K1", async () => {
    const { c1, k1 } = tower;
    const pm = c1.members.project_manager;
    const id = await inReview("Fire pumps");
    await aged(id, 5);
    await hidden("at C1's review", id, { as: pm, via: "aged" }, [...views("aged", k1.members.manager, k1B), ...views("list", k1.members.manager, k1B)]);
    await pick(pm, id);
    await step(pm, id, "submit");
    // With K1 now: K1 reads it at week 1, so not in K1's 4+ weeks, nor C1's (K1 holds it).
    const k1Row = (await listOf(k1.members.manager, tower.projectId)).find((r) => r.id === id);
    expect(Date.now() - k1Row!.entered_at!.getTime()).toBeLessThan(FOUR_WEEKS / 4);
    await hidden("just with K1", id, { as: k1.members.manager, via: "list" }, [...views("aged", k1.members.manager, k1B, pm, c1.members.engineer)]);
    await aged(id, 4);
    await hidden("four weeks with K1", id, views("aged", k1.members.manager, k1B), views("aged", pm, c1.members.engineer));
  });
});

describe("scenarios RP-407-5 and RP-407-6: K1 manager A is on two Projects, manager B on the first only", () => {
  let atTower = "";
  let atSecond = "";
  beforeAll(async () => {
    atTower = await submitted("Cable trays");
    atSecond = await submitted("Villa pumps", second);
  });

  it("RP-407-5: A reads both Projects' feeds, B the first only; C1 by its name only, and none of C1's internal events", async () => {
    const { c1, k1, c2 } = tower;
    const a = k1.members.manager;
    const pm = c1.members.project_manager;
    const submitOf = { tower: await eventOf(atTower, "submit"), second: await eventOf(atSecond, "submit") };
    await hidden("the second Project's Submit", submitOf.second, { as: a, via: "feed" }, { as: k1B, via: "feed" }, true);
    await hidden("the first Project's Submit", submitOf.tower, views("feed", a, k1B), { as: c2.members.engineer, via: "feed" }, true);
    // None of C1's internal events on either item (its Send for Review, its PM's pick-up): its raiser reads each in the
    // feed, K1 none (V5). The feed leaves out answer changes, and its raiser's feed shows no creation event either.
    const internal = await migrator.query<{ id: string }>(
      `select e.id from work_item_event e join participant p on p.id = e.actor_participant_id
       where e.work_item_id = any($1::uuid[]) and e.audience = 'internal' and p.company_id = $2 and e.type not in ('answers_changed', 'created')`,
      [[atTower, atSecond], c1.id],
    );
    expect(internal.rows.map((r) => r.id)).toContain(await eventOf(atSecond, "send_for_review"));
    for (const { id } of internal.rows) await hidden("C1's internal event", id, { as: c1.members.engineer, via: "feed" }, views("feed", a, k1B), true);
    // C1 reads its own people's names; K1 reads C1 by its name only (V14).
    const c1Name = (await migrator.query("select legal_name from company where id = $1", [c1.id])).rows[0].legal_name;
    expect((await read({ as: pm, via: "feed" })).find((e) => e.event === submitOf.tower)?.member_name).not.toBeNull();
    const feedOfA = await read({ as: a, via: "feed" });
    for (const event of [submitOf.tower, submitOf.second]) expect(feedOfA.find((e) => e.event === event)).toMatchObject({ company_name: c1Name, member_name: null });
    // Seam 1 checks Home merges the two feeds' newest entries.
  });

  it("RP-407-6: A reads both Projects and both items waiting; B the first only; each sum is of the Member's own Projects' reads", async () => {
    const { k1, c2 } = tower;
    const a = k1.members.manager;
    await expectHiddenFrom<string, { id: string }>({
      label: "the second Project",
      read: (as) => tower.call<{ id: string }>(as, sql`select id from project where status = 'active'`),
      target: second.projectId,
      seenBy: a,
      hiddenFrom: k1B,
      name: (as) => names.get(as)!,
    });
    await hidden("waiting on the second Project", atSecond, { as: a, via: "waiting" }, { as: k1B, via: "waiting" });
    await hidden("waiting on the first Project", atTower, views("waiting", a, k1B), { as: c2.members.engineer, via: "waiting" });
    for (const as of [a, k1B, tower.c1.members.project_manager]) {
      // Home's Need My Action is the sum of the Projects page's per Project...
      const byProject = [...(await ids({ as, via: "waiting" }, [tower.projectId])), ...(await ids({ as, via: "waiting" }, [second.projectId]))].sort();
      expect(await ids({ as, via: "waiting" }), names.get(as)).toEqual(byProject);
      // ...and each Project's is the List's toggle rows waiting on them (never their own Draft).
      for (const projectId of [tower.projectId, second.projectId]) {
        const toggle = (await listOf(as, projectId)).filter((r) => r.need === "waiting").map((r) => r.id).sort();
        expect(await ids({ as, via: "waiting" }, [projectId]), `${names.get(as)} on ${projectId}`).toEqual(toggle);
      }
    }
  });
});

describe("scenarios RP-407-7 and RP-407-8: C1's items at every point of the Workflow", () => {
  const items = { draft: "", internal: "", withK1: "", withOr: "", sentBack: "", codeA: "", cancelled: "", codeC: "", mechanicalItem: "" };
  beforeAll(async () => {
    const { c1, k1 } = tower;
    const manager = k1.members.manager;
    items.draft = await draft("Waiting: still a Draft");
    items.internal = await inReview("Waiting: at our review");
    items.withK1 = await submitted("Waiting: with the Consultant");
    items.withOr = await submitted("Waiting: sent on to the Owner Representative");
    await pick(manager, items.withOr);
    await step(manager, items.withOr, "forward");
    items.sentBack = await submitted("Waiting: sent back");
    await pick(manager, items.sentBack);
    await step(manager, items.sentBack, "send_back");
    items.codeA = await submitted("Waiting: approved");
    await coded(items.codeA, "approve_a");
    items.cancelled = await inReview("Waiting: cancelled");
    await pick(c1.members.project_manager, items.cancelled);
    await step(c1.members.project_manager, items.cancelled, "cancel_review");
    items.codeC = await submitted("Waiting: revised");
    await coded(items.codeC, "revise_c");
    items.mechanicalItem = await submitted("Waiting: mechanical", { ...atTower(), tradeId: mechanical });
  });

  it("RP-407-7: counts for C1 the items another Participant holds, never for K1, OR or C2", async () => {
    const { c1, k1, c2 } = tower;
    const c1Members = [c1.members.engineer, c1.members.project_manager];
    const others = [k1.members.manager, orEngineer, c2.members.engineer];
    await hidden("with K1", items.withK1, [...views("others", ...c1Members), { as: k1.members.manager, via: "list" }], views("others", ...others));
    await hidden("with OR", items.withOr, [...views("others", ...c1Members), { as: orEngineer, via: "list" }], views("others", ...others));
    // The Sent Back, cancelled and closed ones, the Draft and C1's review: C1 reads them, and counts none.
    for (const key of ["sentBack", "cancelled", "codeA", "draft", "internal"] as const)
      await hidden(key, items[key], { as: c1.members.engineer, via: "list" }, views("others", ...c1Members));
    // The Mechanical-only engineer counts only Mechanical items.
    await hidden("an Electrical item", items.withK1, { as: c1.members.engineer, via: "others" }, { as: mechanicalOnly, via: "others" });
    await hidden("the Mechanical item", items.mechanicalItem, { as: mechanicalOnly, via: "others" }, views("others", ...others));
    // No C1 item's id reaches C2, through any of Home's reads.
    for (const id of Object.values(items))
      await hidden("C2", id, { as: c1.members.engineer, via: "list" }, views("list", c2.members.engineer).concat(views("waiting", c2.members.engineer), views("feed", c2.members.engineer), views("others", c2.members.engineer)));
  });

  it("RP-407-7: counts the Code C chain nothing while its Rev 1 is a Draft, once when Rev 1 waits with K1", async () => {
    const { c1, k1 } = tower;
    const [made] = await tower.call<{ outcome: string; work_item_id: string }>(c1.members.engineer, sql`select outcome, work_item_id from app.create_revision(${items.codeC}::uuid, ${randomUUID()}::uuid, now())`);
    expect(made!.outcome).toBe("created");
    const rev1 = made!.work_item_id;
    await hidden("Rev 1, a Draft", rev1, { as: c1.members.engineer, via: "list" }, views("others", c1.members.engineer, c1.members.project_manager));
    // Rev 0 is closed with Code C: K1, which does not see C1's Draft Rev 1, still lists it; C1 counts it not.
    await hidden("the chain's Rev 0", items.codeC, { as: k1.members.manager, via: "list" }, views("others", c1.members.engineer, c1.members.project_manager));
    await step(c1.members.engineer, rev1, "send_for_review");
    await pick(c1.members.project_manager, rev1);
    await step(c1.members.project_manager, rev1, "submit");
    await hidden("Rev 1, with K1", rev1, views("others", c1.members.engineer, c1.members.project_manager), { as: k1.members.manager, via: "others" });
    // Once: the chain's Rev 0 is no row of the List any more, so not of the count.
    expect((await ids({ as: c1.members.project_manager, via: "others" })).filter((id) => id === rev1 || id === items.codeC)).toEqual([rev1]);
  });

  it("RP-407-8: each Member's card counts their own List, so K1 never C1's Draft or review, and C2 none of C1's", async () => {
    const { c1, k1, c2 } = tower;
    // The card's count is the List's, both of app.work_items_seen (seam 1 checks the number Home and the List give).
    for (const key of ["draft", "internal", "cancelled"] as const)
      await hidden(key, items[key], { as: c1.members.engineer, via: "list" }, views("list", k1.members.manager, k1B, orEngineer, c2.members.engineer));
    // K1's List is exactly the C1 items that were Submitted, as C1's Engineer reads them.
    const c1Submitted = (await listOf(c1.members.engineer, tower.projectId)).filter((r) => r.submitted_at !== null).map((r) => r.id).sort();
    expect(await ids({ as: k1.members.manager, via: "list" }, [tower.projectId])).toEqual(c1Submitted);
  });

  it("RP-407-7: after K1's withdrawal, the items it held still wait with others for C1", async () => {
    const pm = tower.c1.members.project_manager;
    const before = await ids({ as: pm, via: "others" });
    expect(before).toEqual(expect.arrayContaining([items.withK1, items.withOr]));
    await migrator.query("update participant set status = 'withdrawn' where id = $1", [tower.k1.participantId]);
    expect(await ids({ as: pm, via: "others" })).toEqual(before);
  });
});
