// Seam 2 for the Visibility Gap leaving discarded Drafts out (RP-1252; scenario RP-1252-1), as the app
// role. A deactivated Trade or Location is in the gap only while a Work Item uses it (RP-1239-4); a
// discarded Draft is no use, while a live or closed Work Item still is. The gap stays the Project
// Admin's only. Seam 1: apps/api/test/rp-1252-visibility.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { bilingual, buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;
let t: SeamTwoTower;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  t = await buildSeamTwoTower(app, migrator, { projectCode: "RGD" });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const addZone = async (code: string): Promise<string> => {
  const [row] = await t.call<{ outcome: string; value_id: string }>(
    t.c1.ap,
    sql`select outcome, value_id from app.add_dimension_value(${t.projectId}::uuid, 'location', null::uuid, ${code}, ${JSON.stringify(bilingual(code))}::jsonb)`,
  );
  if (row!.outcome !== "added") throw new Error(`add ${code}: ${row!.outcome}`);
  return row!.value_id;
};

/** C1's Engineer raises a Draft on the Tower's Trade at `location`; returns the item. */
const draftAt = async (location: string): Promise<string> => {
  const [row] = await t.call<{ outcome: string; work_item_id: string }>(
    t.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${t.projectId}::uuid, 'WIR', 'Slab pour', app.latest_form_version('WIR'), '{}'::jsonb, ${t.tradeId}::uuid, ${location}::uuid, now())`,
  );
  if (row!.outcome !== "created") throw new Error(`draft: ${row!.outcome}`);
  return row!.work_item_id;
};

const gap = (as: string) =>
  t.call<{ id: string; status: string }>(as, sql`select id, status from app.project_visibility_gap(${t.projectId}::uuid) where kind = 'location'`);

describe("scenario RP-1252-1: the Visibility Gap counts no discarded Draft as a use of a deactivated value", () => {
  let discarded = "";
  let live = "";
  let closed = "";

  beforeAll(async () => {
    discarded = await addZone("ZX");
    live = await addZone("ZL");
    closed = await addZone("ZC");
    const discardedDraft = await draftAt(discarded);
    await draftAt(live);
    const closedItem = await draftAt(closed);
    expect(await t.outcome(t.c1.members.engineer, sql`select app.discard_draft(${discardedDraft}::uuid, now()) as outcome`)).toBe("discarded");
    // A closed item that was never discarded (closed here by hand: how it closed does not matter to the gap).
    await migrator.query("update work_item set outcome = 'cancelled', closed_at = now() where id = $1", [closedItem]);
    // Every Participant covers Buildings A and B only, so the three Zones are in the gap.
    for (const p of [t.c1.participantId, t.k1.participantId, t.ow.participantId, t.c2.participantId]) {
      expect(
        await t.outcome(t.c1.ap, sql`select app.set_participant_visibility(${p}::uuid, 'location', false, ${[t.buildingA, t.buildingB]}::uuid[], now()) as outcome`),
      ).toBe("set");
    }
  });

  it("names all three Zones while they are active, the discarded Draft's too", async () => {
    expect((await gap(t.c1.ap)).map((v) => v.id).sort()).toEqual([discarded, live, closed].sort());
  });

  it("drops the deactivated Zone only a discarded Draft uses, and keeps the ones a live or closed item uses", async () => {
    for (const id of [discarded, live, closed]) {
      expect(await t.outcome(t.c1.ap, sql`select app.update_dimension_value(${id}::uuid, 'location', null::jsonb, false, now()) as outcome`)).toBe("updated");
    }
    const rows = await gap(t.c1.ap);
    expect(rows.map((v) => v.id)).not.toContain(discarded);
    expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: live, status: "deactivated" },
        { id: closed, status: "deactivated" },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("is still the Project Admin's only", async () => {
    await expectHiddenFrom({
      read: gap,
      target: live,
      seenBy: t.c1.ap,
      hiddenFrom: [t.c1.members.engineer, t.k1.ap, t.ow.ap, t.c2.ap, t.c2.members.engineer],
      label: "the Project's Visibility Gap",
    });
  });
});
