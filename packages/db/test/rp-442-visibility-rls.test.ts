// Seam 2 for a Company's Library of Workflows (RP-442, WF-19; ADR 0016; visibility.md V18,
// scenario RP-442-1), through the tables and commands its routes use (apps/api/src/projects/
// workflows.ts: listLibraryWorkflows, readWorkflow, readWorkflowBuilder, saveWorkflowToLibrary)
// as the app role. TMC (C1, Tower's creator) saves Tower's own Workflow to its Library, edits the
// copy and uses it on Tower; K1, Tower's Consultant, saves Tower's Workflow to its own. A Library
// is its Company's alone: K1 and a Company on no shared Project read none of TMC's, and TMC none
// of K1's; a plain TMC Member reads TMC's published ones, never a draft. The copies keep no link.
// Seam 1: apps/api/test/workflow-library.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RL${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RLP", otherProject: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let route = ""; // Tower's own Workflow.
let tmcCopy = ""; // In TMC's Library: published, edited to Version 2, a Version 3 drafted.
let tmcDraftOnly = ""; // In TMC's Library, never published.
let k1Copy = ""; // In K1's Library.
let towerFromLibrary = ""; // Tower's copy of TMC's Library Workflow: a draft.

const name: Record<string, string> = {};
const named = (member: string) => name[member] ?? member;
const ids = async (as: string, query: ReturnType<typeof sql<{ id: string }>>) => (await tower.call<{ id: string }>(as, query)).map((r) => ({ id: r.id }));
/** The Library list `as` reads: their own Company's Library Workflows, as listLibraryWorkflows selects them. */
const libraryList = (as: string) => ids(as, sql<{ id: string }>`select d.id from workflow_definition d where d.owner_kind = 'company' and d.company_id = app.current_company_id()`);
/** Workflow `id`, read by id (what its read, map and builder start from). */
const workflow = (id: string) => (as: string) => ids(as, sql<{ id: string }>`select id from workflow_definition where id = ${id}::uuid`);

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);

  const rabaedDefault = await addTestWorkflow(run, { name: bilingual(`RP-442 default ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Library (RP-442)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  const typeId = (
    await migrator.query(
      `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
       values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4) returning id`,
      [TYPE, JSON.stringify(bilingual("Library (RP-442)")), rabaedDefault, formId],
    )
  ).rows[0].id as string;

  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, ow, other } = tower;
  Object.assign(name, {
    [c1.ap]: "TMC's Authorized Person",
    [c1.members.engineer]: "a plain TMC Member",
    [k1.ap]: "K1's Authorized Person",
    [k1.members.engineer]: "K1 engineer",
    [ow.members.representative]: "the Owner",
    [other.ap]: "a Company on no shared Project",
  });

  // K1's Authorized Person on Tower too, to read the Workflow it saves.
  await tower.call(k1.ap, sql<{ outcome: string }>`select app.add_project_member(${k1.participantId}::uuid, ${k1.ap}::uuid, now())`);
  route = await addTestWorkflow(run, { name: bilingual(`Tower route ${digits(4)}`), owner: { kind: "project", projectId: tower.projectId } });
  await migrator.query("update workflow_definition set work_item_type_id = $1 where id = $2", [typeId, route]);

  const copy = async (as: string, source: string, projectId: string | null) => {
    const [copied] = await tower.call<{ outcome: string; workflow_definition_id: string }>(
      as,
      sql`select outcome, workflow_definition_id from app.duplicate_workflow(${source}::uuid, ${projectId}::uuid, ${JSON.stringify(bilingual(`Copy ${digits(4)}`))}::jsonb, now())`,
    );
    expect(copied!.outcome, named(as)).toBe("duplicated");
    return copied!.workflow_definition_id;
  };
  const publish = async (as: string, id: string) => expect(await tower.outcome(as, sql`select outcome from app.publish_workflow(${id}::uuid, now())`)).toBe("published");
  /** A new draft of `id`: its latest published Version as it is, renamed. */
  const redraft = async (as: string, id: string) => {
    const [rows] = await tower.call<{ layout: unknown; steps: unknown; transitions: unknown }>(
      as,
      sql`select r.* from workflow_version v cross join lateral app.workflow_version_rows(v.id) r
        where v.workflow_definition_id = ${id}::uuid and v.status = 'published' order by v.version_no desc limit 1`,
    );
    const saved = await tower.outcome(
      as,
      sql`select outcome from app.save_workflow_draft(${id}::uuid, ${JSON.stringify(bilingual(`Edited ${digits(4)}`))}::jsonb, ${JSON.stringify(rows!.layout)}::jsonb,
        ${JSON.stringify(rows!.steps)}::jsonb, ${JSON.stringify(rows!.transitions)}::jsonb, now())`,
    );
    expect(saved).toBe("saved");
  };

  // TMC's Authorized Person saves Tower's Workflow to TMC's Library (published at once), edits it to a Version 2, then drafts a Version 3.
  tmcCopy = await copy(c1.ap, route, null);
  await publish(c1.ap, tmcCopy);
  await redraft(c1.ap, tmcCopy);
  await publish(c1.ap, tmcCopy);
  await redraft(c1.ap, tmcCopy);
  tmcDraftOnly = await copy(c1.ap, route, null);
  // And uses it on Tower: Tower's copy, a draft.
  towerFromLibrary = await copy(c1.ap, tmcCopy, tower.projectId);
  // K1 saves Tower's Workflow to its own Library.
  k1Copy = await copy(k1.ap, route, null);
  await publish(k1.ap, k1Copy);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-442-1: a Company Library", () => {
  it("TMC's Library list and Workflows: TMC's Members only, never K1 or a Company on no shared Project (V18)", async () => {
    const { c1, k1, other } = tower;
    const outsiders = [k1.ap, k1.members.engineer, other.ap];
    await expectHiddenFrom({ read: libraryList, target: tmcCopy, seenBy: [c1.ap, c1.members.engineer], hiddenFrom: outsiders, name: named, label: "TMC's Library list" });
    await expectHiddenFrom({ read: workflow(tmcCopy), target: tmcCopy, seenBy: [c1.ap, c1.members.engineer], hiddenFrom: outsiders, name: named, label: "TMC's Library Workflow" });
    const versions = (as: string) => ids(as, sql<{ id: string }>`select id from workflow_version where workflow_definition_id = ${tmcCopy}::uuid`);
    const latest = (await migrator.query("select id from workflow_version where workflow_definition_id = $1 and version_no = 2", [tmcCopy])).rows[0].id as string;
    await expectHiddenFrom({ read: versions, target: latest, seenBy: [c1.ap, c1.members.engineer], hiddenFrom: outsiders, name: named, label: "its Version 2" });
    // Saving it to another Library is refused to them as to a made-up id.
    for (const as of [k1.ap, other.ap]) {
      expect(await tower.outcome(as, sql`select outcome from app.duplicate_workflow(${tmcCopy}::uuid, null, ${JSON.stringify(bilingual("Taken"))}::jsonb, now())`), named(as)).toBe("not_found");
    }
  });

  it("K1's list holds its own copy only, and TMC's holds TMC's", async () => {
    const { c1, k1, other } = tower;
    expect((await libraryList(k1.ap)).map((r) => r.id)).toEqual([k1Copy]);
    expect((await libraryList(c1.ap)).map((r) => r.id).sort()).toEqual([tmcCopy, tmcDraftOnly].sort());
    await expectHiddenFrom({ read: libraryList, target: k1Copy, seenBy: [k1.ap, k1.members.engineer], hiddenFrom: [c1.ap, c1.members.engineer, other.ap], name: named, label: "K1's Library list" });
    await expectHiddenFrom({ read: workflow(k1Copy), target: k1Copy, seenBy: k1.ap, hiddenFrom: [c1.ap, c1.members.engineer, other.ap], name: named, label: "K1's Library Workflow" });
  });

  it("a plain TMC Member reads the published Library Workflows, never a draft or the builder; saving to the Library is refused them", async () => {
    const { c1, k1 } = tower;
    await expectHiddenFrom({ read: workflow(tmcDraftOnly), target: tmcDraftOnly, seenBy: c1.ap, hiddenFrom: [c1.members.engineer, k1.ap], name: named, label: "a never-published Library Workflow" });
    const draft = (await migrator.query("select id from workflow_version where workflow_definition_id = $1 and status = 'draft'", [tmcCopy])).rows[0].id as string;
    const drafted = async (as: string) =>
      (await tower.call<{ workflow_version_id: string }>(as, sql`select workflow_version_id from app.workflow_draft(${tmcCopy}::uuid)`)).map((r) => ({ id: r.workflow_version_id }));
    await expectHiddenFrom({ read: drafted, target: draft, seenBy: c1.ap, hiddenFrom: [c1.members.engineer, k1.ap], name: named, label: "the Library Workflow's draft (the builder)" });
    const authors = async (as: string) => ((await tower.call<{ can: boolean }>(as, sql`select app.can_author_workflow(${tmcCopy}::uuid) as can`))[0]!.can ? [{ id: tmcCopy }] : []);
    await expectHiddenFrom({ read: authors, target: tmcCopy, seenBy: c1.ap, hiddenFrom: [c1.members.engineer, k1.ap], name: named, label: "app.can_author_workflow" });
    expect(await tower.outcome(c1.members.engineer, sql`select outcome from app.duplicate_workflow(${route}::uuid, null, ${JSON.stringify(bilingual("Mine"))}::jsonb, now())`)).toBe(
      "not_found",
    );
  });

  it("the copies keep no link: a Library edit never reaches Tower's Workflow, and Tower's copy of the Library Workflow is a draft its Project Admins alone read", async () => {
    const { c1, k1, ow } = tower;
    for (const copy of [tmcCopy, k1Copy, towerFromLibrary]) {
      const { rows } = await migrator.query("select to_jsonb(d) as row from workflow_definition d where id = $1", [copy]);
      expect(JSON.stringify(rows[0].row)).not.toContain(route); // not hidden-from: the copy's row names no source (ADR 0016), read as the tables' owner
    }
    const { rows } = await migrator.query("select to_jsonb(d) as row from workflow_definition d where id = $1", [towerFromLibrary]);
    expect(JSON.stringify(rows[0].row)).not.toContain(tmcCopy); // not hidden-from: nor does Tower's copy name the Library Workflow
    // TMC's Library edits (Versions 2 and 3) left Tower's Workflow at its one Version.
    expect((await migrator.query("select version_no, status from workflow_version where workflow_definition_id = $1", [route])).rows).toEqual([{ version_no: 1, status: "published" }]);
    await expectHiddenFrom({
      read: workflow(towerFromLibrary),
      target: towerFromLibrary,
      seenBy: c1.ap,
      hiddenFrom: [c1.members.engineer, k1.members.engineer, ow.members.representative],
      name: named,
      label: "Tower's copy of the Library Workflow",
    });
  });
});
