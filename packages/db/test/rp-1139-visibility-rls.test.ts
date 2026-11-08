// Seam 2 for the Member ids another Company could read (RP-1139; visibility.md V14; scenarios
// RP-1139-1 to RP-1139-7), as the app role: `work_item_event.actor_member_id` and
// `document.uploaded_by_member_id` are not granted, and app.event_actor_members and app.document_uploaders
// give the id only for a Member of the reader's own Company (PR 1). Nor are `work_item.created_by_member_id`,
// `numbering_pattern.set_by_member_id`, `participant.invited_by_member_id` and `withdrawn_by_member_id`, or
// `project.creator_member_id`; app.my_created_work_items gives the caller's own raised items (PR 2). C1's
// Submittal goes through K1's Recommendation to the Owner's review, which closes it. Seam 1:
// apps/api/test/rp-1139-visibility.test.ts.
import { randomInt } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import { addOwnerReviewWorkflow, bilingual, buildSeamTwoTower, expectHiddenFrom, sha256Bytea, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RM${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RMP", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let item = "";
let eventIds: string[] = [];
let c1Document = "";

const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

/** `as` uploads a Document to the item and confirms it; returns its id. */
async function uploaded(as: string, fileName: string): Promise<string> {
  const [started] = await tower.call<{ outcome: string; document_id: string }>(
    as,
    sql`select outcome, document_id from app.start_document_upload(${item}::uuid, ${fileName}, 10, 'application/pdf', now(), null)`,
  );
  expect(started!.outcome).toBe("started");
  expect(
    await tower.outcome(
      as,
      sql`select app.confirm_document_upload(${item}::uuid, ${started!.document_id}::uuid, 10, 'application/pdf', ${sha256Bytea(fileName)}, now(),
        null, null, null, 1) as outcome`,
    ),
  ).toBe("confirmed");
  return started!.document_id;
}

/** The actor ids `as` reads on the item's events through app.event_actor_members, as rows by id. */
const actorsRead = async (as: string) =>
  (await tower.call<{ actor_member_id: string | null }>(as, sql`select actor_member_id from app.event_actor_members(${eventIds}::uuid[])`))
    .filter((r) => r.actor_member_id !== null)
    .map((r) => ({ id: r.actor_member_id! }));
/** The uploader ids `as` reads on the item's Documents through app.document_uploaders, as rows by id. */
const uploadersRead = async (as: string) =>
  (await tower.call<{ uploaded_by_member_id: string | null }>(as, sql`select uploaded_by_member_id from app.document_uploaders(${[c1Document]}::uuid[])`))
    .filter((r) => r.uploaded_by_member_id !== null)
    .map((r) => ({ id: r.uploaded_by_member_id! }));

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);
  const workflow = await addOwnerReviewWorkflow(run);
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Member ids (RP-1139)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Member ids (RP-1139)")), workflow, formId],
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

  // The Owner's review is an approving Step: OW's representative is its Project Manager too.
  expect(
    await tower.outcome(
      ow.ap,
      sql`select app.set_project_member_positions(${ow.participantId}::uuid, ${ow.members.representative}::uuid, ${["representative", "project_manager"]}::text[]) as outcome`,
    ),
  ).toBe("set");
  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'Switchgear', app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "SG-1" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  item = created!.work_item_id;
  c1Document = await uploaded(c1.members.engineer, "c1-datasheet.pdf");
  expect(await tower.take(c1.members.engineer, item, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(c1.members.project_manager, item)).toBe("picked_up");
  expect(await tower.take(c1.members.project_manager, item, "submit")).toBe("applied");
  expect(await tower.pickUp(k1.members.manager, item)).toBe("picked_up");
  expect(await tower.take(k1.members.manager, item, "recommend_a")).toBe("applied");
  eventIds = (await migrator.query<{ id: string }>("select id from work_item_event where work_item_id = $1", [item])).rows.map((r) => r.id);
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1139-1: the app role reads no event actor or Document uploader directly", () => {
  it("refuses a direct select of work_item_event.actor_member_id and document.uploaded_by_member_id", async () => {
    const as = tower.c1.members.engineer;
    type Row = Record<string, string | null>;
    await expect(tower.call<Row>(as, sql`select actor_member_id from work_item_event where work_item_id = ${item}::uuid`)).rejects.toThrow(/permission denied/);
    await expect(tower.call<Row>(as, sql`select uploaded_by_member_id from document where work_item_id = ${item}::uuid`)).rejects.toThrow(/permission denied/);
    // The rest of each row stays readable: the event's actor Participant, the Document's uploading Participant.
    expect((await tower.call<Row>(as, sql`select actor_participant_id from work_item_event where work_item_id = ${item}::uuid`)).length).toBeGreaterThan(0);
    expect((await tower.call<Row>(as, sql`select uploaded_by_participant_id from document where work_item_id = ${item}::uuid`)).length).toBeGreaterThan(0);
  });
});

