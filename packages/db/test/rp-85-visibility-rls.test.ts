// Seam 2 for scenarios RP-85-1 and RP-85-2 (ADR 0023: no Signature, no Transition): a holder with no
// Signature is refused `no_signature`, before the Form's own check, with nothing written and nobody
// notified; another Company's Member gets the plain `not_found`. Each Transition's event records
// the Signature in force, kept after it is replaced; each Member reads only their own Signatures,
// and no history read through the app role carries a `signature_id`. Seam 1 is
// apps/api/test/signature.test.ts.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/index.ts";
import {
  addTestWorkflow,
  bilingual,
  buildSeamTwoTower,
  digits,
  expectHiddenFrom,
  testDatabaseUrls,
  withoutSignature,
  type RunAsOwner,
  type SeamTwoTower,
} from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RS${letters(3)}`;
const sha = (s: string) => createHash("sha256").update(s).digest();

let migrator: pg.Client;
let app: Db;
let t: SeamTwoTower;
const asOwner: RunAsOwner = (text, values) => migrator.query(text, values as unknown[]);
let names: Map<string, string>;
const name = (member: string) => names.get(member) ?? member;

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const run = (text: string) => migrator.query(text);
  const workflowId = await addTestWorkflow(run, { name: bilingual(`RP-85 signature ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Signature (RP-85)"))]))
    .rows[0].id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", required: true, label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Signature (RP-85)")), workflowId, formId],
  );
  t = await buildSeamTwoTower(app, migrator, { projectCode: "RSG" });
  names = new Map([
    [t.c1.members.engineer, "C1 engineer"],
    [t.c1.members.project_manager, "C1 PM"],
    [t.c2.members.engineer, "C2 engineer"],
  ]);
}, 60_000);

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

/** C1's engineer raises a Draft with `data`; returns its id. */
async function raise(title: string, data: object): Promise<string> {
  const [created] = await t.call<{ outcome: string; work_item_id: string }>(
    t.c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${t.projectId}::uuid, ${TYPE}, ${title}, app.latest_form_version(${TYPE}), ${JSON.stringify(data)}::jsonb,
      ${t.tradeId}::uuid, ${t.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  return created!.work_item_id;
}

/** `as` takes Send for Review on `id` with answers the api never found complete: a Form with gaps. */
const sendUnchecked = (as: string, id: string) =>
  t.outcome(
    as,
    sql`select app.take_transition(${id}::uuid, 'send_for_review', '{}'::jsonb, '', ${sha("not the checked answers")}, ${randomUUID()}::uuid, now()) as outcome`,
  );

/** What item `id` has written: its events and the notifications about it. */
const written = async (id: string) =>
  (
    await migrator.query<{ events: number; notices: number }>(
      `select (select count(*)::int from work_item_event where work_item_id = $1) as events,
              (select count(*)::int from notification where work_item_id = $1) as notices`,
      [id],
    )
  ).rows[0]!;

/** Saves a Signature as `member`, as the api does once it stored the image; returns its id. */
const addSignature = async (member: string) => {
  const key = `members/${member}/signatures/${randomUUID()}.png`;
  const [row] = await t.call<{ id: string }>(member, sql`select app.set_member_signature(${key}, ${sha(key)}, ${1234}, 'image/png', 'drawn', now()) as id`);
  return row!.id;
};

/** The Signatures `member` reads. */
const signaturesOf = (member: string) => t.call<{ id: string }>(member, sql`select id from member_signature`);

describe("scenario RP-85-1: C1's engineer has no Signature and opens Send for Review on a Draft whose Form isn't complete", () => {
  it("refuses the engineer no_signature before the Form's gaps, writing nothing and telling nobody; the PM is asked for nothing and C2 gets not_found", async () => {
    const id = await raise("Cable trays, no Signature", {});
    await withoutSignature(asOwner, t.c1.members.engineer);
    await withoutSignature(asOwner, t.c1.members.project_manager);
    const before = await written(id);
    // The item read says a Signature is needed: the engineer's own Signature in force is none.
    expect(await t.call<{ id: string | null }>(t.c1.members.engineer, sql`select app.active_signature_id(${t.c1.members.engineer}::uuid) as id`)).toEqual([{ id: null }]);
    expect(await sendUnchecked(t.c1.members.engineer, id)).toBe("no_signature");
    // The PM holds no Step of the Draft, so is never asked for a Signature; C2 doesn't see the item at all.
    expect(await sendUnchecked(t.c1.members.project_manager, id)).toBe("not_holder");
    expect(await sendUnchecked(t.c2.members.engineer, id)).toBe("not_found");
    expect(await written(id)).toEqual(before);

    // With a Signature the Form's own check speaks next: the Signature came first.
    await addSignature(t.c1.members.engineer);
    expect(await sendUnchecked(t.c1.members.engineer, id)).toBe("form_not_checked");
    expect(await written(id)).toEqual(before);
  });
});

describe("scenario RP-85-2: C1's engineer adds a Signature, sends for review, replaces it; the PM Returns and the engineer sends again", () => {
  it("records on each Transition's event the Signature in force, keeps the first after the replacement, and shows each Member only their own", async () => {
    const { engineer, project_manager: pm } = t.c1.members;
    await withoutSignature(asOwner, engineer);
    const first = await addSignature(engineer);
    const pmSignature = await addSignature(pm);
    const id = await raise("Cable trays, signed", { model: "Tray 300" });
    expect(await t.take(engineer, id, "send_for_review")).toBe("applied");
    const second = await addSignature(engineer);
    expect(await t.pickUp(pm, id)).toBe("picked_up");
    expect(await t.take(pm, id, "return")).toBe("applied");
    expect(await t.take(engineer, id, "send_for_review")).toBe("applied");

    const { rows } = await migrator.query("select signature_id from work_item_event where work_item_id = $1 and type = 'transition' order by seq", [id]);
    expect(rows.map((r: { signature_id: string }) => r.signature_id)).toEqual([first, pmSignature, second]);
    const kept = await migrator.query("select active_to is not null as ended from member_signature where id = $1", [first]);
    expect(kept.rows).toEqual([{ ended: true }]);

    // Each reads only their own Signatures, the one they replaced included.
    for (const own of [first, second]) await expectHiddenFrom({ read: signaturesOf, target: own, seenBy: engineer, hiddenFrom: [pm, t.c2.members.engineer], name });
    await expectHiddenFrom({ read: signaturesOf, target: pmSignature, seenBy: pm, hiddenFrom: [engineer, t.c2.members.engineer], name });

    // No history read through the app role carries a signature_id.
    for (const member of [engineer, pm]) {
      await expect(t.call(member, sql<{ signature_id: string }>`select signature_id from work_item_event where work_item_id = ${id}::uuid`), name(member)).rejects.toThrow(/permission denied/);
    }
  });
});
