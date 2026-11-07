// Seam 2 for renaming and deactivating a Project's Trades and Locations (RP-1239; visibility.md V15,
// V16; scenarios RP-1239-1 to RP-1239-4), as the app role. Only the Project's Project Admins rename or
// deactivate a value; a deactivated value keeps the grants and Work Items that already use it, so
// nobody loses or gains Visibility; it is never picked anew; and the Visibility Gap counts it only
// while a Work Item uses it. Seam 1: apps/api/test/rp-1239-visibility.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, c2Draft, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const towerOptions = { projectCode: "RTL", otherProject: true } as const;

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower<typeof towerOptions>;
let gapTower: SeamTwoTower;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  gapTower = await buildSeamTwoTower(app, migrator, { projectCode: "RTG" });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** What the helpers below use of either Tower. */
type AnyTower = Pick<SeamTwoTower, "projectId" | "tradeId" | "c1" | "call" | "outcome">;

type Value = { id: string; code: string; name: { en: string; ar: string }; status: string };
const valueOf = async (id: string): Promise<Value> =>
  (await migrator.query("select id, code, name, status from dimension_value where id = $1", [id])).rows[0] as Value;

/** `as` renames (`name`) or deactivates and reactivates (`active`) value `id` of `kind`; returns the outcome. */
const update = (t: Pick<SeamTwoTower, "outcome">, as: string, kind: string, id: string, change: { name?: object; active?: boolean }) =>
  t.outcome(
    as,
    sql`select app.update_dimension_value(${id}::uuid, ${kind}, ${change.name ? JSON.stringify(change.name) : null}::jsonb, ${change.active ?? null}::boolean, now()) as outcome`,
  );

const add = async (t: AnyTower, kind: string, code: string, parent: string | null = null): Promise<string> => {
  const [row] = await t.call<{ outcome: string; value_id: string }>(
    t.c1.ap,
    sql`select outcome, value_id from app.add_dimension_value(${t.projectId}::uuid, ${kind}, ${parent}::uuid, ${code}, ${JSON.stringify(bilingual(code))}::jsonb)`,
  );
  if (row!.outcome !== "added") throw new Error(`add ${code}: ${row!.outcome}`);
  return row!.value_id;
};

const generalTrade = async (projectId: string): Promise<string> =>
  (
    await migrator.query(
      "select v.id from dimension_value v join visibility_dimension d on d.id = v.dimension_id where d.project_id = $1 and d.kind = 'trade' and v.code = 'GEN'",
      [projectId],
    )
  ).rows[0].id as string;

/** C1's Engineer raises a Draft on the Tower's Trade at `location`; returns the outcome and the item. */
const c1Draft = async (t: AnyTower, location: string, trade = t.tradeId) =>
  (
    await t.call<{ outcome: string; work_item_id: string | null }>(
      t.c1.members.engineer,
      sql`select outcome, work_item_id from app.create_work_item(
        ${t.projectId}::uuid, 'WIR', 'Slab pour', app.latest_form_version('WIR'), '{}'::jsonb, ${trade}::uuid, ${location}::uuid, now())`,
    )
  )[0]!;

