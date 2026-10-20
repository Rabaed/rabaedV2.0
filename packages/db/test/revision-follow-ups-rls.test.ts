// Seam 2 for the follow-up counts of a Revision's previous item (RP-653, INSP-6; spec RP-649; ADR 0025;
// visibility.md "Lists and counts" and scenario RP-653-1), as the app role. C1 raises an Inspection on a
// test Type (the WIR Form on a Workflow whose codes show the copied checklist); K1's Engineer fails both
// check items, so K1's Manager's Code C raises two Snags (RP-577). C1 raises Rev 1 of it, a Revision, and
// Submits it: `app.work_item_previous_raised_item_counts` gives Rev 1 the Snags raised from Rev 0.
//
// RP-653-1: the counts are the follow-ups the viewer sees, never a discarded one. A Member who sees only
// one of the two Snags counts one; C2, another Contractor of the same Trade not covering the Location,
// sees neither Rev 1 nor a count; another Project's Member none.
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestScreen, addTestWorkflow, buildSeamTwoTower, testDatabaseUrls, wirAtConsultant, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
const TYPE = `RF${Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("")}`;
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

let migrator: pg.Client;
let app: Db;

/** The Tower's own Template raises one Snag; this one raises two. */
const templateItems = [item("formwork", "Formwork tight"), item("cover", "Rebar cover")];
const towerOptions = { projectCode: "RFK", tradeCode: "CV", otherProject: true, k1Manager: true } as const;
type Tower = SeamTwoTower<typeof towerOptions>;
let tower: Tower;
let c1: Tower["c1"];
let k1: Tower["k1"];
let c2: Tower["c2"];
let other: Tower["other"];
let call: Tower["call"];
let outcome: Tower["outcome"];
let take: Tower["take"];
let pickUp: Tower["pickUp"];
let c1Pm = "";
let rev0 = "";
let rev1 = "";
let snagB = ""; // The second Snag, moved to Building B; the first stays in Building A, where the Inspection is.
let k1BuildingA = ""; // A K1 Manager covering Building A only.

