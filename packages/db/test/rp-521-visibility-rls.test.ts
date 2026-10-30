// Seam 2 for a Link opened by its own id (RP-521; visibility.md E1 and the Links row; scenario RP-521-1), as the app
// role. The api opens /work-items/<MAR>/links/<Link> from the MAR's Links, app.work_item_links, which gives each
// linked item's Document Number and Subject, and its id only to a reader who sees it (as in scenario 12). C1's
// Mechanical MAR links to C1's Electrical item: K1's Mechanical manager reads the Link, with the item's number and
// Subject and no id of it anywhere, nor the item itself; K1's manager, who sees the item, reads its id; C2, who
// can't see the MAR, reads no Link. Seam 1: apps/api/test/links.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, c2Draft, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RL${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RLK", k1Manager: true, c2OtherLocation: false } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let mechanical = "";
let k1Mechanical = ""; // A K1 manager covering Mechanical only.
let electrical = ""; // C1's Electrical item: hidden from the Mechanical manager.
let electricalNumber = "";
let mar = ""; // C1's Mechanical MAR, linking to it.
let link = "";
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

type LinkRow = { id: string; kind: string; field_key: string | null; document_number: string; subject: string; work_item_id: string | null };
/** Item `of`'s Links as `as` reads them: what the api opens a Link by its id from. */
const links = (as: string, of: string) =>
  tower.call<LinkRow>(as, sql`select id, kind, field_key, document_number, subject, work_item_id from app.work_item_links(${of}::uuid)`);
/** Item `id`, as `as` reads it through the app role's RLS: one row when they may see it. */
const itemById = (as: string, id: string) => tower.call<{ id: string }>(as, sql`select id from work_item where id = ${id}::uuid`);

/** C1's Engineer raises `title` on `trade` in Building A; returns its id. */
async function raised(title: string, trade: string): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: title })}::jsonb,
      ${trade}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

/** C1 Sends item `id` for review, and its PM Submits it to K1. */
async function submit(id: string) {
  const { c1 } = tower;
  expect(await tower.take(c1.members.engineer, id, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(c1.members.project_manager, id)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, id, "submit")).toBe("applied");
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-521 Link page ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Link page (RP-521)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Link page (RP-521)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, c2 } = tower;
  mechanical = (
    await tower.call<{ value_id: string }>(
      c1.ap,
      sql`select value_id from app.add_dimension_value(${tower.projectId}::uuid, 'trade', null, 'ME', ${JSON.stringify(bilingual("Mechanical"))}::jsonb)`,
    )
  )[0]!.value_id;

  // K1's Mechanical manager: on the Project, covering the Mechanical Trade only.
  k1Mechanical = (
    await migrator.query("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      k1.id,
      `k1-mechanical-${digits(8)}@rabaed.test`,
      JSON.stringify(bilingual("K1 Mechanical manager")),
    ])
  ).rows[0].id as string;
  await tower.call(k1.ap, sql<{ outcome: string }>`select app.add_project_member(${k1.participantId}::uuid, ${k1Mechanical}::uuid, now())`);
  expect(await tower.outcome(k1.ap, sql`select app.set_member_visibility(${k1.participantId}::uuid, ${k1Mechanical}::uuid, 'trade', false, ${[mechanical]}::uuid[], now()) as outcome`)).toBe("set");
  expect(await tower.outcome(k1.ap, sql`select app.set_member_visibility(${k1.participantId}::uuid, ${k1Mechanical}::uuid, 'location', true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  expect(await tower.outcome(k1.ap, sql`select app.set_project_member_positions(${k1.participantId}::uuid, ${k1Mechanical}::uuid, ${["manager"]}::text[]) as outcome`)).toBe("set");
  for (const [as, name] of [
    [c1.members.engineer, "C1 engineer"],
    [k1.members.manager, "K1 manager"],
    [k1Mechanical, "K1 Mechanical manager"],
    [c2.members.engineer, "C2 engineer"],
  ] as const)
    names.set(as, name);

  // C1's Electrical item, Submitted (Link search offers only those), then its Mechanical MAR linking to it, Submitted too.
  electrical = await raised("Cable trays, approved", tower.tradeId);
  await submit(electrical);
  mar = await raised("Chilled water pipes", mechanical);
  const [added] = await tower.call<{ outcome: string; link_id: string }>(c1.members.engineer, sql`select outcome, link_id from app.add_work_item_link(${mar}::uuid, ${electrical}::uuid, now())`);
  expect(added!.outcome).toBe("added");
  link = added!.link_id;
  await submit(mar);
  electricalNumber = (await migrator.query("select document_number from work_item where id = $1", [electrical])).rows[0].document_number as string;
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-521-1: K1's Mechanical manager opens the Link from the Mechanical MAR to C1's Electrical item, at seam 2", () => {
  it("reads the Link as the item's number and Subject only, with no id of it", async () => {
    expect(await links(k1Mechanical, mar)).toEqual([
      { id: link, kind: "related", field_key: null, document_number: electricalNumber, subject: "Cable trays, approved", work_item_id: null },
    ]);
  });

  it("gets the item's id only where it sees the item: K1's manager does, the Mechanical manager doesn't, anywhere in the read", async () => {
    const { k1, c1 } = tower;
    const linkedIds = async (as: string) => (await links(as, mar)).flatMap((l) => (l.work_item_id ? [{ id: l.work_item_id }] : []));
    await expectHiddenFrom({ read: linkedIds, target: electrical, seenBy: [k1.members.manager, c1.members.engineer], hiddenFrom: k1Mechanical, name: named, label: "the Link's item id" });
    const holdsId = async (as: string) => (JSON.stringify(await links(as, mar)).includes(electrical) ? [{ id: electrical }] : []);
    await expectHiddenFrom({ read: holdsId, target: electrical, seenBy: k1.members.manager, hiddenFrom: k1Mechanical, name: named, label: "the item's id, anywhere in the Link's read" });
    // Its URL stays 404 to them: the item itself is hidden.
    await expectHiddenFrom({ read: (as: string) => itemById(as, electrical), target: electrical, seenBy: k1.members.manager, hiddenFrom: k1Mechanical, name: named, label: "the item" });
  });

  it("gives C2, who can't see the MAR, no Link", async () => {
    const { k1, c2 } = tower;
    // The positive control: C2 reads its own item, so the refusals below are V3, not a C2 that reads nothing.
    const own = await c2Draft(tower, { type: TYPE, title: "Cable ladders" });
    expect(await itemById(c2.members.engineer, own)).toEqual([{ id: own }]);
    await expectHiddenFrom({
      read: (as: string) => links(as, mar),
      target: link,
      seenBy: [k1Mechanical, k1.members.manager],
      hiddenFrom: c2.members.engineer,
      name: named,
      label: "the Link, through the MAR",
    });
    await expectHiddenFrom({ read: (as: string) => itemById(as, mar), target: mar, seenBy: k1Mechanical, hiddenFrom: c2.members.engineer, name: named, label: "the MAR" });
  });
});
