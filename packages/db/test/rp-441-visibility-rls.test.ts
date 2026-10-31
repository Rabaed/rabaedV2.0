// Seam 2 for Project → Settings → Workflows (RP-441, WF-18; ADR 0016, 0019; visibility.md V15,
// V18, V20, scenario RP-441-1), through the tables its reads use (apps/api/src/projects/
// workflow-settings.ts) as the app role: which Workflow each Type runs (workflow_binding), its
// published Versions whole (workflow_version, workflow_step, workflow_transition) and the Screen
// Versions they pin (screen_version). Everyone on the Tower reads them; an exception for one
// Participant (C2 here, the scenario's Beta Build) is read by that Participant's Members and the
// Project Admins only; a draft Version by its authors only; a Member of another Project reads none.
// Seam 1: apps/api/test/workflow-settings.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RS${letters(3)}`;
const reply = (note: string) => ({
  sections: [{ key: "reply", title: bilingual("Reply"), fields: [{ key: "remarks", type: "textarea", label: bilingual(note) }] }],
});

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RSP", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let typeId = "";
let route = ""; // The Project copy the Type runs.
let exception = ""; // The Workflow C2's raisers run.
const routeVersion: Record<number, string> = {};
const screenVersion: Record<number, string> = {};

const name: Record<string, string> = {};
const named = (member: string) => name[member] ?? member;
const ids = async <T extends { id: string }>(as: string, query: ReturnType<typeof sql<T>>) => (await tower.call<T>(as, query)).map((r) => ({ id: r.id }));

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  const rabaedDefault = await addTestWorkflow(run, { name: bilingual(`RP-441 default ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Settings (RP-441)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
      [TYPE, JSON.stringify(bilingual("Settings (RP-441)")), rabaedDefault, formId],
    )
  ).rows[0].id as string;

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, ow, c2, other } = tower;
  Object.assign(name, {
    [c1.ap]: "Tower's Project Admin",
    [c1.members.engineer]: "C1 engineer",
    [k1.members.engineer]: "K1 engineer",
    [ow.members.representative]: "the Owner",
    [c2.members.engineer]: "C2 engineer (the exception's Participant)",
    [other.ap]: "a Member of another Project",
  });

  // The Project's own Screen, Version 1 published, then Version 2.
  const [screen] = await tower.call<{ outcome: string; screen_id: string }>(
    c1.ap,
    sql`select outcome, screen_id from app.create_screen(${tower.projectId}::uuid, ${`reply_${digits(6)}`}, ${JSON.stringify(bilingual("Reply"))}::jsonb,
      ${JSON.stringify(reply("Remarks"))}::jsonb, '{}'::text[], now())`,
  );
  expect(screen!.outcome).toBe("created");
  expect(await tower.outcome(c1.ap, sql`select outcome from app.publish_screen(${screen!.screen_id}::uuid, now())`)).toBe("published");
  expect(await tower.outcome(c1.ap, sql`select outcome from app.save_screen_draft(${screen!.screen_id}::uuid, ${JSON.stringify(reply("Notes"))}::jsonb, '{}'::text[], now())`)).toBe("saved");
  expect(await tower.outcome(c1.ap, sql`select outcome from app.publish_screen(${screen!.screen_id}::uuid, now())`)).toBe("published");
  for (const row of (await migrator.query<{ id: string; version_no: number }>("select id, version_no from screen_version where screen_id = $1", [screen!.screen_id])).rows) {
    screenVersion[row.version_no] = row.id;
  }

  // The Project copy: Version 1 pins Screen Version 1, Version 2 pins Version 2, and a Version 3 waits as a draft.
  route = await addTestWorkflow(run, { name: bilingual(`Tower route ${digits(4)}`), owner: { kind: "project", projectId: tower.projectId }, screens: { approve_a: screenVersion[1]! } });
  await addTestWorkflow(run, { version: { definitionId: route, no: 2 }, screens: { approve_a: screenVersion[2]! } });
  await addTestWorkflow(run, { version: { definitionId: route, no: 3 }, publish: false });
  exception = await addTestWorkflow(run, { name: bilingual(`Second route ${digits(4)}`), owner: { kind: "project", projectId: tower.projectId } });
  // Made for the Type, as a copy into the Project makes them.
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = any($2::uuid[])", [typeId, [route, exception]]);
  for (const row of (await migrator.query<{ id: string; version_no: number }>("select id, version_no from workflow_version where workflow_definition_id = $1", [route])).rows) {
    routeVersion[row.version_no] = row.id;
  }

  // The Project Admin binds the copy for the Type, and the exception for C2's raisers.
  expect(await tower.outcome(c1.ap, sql`select app.bind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, null, ${route}::uuid, now()) as outcome`)).toBe("bound");
  expect(await tower.outcome(c1.ap, sql`select app.bind_workflow(${tower.projectId}::uuid, ${typeId}::uuid, ${c2.participantId}::uuid, ${exception}::uuid, now()) as outcome`)).toBe(
    "bound",
  );
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-441-1: Project → Settings → Workflows", () => {
  const everyone = () => [tower.c1.ap, tower.c1.members.engineer, tower.k1.members.engineer, tower.ow.members.representative, tower.c2.members.engineer];

  it("everyone on the Tower reads which Workflow the Type runs; a Member of another Project doesn't", async () => {
    const runs = (as: string) =>
      ids(
        as,
        sql<{ id: string }>`select workflow_definition_id as id from workflow_binding
          where project_id = ${tower.projectId}::uuid and work_item_type_id = ${typeId}::uuid and raising_participant_id is null`,
      );
    await expectHiddenFrom({ read: runs, target: route, seenBy: everyone(), hiddenFrom: tower.other.ap, name: named, label: "the Type's binding" });
    const workflow = (as: string) => ids(as, sql<{ id: string }>`select id from workflow_definition where id = ${route}::uuid`);
    await expectHiddenFrom({ read: workflow, target: route, seenBy: everyone(), hiddenFrom: tower.other.ap, name: named, label: "the Workflow" });
  });

  it("everyone on the Tower reads every published Version whole and the Screen Version each pins (V20); a Member of another Project none", async () => {
    const versions = (as: string) => ids(as, sql<{ id: string }>`select id from workflow_version where workflow_definition_id = ${route}::uuid`);
    for (const no of [1, 2]) await expectHiddenFrom({ read: versions, target: routeVersion[no]!, seenBy: everyone(), hiddenFrom: tower.other.ap, name: named, label: `Version ${no}` });

    for (const [no, pinned] of [[1, 1], [2, 2]] as const) {
      const whole = (await migrator.query<{ id: string }>("select id from workflow_step where workflow_version_id = $1 order by id", [routeVersion[no]])).rows.map((r) => r.id);
      for (const as of everyone()) {
        expect((await tower.call<{ id: string }>(as, sql`select id from workflow_step where workflow_version_id = ${routeVersion[no]!}::uuid order by id`)).map((r) => r.id), named(as)).toEqual(whole);
      }
      const pins = (as: string) =>
        ids(as, sql<{ id: string }>`select t.screen_version_id as id from workflow_transition t where t.workflow_version_id = ${routeVersion[no]!}::uuid and t.screen_version_id is not null`);
      await expectHiddenFrom({ read: pins, target: screenVersion[pinned]!, seenBy: everyone(), hiddenFrom: tower.other.ap, name: named, label: `the Screen Version Version ${no} pins` });
      const screen = (as: string) => ids(as, sql<{ id: string }>`select id from screen_version where id = ${screenVersion[pinned]!}::uuid`);
      await expectHiddenFrom({ read: screen, target: screenVersion[pinned]!, seenBy: everyone(), hiddenFrom: tower.other.ap, name: named, label: `Screen Version ${pinned}` });
    }
  });

  it("the exception is read by its Participant's Members and the Project Admins only; the others learn of no Participant", async () => {
    const { c1, k1, ow, c2, other } = tower;
    const excepted = (as: string) =>
      ids(
        as,
        sql<{ id: string }>`select raising_participant_id as id from workflow_binding
          where project_id = ${tower.projectId}::uuid and work_item_type_id = ${typeId}::uuid and raising_participant_id is not null`,
      );
    await expectHiddenFrom({
      read: excepted,
      target: c2.participantId,
      seenBy: [c2.members.engineer, c1.ap],
      hiddenFrom: [c1.members.engineer, k1.members.engineer, ow.members.representative, other.ap],
      name: named,
      label: "the exception's binding",
    });
    // Its Workflow is the Project's, read whole by every Member of it (V20); its name names nobody (bind_workflow refuses one that does).
    const workflow = (as: string) => ids(as, sql<{ id: string }>`select id from workflow_definition where id = ${exception}::uuid`);
    await expectHiddenFrom({ read: workflow, target: exception, seenBy: everyone(), hiddenFrom: other.ap, name: named, label: "the exception's Workflow" });
  });

  it("a draft Version is its authors' only: through app.workflow_draft for the Project Admin, never through the table", async () => {
    const { c1, k1, ow, c2, other } = tower;
    const draft = routeVersion[3]!;
    const drafted = async (as: string) =>
      (await tower.call<{ workflow_version_id: string }>(as, sql`select workflow_version_id from app.workflow_draft(${route}::uuid)`)).map((r) => ({ id: r.workflow_version_id }));
    const others = [c1.members.engineer, k1.members.engineer, ow.members.representative, c2.members.engineer, other.ap];
    await expectHiddenFrom({ read: drafted, target: draft, seenBy: c1.ap, hiddenFrom: others, name: named, label: "app.workflow_draft" });
    // Through the table the Project Admin reads the published Versions and not the draft, like everyone else.
    const versions = (as: string) => ids(as, sql<{ id: string }>`select id from workflow_version where workflow_definition_id = ${route}::uuid`);
    for (const as of everyone()) expect((await versions(as)).map((v) => v.id).sort(), named(as)).toEqual([routeVersion[1], routeVersion[2]].sort());
  });
});
