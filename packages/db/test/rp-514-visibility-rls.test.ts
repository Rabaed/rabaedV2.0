// Seam 2 for a Draft Step whose "Drafts visible to" is the author only (RP-514, spec RP-511 decision 4;
// form-engine.md §4; visibility.md V1; scenario RP-514-1), as the app role. Hafiz, a C1 engineer, starts
// a Draft: Omar (another C1 engineer), Ali (C1's PM), C1's Authorized Person and K1 read none of its rows
// and don't count it; Hafiz does, and saves it. Sent for Review it is no Draft: C1 reads it as before, K1
// still doesn't. Badr's Draft is handed over on his deactivation by its Step and Project only, to Omar,
// who then reads and saves it. Under the default, Omar reads Hafiz's Draft but can't save it. On the test
// Send Back Workflow (addTestWorkflow). Seam 1: apps/api/test/holder-edits-form.test.ts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const AUTHOR_ONLY = `RA${letters(3)}`;
const DEFAULT = `RD${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RAO" } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let hafiz = ""; // C1 engineer: writes the Drafts.
let omar = ""; // Another C1 engineer.
let ali = ""; // C1's PM.
let k1 = ""; // K1's engineer.
const names = new Map<string, string>();
const nameOf = (as: string) => names.get(as) ?? as;

/** A Rabaed Type `code` of one text field, on the test Workflow with its Draft Step's "Drafts visible to". */
async function addType(code: string, draftsVisibleTo?: "author") {
  const workflowId = await addTestWorkflow((text) => migrator.query(text), {
    name: bilingual(`RP-514 ${code} ${digits(6)}`),
    ...(draftsVisibleTo ? { draftsVisibleTo } : {}),
  });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual(`Drafts (${code})`))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [code, JSON.stringify(bilingual(`Drafts (${code})`)), workflowId, formId],
  );
}

/** A C1 engineer on the Tower, Visibility of all, besides the Tower's own. */
async function c1Engineer(name: string): Promise<string> {
  const { c1 } = tower;
  const id = (
    await migrator.query("insert into member (company_id, email, full_name, status) values ($1, $2, $3, 'active') returning id", [
      c1.id,
      `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@rabaed.test`,
      JSON.stringify(bilingual(name)),
    ])
  ).rows[0].id as string;
  expect(await tower.outcome(c1.ap, sql`select app.add_project_member(${c1.participantId}::uuid, ${id}::uuid, now()) as outcome`)).toBeTruthy();
  for (const kind of ["trade", "location"]) {
    expect(await tower.outcome(c1.ap, sql`select app.set_member_visibility(${c1.participantId}::uuid, ${id}::uuid, ${kind}, true, '{}'::uuid[], now()) as outcome`)).toBe("set");
  }
  expect(await tower.outcome(c1.ap, sql`select app.set_project_member_positions(${c1.participantId}::uuid, ${id}::uuid, ${["engineer"]}::text[]) as outcome`)).toBe("set");
  names.set(id, name);
  return id;
}

/** `as` starts a Draft of `type` on the Tower's Trade and Building A. */
async function raise(as: string, type: string, title: string): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    as,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${type}, ${title}, app.latest_form_version(${type}), ${JSON.stringify({ model: title })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

/** `as` saves item `id`'s answers; returns the outcome. */
const save = (as: string, id: string, model: string) =>
  tower.outcome(
    as,
    sql`select app.save_work_item_answers(${id}::uuid, ${JSON.stringify({ model })}::jsonb, ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, '{}'::uuid[], now()) as outcome`,
  );

/** The rows of item `id` `as` reads, by item id: the item itself and its tables. */
const tables = [
  ["work_item", "id"],
  ["work_item_dimension_value", "work_item_id"],
  ["work_item_access", "work_item_id"],
  ["step_assignment", "work_item_id"],
] as const;

/** Item `target` read in each of its tables by every one of `seenBy` first, and by none of `hiddenFrom`. */
async function expectItemHidden(target: string, seenBy: string | string[], hiddenFrom: string | string[], label: string) {
  for (const [table, column] of tables) {
    await expectHiddenFrom({
      read: (as: string) => tower.call<{ id: string }>(as, sql`select distinct ${sql.ref(column)} as id from ${sql.table(table)}`),
      target,
      seenBy,
      hiddenFrom,
      name: nameOf,
      label: `${label}: ${table}`,
    });
  }
}

/** How many Work Items `as` counts on the Tower, as a list's Stage counts them. */
const counted = async (as: string) =>
  (await tower.call<{ n: number }>(as, sql`select count(*)::int as n from work_item where project_id = ${tower.projectId}::uuid`))[0]!.n;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  await addType(AUTHOR_ONLY, "author");
  await addType(DEFAULT);
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  hafiz = tower.c1.members.engineer;
  ali = tower.c1.members.project_manager;
  k1 = tower.k1.members.engineer;
  for (const [as, name] of [
    [hafiz, "Hafiz"],
    [ali, "Ali (C1's PM)"],
    [tower.c1.ap, "C1's Authorized Person"],
    [k1, "K1's engineer"],
  ] as const)
    names.set(as, name);
  omar = await c1Engineer("Omar");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-514-1: Drafts visible to the author only", () => {
  it("Omar, Ali, C1's Authorized Person and K1 read none of Hafiz's Draft and don't count it; Hafiz does, and saves it", async () => {
    const before = { omar: await counted(omar), ali: await counted(ali), hafiz: await counted(hafiz) };
    const id = await raise(hafiz, AUTHOR_ONLY, "Author only");
    await expectItemHidden(id, hafiz, [omar, ali, tower.c1.ap, k1], "Hafiz's Draft");
    expect(await counted(omar)).toBe(before.omar);
    expect(await counted(ali)).toBe(before.ali);
    expect(await counted(hafiz)).toBe(before.hafiz + 1);
    expect(await save(hafiz, id, "Author only, edited")).toBe("saved");
    for (const who of [omar, ali]) expect(await save(who, id, "Not theirs"), nameOf(who)).toBe("not_found");

    // Sent for Review it is no Draft: C1 reads it as any item in Internal Review; K1 still doesn't (V1).
    expect(await tower.take(hafiz, id, "send_for_review")).toBe("applied");
    await expectItemHidden(id, [hafiz, omar, ali], k1, "sent for review");
  });

  it("the Authorized Person hands over Badr's Draft by its Step and Project only; Omar then reads and saves it, Hafiz doesn't read it", async () => {
    const { c1 } = tower;
    const badr = await c1Engineer("Badr");
    const id = await raise(badr, AUTHOR_ONLY, "Badr's Draft");
    await expectItemHidden(id, badr, [c1.ap, omar, hafiz], "Badr's Draft");

    type Needed = { assignment_id: string; project_id: string; step_name: { en: string }; work_item_id: string | null; document_number: string | null; title: string | null };
    await withMember(app, c1.ap, async (trx) => {
      const before = (await sql<{ ids: string[] }>`select app.handover_pooled_before(${badr}::uuid, null) as ids`.execute(trx)).rows[0]!.ids;
      expect((await sql<{ outcome: string }>`select app.deactivate_member(${badr}::uuid, now()) as outcome`.execute(trx)).rows[0]!.outcome).toBe("deactivated");
      const rows = (await sql<Needed>`select * from app.handovers_needed(${badr}::uuid, null, ${before}::uuid[])`.execute(trx)).rows;
      expect(rows.map((r) => ({ project_id: r.project_id, step: r.step_name.en, work_item_id: r.work_item_id, document_number: r.document_number, title: r.title }))).toEqual([
        { project_id: tower.projectId, step: "Draft", work_item_id: null, document_number: null, title: null },
      ]);
      expect(JSON.stringify(rows).includes(id), "the Handover names the Draft's id").toBe(false);
      for (const row of rows) {
        expect((await sql<{ outcome: string }>`select app.hand_over_step(${row.assignment_id}::uuid, ${badr}::uuid, ${omar}::uuid, 'deactivated', now()) as outcome`.execute(trx)).rows[0]!.outcome).toBe(
          "handed_over",
        );
      }
    });

    await expectItemHidden(id, omar, [hafiz, c1.ap], "handed to Omar");
    expect(await save(omar, id, "Omar's now")).toBe("saved");
  });

  it("under the default, Omar reads Hafiz's Draft but can't save it (form-engine.md §4); K1 doesn't read it", async () => {
    const id = await raise(hafiz, DEFAULT, "Company Draft");
    await expectItemHidden(id, [hafiz, omar, ali], k1, "a default Draft");
    expect(await save(omar, id, "Omar's change")).toBe("not_editable");
    expect(await save(hafiz, id, "Hafiz's change")).toBe("saved");
  });
});
