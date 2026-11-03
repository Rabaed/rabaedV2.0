// Seam 2 for the New Snag's short form (RP-1222 gap row 25; visibility.md V1, V3; scenario
// RP-1222-1), as the app role. K1's manager creates a Snag Draft (app.create_work_item, Type
// SNG) and its photos are stored on it straight after, as the short form's Save Draft does. The
// Draft and its photos are read inside K1 (its manager and its engineer: the Draft Step leaves
// "Drafts visible to" at the whole Company) and by nobody else: not C1's Members, not a Member off
// the Project. Seam 1: apps/api/test/rp-1222-visibility.test.ts.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const towerOptions = { projectCode: "RSF", otherProject: true, k1Manager: true } as const;

let migrator: pg.Client;
let app: Db;
let tower: SeamTwoTower<typeof towerOptions>;
let snagId = "";
const photoIds: string[] = [];
const names = new Map<string, string>();

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.k1.members.manager,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, 'SNG', 'Cable tray not bonded', app.latest_form_version('SNG'),
      '{"description": "Level 3 riser, east side"}'::jsonb, ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  if (created!.outcome !== "created") throw new Error(`create: ${created!.outcome}`);
  snagId = created!.work_item_id;
  // The photos the short form uploads straight after the create: confirmed Documents of the photos field,
  // written as the owner (rabaed_app can't), as the app.* document functions write them.
  for (const name of ["east.jpg", "close-up.jpg"]) {
    const id = randomUUID();
    await migrator.query(
      `insert into document (id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
         uploaded_by_member_id, uploaded_by_participant_id, confirmed_at, field_key)
       values ($1::uuid, $2::uuid, $3::uuid, $4, 2048, 'image/jpeg', app.document_storage_key($2::uuid, $3::uuid, $1::uuid), $5::uuid, $6::uuid, now(), 'photos')`,
      [id, tower.projectId, snagId, name, tower.k1.members.manager, tower.k1.participantId],
    );
    photoIds.push(id);
  }
  for (const [member, name] of [
    [tower.k1.members.manager, "K1's manager, who raised it"],
    [tower.k1.members.engineer, "K1's engineer"],
    [tower.c1.members.engineer, "C1's engineer"],
    [tower.c1.members.project_manager, "C1's PM"],
    [tower.other.ap, "a Member off the Project"],
  ] as const)
    names.set(member, name);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

const k1Side = () => [tower.k1.members.manager, tower.k1.members.engineer];
const hidden = () => [tower.c1.members.engineer, tower.c1.members.project_manager, tower.other.ap];
const name = (as: string) => names.get(as) ?? as;

describe("scenario RP-1222-1: a Snag saved in the short form, with its photos, stays inside K1", () => {
  it("is a Work Item K1's Members read and nobody else does", async () => {
    await expectHiddenFrom({
      read: (as: string) => tower.call<{ id: string }>(as, sql`select id from work_item where id = ${snagId}::uuid`),
      target: snagId,
      seenBy: k1Side(),
      hiddenFrom: hidden(),
      name,
      label: "the Snag Draft",
    });
  });

  it("holds photos K1's Members read and nobody else does", async () => {
    for (const photo of photoIds) {
      await expectHiddenFrom({
        read: (as: string) => tower.call<{ id: string }>(as, sql`select id from document where work_item_id = ${snagId}::uuid`),
        target: photo,
        seenBy: k1Side(),
        hiddenFrom: hidden(),
        name,
        label: "the Draft's photos",
      });
    }
  });
});
