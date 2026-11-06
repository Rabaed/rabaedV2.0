// Seam 2 for the Activity Feed page's viewer flags (RP-1157; visibility.md "Activity Feed", V5, V14;
// scenarios RP-1157-1 and RP-1157-2), as the app role. app.activity_feed's `on_item` says the reader
// is on the entry's item, by the rule "Only items I'm on" filters by; `by_me` says the reader took
// the event. Both are about the reader only: neither tells anyone that another Member is on an item
// or took a move, whether of their own Company or another.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
let migrator: pg.Client;
let app: Db;
// The Tower (RP-980): C1 raises, K1 reviews (an Engineer, who is given the item at K1's review, and a
// Manager, who is not on it), OW oversees.
let tower: SeamTwoTower<{ k1Manager: true }>;
/** C1's WIR: raised by C1's Engineer, picked up and Submitted to K1 by C1's PM. */
let item = "";
/** Another C1 Engineer on the Project, covering all it covers, who is not on the item. */
let c1Other = "";
/** The Submit's event id. */
let submit = "";

type FeedRow = { id: string; work_item_id: string; type: string; on_item: boolean; by_me: boolean };

/** `as`'s whole feed of the Tower. */
const feed = (as: string) =>
  tower.call<FeedRow>(as, sql`select id, work_item_id, type, on_item, by_me from app.activity_feed(${tower.projectId}::uuid, null, '{}'::text[], false, null, 101)`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, { projectCode: "RAF", k1Manager: true });
  const { c1 } = tower;
  c1Other = (
    await migrator.query("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      c1.id,
      `c1-other-${digits(8)}@rabaed.test`,
      JSON.stringify(bilingual("C1 other engineer")),
    ])
  ).rows[0].id as string;
  await tower.call(c1.ap, sql<{ outcome: string }>`select app.add_project_member(${c1.participantId}::uuid, ${c1Other}::uuid, now())`);
  for (const kind of ["trade", "location"]) {
    expect(await tower.outcome(c1.ap, sql`select app.set_member_visibility(${c1.participantId}::uuid, ${c1Other}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
  expect(await tower.outcome(c1.ap, sql`select app.set_project_member_positions(${c1.participantId}::uuid, ${c1Other}::uuid, ${["engineer"]}::text[]) as outcome`)).toBe("set");
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, 'WIR', 'Slab pour', app.latest_form_version('WIR'), ${JSON.stringify({ checklist_template: tower.checklistVersionId })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  item = created!.work_item_id;
  expect(await tower.outcome(c1.members.engineer, sql`select app.sync_work_item_checklists(${item}::uuid, now()) as outcome`)).toBe("synced");
  expect(await tower.take(c1.members.engineer, item, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(c1.members.project_manager, item)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, item, "submit")).toBe("applied");
  // The PM's one Transition on it: the Submit.
  submit = (await feed(c1.members.project_manager)).find((e) => e.work_item_id === item && e.by_me && e.type === "transition")!.id;
});

afterAll(async () => {
  await migrator.end();
  await app.destroy();
});

describe("RP-1157: the Activity Feed's flags are about the reader only", () => {
  it("RP-1157-1: on_item is set for the Members on the item, and for nobody else who reads its entries", async () => {
    const { c1, k1, ow } = tower;
    // On it: C1's raiser and the PM who Submitted it, and K1's Engineer, given it at K1's review.
    const on = [c1.members.engineer, c1.members.project_manager, k1.members.engineer];
    // Not on it, though each reads its entries: another C1 Engineer, K1's Manager, the Owner.
    const others = [c1Other, k1.members.manager, ow.members.representative];
    // Positive control: everyone above reads the Submit, so a missing flag is not a missing entry.
    await expectHiddenFrom({ read: feed, target: submit, seenBy: [...on, ...others], hiddenFrom: [tower.c2.members.engineer], label: "RP-1157-1 the Submit" });
    // The items each reader's feed flags as theirs.
    const flagged = async (as: string) => (await feed(as)).filter((e) => e.on_item).map((e) => ({ id: e.work_item_id }));
    await expectHiddenFrom({ read: flagged, target: item, seenBy: on, hiddenFrom: others, label: "RP-1157-1 on_item" });
    // Every entry of the item, not only some, carries the reader's flag.
    for (const e of (await feed(c1.members.engineer)).filter((x) => x.work_item_id === item)) expect(e.on_item).toBe(true);
    // The filter and the flag agree: "Only items I'm on" gives the flagged entries, and only them.
    const mine = await tower.call<FeedRow>(c1.members.project_manager, sql`select id, on_item from app.activity_feed(${tower.projectId}::uuid, null, '{}'::text[], true, null, 101)`);
    expect(mine.map((e) => e.id)).toContain(submit);
    expect(mine.every((e) => e.on_item)).toBe(true);
  });

  it("RP-1157-2: by_me is set for the Member who took the event, and for nobody else who reads it", async () => {
    const { c1, k1, ow } = tower;
    const byMe = async (as: string) => (await feed(as)).filter((e) => e.by_me);
    await expectHiddenFrom({
      read: byMe,
      target: submit,
      seenBy: c1.members.project_manager,
      hiddenFrom: [c1.members.engineer, c1Other, k1.members.engineer, k1.members.manager, ow.members.representative],
      label: "RP-1157-2 by_me",
    });
  });
});
