// Seam 2 for the New item's route preview (RP-1152, gap rows 22, 34 and 35; visibility.md V1, V15,
// V20; scenario RP-1152-1), as the app role, through the reads the api's preview runs: the Types the
// Member may raise (app.raisable_type_ids), the Version a new item would start on
// (app.new_item_workflow_version) and that Version's Steps. Hafiz, a C1 engineer, reads the Type's
// Steps, their roles and the Draft Step's "Drafts visible to"; nothing he reads holds a Company's,
// a Participant's or a Member's id. K1's engineer, who holds no Draft, and a Member off the Project
// may not raise the Type. Seam 1: apps/api/test/route-preview.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RP${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RPV", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let typeId = "";
const names = new Map<string, string>();

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1152 ${TYPE} ${digits(6)}`), draftsVisibleTo: "author" });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual(`Preview (${TYPE})`))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
      [TYPE, JSON.stringify(bilingual(`Preview (${TYPE})`)), workflowId, formId],
    )
  ).rows[0].id as string;
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

/** The Types `as` may raise on the Tower's Submittals. */
const raisable = (as: string) =>
  tower.call<{ id: string }>(as, sql`select work_item_type_id as id from app.raisable_type_ids(${tower.projectId}::uuid, 'submittals')`);

/** The Steps of the Version a new item of the test Type would start on for `as`, as the preview reads them. */
async function previewSteps(as: string) {
  return tower.call<{ key: string; role: string | null; drafts_visible_to: string | null; row: unknown }>(
    as,
    sql`select s.key, app.actor_holder(s.actor_rule) as role, s.drafts_visible_to, to_jsonb(s) - 'id' - 'workflow_version_id' as row
      from workflow_step s
      where s.workflow_version_id = app.new_item_workflow_version(${tower.projectId}::uuid, ${typeId}::uuid, (
        select pm.participant_id from project_member pm
        where pm.project_id = ${tower.projectId}::uuid and pm.member_id = app.current_member_id() and pm.status = 'active'))
      order by s.key`,
  );
}

describe("scenario RP-1152-1: the route preview names no Company and no Member", () => {
  it("Hafiz may raise the Type; K1's engineer and a Member off the Project may not", async () => {
    await expectHiddenFrom({
      read: raisable,
      target: typeId,
      seenBy: tower.c1.members.engineer,
      hiddenFrom: [tower.k1.members.engineer, tower.other.ap],
      name: (as: string) => names.get(as) ?? as,
      label: "the Types one may raise",
    });
  });

  it("Hafiz reads the Steps, their roles and the Draft Step's Drafts visible to, and no id of a Company, Participant or Member", async () => {
    const steps = await previewSteps(tower.c1.members.engineer);
    expect(steps.find((s) => s.key === "draft")).toMatchObject({ role: "contractor", drafts_visible_to: "author" });
    expect(new Set(steps.map((s) => s.role))).toEqual(new Set(["contractor", "consultant", null]));
    const read = JSON.stringify(steps.map((s) => s.row));
    const ids = [tower.c1, tower.k1, tower.c2].flatMap((c) => [c.id, c.ap, ...Object.values(c.members)]);
    const { rows: participants } = await migrator.query("select id from participant where project_id = $1", [tower.projectId]);
    for (const id of [...ids, ...participants.map((p: { id: string }) => p.id)]) expect(read).not.toContain(id); // not hidden-from: the Steps Hafiz just read, his Draft Step among them
  });
});
