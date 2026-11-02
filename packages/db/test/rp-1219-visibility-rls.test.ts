// Seam 2 for scenario RP-1219-1 (visibility.md row 73, V3), as the app role: the Kanban's Draft column. C1 and
// C2, two Contractors on one Project, each raise Submittal Drafts; K1 is its Consultant. app.raisable_type_ids,
// the rule the Kanban asks whether to show the Draft column (and the Register Import's 403), gives C1's and C2's
// engineers a Submittals Type and K1's Members none. app.work_items_seen, which the column reads, gives each
// Contractor only its own Participant's Drafts and K1 none of them. Seam 1: apps/api/test/rp-1219-visibility.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, c2Draft, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const towerOptions = { projectCode: "RDC", k1Manager: true, checklistTemplate: false } as const;

let migrator: pg.Client;
let app: Db;
let t: SeamTwoTower<typeof towerOptions>;
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

let c1Drafts: string[] = [];
let c2Drafts: string[] = [];

/** How many Submittals Types app.raisable_type_ids lets `as` raise on the Tower. */
const raisable = async (as: string) =>
  (await t.call<{ count: number }>(as, sql`select count(*)::int as count from app.raisable_type_ids(${t.projectId}::uuid, 'submittals')`))[0]!.count;

/** The Drafts app.work_items_seen gives `as` on the Tower's Submittals: the rows the Kanban's Draft column holds. */
const draftsSeen = async (as: string) =>
  (
    await t.call<{ id: string }>(
      as,
      sql`select w.id from app.work_items_seen(${t.projectId}::uuid, array['submittals']::text[], false, null) w where w.stage_key = 'draft'`,
    )
  ).map((r) => ({ id: r.id }));

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  t = await buildSeamTwoTower(app, migrator, towerOptions);
  for (const [as, name] of [
    [t.c1.members.engineer, "C1 engineer"],
    [t.c1.members.project_manager, "C1 PM"],
    [t.c2.members.engineer, "C2 engineer"],
    [t.k1.members.engineer, "K1 engineer"],
    [t.k1.members.manager, "K1 manager"],
  ] as const)
    names.set(as, name);

  const c1Draft = async (title: string) => {
    const [created] = await t.call<{ outcome: string; work_item_id: string }>(
      t.c1.members.engineer,
      sql`select outcome, work_item_id from app.create_work_item(
        ${t.projectId}::uuid, 'MAR', ${title}, app.latest_form_version('MAR'), '{}'::jsonb, ${t.tradeId}::uuid, ${t.buildingA}::uuid, now())`,
    );
    if (created!.outcome !== "created") throw new Error(`C1 draft: ${created!.outcome}`);
    return created!.work_item_id;
  };
  c1Drafts = [await c1Draft("Cable tray risers"), await c1Draft("Busbar trunking")];
  c2Drafts = [await c2Draft(t, { type: "MAR", title: "Chilled water pumps" })];
});

afterAll(async () => {
  await app.destroy();
  await migrator.end();
});

describe("scenario RP-1219-1: the Kanban's Draft column, C1 and C2 raising Drafts on one Project with K1", () => {
  it("app.raisable_type_ids gives each Contractor's engineer a Submittals Type to raise, and K1's Members none", async () => {
    for (const as of [t.c1.members.engineer, t.c2.members.engineer]) expect(await raisable(as), named(as)).toBeGreaterThan(0);
    for (const as of [t.k1.members.engineer, t.k1.members.manager]) expect(await raisable(as), named(as)).toBe(0);
  });

  it("app.work_items_seen gives the Draft column only the viewer's own Participant's Drafts: C1's to C1, C2's to C2, none to K1", async () => {
    for (const id of c1Drafts) {
      await expectHiddenFrom({
        read: draftsSeen,
        target: id,
        seenBy: [t.c1.members.engineer],
        hiddenFrom: [t.c2.members.engineer, t.k1.members.engineer, t.k1.members.manager],
        name: named,
        label: "C1's Draft",
      });
    }
    for (const id of c2Drafts) {
      await expectHiddenFrom({
        read: draftsSeen,
        target: id,
        seenBy: [t.c2.members.engineer],
        hiddenFrom: [t.c1.members.engineer, t.c1.members.project_manager, t.k1.members.engineer, t.k1.members.manager],
        name: named,
        label: "C2's Draft",
      });
    }
  });
});
