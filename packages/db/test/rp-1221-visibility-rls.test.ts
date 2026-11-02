// Seam 2 for the New Inspection's route preview (RP-1221, gap rows 23 and 24; visibility.md V1, V15,
// V20; scenario RP-1221-1), as the app role, through the reads the api's preview runs for the WIR:
// the Inspections Types the Member may raise (app.raisable_type_ids), the Version a new WIR would
// start on (app.new_item_workflow_version) and that Version's Steps. Hafiz, a C1 engineer, reads the
// WIR's Steps and their roles; nothing he reads holds a Company's, a Participant's or a Member's id.
// K1's engineer, who inspects but raises no WIR, and a Member off the Project may not raise it.
// Seam 1: apps/api/test/rp-1221-wir-route-preview.test.ts.
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RPW", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let wirId = "";
const names = new Map<string, string>();

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  wirId = (await migrator.query("select id from work_item_type where owner_kind = 'rabaed' and code = 'WIR'")).rows[0].id as string;
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  for (const [as, name] of [
    [tower.c1.members.engineer, "Hafiz (C1's engineer)"],
    [tower.k1.members.engineer, "K1's engineer"],
    [tower.other.ap, "a Member off the Project"],
  ] as const)
    names.set(as, name);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** The Inspections Types `as` may raise on the Tower. */
const raisable = (as: string) =>
  tower.call<{ id: string }>(as, sql`select work_item_type_id as id from app.raisable_type_ids(${tower.projectId}::uuid, 'inspections')`);

/** The Steps of the Version a new WIR would start on for `as`, as the preview reads them. */
async function previewSteps(as: string) {
  return tower.call<{ key: string; role: string | null; row: unknown }>(
    as,
    sql`select s.key, app.actor_holder(s.actor_rule) as role, to_jsonb(s) - 'id' - 'workflow_version_id' as row
      from workflow_step s
      where s.workflow_version_id = app.new_item_workflow_version(${tower.projectId}::uuid, ${wirId}::uuid, (
        select pm.participant_id from project_member pm
        where pm.project_id = ${tower.projectId}::uuid and pm.member_id = app.current_member_id() and pm.status = 'active'))
      order by s.key`,
  );
}

describe("scenario RP-1221-1: the New Inspection's route preview names no Company and no Member", () => {
  it("Hafiz may raise a WIR; K1's engineer and a Member off the Project may not", async () => {
    await expectHiddenFrom({
      read: raisable,
      target: wirId,
      seenBy: tower.c1.members.engineer,
      hiddenFrom: [tower.k1.members.engineer, tower.other.ap],
      name: (as: string) => names.get(as) ?? as,
      label: "the Inspections Types one may raise",
    });
  });

  it("Hafiz reads the WIR's Steps and their roles, and no id of a Company, Participant or Member", async () => {
    const steps = await previewSteps(tower.c1.members.engineer);
    expect(steps.find((s) => s.key === "draft")).toMatchObject({ role: "contractor" });
    expect(steps.find((s) => s.key === "consultant_engineer")).toMatchObject({ role: "consultant" });
    const read = JSON.stringify(steps.map((s) => s.row));
    const ids = [tower.c1, tower.k1, tower.c2].flatMap((c) => [c.id, c.ap, ...Object.values(c.members)]);
    const { rows: participants } = await migrator.query("select id from participant where project_id = $1", [tower.projectId]);
    for (const id of [...ids, ...participants.map((p: { id: string }) => p.id)]) expect(read).not.toContain(id); // not hidden-from: the Steps Hafiz just read, his Draft Step among them
  });
});
