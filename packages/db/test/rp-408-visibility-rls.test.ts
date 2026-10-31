// Seam 2 for the Projects page's `submittals` (RP-408; visibility.md "Home across Projects", V3, V5; scenario RP-408-1),
// as the app role. The count on each Project's card, the Projects page's and Home's, is the Member's own Submittals List
// on it (apps/api/src/projects/submittal-counts.ts): its rows are app.work_items_seen's, and the Projects are the ones
// row-level security lets the Member read. So here each Member's List is read by id: K1 never reads C1's Draft or
// internal review, C2 none of C1's items, a Mechanical-only Member fewer than an Engineer who sees all, and a closed
// Project's List is still read whole. Seam 1 (apps/api/test/home.test.ts) checks the numbers the API gives, and that
// the page has one entry per Project. On the test Send Back Workflow (addTestWorkflow) with a send on to the Owner
// Representative.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, c2Draft, digits, expectHiddenFrom, joinProject, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RP${letters(3)}`;

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower<{ k1Manager: true; otherProject: true }>;
let mechanical = "";
let mechanicalOnly = "";
let orEngineer = "";
const items = { draft: "", internal: "", withK1: "", withOr: "", mechanicalItem: "" };
let c2Own = "";
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

/** C1's Engineer raises a Draft in Building A, on the Tower's Trade unless given. */
async function draft(title: string, tradeId = tower.tradeId): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "M-1" })}::jsonb,
      ${tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome, title).toBe("created");
  return created!.work_item_id;
}
const step = async (as: string, id: string, transition: string) => expect(await tower.take(as, id, transition), `${transition} by ${names.get(as)}`).toBe("applied");
const pick = async (as: string, id: string) => expect(await tower.pickUp(as, id), `pick up by ${names.get(as)}`).toBe("picked_up");
async function inReview(title: string, tradeId?: string) {
  const id = await draft(title, tradeId);
  await step(tower.c1.members.engineer, id, "send_for_review");
  return id;
}
async function submitted(title: string, tradeId?: string) {
  const id = await inReview(title, tradeId);
  await pick(tower.c1.members.project_manager, id);
  await step(tower.c1.members.project_manager, id, "submit");
  return id;
}

/** The Tower's Submittals List as `as` reads it: app.work_items_seen, the latest Revision of each chain, every page together. */
const listOf = (as: string) => tower.call<{ id: string }>(as, sql`select id from app.work_items_seen(${tower.projectId}::uuid, array['submittals'], false)`);
/** The Projects `as` reads (row-level security): the Projects page's, each with its card's count. */
const projectsOf = (as: string) => tower.call<{ id: string; status: string }>(as, sql`select id, status from project`);
const ids = async (as: string) => (await listOf(as)).map((r) => r.id).sort();
const named = (as: string) => names.get(as) ?? as;
const hiddenInList = (label: string, target: string, seenBy: string | string[], hiddenFrom: string | string[]) =>
  expectHiddenFrom<string, { id: string }>({ read: listOf, target, seenBy, hiddenFrom, name: named, label });

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-408 Projects page ${digits(6)}`), forward: true });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Projects page (RP-408)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    "insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id) values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)",
    [TYPE, JSON.stringify(bilingual("Projects page (RP-408)")), workflowId, formId],
  );
  // C2 sees every Trade and Location: it still reads none of C1's items (V3). `other` is on a Project of its own.
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RPP", k1Manager: true, c2OtherLocation: false, otherProject: true });
  const { c1, k1, c2 } = tower;
  mechanical = (
    await tower.call<{ value_id: string }>(c1.ap, sql`select value_id from app.add_dimension_value(${tower.projectId}::uuid, 'trade', null, 'ME', ${JSON.stringify(bilingual("ME"))}::jsonb)`)
  )[0]!.value_id;
  mechanicalOnly = await newMember(c1.id, "C1 mechanical engineer");
  await onProject(c1.ap, c1.participantId, mechanicalOnly, "engineer", [mechanical]);

  // The Owner Representative (OR), whom K1 sends an item on to.
  const orCr = digits(10);
  const orId = await one("insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, (select id from rabaed_engineer limit 1)) returning id", [
    JSON.stringify(bilingual("OR")),
    orCr,
    `3${digits(13)}3`,
  ]);
  const orAp = await newMember(orId, "OR ap");
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [orAp, orId]);
  const orParticipant = await joinProject(app, tower.projectId, { adminId: c1.ap, crNumber: orCr, role: "owner_representative" }, orAp);
  for (const kind of ["trade", "location"])
    expect(await tower.outcome(c1.ap, sql`select app.set_participant_visibility(${orParticipant}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  orEngineer = await newMember(orId, "OR engineer");
  await onProject(orAp, orParticipant, orEngineer, "engineer");

  for (const [as, name] of [
    [c1.members.engineer, "C1 engineer"],
    [c1.members.project_manager, "C1 PM"],
    [mechanicalOnly, "C1 Mechanical-only engineer"],
    [k1.members.manager, "K1 manager"],
    [orEngineer, "OR engineer"],
    [c2.members.engineer, "C2 engineer"],
    [tower.other.ap, "another Project's Member"],
  ] as const)
    names.set(as, name);

  // As in RP-407-7: a Draft, an item in C1's review, one with K1, one K1 sent on to OR, and a Mechanical one with K1.
  items.draft = await draft("Projects page: a Draft");
  items.internal = await inReview("Projects page: at our review");
  items.withK1 = await submitted("Projects page: with the Consultant");
  items.withOr = await submitted("Projects page: sent on to the Owner Representative");
  await pick(k1.members.manager, items.withOr);
  await step(k1.members.manager, items.withOr, "forward");
  items.mechanicalItem = await submitted("Projects page: mechanical", mechanical);
  c2Own = await c2Draft(tower, { type: TYPE, title: "Projects page: C2's own Draft" });
});

