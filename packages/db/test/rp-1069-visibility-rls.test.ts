// Seam 2 for what the Submittal Panel's Chat tab (RP-1069) reads, as the app role: app.work_item_chat
// and app.post_chat_message (RP-1062; visibility.md V6, V14 and the Chat row; scenario RP-1069-1).
// K1's engineer reads C1's Submitted item's thread: C1's author and the Owner's as their Company's
// name and Project Role only, no person; K1's colleague and the reader by name (the positive control).
// Before the Submission Date K1 reads nothing of the thread, and C1 reads it empty and can't post.
// Seam 1: apps/api/test/rp-1069-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RC${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RCS", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let id = "";
let internal = "";
const message = { c1: "", k1Colleague: "", reader: "", owner: "" };
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

type ChatRow = {
  id: string;
  author_kind: "own" | "other";
  member_name: { en: string; ar: string } | null;
  company_name: { en: string; ar: string };
  role_base: string;
  mine: boolean;
  body: string;
};

/** Item `item`'s Chat as Member `as` reads it, oldest first. */
const chat = (as: string, item: string) =>
  tower.call<ChatRow>(as, sql`select id, author_kind, member_name, company_name, role_base, mine, body from app.work_item_chat(${item}::uuid)`);
/** `as` posts `body` on item `item`: the outcome and the new message's id. */
const post = async (as: string, item: string, body: string) =>
  (await tower.call<{ outcome: string; message_id: string | null }>(as, sql`select outcome, message_id from app.post_chat_message(${item}::uuid, ${body}, now())`))[0]!;
/** `as` posts `body` on item `item`, which must be accepted; returns the new message's id. */
async function posted(as: string, item: string, body: string): Promise<string> {
  const result = await post(as, item, body);
  expect(result.outcome).toBe("posted");
  return result.message_id!;
}

/** C1's Engineer raises an item in Building A and sends it to C1's review; returns its id. */
async function raised(title: string): Promise<string> {
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    tower.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify({ model: title })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  expect(await tower.take(tower.c1.members.engineer, created!.work_item_id, "send_for_review")).toBe("applied");
  return created!.work_item_id;
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-1069 chat tab ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Chat tab (RP-1069)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Chat tab (RP-1069)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, ow, c2 } = tower;
  for (const [as, name] of [
    [c1.members.engineer, "C1 engineer"],
    [c1.members.project_manager, "C1 PM"],
    [k1.members.engineer, "K1 engineer"],
    [k1.members.manager, "K1 manager"],
    [ow.members.representative, "OW representative"],
    [c2.members.engineer, "C2 engineer"],
  ] as const)
    names.set(as, name);

  id = await raised("Cable trays");
  expect(await tower.pickUp(c1.members.project_manager, id)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, id, "submit")).toBe("applied");
  internal = await raised("Cable ladders, not yet Submitted");
  message.c1 = await posted(c1.members.engineer, id, "Datasheet attached.");
  message.k1Colleague = await posted(k1.members.manager, id, "Reviewing today.");
  message.reader = await posted(k1.members.engineer, id, "Checking the sample.");
  message.owner = await posted(ow.members.representative, id, "Please prioritise.");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1069-1: K1's engineer reads C1's Submitted item's thread", () => {
  it("reads C1's and the Owner's messages by Company name and Project Role only; K1's colleague and the reader by name", async () => {
    const rows = await chat(tower.k1.members.engineer, id);
    expect(rows.map((r) => [r.id, r.author_kind, r.member_name, r.company_name, r.role_base, r.mine, r.body])).toEqual([
      [message.c1, "other", null, bilingual("C1"), "contractor", false, "Datasheet attached."],
      [message.k1Colleague, "own", bilingual("manager"), bilingual("K1"), "consultant", false, "Reviewing today."],
      [message.reader, "own", bilingual("engineer"), bilingual("K1"), "consultant", true, "Checking the sample."],
      [message.owner, "other", null, bilingual("OW"), "owner", false, "Please prioritise."],
    ]);
  });

  it("names C1's author to C1 only, and the Owner's to the Owner only", async () => {
    const { c1, k1, ow } = tower;
    /** The messages `as` reads with their author named: their own Company's. */
    const namedMessages = async (as: string) => (await chat(as, id)).filter((r) => r.member_name !== null);
    await expectHiddenFrom({
      read: namedMessages,
      target: message.c1,
      seenBy: [c1.members.project_manager, c1.members.engineer],
      hiddenFrom: [k1.members.engineer, k1.members.manager, ow.members.representative],
      name: named,
      label: "C1's author",
    });
    await expectHiddenFrom({
      read: namedMessages,
      target: message.owner,
      seenBy: ow.members.representative,
      hiddenFrom: [k1.members.engineer, c1.members.project_manager],
      name: named,
      label: "the Owner's author",
    });
  });

  it("gives a Contractor who doesn't see the item none of its messages", async () => {
    const { c1, c2 } = tower;
    await expectHiddenFrom({ read: (as: string) => chat(as, id), target: message.reader, seenBy: c1.members.project_manager, hiddenFrom: c2.members.engineer, name: named, label: "the thread" });
  });
});

describe("scenario RP-1069-1: before the Submission Date", () => {
  it("refuses C1's post before the Submission Date and writes nothing: once Submitted, K1 reads only the post after it", async () => {
    const { c1, k1 } = tower;
    expect((await post(c1.members.engineer, internal, "Too early")).outcome).toBe("not_submitted");
    expect(await chat(c1.members.engineer, internal)).toEqual([]); // not hidden-from: C1 sees the item; the refused post wrote nothing
    expect(await tower.pickUp(c1.members.project_manager, internal)).toBe("picked_up");
    expect(await tower.take(c1.members.project_manager, internal, "submit")).toBe("applied");
    // Once Submitted, a post is open to both; the one refused before stays unwritten.
    const after = await posted(c1.members.engineer, internal, "Submitted now.");
    expect((await chat(k1.members.engineer, internal)).map((r) => r.id)).toEqual([after]);
  });

  it("K1 doesn't read the thread of an item still in C1's review, while C1 reads it", async () => {
    const { c1, k1 } = tower;
    const early = await raised("Cable glands, in C1's review");
    // The item itself: C1 reads it, K1 doesn't (V1), so neither its thread.
    const item = (as: string) => tower.call<{ id: string }>(as, sql`select id from work_item where id = ${early}::uuid`);
    await expectHiddenFrom({ read: item, target: early, seenBy: c1.members.engineer, hiddenFrom: [k1.members.engineer, k1.members.manager], name: named, label: "the item before Submission" });
    expect((await post(k1.members.engineer, early, "Hello?")).outcome).toBe("not_found");
  });
});