describe("scenario RP-1139-2: C1 at the Owner's review, and after it closes, reads no other Company's actor", () => {
  const cOne = () => [tower.c1.members.engineer, tower.c1.members.project_manager];
  const kOne = () => [tower.k1.members.engineer, tower.k1.members.manager];

  it("at the Owner's review: K1's manager's Recommendation names its actor to K1 only; C1's PM's Submit to C1 only", async () => {
    const { c1, k1, ow, c2 } = tower;
    await expectHiddenFrom({
      read: actorsRead,
      target: k1.members.manager,
      seenBy: kOne(),
      hiddenFrom: [...cOne(), ow.members.representative, c2.members.engineer],
      name: named,
      label: "K1's manager on the Recommendation",
    });
    await expectHiddenFrom({
      read: actorsRead,
      target: c1.members.project_manager,
      seenBy: cOne(),
      hiddenFrom: [...kOne(), ow.members.representative, c2.members.engineer],
      name: named,
      label: "C1's PM on the Submit",
    });
  });

  it("the history names each reader's own Company's actor only", async () => {
    const { c1, k1 } = tower;
    const historyNames = async (as: string) =>
      (await tower.call<{ member_name: { en: string } | null }>(as, sql`select member_name from app.work_item_history(${item}::uuid)`))
        .filter((r) => r.member_name !== null)
        .map((r) => ({ id: r.member_name!.en }));
    const k1Name = (await migrator.query<{ en: string }>("select full_name ->> 'en' as en from member where id = $1", [k1.members.manager])).rows[0]!.en;
    await expectHiddenFrom({ read: historyNames, target: k1Name, seenBy: kOne(), hiddenFrom: [...cOne(), tower.ow.members.representative], name: named, label: "K1's manager in the history" });
    const c1Name = (await migrator.query<{ en: string }>("select full_name ->> 'en' as en from member where id = $1", [c1.members.project_manager])).rows[0]!.en;
    await expectHiddenFrom({ read: historyNames, target: c1Name, seenBy: cOne(), hiddenFrom: [...kOne(), tower.ow.members.representative], name: named, label: "C1's PM in the history" });
  });

  it("after the Owner's closing Confirm: its actor is the Owner's own; C1 and K1 read no id of it", async () => {
    const { ow, c2 } = tower;
    expect(await tower.pickUp(ow.members.representative, item)).toBe("picked_up");
    expect(await tower.take(ow.members.representative, item, "confirm_a")).toBe("applied");
    eventIds = (await migrator.query<{ id: string }>("select id from work_item_event where work_item_id = $1", [item])).rows.map((r) => r.id);
    await expectHiddenFrom({
      read: actorsRead,
      target: ow.members.representative,
      seenBy: ow.members.representative,
      hiddenFrom: [...cOne(), ...kOne(), c2.members.engineer],
      name: named,
      label: "the Owner's representative on the closing Confirm",
    });
  });

  it("the activity feed still marks a reader's own moves (by_me, on_item) without the actor column", async () => {
    const { k1 } = tower;
    const feed = await tower.call<{ work_item_id: string; by_me: boolean; on_item: boolean; transition_label: { en: string } | null }>(
      k1.members.manager,
      sql`select work_item_id, by_me, on_item, transition_label from app.activity_feed(${tower.projectId}::uuid, null, null, true, null, 50)`,
    );
    const mine = feed.filter((r) => r.work_item_id === item);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.on_item)).toBe(true);
    expect(mine.some((r) => r.by_me)).toBe(true);
    const engineer = await tower.call<{ work_item_id: string; by_me: boolean }>(
      k1.members.engineer,
      sql`select work_item_id, by_me from app.activity_feed(${tower.projectId}::uuid, null, null, false, null, 50)`,
    );
    expect(engineer.filter((r) => r.work_item_id === item).some((r) => r.by_me)).toBe(false);
  });
});