/** Every Member of the Tower this file reads as. */
const towerMembers = () => [tower.c1.members.engineer, tower.c1.members.project_manager, mechanicalOnly, tower.k1.members.manager, orEngineer, tower.c2.members.engineer];

describe("scenario RP-408-1: the Projects page's `submittals` is each Member's own Submittals List", () => {
  it("is for the Projects the Member is on, and none of another's", async () => {
    const read = projectsOf;
    await expectHiddenFrom({ read, target: tower.projectId, seenBy: towerMembers(), hiddenFrom: tower.other.ap, name: named, label: "the Tower" });
    await expectHiddenFrom({ read, target: tower.other.projectId, seenBy: tower.other.ap, hiddenFrom: towerMembers(), name: named, label: "another Project" });
    // Nor does the other Project's Member read a row of the Tower's List.
    await hiddenInList("the Tower's List", items.withK1, tower.c1.members.engineer, tower.other.ap);
  });

  it("never counts C1's Draft or internal review for K1 or OR, nor any C1 item for C2", async () => {
    const { c1, k1, c2 } = tower;
    for (const key of ["draft", "internal"] as const) await hiddenInList(key, items[key], c1.members.engineer, [k1.members.manager, orEngineer, c2.members.engineer]);
    // K1 and OR read the items they hold.
    await hiddenInList("with K1", items.withK1, [c1.members.engineer, k1.members.manager], c2.members.engineer);
    await hiddenInList("with OR", items.withOr, [c1.members.engineer, k1.members.manager, orEngineer], c2.members.engineer);
    await hiddenInList("the Mechanical item", items.mechanicalItem, [c1.members.engineer, k1.members.manager], c2.members.engineer);
    // C2's List is read, so its 0 of C1's is no broken read: it lists its own Draft, which C1 and K1 don't.
    await hiddenInList("C2's own Draft", c2Own, c2.members.engineer, [c1.members.engineer, k1.members.manager]);
  });

  it("counts for a Mechanical-only Member only their own List, fewer than an Engineer who sees all", async () => {
    const engineer = tower.c1.members.engineer;
    await hiddenInList("an Electrical item", items.withK1, engineer, mechanicalOnly);
    await hiddenInList("the Mechanical item", items.mechanicalItem, mechanicalOnly, tower.c2.members.engineer);
    const all = await ids(engineer);
    const mine = await ids(mechanicalOnly);
    expect(all).toEqual(expect.arrayContaining(mine));
    expect(mine.length).toBeLessThan(all.length);
  });

  it("counts a closed Project too: each Member's List on it is the same as before it closed", async () => {
    const before = new Map<string, string[]>();
    for (const as of towerMembers()) before.set(as, await ids(as));
    await migrator.query("update project set status = 'closed', closed_at = now() where id = $1", [tower.projectId]);
    for (const as of towerMembers()) {
      expect(await ids(as), named(as)).toEqual(before.get(as));
      expect((await projectsOf(as)).find((p) => p.id === tower.projectId)?.status, named(as)).toBe("closed");
    }
    // Its List is still read after it closed, by those who may, and still not by C2.
    await hiddenInList("a closed Project's item", items.withK1, [tower.c1.members.engineer, tower.k1.members.manager], tower.c2.members.engineer);
  });
});
