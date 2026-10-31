// Seam 2 for the Submittal Panel's Attachments (RP-1068, spec RP-1054; visibility.md, scenario
// RP-1068-1): the panel previews a Document only through its signed download URL, which the api
// signs after reading the Document's row under the Work Item's row-level security. So a Company
// that doesn't see the item reads no row of its Documents: neither the list nor the row by id.
// Seam 1 is apps/api/test/documents.test.ts.
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { buildSeamTwoTower, c2Draft, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();

let migrator: pg.Client;
let app: Db;
let t: SeamTwoTower;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  // C2 covers every Location here, so only the Contractor rule keeps C1's item from it.
  t = await buildSeamTwoTower(app, migrator, { c2OtherLocation: false, checklistTemplate: false });
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** `as` uploads a confirmed PDF to `item`, through the app functions; returns its Document's id. */
async function uploaded(as: string, item: string): Promise<string> {
  const [started] = await t.call<{ outcome: string; document_id: string }>(
    as,
    sql`select outcome, document_id from app.start_document_upload(${item}::uuid, 'Luminaire datasheet.pdf', 10, 'application/pdf', now(), null)`,
  );
  expect(started!.outcome).toBe("started");
  expect(
    await t.outcome(
      as,
      sql`select app.confirm_document_upload(${item}::uuid, ${started!.document_id}::uuid, 10, 'application/pdf', ${randomBytes(32)}::bytea, now()) as outcome`,
    ),
  ).toBe("confirmed");
  return started!.document_id;
}

/** What the api reads for the download URL: the Document's row by its id and its item's. */
const byId = (item: string, document: string) => (as: string) =>
  t.call<{ id: string }>(as, sql`select id, storage_key from document where id = ${document}::uuid and work_item_id = ${item}::uuid`);

/** What the api reads for the item's list of Documents. */
const listed = (item: string) => (as: string) =>
  t.call<{ id: string }>(as, sql`select d.id from document d join app.document_times(${item}::uuid) dt on dt.document_id = d.id`);

describe("visibility.md, the Submittal Panel's Attachments", () => {
  it("RP-1068-1: a Company that sees the item reads its Document's row; one that doesn't reads none, by the list or by id", async () => {
    const [scope] = await t.call<{ scope_id: string }>(
      t.c1.ap,
      sql`select scope_id from app.add_scope(${t.projectId}::uuid, ${t.tradeId}::uuid, null, '{"en": "S", "ar": "ن"}'::jsonb)`,
    );
    const [created] = await t.call<{ outcome: string; work_item_id: string }>(
      t.c1.members.engineer,
      sql`select outcome, work_item_id from app.create_work_item(
        ${t.projectId}::uuid, 'MAR', 'Luminaires', app.latest_form_version('MAR'), '{"description": "Linear LED"}'::jsonb,
        ${t.tradeId}::uuid, ${t.buildingA}::uuid, now(), ${[scope!.scope_id]}::uuid[])`,
    );
    expect(created!.outcome).toBe("created");
    const item = created!.work_item_id;
    const document = await uploaded(t.c1.members.engineer, item);
    expect(await t.take(t.c1.members.engineer, item, "send_for_review")).toBe("applied");
    expect(await t.pickUp(t.c1.members.project_manager, item)).toBe("picked_up");
    expect(await t.take(t.c1.members.project_manager, item, "submit")).toBe("applied");

    const names = new Map([
      [t.c1.members.engineer, "C1's engineer"],
      [t.k1.members.engineer, "K1's engineer"],
      [t.c2.members.engineer, "C2's engineer"],
      [t.c2.ap, "C2's Authorized Person"],
    ]);
    const name = (as: string) => names.get(as) ?? as;
    const seenBy = [t.c1.members.engineer, t.k1.members.engineer];
    const hiddenFrom = [t.c2.members.engineer, t.c2.ap];
    await expectHiddenFrom({ read: byId(item, document), target: document, seenBy, hiddenFrom, name, label: "by id" });
    await expectHiddenFrom({ read: listed(item), target: document, seenBy, hiddenFrom, name, label: "the list" });

    // The positive control: C2 reads the Document of an item it does see, its own Draft, so the
    // refusals above are about C1's item, not a C2 Member who reaches no Document at all.
    const own = await c2Draft(t, { type: "MAR", title: "C2's luminaires" });
    const theirs = await uploaded(t.c2.members.engineer, own);
    await expectHiddenFrom({ read: byId(own, theirs), target: theirs, seenBy: t.c2.members.engineer, hiddenFrom: t.c1.members.engineer, name, label: "C2's own" });
  });
});