const run = (text: string) => migrator.query(text);
const one = async (text: string, values: unknown[]): Promise<string> => (await migrator.query(text, values)).rows[0].id as string;
/** The previous item's counts `as` reads on `id`: its Revision number, then per Type open and closed. */
const previous = (as: string, id: string) =>
  call<{ previous_revision_no: number; type_code: string; open_count: number; closed_count: number }>(
    as,
    sql`select previous_revision_no, type_code, open_count::integer, closed_count::integer from app.work_item_previous_raised_item_counts(${id}::uuid)`,
  );

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });

  const screenVersion = await addTestScreen(run, `rp653_${digits(6)}`, codeScreen, []);
  const workflowId = await addTestWorkflow(run, {
    name: label(`RP-653 revisions ${digits(6)}`),
    recommendCode: true,
    screens: { approve_a: screenVersion, revise_c: screenVersion },
  });
  const formId = await one("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(label("Inspection (RP-653)"))]);
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    wirForm,
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     select 'rabaed', module_key, $1, $2, $3, outcome_kind, $4 from work_item_type where owner_kind = 'rabaed' and code = 'WIR'`,
    [TYPE, JSON.stringify(label("Inspection (RP-653)")), workflowId, formId],
  );

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  ({ c1, k1, c2, other, call, outcome, take, pickUp } = tower);
  c1Pm = c1.members.project_manager;

  // Rev 0: K1's Engineer fails both items and Sends it to the Manager, who issues Code C: two Snags.
  const [template] = await call<{ outcome: string; template_id: string }>(
    c1.ap,
    sql`select outcome, template_id from app.create_checklist_template(${tower.projectId}::uuid, ${JSON.stringify(label("Two Snags"))}::jsonb, ${tower.tradeId}::uuid, ${JSON.stringify(templateItems)}::jsonb, now())`,
  );
  expect(template!.outcome).toBe("created");
  const checklistVersionId = await one("select id from checklist_template_version where checklist_template_id = $1 and version_no = 1", [template!.template_id]);
  rev0 = await wirAtConsultant({ ...tower, checklistVersionId }, { type: TYPE, title: "Slab pour, Level 2" });
  expect(
    await outcome(
      k1.members.engineer,
      sql`select app.save_reply_checklist(${rev0}::uuid, ${FIELD}, ${JSON.stringify(BOTH_FAIL)}::jsonb, now()) as outcome`,
    ),
  ).toBe("saved");
  expect(await take(k1.members.engineer, rev0, "send_to_manager")).toBe("applied");
  expect(await pickUp(k1.members.manager, rev0)).toBe("picked_up");
  expect(await take(k1.members.manager, rev0, "revise_c", { remarks: "Seal the formwork" })).toBe("applied");
  const raised = (await migrator.query("select from_id from work_item_link where to_id = $1 and kind = 'raised_from' order by created_at, from_id", [rev0])).rows;
  expect(raised).toHaveLength(2);
  snagB = raised[1].from_id as string;
  // The second Snag is in Building B, which C1's Project Manager does not cover below.
  await migrator.query(
    `update work_item_dimension_value set dimension_value_id = $2
     where work_item_id = $1 and dimension_id = (select dimension_id from dimension_value where id = $2)`,
    [snagB, tower.buildingB],
  );

  // Rev 1: C1's Engineer creates the Revision, sends it for review and C1's Project Manager Submits it.
  const [revision] = await call<{ outcome: string; work_item_id: string | null }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_revision(${rev0}::uuid, gen_random_uuid(), now())`,
  );
  expect(revision!.outcome).toBe("created");
  rev1 = revision!.work_item_id!;
  expect(await take(c1.members.engineer, rev1, "send_for_review")).toBe("applied");
  expect(await pickUp(c1Pm, rev1)).toBe("picked_up");
  expect(await take(c1Pm, rev1, "submit")).toBe("applied");

  // A Manager of K1 covering Building A only, and C1's Project Manager restricted likewise.
  k1BuildingA = k1.members.manager;
  expect(
    await outcome(k1.ap, sql`select app.set_member_visibility(${k1.participantId}::uuid, ${k1BuildingA}::uuid, 'location', false, ${[tower.buildingA]}::uuid[], now()) as outcome`),
  ).toBe("set");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("RP-653-1: a Revision counts only the previous item's follow-ups the viewer sees", () => {
  it("C1's Members, who see both Snags, count two open Snags from Rev 0", async () => {
    for (const reader of [c1.members.engineer, c1Pm]) {
      expect(await previous(reader, rev1), reader).toEqual([{ previous_revision_no: 0, type_code: "SNG", open_count: 2, closed_count: 0 }]);
    }
  });

  it("a Member who sees only the Snag in Building A counts one; both Snags still count for those who see both", async () => {
    expect(
      await outcome(
        c1.ap,
        sql`select app.set_member_visibility(${c1.participantId}::uuid, ${c1Pm}::uuid, 'location', false, ${[tower.buildingA]}::uuid[], now()) as outcome`,
      ),
    ).toBe("set");
    expect((await call(c1Pm, sql<{ id: string }>`select id from work_item where id = ${snagB}::uuid`))).toEqual([]);
    expect(await previous(c1Pm, rev1)).toEqual([{ previous_revision_no: 0, type_code: "SNG", open_count: 1, closed_count: 0 }]);
    expect(await previous(c1.members.engineer, rev1)).toEqual([{ previous_revision_no: 0, type_code: "SNG", open_count: 2, closed_count: 0 }]);
  });

  it("C2 and another Project's Member count none: they see neither Rev 1 nor Rev 0", async () => {
    for (const outsider of [c2.members.engineer, other.ap]) {
      expect(await previous(outsider, rev1), outsider).toEqual([]);
    }
  });

  it("Rev 0, which follows no item, has no previous counts; K1, who sees Rev 1, counts what it sees of Rev 0's", async () => {
    expect(await previous(c1.members.engineer, rev0)).toEqual([]);
    expect(await previous(k1.members.engineer, rev1)).toEqual([{ previous_revision_no: 0, type_code: "SNG", open_count: 2, closed_count: 0 }]);
    expect(await previous(k1BuildingA, rev1)).toEqual([{ previous_revision_no: 0, type_code: "SNG", open_count: 1, closed_count: 0 }]);
  });
});
