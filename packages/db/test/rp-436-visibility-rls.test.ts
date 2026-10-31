// Seam 2 for every Transition recorded for the Documental Record (RP-436; ADR 0017; visibility.md V7,
// V14, the Documental Record row; scenario RP-436-1), as the app role. C1's engineer sends a MAR-shaped
// item for review, C1's PM Returns it and later Submits it, K1's engineer sends it to K1's manager, who
// issues Code A. Each Transition's event holds who took it, their Participant, when and a hash of the
// item's content then, C1's and K1's alike; the app role reads none of the hashes (Side channels). The
// live history still names K1's people to C1 only for the Code's signer. On the test Send Back Workflow
// (addTestWorkflow). That an unconfirmed Transition is refused is the api's (it never reaches
// app.take_transition): seam 1, apps/api/test/transition-confirmed.test.ts.
import { randomInt } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withMember, type Db } from "../src/index.ts";
import { addTestWorkflow, bilingual, buildSeamTwoTower, digits, expectHiddenFrom, testDatabaseUrls, type SeamTwoTower } from "../test-support/index.ts";

const urls = testDatabaseUrls();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("");
const TYPE = `RT${letters(3)}`;

let migrator: pg.Client;
let app: Db;
const towerOptions = { projectCode: "RTC", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let id = "";
const names = new Map<string, string>();
const nameOf = (as: string) => names.get(as) ?? as;

/** One Transition's event, as the migrator reads the append-only trail. */
type TrailRow = { id: string; transition: string; type: string; actor_member_id: string; actor_participant_id: string; created_at: Date; content_sha256: Buffer | null };

/** The item's Transitions in the audit trail the Documental Record is made from, in order. */
const trail = async () =>
  (
    await migrator.query<TrailRow>(
      `select e.id, tr.key as transition, e.type, e.actor_member_id, e.actor_participant_id, e.created_at, e.content_sha256
       from work_item_event e join workflow_transition tr on tr.id = e.transition_id
       where e.work_item_id = $1 and e.type in ('transition', 'issue_code') order by e.seq`,
      [id],
    )
  ).rows;

/**
 * The ids of the item's events whose actor `as` is told by name in the live history (app.work_item_history).
 * The history gives a row no id (its seq counts only what the reader sees), so each row is matched to the
 * migrator's event of its type and time; the Tower's Members are named by Position, so a name proves nothing.
 */
async function namedEventsOf(as: string): Promise<{ id: string }[]> {
  const events = (await migrator.query("select id, type, created_at from work_item_event where work_item_id = $1", [id])).rows as { id: string; type: string; created_at: Date }[];
  const rows = await tower.call<{ type: string; created_at: Date; member_name: unknown }>(as, sql`select type, created_at, member_name from app.work_item_history(${id}::uuid)`);
  return rows
    .filter((r) => r.member_name !== null)
    .flatMap((r) => events.filter((e) => e.type === r.type && e.created_at.getTime() === r.created_at.getTime()).map((e) => ({ id: e.id })));
}

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), { name: bilingual(`RP-436 audit trail ${digits(6)}`) });
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Audit trail (RP-436)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Audit trail (RP-436)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1, c2 } = tower;
  for (const [as, name] of [
    [c1.members.engineer, "C1's engineer"],
    [c1.members.project_manager, "C1's PM"],
    [k1.members.engineer, "K1's engineer"],
    [k1.members.manager, "K1's manager"],
    [c2.members.engineer, "C2's engineer"],
  ] as const)
    names.set(as, name);

  const [created] = await tower.call<{ outcome: string; work_item_id: string }>(
    c1.members.engineer,
    sql`select outcome, work_item_id from app.create_work_item(
      ${tower.projectId}::uuid, ${TYPE}, 'Cable trays', app.latest_form_version(${TYPE}), ${JSON.stringify({ model: "CT-1" })}::jsonb,
      ${tower.tradeId}::uuid, ${tower.buildingA}::uuid, now())`,
  );
  expect(created!.outcome).toBe("created");
  id = created!.work_item_id;
  const { engineer, project_manager: pm } = c1.members;
  expect(await tower.take(engineer, id, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(pm, id)).toBe("picked_up");
  expect(await tower.take(pm, id, "return")).toBe("applied");
  expect(await tower.take(engineer, id, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(pm, id)).toBe("picked_up");
  expect(await tower.take(pm, id, "submit")).toBe("applied");
  expect(await tower.pickUp(k1.members.engineer, id)).toBe("picked_up");
  expect(await tower.take(k1.members.engineer, id, "send_to_manager")).toBe("applied");
  expect(await tower.pickUp(k1.members.manager, id)).toBe("picked_up");
  expect(await tower.take(k1.members.manager, id, "approve_a")).toBe("applied");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-436-1: a MAR sent, Returned, Submitted and Coded A by K1's manager", () => {
  it("records every Transition on the path with who took it, their Participant, when and a content hash, C1's and K1's alike (V7)", async () => {
    const { c1, k1 } = tower;
    const rows = await trail();
    expect(rows.map((r) => [r.transition, r.actor_member_id, r.actor_participant_id])).toEqual([
      ["send_for_review", c1.members.engineer, c1.participantId],
      ["return", c1.members.project_manager, c1.participantId],
      ["send_for_review", c1.members.engineer, c1.participantId],
      ["submit", c1.members.project_manager, c1.participantId],
      ["send_to_manager", k1.members.engineer, k1.participantId],
      ["approve_a", k1.members.manager, k1.participantId],
    ]);
    expect(rows.at(-1)!.type).toBe("issue_code");
    for (const row of rows) {
      expect(row.created_at, row.transition).toBeInstanceOf(Date);
      expect(Buffer.isBuffer(row.content_sha256) ? row.content_sha256.length : null, row.transition).toBe(32);
    }
    // The Code sets the outcome, which the hash covers: it differs from the Submit's on the same answers.
    expect(rows.at(-1)!.content_sha256!.equals(rows[3]!.content_sha256!)).toBe(false);
  });

  it("gives the app role none of the trail's hashes, whoever reads it (Side channels)", async () => {
    const { c1, k1 } = tower;
    for (const as of [c1.members.project_manager, k1.members.manager]) {
      for (const column of ["content_sha256", "hash", "prev_hash"]) {
        await expect(
          withMember(app, as, (trx) => sql`select ${sql.ref(column)} from work_item_event where work_item_id = ${id}::uuid`.execute(trx)),
          `${nameOf(as)}: ${column}`,
        ).rejects.toThrow(/permission denied/);
      }
    }
  });

  it("names K1's people to C1's PM in the live history only for the Code's signer (V14)", async () => {
    const { c1, k1, c2 } = tower;
    const rows = await trail();
    const code = rows.find((r) => r.transition === "approve_a")!;
    const toManager = rows.find((r) => r.transition === "send_to_manager")!;
    // The Code's signer is named to C1 and to K1 (and C2 reads nothing of the item).
    await expectHiddenFrom({ read: namedEventsOf, target: code.id, seenBy: [c1.members.project_manager, c1.members.engineer, k1.members.manager], hiddenFrom: c2.members.engineer, name: nameOf, label: "the Code's signer" });
    // K1's engineer, who sent it to K1's manager, is named to K1 only.
    await expectHiddenFrom({ read: namedEventsOf, target: toManager.id, seenBy: k1.members.manager, hiddenFrom: [c1.members.project_manager, c1.members.engineer, c2.members.engineer], name: nameOf, label: "K1's engineer" });
    // And whatever K1 event C1's PM reads, it names nobody but on the Code, by the signer's own name.
    const signer = (await migrator.query("select full_name from member where id = $1", [k1.members.manager])).rows[0].full_name;
    const history = await tower.call<{ type: string; company_name: { en: string } | null; member_name: unknown }>(
      c1.members.project_manager,
      sql`select h.type, h.company_name, h.member_name from app.work_item_history(${id}::uuid) h`,
    );
    const k1Name = (await migrator.query("select legal_name from company where id = $1", [k1.id])).rows[0].legal_name;
    const fromK1 = history.filter((r) => JSON.stringify(r.company_name) === JSON.stringify(k1Name));
    expect(fromK1.map((r) => [r.type, r.member_name])).toEqual([["issue_code", signer]]);
  });
});