describe("scenario RP-1139-3: another Company reads a Document's Company, never its uploader's id", () => {
  it("C1's Document names its uploader to C1 only", async () => {
    const { c1, k1, ow, c2 } = tower;
    const cOne = [c1.members.engineer, c1.members.project_manager];
    const kOne = [k1.members.engineer, k1.members.manager];
    // The Documents themselves are read across Companies, so a hidden id is the column, not the row.
    const seen = await tower.call<{ id: string }>(k1.members.engineer, sql`select id from document where id = ${c1Document}::uuid`);
    expect(seen.map((r) => r.id)).toEqual([c1Document]);
    await expectHiddenFrom({
      read: uploadersRead,
      target: c1.members.engineer,
      seenBy: cOne,
      hiddenFrom: [...kOne, ow.members.representative, c2.members.engineer],
      name: named,
      label: "C1's engineer on C1's Document",
    });
  });
});

describe("scenario RP-1139-4: C2 on C1's item, which it doesn't see, gets nothing", () => {
  it("asked with the item's event and Document ids, gives C2 no row; C1 reads its own", async () => {
    const { c1, c2 } = tower;
    const anyRow = async (as: string) => {
      const events = await tower.call<{ event_id: string }>(as, sql`select event_id from app.event_actor_members(${eventIds}::uuid[])`);
      const documents = await tower.call<{ document_id: string }>(as, sql`select document_id from app.document_uploaders(${[c1Document]}::uuid[])`);
      return [...events.map((r) => ({ id: r.event_id })), ...documents.map((r) => ({ id: r.document_id }))];
    };
    await expectHiddenFrom({ read: anyRow, target: c1Document, seenBy: c1.members.engineer, hiddenFrom: c2.members.engineer, name: named, label: "C1's Document" });
    // C1's first move after the Draft's start (`created` is no one's to read).
    const sent = (await migrator.query<{ id: string }>("select id from work_item_event where work_item_id = $1 and type <> 'created' order by seq limit 1", [item])).rows[0]!.id;
    await expectHiddenFrom({ read: anyRow, target: sent, seenBy: c1.members.engineer, hiddenFrom: c2.members.engineer, name: named, label: "an event of C1's item" });
  });
});

describe("scenario RP-1139-5: the app role reads no item creator, numbering setter, inviter, withdrawer or Project creator directly", () => {
  it("refuses a direct select of each, of rows the reader sees; the rest of each row stays readable", async () => {
    const { c1, k1 } = tower;
    // K1's own Participant row was invited by C1's AP; the Project and its pattern were set by C1's AP; the item was raised by C1's engineer.
    expect(
      await tower.outcome(
        c1.ap,
        sql`select app.set_numbering_pattern(${tower.projectId}::uuid, null, ${JSON.stringify([{ kind: "project" }, { kind: "participant" }])}::jsonb,
          '-', 4, ${JSON.stringify([0, 1])}::jsonb, false, now()) as outcome`,
      ),
    ).toBe("saved");
    const reads: [string, RawBuilder<object>, RawBuilder<object>][] = [
      [k1.members.engineer, sql`select created_by_member_id from work_item where id = ${item}::uuid`, sql`select raised_by_participant_id from work_item where id = ${item}::uuid`],
      [k1.members.engineer, sql`select set_by_member_id from numbering_pattern where project_id = ${tower.projectId}::uuid`, sql`select id from numbering_pattern where project_id = ${tower.projectId}::uuid`],
      [k1.ap, sql`select invited_by_member_id from participant where id = ${k1.participantId}::uuid`, sql`select status from participant where id = ${k1.participantId}::uuid`],
      [k1.ap, sql`select withdrawn_by_member_id from participant where id = ${k1.participantId}::uuid`, sql`select company_id from participant where id = ${k1.participantId}::uuid`],
      [k1.members.engineer, sql`select creator_member_id from project where id = ${tower.projectId}::uuid`, sql`select code from project where id = ${tower.projectId}::uuid`],
      // Refused to one's own Company too: the column is no one's to read directly.
      [c1.members.engineer, sql`select created_by_member_id from work_item where id = ${item}::uuid`, sql`select id from work_item where id = ${item}::uuid`],
    ];
    for (const [as, refused, readable] of reads) {
      const label = `${named(as)}: ${refused.compile(app).sql}`;
      await expect(tower.call(as, refused), label).rejects.toThrow(/permission denied/);
      expect((await tower.call(as, readable)).length, label).toBeGreaterThan(0); // not hidden-from: the row itself is the reader's to see, the control for the refused column above
    }
  });
});

