// Seam 2 for Documents (RP-269): a Document is read under its Work Item's own
// row-level security, so Project B's Documents never return with a Member of
// Project A set; pending and removed uploads return to nobody; the app role
// can't write the table; and a frozen Document never changes, even for its owner.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const email = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

let migrator: pg.Client;
let app: Db;

type Side = { ap: string; projectId: string; itemId: string; documentId: string };
let a: Side; // Project A, its Contractor's Authorized Person.
let b: Side; // Project B, another Company's.

const call = <T extends object>(as: string, query: ReturnType<typeof sql<T>>) =>
  withMember(app, as, (trx) => query.execute(trx).then((r) => r.rows));

async function one(text: string, values: unknown[]): Promise<string> {
  return (await migrator.query(text, values)).rows[0].id as string;
}

/** A Company whose Authorized Person creates a Project, with a Draft MAR on it and one confirmed Document. */
async function side(engineer: string, name: string): Promise<Side> {
  const companyId = await one(
    "insert into company (legal_name, cr_number, vat_number, onboarded_by) values ($1, $2, $3, $4) returning id",
    [JSON.stringify({ en: name, ar: name }), digits(10), `3${digits(13)}3`, engineer],
  );
  const ap = await one(
    "insert into member (company_id, email, full_name, status, can_create_projects) values ($1, $2, $3, 'active', true) returning id",
    [companyId, email("ap"), JSON.stringify({ en: name, ar: name })],
  );
  await migrator.query("update company set authorized_person_id = $1 where id = $2", [ap, companyId]);
  const [created] = await call<{ project_id: string }>(
    ap,
    sql`select project_id from app.create_project(${JSON.stringify({ en: name, ar: name })}::jsonb, 'TWR', 'contractor')`,
  );
  const projectId = created!.project_id;
  const [electrical] = await call<{ value_id: string }>(
    ap,
    sql`select value_id from app.add_dimension_value(${projectId}::uuid, 'trade', null, 'EL', '{"en": "EL", "ar": "EL"}'::jsonb)`,
  );
  const participantId: string = (await migrator.query("select participant_id from project_member where project_id = $1", [projectId]))
    .rows[0].participant_id;
  // The Authorized Person, the Project's creator, covers everything.
  for (const kind of ["trade", "location"]) {
    const set = await call<{ outcome: string }>(ap, sql`
      select app.set_participant_visibility(${participantId}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome
      union all
      select app.set_member_visibility(${participantId}::uuid, ${ap}::uuid, ${kind}, true, '{}'::uuid[], now())`);
    expect(set.map((r) => r.outcome)).toEqual(["set", "set"]);
  }
  const [item] = await call<{ outcome: string; work_item_id: string }>(
    ap,
    sql`select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, 'MAR', 'Cable trays', app.latest_form_version('MAR'), '{}'::jsonb,
      ${electrical!.value_id}::uuid, null, now())`,
  );
  expect(item!.outcome).toBe("created");
  const documentId = await insertDocument(projectId, item!.work_item_id, ap, participantId, { confirmed: true });
  return { ap, projectId, itemId: item!.work_item_id, documentId };
}

/** A Document row written as the owner (rabaed_app can't), as the app.* functions would. */
async function insertDocument(
  projectId: string,
  itemId: string,
  memberId: string,
  participantId: string,
  state: { confirmed?: boolean; removed?: boolean },
): Promise<string> {
  const id = randomUUID();
  await migrator.query(
    `insert into document (id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
       uploaded_by_member_id, uploaded_by_participant_id, confirmed_at, removed_at, removed_by_member_id)
     values ($1::uuid, $2::uuid, $3::uuid, 'datasheet.pdf', 1024, 'application/pdf',
       'projects/' || $2 || '/work-items/' || $3 || '/documents/' || $1, $4::uuid, $5::uuid,
       case when $6::boolean then now() end, case when $7::boolean then now() end, case when $7 then $4::uuid end)`,
    [id, projectId, itemId, memberId, participantId, state.confirmed ?? false, state.removed ?? false],
  );
  return id;
}

const documentIds = (as: string) => call<{ id: string }>(as, sql`select id from document`).then((rows) => rows.map((r) => r.id));

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const engineer = await one("insert into rabaed_engineer (email, full_name) values ($1, 'Seam Two') returning id", [
    email("eng"),
  ]);
  a = await side(engineer, "A");
  b = await side(engineer, "B");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("a Document", () => {
  it("returns to the Members who see its Work Item", async () => {
    expect(await documentIds(a.ap)).toEqual([a.documentId]);
    expect(await documentIds(b.ap)).toEqual([b.documentId]);
  });

  it("of Project B never returns with a Member of Project A set, even by its id", async () => {
    expect(await documentIds(a.ap)).not.toContain(b.documentId);
    const rows = await call<{ id: string }>(a.ap, sql`select id, storage_key from document where id = ${b.documentId}::uuid`);
    expect(rows).toEqual([]);
    const pending = await call<{ storage_key: string }>(a.ap, sql`select storage_key from app.pending_document_upload(${b.itemId}::uuid, ${b.documentId}::uuid)`);
    expect(pending).toEqual([]);
  });

  it("returns nothing with no Member set", async () => {
    const { rows } = await sql`select id from document`.execute(app);
    expect(rows).toEqual([]);
  });

  it("returns to nobody while its upload is pending, or once removed", async () => {
    const participantId = (await migrator.query("select uploaded_by_participant_id as id from document where id = $1", [a.documentId]))
      .rows[0].id;
    const pending = await insertDocument(a.projectId, a.itemId, a.ap, participantId, {});
    const removed = await insertDocument(a.projectId, a.itemId, a.ap, participantId, { confirmed: true, removed: true });
    const seen = await documentIds(a.ap);
    expect(seen).not.toContain(pending);
    expect(seen).not.toContain(removed);
  });
});

describe("the document table, as the app role", () => {
  for (const [what, statement] of [
    ["inserted into", () => sql`insert into document select * from document limit 1`],
    ["updated", () => sql`update document set file_name = 'renamed.pdf'`],
    ["deleted from", () => sql`delete from document`],
  ] as const) {
    it(`can't be ${what}`, async () => {
      await expect(withMember(app, a.ap, (trx) => statement().execute(trx))).rejects.toMatchObject({ code: "42501" });
    });
  }
});

describe("a frozen Document, even as its owner", () => {
  it("refuses any change or removal", async () => {
    await migrator.query("update document set frozen_at = now() where id = $1", [b.documentId]);
    await expect(migrator.query("update document set file_name = 'x.pdf' where id = $1", [b.documentId])).rejects.toMatchObject({
      code: "42501",
    });
    await expect(migrator.query("delete from document where id = $1", [b.documentId])).rejects.toMatchObject({ code: "42501" });
  });
});
