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
  // Built as a draft, then published: a published Version takes no new parts.
  const version = await one(
    `insert into workflow_version (workflow_definition_id, version_no, status)
     values ($1, $2, 'draft') returning id`,
    [definition, no],
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
  if (status === "published") {
    await migrator.query("update workflow_version set status = 'published', published_at = now() where id = $1", [version]);
  }
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

  it("can't take a new Step or Transition", async () => {
    await refused(
      `insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule)
       values ($1, 'extra', $2, 'draft', '{}')`,
      [published.version, name],
    );
    await refused(
      `insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, permission)
       values ($1, 'extra', $2, $3, $4, 'send', 'create')`,
      [published.version, published.fromStep, published.toStep, name],
    );
  });

  it("can't take a draft's Step or Transition moved into it", async () => {
    const definition = await one("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
    const other = await addVersion(definition, 1, "draft");
    await refused("update workflow_step set workflow_version_id = $2, key = 'moved' where id = $1", [other.fromStep, published.version]);
    await refused("update workflow_transition set workflow_version_id = $2, key = 'moved' where id = $1", [other.transition, published.version]);
  });
});

describe("a published Workflow Version, more ways", () => {
  it("can't go back to a draft", async () => {
    await refused("update workflow_version set status = 'draft', published_at = null where id = $1", [published.version]);
  });

  // rabaed_app has no write path to a Version, Step or Transition (no INSERT, UPDATE or
  // DELETE grant), so the guard is never reached through it; the owner is the only writer.
  it("has no write path for rabaed_app", async () => {
    const app = new pg.Client({ connectionString: urls.app });
    await app.connect();
    try {
      await expect(
        app.query(
          `insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule)
           values ($1, 'extra', $2, 'draft', '{}')`,
          [published.version, name],
        ),
      ).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("permission denied") });
      await expect(app.query("delete from workflow_version where id = $1", [published.version])).rejects.toMatchObject({
        message: expect.stringContaining("permission denied"),
      });
    } finally {
      await app.end();
    }
  });

  // The guard reads workflow_version without the caller's row-level security, so a role
  // that can't see the Version is refused all the same.
  it("is checked by security definer functions with a fixed search_path", async () => {
    const { rows } = await migrator.query(
      `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname like 'refuse_published_workflow%' order by p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual(["refuse_published_workflow_part_change", "refuse_published_workflow_version_change"]);
    const part = rows[0];
    expect(part.prosecdef).toBe(true);
    expect(part.proconfig).toEqual(["search_path=pg_catalog, public"]);
  });
});

describe("a draft Workflow Version", () => {
  it("takes a new Step and Transition after it was created", async () => {
    const definition = await one("insert into workflow_definition (owner_kind, name) values ('rabaed', $1) returning id", [name]);
    const later = await addVersion(definition, 1, "draft");
    const step = await one(
      `insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule)
       values ($1, 'third', $2, 'draft', '{}') returning id`,
      [later.version, name],
    );
    await migrator.query(
      `insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, permission)
       values ($1, 'onward', $2, $3, $4, 'send', 'create')`,
      [later.version, later.toStep, step, name],
    );
  });

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