describe("scenario RP-1139-6: \"Items I'm on\" knows the raiser's own items without the creator column", () => {
  it("app.my_created_work_items gives the raiser their item, and no one else", async () => {
    const { c1, k1, ow, c2 } = tower;
    const created = async (as: string) =>
      (await tower.call<{ id: string }>(as, sql`select app.my_created_work_items(${tower.projectId}::uuid) as id`)).map((r) => ({ id: r.id }));
    await expectHiddenFrom({
      read: created,
      target: item,
      seenBy: c1.members.engineer,
      hiddenFrom: [c1.members.project_manager, k1.members.engineer, k1.members.manager, ow.members.representative, c2.members.engineer],
      name: named,
      label: "C1's engineer's raised item",
    });
  });

  it("the Activity Feed's \"Items I'm on\" holds an item for its raiser who never acted on it; not for C1's AP, K1 or C2", async () => {
    const { c1, k1, c2 } = tower;
    // A raiser who never acted, as a Register import makes the assignee the raiser (the importer acts): C1's engineer
    // starts and sends it, and C1's PM is made its raiser. Only app.my_created_work_items puts it in the PM's "Items I'm on".
    const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
      c1.members.engineer,
      sql`select outcome, work_item_id from app.create_work_item(
        ${tower.projectId}::uuid, ${TYPE}, 'Panels', app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "PN-1" })}::jsonb,
        ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
    );
    expect(created!.outcome).toBe("created");
    const raised = created!.work_item_id;
    expect(await tower.take(c1.members.engineer, raised, "send_for_review")).toBe("applied");
    await migrator.query("update work_item set created_by_member_id = $1 where id = $2", [c1.members.project_manager, raised]);
    const mine = async (as: string) =>
      (
        await tower.call<{ work_item_id: string; on_item: boolean }>(
          as,
          sql`select work_item_id, on_item from app.activity_feed(${tower.projectId}::uuid, null, null, true, null, 100)`,
        )
      )
        .filter((r) => r.on_item)
        .map((r) => ({ id: r.work_item_id }));
    await expectHiddenFrom({
      read: mine,
      target: raised,
      seenBy: c1.members.project_manager,
      hiddenFrom: [c1.ap, k1.members.engineer, c2.members.engineer],
      name: named,
      label: "the PM's raised item in Items I'm on",
    });
  });
});

describe("scenario RP-1139-7: the numbering pattern's setter is named to the setter's own Company only", () => {
  it("names C1's AP to C1, and gives K1, the Owner and C2 no name", async () => {
    const { c1, k1, ow, c2 } = tower;
    const setters = async (as: string) =>
      (await tower.call<{ member_name: { en: string } | null }>(as, sql`select member_name from app.numbering_pattern_versions(${tower.projectId}::uuid, now())`))
        .filter((r) => r.member_name !== null)
        .map((r) => ({ id: r.member_name!.en }));
    const apName = (await migrator.query<{ en: string }>("select full_name ->> 'en' as en from member where id = $1", [c1.ap])).rows[0]!.en;
    await expectHiddenFrom({
      read: setters,
      target: apName,
      seenBy: [c1.ap, c1.members.engineer],
      hiddenFrom: [k1.ap, k1.members.engineer, ow.members.representative, c2.members.engineer],
      name: named,
      label: "C1's AP as the pattern's setter",
    });
  });
});
