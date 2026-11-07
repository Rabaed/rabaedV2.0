// Seam 2 for the Snag List's "Raised from" filter at every Revision (RP-1119; scenario RP-1119-1;
// visibility.md "Search and filters", V3), as the app role. The api's filter (apps/api/src/work-items/query.ts)
// keeps the items whose `raised_from` Link, as app.work_item_links gives it to the reader, names the number.
// A Revision's number is its first item's with " Rev n". C1 raises an Inspection that gets Code C twice:
// Rev 0, Rev 1 and Rev 2 each raise two Snags. Each Revision's number finds exactly its own two Snags, for
// C1 and K1; C2 (the same Trade, not covering the Location) and another Project's Member find none.
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestScreen, addTestWorkflow, buildSeamTwoTower, expectHiddenFrom, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const TYPE = `RV${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
const FIELD = "inspection_checklist";
const wirForm = readFileSync(new URL("../../../apps/admin/forms/WIR.json", import.meta.url), "utf8");
const label = (en: string) => ({ en, ar: en });
/** Both check items fail: each raises a Snag at the code. */
const BOTH_FAIL = { formwork: { answer: "fail", comment: "Gap at the joint" }, cover: { answer: "fail", comment: "Cover too thin" } };
const item = (key: string, text: string) => ({ key, text: label(text), answers: "pass_fail_na", comment: "optional", photo: "off", on_negative: "create_snag" });
const codeScreen = {
  sections: [
    {
      key: "inspection",
      title: label("Inspection"),
      fields: [
        { key: FIELD, type: "copied_checklist", copyOf: "checklist_template", label: label("Checklist"), required: true },
        { key: "remarks", type: "textarea", label: label("Remarks") },
      ],
    },
  ],
};
const templateItems = [item("formwork", "Formwork tight"), item("cover", "Rebar cover")];
const towerOptions = { projectCode: "RVK", tradeCode: "CV", otherProject: true, k1Manager: true } as const;
type Tower = SeamTwoTower<typeof towerOptions>;

let migrator: pg.Client;
let app: Db;
let tower: Tower;
/** Rev 0, Rev 1 and Rev 2: each one's id, Document Number and the two Snags its Code C raised. */
const chain: { id: string; number: string; snags: string[] }[] = [];

const run = (text: string) => migrator.query(text);
const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;
/** The items `as` reads whose `raised_from` Link names `number`: the "Raised from" filter, as the api runs it. */
const raisedFrom = async (as: string, number: string) =>
  (
    await tower.call<{ id: string }>(
      as,
      sql`select w.id from work_item w where w.project_id = ${tower.projectId}::uuid
          and exists (select 1 from app.work_item_links(w.id) l where l.kind = 'raised_from' and l.document_number = ${number}) order by w.id`,
    )
  ).map((r) => ({ id: r.id }));

/** K1's Engineer fails both items of `id` and Sends it to the Manager, who issues Code C; returns the two Snags raised. */
async function codeC(id: string): Promise<string[]> {
  const { k1, outcome, take, pickUp } = tower;
  expect(await outcome(k1.members.engineer, sql`select app.save_reply_checklist(${id}::uuid, ${FIELD}, ${JSON.stringify(BOTH_FAIL)}::jsonb, now()) as outcome`)).toBe("saved");
  expect(await take(k1.members.engineer, id, "send_to_manager")).toBe("applied");
  expect(await pickUp(k1.members.manager, id)).toBe("picked_up");
  expect(await take(k1.members.manager, id, "revise_c", { remarks: "Seal the formwork" })).toBe("applied");
  return (await migrator.query("select from_id from work_item_link where to_id = $1 and kind = 'raised_from' order by from_id", [id])).rows.map((r) => r.from_id as string);
}

/** C1's Engineer creates the next Revision of `id` and it goes back to K1's Engineer, as Rev 0 did. */
async function revise(id: string): Promise<string> {
  const { c1, k1, call, take, pickUp } = tower;
  const [revision] = await call<{ outcome: string; work_item_id: string | null }>(c1.members.engineer, sql`select outcome, work_item_id from app.create_revision(${id}::uuid, gen_random_uuid(), now())`);
  expect(revision!.outcome).toBe("created");
  const next = revision!.work_item_id!;
  // As wirAtConsultant does for Rev 0: the reply checklist is copied from the Checklist Template.
  expect(await tower.outcome(c1.members.engineer, sql`select app.sync_work_item_checklists(${next}::uuid, now()) as outcome`)).toBe("synced");
  expect(await take(c1.members.engineer, next, "send_for_review")).toBe("applied");
  expect(await pickUp(c1.members.project_manager, next)).toBe("picked_up");
  expect(await take(c1.members.project_manager, next, "submit")).toBe("applied");
  expect(await pickUp(k1.members.engineer, next)).toBe("picked_up");
  return next;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });

  const screenVersion = await addTestScreen(run, `rp1119_${digits(6)}`, codeScreen, []);
  const workflowId = await addTestWorkflow(run, { name: label(`RP-1119 revisions ${digits(6)}`), recommendCode: true, screens: { approve_a: screenVersion, revise_c: screenVersion } });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(label("Inspection (RP-1119)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [formId, wirForm]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify(label("Inspection (RP-1119)")), workflowId, formId],
  );

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const [template] = await tower.call<{ outcome: string; template_id: string }>(
    tower.c1.ap,
    sql`select outcome, template_id from app.create_checklist_template(${tower.projectId}::uuid, ${JSON.stringify(label("Two Snags"))}::jsonb, ${tower.tradeId}::uuid, ${JSON.stringify(templateItems)}::jsonb, now())`,
  );
  expect(template!.outcome).toBe("created");
  const checklistVersionId = await one("select id from checklist_template_version where checklist_template_id = $1 and version_no = 1", [template!.template_id]);

  let id = await wirAtConsultant({ ...tower, checklistVersionId }, { type: TYPE, title: "Slab pour, Level 2" });
  for (let rev = 0; rev <= 2; rev++) {
    if (rev > 0) id = await revise(id);
    const snags = await codeC(id);
    const number = (await migrator.query("select document_number from work_item where id = $1", [id])).rows[0].document_number as string;
    chain.push({ id, number, snags });
  }
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("RP-1119-1: the Raised from filter finds a Revision's Snags by its Document Number, only those the reader sees", () => {
  it("the chain is numbered Rev 0, \" Rev 1\" and \" Rev 2\", each Code C raising two Snags", () => {
    const first = chain[0]!.number;
    expect(chain.map((r) => r.number)).toEqual([first, `${first} Rev 1`, `${first} Rev 2`]);
    expect(chain.map((r) => r.snags.length)).toEqual([2, 2, 2]); // not hidden-from: setup, read as the migrator
  });

  it("C1's Members and K1's Engineer find exactly each Revision's own two Snags by its number", async () => {
    for (const reader of [tower.c1.members.engineer, tower.c1.members.project_manager, tower.k1.members.engineer]) {
      for (const r of chain) expect((await raisedFrom(reader, r.number)).map((x) => x.id), `${reader} ${r.number}`).toEqual([...r.snags].sort());
    }
  });

  it("C2 and another Project's Member find none of them by any of the chain's numbers", async () => {
    for (const r of chain) {
      for (const snag of r.snags) {
        await expectHiddenFrom({
          read: (as) => raisedFrom(as, r.number),
          target: snag,
          seenBy: [tower.c1.members.engineer, tower.k1.members.engineer],
          hiddenFrom: [tower.c2.members.engineer, tower.other.ap],
          label: `a Snag raised from ${r.number}`,
        });
      }
    }
  });
});