describe("scenario RP-1239-1: only the Project's Project Admins rename or deactivate its Trades and Locations", () => {
  it("lets the Project Admin rename a Trade; only the name changes, never the code", async () => {
    const before = await valueOf(tower.tradeId);
    expect(await update(tower, tower.c1.ap, "trade", tower.tradeId, { name: { en: "Electrical works", ar: "أعمال كهربائية" } })).toBe("updated");
    const after = await valueOf(tower.tradeId);
    expect(after.name).toEqual({ en: "Electrical works", ar: "أعمال كهربائية" });
    expect(after.code).toBe(before.code);
  });

  it("names nothing to anyone else: other Members of the Admin's Company, every other Company, and another Project's Admin", async () => {
    const names = new Map([
      [tower.c1.ap, "C1's Authorized Person, the Project Admin"],
      [tower.c1.members.engineer, "C1's engineer"],
      [tower.c1.members.project_manager, "C1's Project Manager"],
      [tower.k1.ap, "K1's Authorized Person"],
      [tower.k1.members.engineer, "K1's engineer"],
      [tower.ow.ap, "OW's Authorized Person"],
      [tower.c2.ap, "C2's Authorized Person"],
      [tower.c2.members.engineer, "C2's engineer"],
      [tower.other.ap, "another Project's Authorized Person and Admin"],
    ]);
    const name = { en: "Electrical works", ar: "أعمال كهربائية" };
    // "Read" here is the write: a row back means the rename went through for `as`.
    await expectHiddenFrom({
      read: async (as: string) => ((await update(tower, as, "trade", tower.tradeId, { name })) === "updated" ? [{ id: tower.tradeId }] : []),
      target: tower.tradeId,
      seenBy: tower.c1.ap,
      hiddenFrom: [
        tower.c1.members.engineer,
        tower.c1.members.project_manager,
        tower.k1.ap,
        tower.k1.members.engineer,
        tower.ow.ap,
        tower.c2.ap,
        tower.c2.members.engineer,
        tower.other.ap,
      ],
      name: (as: string) => names.get(as) ?? as,
      label: "renaming a Trade",
    });
    for (const as of [tower.k1.ap, tower.c2.ap, tower.other.ap]) {
      expect(await update(tower, as, "location", tower.buildingA, { active: false })).toBe("not_found");
    }
    expect((await valueOf(tower.buildingA)).status).toBe("active");
  });

  it("refuses the Admin a value of another Project, or of the other dimension, as not_found", async () => {
    expect(await update(tower, tower.c1.ap, "trade", await generalTrade(tower.other.projectId), { name: bilingual("Mine") })).toBe("not_found");
    expect(await update(tower, tower.c1.ap, "trade", tower.buildingA, { name: bilingual("Mine") })).toBe("not_found");
    expect(await update(tower, tower.c1.ap, "location", tower.tradeId, { name: bilingual("Mine") })).toBe("not_found");
  });

  it("renames the General Trade (GEN) but never deactivates it", async () => {
    const gen = await generalTrade(tower.projectId);
    expect(await update(tower, tower.c1.ap, "trade", gen, { name: { en: "General works", ar: "أعمال عامة" } })).toBe("updated");
    expect(await update(tower, tower.c1.ap, "trade", gen, { active: false })).toBe("general_trade");
    const after = await valueOf(gen);
    expect(after).toMatchObject({ code: "GEN", status: "active", name: { en: "General works", ar: "أعمال عامة" } });
  });

  it("deactivates a Location with every Location below it, and reactivates none below a deactivated one", async () => {
    const zone = await add(tower, "location", "ZN");
    const building = await add(tower, "location", "BL", zone);
    const floor = await add(tower, "location", "FL", building);
    expect(await update(tower, tower.c1.ap, "location", zone, { active: false })).toBe("updated");
    for (const id of [zone, building, floor]) expect((await valueOf(id)).status).toBe("deactivated");
    expect(await update(tower, tower.c1.ap, "location", floor, { active: true })).toBe("parent_deactivated");
    expect(await update(tower, tower.c1.ap, "location", zone, { active: true })).toBe("updated");
    expect((await valueOf(zone)).status).toBe("active");
    expect((await valueOf(building)).status).toBe("deactivated");
    expect(await update(tower, tower.c1.ap, "location", building, { active: true })).toBe("updated");
    expect(await update(tower, tower.c1.ap, "location", floor, { active: true })).toBe("updated");
  });
});

describe("scenario RP-1239-2: a deactivated value keeps its grants and Work Items: nobody loses or gains Visibility", () => {
  let draft = "";

  beforeAll(async () => {
    draft = await c2Draft(tower, { type: "WIR", title: "Column pour" });
    expect(await update(tower, tower.c1.ap, "location", tower.buildingB, { active: false })).toBe("updated");
  });

  it("leaves C2's Work Item on the deactivated Building to C2, and to no one it was hidden from", async () => {
    await expectHiddenFrom({
      read: (as: string) => tower.call<{ id: string }>(as, sql`select id from work_item where id = ${draft}::uuid`),
      target: draft,
      seenBy: tower.c2.members.engineer,
      hiddenFrom: [tower.c1.members.engineer, tower.k1.members.engineer, tower.ow.members.representative, tower.other.ap],
      label: "C2's Draft on a deactivated Building",
    });
  });

  it("keeps the deactivated Building in C2's grant, read as deactivated by C2 and the Project Admin only", async () => {
    type Covered = { id: string; status: string };
    const covered = (as: string) => tower.call<Covered>(as, sql`select id, status from app.participant_covered_values(${tower.c2.participantId}::uuid)`);
    expect((await covered(tower.c2.ap)).find((v) => v.id === tower.buildingB)?.status).toBe("deactivated");
    await expectHiddenFrom({
      read: covered,
      target: tower.buildingB,
      seenBy: [tower.c2.ap, tower.c1.ap],
      hiddenFrom: [tower.c1.members.engineer, tower.k1.ap, tower.k1.members.engineer, tower.ow.ap, tower.other.ap],
      label: "C2's covered values",
    });
  });
});

