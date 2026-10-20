// Seam 2 for the Tower fixture itself (RP-980): `wirAtConsultant` leaves the WIR with K1's Engineer whether K1 has a
// Manager (the Step waits, the Engineer picks it up) or only that Engineer (it holds the Step as it arrives);
// `c2Draft` (RP-995) leaves a Draft only C2 sees, the positive control beside a refusal to C2.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, c2Draft, testDatabaseUrls, wirAtConsultant } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;

/** Who holds item `id` at its current Step, and in what state. */
async function holder(id: string): Promise<{ assignee_member_id: string; status: string }[]> {
  const { rows } = await migrator.query(
    "select assignee_member_id, status from step_assignment where work_item_id = $1 and step_id = (select current_step_id from work_item where id = $1)",
    [id],
  );
  return rows;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("wirAtConsultant", () => {
  it("on a Tower whose K1 has only an Engineer, leaves the WIR held by that Engineer", async () => {
    const tower = await buildSeamTwoTower(app, migrator, { projectCode: "RTA" });
    const id = await wirAtConsultant(tower, { type: "WIR", title: "Slab pour" });
    expect(await holder(id)).toEqual([{ assignee_member_id: tower.k1.members.engineer, status: "picked_up" }]);
  });

  it("on a Tower whose K1 also has a Manager, has the Engineer pick the WIR up", async () => {
    const tower = await buildSeamTwoTower(app, migrator, { projectCode: "RTB", k1Manager: true });
    const id = await wirAtConsultant(tower, { type: "WIR", title: "Slab pour" });
    expect(await holder(id)).toEqual([{ assignee_member_id: tower.k1.members.engineer, status: "picked_up" }]);
  });
});

describe("c2Draft", () => {
  it("leaves a Draft that C2's Engineer holds and sees, and C1, K1 and the Owner don't (V1)", async () => {
    const tower = await buildSeamTwoTower(app, migrator, { projectCode: "RTC" });
    const id = await c2Draft(tower, { type: "WIR", title: "Slab pour" });
    const sees = (as: string) => tower.call<{ sees: boolean }>(as, sql`select app.sees_work_item(${id}::uuid) as sees`).then((r) => r[0]!.sees);
    expect(await holder(id)).toEqual([{ assignee_member_id: tower.c2.members.engineer, status: "picked_up" }]);
    expect(await sees(tower.c2.members.engineer)).toBe(true);
    for (const outsider of [tower.c1.members.engineer, tower.k1.members.engineer, tower.ow.members.representative]) expect(await sees(outsider)).toBe(false);
  });
});
