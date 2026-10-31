// Seam 2 for the Workflow builder's gate (RP-439, WF-16; visibility.md V18, V20, scenario
// RP-439-1), through the reads the builder makes (apps/api/src/projects/workflows.ts,
// readWorkflowBuilder): app.can_author_workflow, then the draft through app.workflow_draft.
// Only each Workflow's authors open it: a Project's Project Admins on its own copy, nobody
// through the app role on a Rabaed Default (a Rabaed Engineer edits it in Rabaed Admin).
// Seam 1: apps/api/test/workflow-builder.test.ts.
import { randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RB${letters(3)}`;
/** The Rabaed Engineer: reads a Rabaed Default's draft on the tables' owner's connection, as Rabaed Admin does on its own. */
const ENGINEER = "a Rabaed Engineer";

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RBP", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let rabaedDefault = "";
let towerCopy = "";
let otherCopy = "";

const name: Record<string, string> = { [ENGINEER]: ENGINEER };
const named = (member: string) => name[member] ?? member;

/** [Workflow `id`] when `as` authors it (app.can_author_workflow, the builder's first read). */
const authors = (id: string) => async (as: string) =>
  (await tower.call<{ can: boolean }>(as, sql`select app.can_author_workflow(${id}::uuid) as can`))[0]!.can ? [{ id }] : [];
/** The draft Version of Workflow `id` that `as` opens in the builder (app.workflow_draft), by its id. */
const draftOf = (id: string) => async (as: string) => {
  if (as === ENGINEER) return (await migrator.query<{ id: string }>("select workflow_version_id as id from app.workflow_draft_rows($1)", [id])).rows;
  return (await tower.call<{ workflow_version_id: string }>(as, sql`select workflow_version_id from app.workflow_draft(${id}::uuid)`)).map((r) => ({ id: r.workflow_version_id }));
};
const draftId = async (id: string) => (await migrator.query("select id from workflow_version where workflow_definition_id = $1 and status = 'draft'", [id])).rows[0].id as string;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  // The Type's Rabaed Default (the MAR Workflow of the scenario), Version 1 published and a Version 2 drafted.
  rabaedDefault = await addTestWorkflow(run, { name: bilingual(`RP-439 default ${digits(6)}`) });
  await addTestWorkflow(run, { version: { definitionId: rabaedDefault, no: 2 }, publish: false });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Builder (RP-439)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Builder (RP-439)")), rabaedDefault, formId],
  );

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, other } = tower;
  Object.assign(name, {
    [c1.ap]: "Tower's Project Admin",
    [c1.members.engineer]: "C1 engineer (a Tower Project Member)",
    [k1.members.engineer]: "K1 engineer",
    [other.ap]: "the other Project's Project Admin",
  });

  // Each Project Admin copies the Rabaed Default into their own Project: a draft each.
  const copy = async (as: string, projectId: string) => {
    const [copied] = await tower.call<{ outcome: string; workflow_definition_id: string }>(
      as,
      sql`select outcome, workflow_definition_id from app.duplicate_workflow(${rabaedDefault}::uuid, ${projectId}::uuid, ${JSON.stringify(bilingual(`Route ${digits(4)}`))}::jsonb, now())`,
    );
    expect(copied!.outcome).toBe("duplicated");
    return copied!.workflow_definition_id;
  };
  towerCopy = await copy(c1.ap, tower.projectId);
  otherCopy = await copy(other.ap, other.projectId);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-439-1: only each Workflow's authors open its builder", () => {
  it("Tower's copy: its Project Admin only; not a Tower Project Member, K1 or the other Project's Project Admin", async () => {
    const { c1, k1, other } = tower;
    const hiddenFrom = [c1.members.engineer, k1.members.engineer, other.ap];
    await expectHiddenFrom({ read: authors(towerCopy), target: towerCopy, seenBy: c1.ap, hiddenFrom, name: named, label: "app.can_author_workflow" });
    await expectHiddenFrom({ read: draftOf(towerCopy), target: await draftId(towerCopy), seenBy: c1.ap, hiddenFrom, name: named, label: "app.workflow_draft" });
  });

  it("the other Project's copy: its own Project Admin only, not Tower's", async () => {
    const { c1, other } = tower;
    const hiddenFrom = [c1.ap, c1.members.engineer];
    await expectHiddenFrom({ read: authors(otherCopy), target: otherCopy, seenBy: other.ap, hiddenFrom, name: named, label: "app.can_author_workflow" });
    await expectHiddenFrom({ read: draftOf(otherCopy), target: await draftId(otherCopy), seenBy: other.ap, hiddenFrom, name: named, label: "app.workflow_draft" });
  });

  it("the Rabaed Default: no Member authors it, Tower's Project Admin included; its draft is the Rabaed Engineer's", async () => {
    const { c1, k1, other } = tower;
    const members = [c1.ap, c1.members.engineer, k1.members.engineer, other.ap];
    for (const as of members) expect((await tower.call<{ can: boolean }>(as, sql`select app.can_author_workflow(${rabaedDefault}::uuid) as can`))[0]!.can, named(as)).toBe(false);
    await expectHiddenFrom({ read: draftOf(rabaedDefault), target: await draftId(rabaedDefault), seenBy: ENGINEER, hiddenFrom: members, name: named, label: "the Rabaed Default's draft" });
  });

  it("a made-up id is the same nothing", async () => {
    const madeUp = randomUUID();
    expect((await tower.call<{ can: boolean }>(tower.c1.ap, sql`select app.can_author_workflow(${madeUp}::uuid) as can`))[0]!.can).toBe(false);
    expect(await draftOf(madeUp)(tower.c1.ap)).toEqual([]); // not hidden-from: a made-up id has no row to read first; the same empty the hidden drafts above give
  });
});
