// Seam 2 for a PDF's page count (RP-1189; gap table v3 row 14), as the app role: app.confirm_document_upload
// keeps the page count the api counted in a PDF's stored bytes, and none for any other file or a count
// that isn't a page; document.page_count is read as the Document is, by who sees it (its own RLS).
// Seam 1: apps/api/test/document-page-count.test.ts (with the Revision's and the Duplicate's copies).
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, sha256Bytea, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RG${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RGP" } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let item = "";

/** `as` uploads `fileName` to the item and confirms it with `pages` counted; returns the Document's id. */
async function uploaded(as: string, fileName: string, contentType: string, pages: number | null): Promise<string> {
  const [started] = await tower.call<{ outcome: string; document_id: string }>(
    as,
    sql`select outcome, document_id from app.start_document_upload(${item}::uuid, ${fileName}, 10, ${contentType}, now(), null)`,
  );
  expect(started!.outcome).toBe("started");
  expect(
    await tower.outcome(
      as,
      sql`select app.confirm_document_upload(${item}::uuid, ${started!.document_id}::uuid, 10, ${contentType}, ${sha256Bytea(fileName)}, now(),
        null, null, null, ${pages}::integer) as outcome`,
    ),
  ).toBe("confirmed");
  return started!.document_id;
}
/** The Documents `as` reads on the item, with their page counts. */
const pagesRead = (as: string) => tower.call<{ id: string; page_count: number | null }>(as, sql`select id, page_count from document where work_item_id = ${item}::uuid`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);
  const workflow = await addTestWorkflow(run, { name: bilingual(`RP-1189 pages ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Pages (RP-1189)"))])).rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Pages (RP-1189)")), workflow, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'Pages', app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "PG-1" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  item = created!.work_item_id;
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a PDF's page count", () => {
  it("is kept for a PDF and read by who sees the Document; none for an image or a count that isn't a page", async () => {
    const { c1, k1 } = tower;
    const pdf = await uploaded(c1.members.engineer, "drawings.pdf", "application/pdf", 7);
    const image = await uploaded(c1.members.engineer, "site.png", "image/png", 5);
    const zero = await uploaded(c1.members.engineer, "empty.pdf", "application/pdf", 0);
    const unread = await uploaded(c1.members.engineer, "broken.pdf", "application/pdf", null);
    const read = Object.fromEntries((await pagesRead(c1.members.project_manager)).map((r) => [r.id, r.page_count]));
    expect(read).toEqual({ [pdf]: 7, [image]: null, [zero]: null, [unread]: null });
    // K1 doesn't see C1's Draft, nor its Documents' page counts.
    await expectHiddenFrom({ read: pagesRead, target: pdf, seenBy: c1.members.project_manager, hiddenFrom: k1.members.engineer, label: "the Draft's PDF" });
  });
});
