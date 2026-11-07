// Seam 2 for the people on the viewer's own Steps in the Submittal Panel's Workflow modal (RP-1189;
// visibility.md V14, V15; scenarios RP-1189-1 and RP-1189-2), as the app role: app.work_item_step_people
// gives, for each Step of the item's pinned Version that the reader's own Participant works, the names
// of its Step Pool (app.step_pool), and nothing for another Company's Steps: no name and no id. C1's
// Submittal is taken through K1's Recommendation to the Owner's review, so each Company has done or
// holds its Steps. Seam 1: apps/api/test/rp-1189-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addOwnerReviewWorkflow, bilingual, buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RQ${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RQP", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let item = "";

const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;
/** A Member's English full name, as the migrator reads it. */
const fullName = async (memberId: string) => (await migrator.query<{ en: string }>("select full_name ->> 'en' as en from member where id = $1", [memberId])).rows[0]!.en;

type StepPeople = { step_key: string; names: { en: string; ar: string }[] };
/** What app.work_item_step_people gives `as` for the item: every column, as the app role reads it. */
const stepPeople = (as: string) => tower.call<StepPeople>(as, sql`select * from app.work_item_step_people(${item}::uuid) order by step_key`);
/** Each name `as` reads on any Step, as a row by its English name, for expectHiddenFrom. */
const peopleRead = async (as: string) => (await stepPeople(as)).flatMap((r) => r.names.map((n) => ({ id: n.en })));

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);
  const workflow = await addOwnerReviewWorkflow(run);
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Step people (RP-1189)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Step people (RP-1189)")), workflow, formId],
  );

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, ow, c2 } = tower;
  for (const [as, name] of [
    [c1.members.engineer, "C1 engineer"],
    [c1.members.project_manager, "C1 PM"],
    [k1.members.engineer, "K1 engineer"],
    [k1.members.manager, "K1 manager"],
    [ow.members.representative, "OW representative"],
    [c2.members.engineer, "C2 engineer"],
  ] as const)
    names.set(as, name);

  // The Owner's review is an approving Step: OW's representative is its Project Manager too.
  expect(
    await tower.outcome(
      ow.ap,
      sql`select app.set_project_member_positions(${ow.participantId}::uuid, ${ow.members.representative}::uuid, ${["representative", "project_manager"]}::text[]) as outcome`,
    ),
  ).toBe("set");
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'Busbar trunking', app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "BT-1" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  item = created!.work_item_id;
  expect(await tower.take(c1.members.engineer, item, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(c1.members.project_manager, item)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, item, "submit")).toBe("applied");
  expect(await tower.pickUp(k1.members.manager, item)).toBe("picked_up");
  expect(await tower.take(k1.members.manager, item, "recommend_a")).toBe("applied");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1189-1: each Company reads the people on its own Steps only", () => {
  it("C1 reads its people on its own Steps (Draft, Contractor review), and no Step of K1's or the Owner's", async () => {
    const { c1 } = tower;
    for (const as of [c1.members.engineer, c1.members.project_manager]) {
      const rows = await stepPeople(as);
      expect(rows.map((r) => r.step_key), named(as)).toEqual(["draft", "internal_review"]);
      // Contractor review is C1's reviewing Step: its PM is in its pool.
      expect(rows.find((r) => r.step_key === "internal_review")!.names.map((n) => n.en), named(as)).toContain(await fullName(c1.members.project_manager));
    }
  });

  it("K1 reads its people on the Consultant PM review only, and the Owner's on the Owner review only", async () => {
    const { k1, ow } = tower;
    for (const as of [k1.members.engineer, k1.members.manager]) {
      const rows = await stepPeople(as);
      expect(rows.map((r) => r.step_key), named(as)).toEqual(["consultant_pm"]);
      expect(rows[0]!.names.map((n) => n.en), named(as)).toContain(await fullName(k1.members.manager));
    }
    const owner = await stepPeople(ow.members.representative);
    expect(owner.map((r) => r.step_key)).toEqual(["owner_review"]);
    expect(owner[0]!.names.map((n) => n.en)).toEqual([await fullName(ow.members.representative)]);
  });

  it("gives a Step's names only: no Member id, no other column", async () => {
    const rows = await stepPeople(tower.c1.members.project_manager);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["names", "step_key"]);
      for (const n of row.names) expect(Object.keys(n).sort()).toEqual(["ar", "en"]);
    }
  });
});

describe("scenario RP-1189-2: outsiders read no other Company's Member", () => {
  it("C1, at the Owner's review, reads no Member of the Owner's or of K1's; K1 none of C1's or the Owner's", async () => {
    const { c1, k1, ow, c2 } = tower;
    const cOne = [c1.members.engineer, c1.members.project_manager];
    const kOne = [k1.members.engineer, k1.members.manager];
    await expectHiddenFrom({
      read: peopleRead,
      target: await fullName(ow.members.representative),
      seenBy: ow.members.representative,
      hiddenFrom: [...cOne, ...kOne, c2.members.engineer],
      name: named,
      label: "the Owner's representative on the Owner review",
    });
    await expectHiddenFrom({
      read: peopleRead,
      target: await fullName(k1.members.manager),
      seenBy: kOne,
      hiddenFrom: [...cOne, ow.members.representative, c2.members.engineer],
      name: named,
      label: "K1's manager on the Consultant PM review",
    });
    await expectHiddenFrom({
      read: peopleRead,
      target: await fullName(c1.members.project_manager),
      seenBy: cOne,
      hiddenFrom: [...kOne, ow.members.representative, c2.members.engineer],
      name: named,
      label: "C1's PM on the Contractor review",
    });
  });

  it("C2, a second Contractor that doesn't see C1's item, reads no Step's people at all", async () => {
    const { c1, c2 } = tower;
    const seenItem = async (as: string) => (await tower.call<{ id: string }>(as, sql`select id from work_item where id = ${item}::uuid`)).map((r) => ({ id: r.id }));
    await expectHiddenFrom({ read: seenItem, target: item, seenBy: c1.members.engineer, hiddenFrom: c2.members.engineer, name: named, label: "the item" });
    const anyStep = async (as: string) => ((await stepPeople(as)).length > 0 ? [{ id: item }] : []);
    await expectHiddenFrom({ read: anyStep, target: item, seenBy: c1.members.engineer, hiddenFrom: c2.members.engineer, name: named, label: "any Step's people" });
  });
});
