// Seam 2 for Workflows (RP-424; ADR 0016): a published Workflow Version, with its
// Steps and Transitions, never changes or goes away, not even for the role that
// owns the tables (the one `pnpm db:setup` migrates with). A draft can change
// and be published.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrls } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const name = JSON.stringify({ en: "Frozen", ar: "مجمد" });

let migrator: pg.Client;
const one = async (text: string, values: unknown[] = []) => (await migrator.query(text, values)).rows[0].id as string;

type Version = { version: string; fromStep: string; toStep: string; transition: string };
let published: Version;
let draft: Version;

async function addVersion(definition: string, no: number, status: "draft" | "published"): Promise<Version> {
  const version = await one(
    `insert into workflow_version (workflow_definition_id, version_no, status, published_at)
     values ($1, $2, $3::text, case when $3::text = 'published' then now() end) returning id`,
    [definition, no, status],
  );
  const step = (key: string) =>
    one(
      `insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule)
       values ($1, $2, $3, 'draft', '{}') returning id`,
      [version, key, name],
    );
  const fromStep = await step("first");
  const toStep = await step("second");
  const transition = await one(
    `insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, permission)
     values ($1, 'go', $2, $3, $4, 'send', 'create') returning id`,
    [version, fromStep, toStep, name],
  );
  return { version, fromStep, toStep, transition };
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  const definition = await one("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
  published = await addVersion(definition, 1, "published");
  draft = await addVersion(definition, 2, "draft");
});

afterAll(async () => {
  await migrator?.end();
});

const refused = (text: string, values: unknown[]) =>
  expect(migrator.query(text, values)).rejects.toMatchObject({ code: "42501" });

describe("a published Workflow Version, as its owner", () => {
  it("can't be updated or deleted", async () => {
    await refused("update workflow_version set layout = '{\"x\": 1}' where id = $1", [published.version]);
    await refused("delete from workflow_version where id = $1", [published.version]);
  });

  it("can't have a Step changed or removed", async () => {
    await refused("update workflow_step set stage_key = 'closed' where id = $1", [published.fromStep]);
    await refused("delete from workflow_step where id = $1", [published.toStep]);
  });

  it("can't have a Transition changed or removed", async () => {
    await refused("update workflow_transition set sort = 9 where id = $1", [published.transition]);
    await refused("delete from workflow_transition where id = $1", [published.transition]);
  });

  it("can't have a Step or Transition moved out to a draft Version", async () => {
    await refused("update workflow_step set workflow_version_id = $2 where id = $1", [published.fromStep, draft.version]);
  });
});

describe("a draft Workflow Version", () => {
  it("can have its Version, Steps and Transitions changed", async () => {
    await migrator.query("update workflow_version set layout = '{\"x\": 1}' where id = $1", [draft.version]);
    await migrator.query("update workflow_step set stage_key = 'in_review' where id = $1", [draft.fromStep]);
    await migrator.query("update workflow_transition set sort = 3 where id = $1", [draft.transition]);
  });

  it("is published, and is frozen from then on", async () => {
    await migrator.query("update workflow_version set status = 'published', published_at = now() where id = $1", [draft.version]);
    await refused("update workflow_step set stage_key = 'closed' where id = $1", [draft.fromStep]);
    await refused("delete from workflow_transition where id = $1", [draft.transition]);
    await refused("delete from workflow_version where id = $1", [draft.version]);
  });

  it("can be deleted, with its Steps and Transitions, while still a draft", async () => {
    const definition = await one("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
    const scratch = await addVersion(definition, 1, "draft");
    await migrator.query("delete from workflow_transition where id = $1", [scratch.transition]);
    await migrator.query("delete from workflow_step where workflow_version_id = $1", [scratch.version]);
    await migrator.query("delete from workflow_version where id = $1", [scratch.version]);
  });
});