describe("scenario RP-1239-3: a deactivated value is never picked anew, for a Work Item or a grant", () => {
  let zone = "";

  beforeAll(async () => {
    zone = await add(tower, "location", "ZP");
    expect(await update(tower, tower.c1.ap, "location", zone, { active: false })).toBe("updated");
  });

  it("refuses a new Work Item on a deactivated Location, while an active one is accepted", async () => {
    expect((await c1Draft(tower, tower.buildingA)).outcome).toBe("created");
    expect((await c1Draft(tower, zone)).outcome).toBe("value_not_found");
  });

  it("refuses a Participant grant that newly lists a deactivated value, but keeps one it already lists", async () => {
    const set = (values: string[]) =>
      tower.outcome(tower.c1.ap, sql`select app.set_participant_visibility(${tower.c2.participantId}::uuid, 'location', false, ${values}::uuid[], now()) as outcome`);
    expect(await set([tower.buildingB, zone])).toBe("value_not_found");
    expect(await set([tower.buildingB])).toBe("set");
  });

  it("refuses a Project Member grant that newly lists a deactivated value, but keeps one it already lists", async () => {
    const set = (values: string[]) =>
      tower.outcome(
        tower.c2.ap,
        sql`select app.set_member_visibility(${tower.c2.participantId}::uuid, ${tower.c2.members.engineer}::uuid, 'location', false, ${values}::uuid[], now()) as outcome`,
      );
    expect(await set([tower.buildingB])).toBe("set");
    expect(await set([tower.buildingB])).toBe("set");
    expect(await update(tower, tower.c1.ap, "location", tower.buildingB, { active: true })).toBe("updated");
    const zoneB = await add(tower, "location", "ZQ");
    expect(
      await tower.outcome(tower.c1.ap, sql`select app.set_participant_visibility(${tower.c2.participantId}::uuid, 'location', false, ${[tower.buildingB, zoneB]}::uuid[], now()) as outcome`),
    ).toBe("set");
    expect(await update(tower, tower.c1.ap, "location", zoneB, { active: false })).toBe("updated");
    expect(await set([tower.buildingB, zoneB])).toBe("value_not_found");
  });
});

describe("scenario RP-1239-4: the Visibility Gap counts a deactivated value only while a Work Item uses it", () => {
  let used = "";
  let unused = "";

  beforeAll(async () => {
    used = await add(gapTower, "location", "ZU");
    unused = await add(gapTower, "location", "ZN");
    expect((await c1Draft(gapTower, used)).outcome).toBe("created");
    // Every Participant covers Buildings A and B only, so the two new Zones are in the gap.
    for (const p of [gapTower.c1.participantId, gapTower.k1.participantId, gapTower.ow.participantId, gapTower.c2.participantId]) {
      expect(
        await gapTower.outcome(
          gapTower.c1.ap,
          sql`select app.set_participant_visibility(${p}::uuid, 'location', false, ${[gapTower.buildingA, gapTower.buildingB]}::uuid[], now()) as outcome`,
        ),
      ).toBe("set");
    }
  });

  const gap = (as: string) =>
    gapTower.call<{ id: string; status: string }>(as, sql`select id, status from app.project_visibility_gap(${gapTower.projectId}::uuid) where kind = 'location'`);

  it("names both Zones while they are active", async () => {
    expect((await gap(gapTower.c1.ap)).map((v) => v.id).sort()).toEqual([used, unused].sort());
  });

  it("drops the deactivated Zone no Work Item uses, and keeps, as deactivated, the one a Work Item uses", async () => {
    for (const id of [used, unused]) expect(await update(gapTower, gapTower.c1.ap, "location", id, { active: false })).toBe("updated");
    expect(await gap(gapTower.c1.ap)).toEqual([{ id: used, status: "deactivated" }]);
  });

  it("is still the Project Admin's only", async () => {
    await expectHiddenFrom({
      read: gap,
      target: used,
      seenBy: gapTower.c1.ap,
      hiddenFrom: [gapTower.c1.members.engineer, gapTower.k1.ap, gapTower.ow.ap, gapTower.c2.ap, gapTower.c2.members.engineer],
      label: "the Project's Visibility Gap",
    });
  });
});
