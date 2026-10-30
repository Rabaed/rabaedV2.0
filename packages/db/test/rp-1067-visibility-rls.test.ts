// Seam 2 for what the Submittal Panel's approval log and Internal Communication (RP-1067) read, as the
// app role: app.work_item_history, app.work_item_creation_date and app.work_item_raised_item_counts
// (visibility.md V5, V14; scenarios RP-1067-1 to RP-1067-3). C1 reads its own people by name, K1 by
// its Company name only but for the final Code's signer, and none of K1's internal events (its
// pick-ups, its moves to its Manager, its Recommended Codes, its Internal Note); K1 reads none of
// C1's. The Creation Date is the raiser's Participant's only. On the test Send Back Workflow
// (addTestWorkflow), its Return and Send Back given a reason and its Submit a Cover Note, as the MAR's.
// Seam 1: apps/api/test/rp-1067-visibility.test.ts.
import { randomInt, randomUUID } from "node:crypto";
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
const towerOptions = { projectCode: "RLS", k1Manager: true } as const;
let tower: SeamTwoTower<typeof towerOptions>;
let id = "";
const names = new Map<string, string>();
const named = (as: string) => names.get(as) ?? as;

type Row = {
  type: string;
  created_at: Date;
  audience: string;
  company_name: { en: string } | null;
  member_name: { en: string } | null;
  transition_label: { en: string } | null;
  from_step_name: { en: string } | null;
  to_step_name: { en: string } | null;
  reason: string | null;
  remarks: string | null;
  internal_note: string | null;
  recommended_code: string | null;
  outcome: string | null;
  answers: Record<string, unknown> | null;
};

/** Item `id`'s history as Member `as` reads it. */
const historyOf = (as: string) =>
  tower.call<Row>(
    as,
    sql`select type, created_at, audience, company_name, member_name, transition_label, from_step_name, to_step_name, reason, remarks,
        internal_note, recommended_code, outcome, answers
      from app.work_item_history(${id}::uuid)`,
  );
/** An event is known by its time, type and audience: `seq` counts only what the reader sees. */
const eventAt = (event: { created_at: Date; type: string; audience: string }) => `${event.created_at.toISOString()} ${event.type} ${event.audience}`;
/** The item's events by Participant `participantId`, as the migrator reads them. */
const eventsOf = async (participantId: string) =>
  (
    await migrator.query<{ created_at: Date; type: string; audience: string }>(
      "select created_at, type, audience from work_item_event where work_item_id = $1 and actor_participant_id = $2 order by seq",
      [id, participantId],
    )
  ).rows;

/** `as` takes `transition` with `answers`, an Internal Note and a Recommended Code; returns the outcome. */
const take = (as: string, transition: string, { answers = {}, note = "", code = null }: { answers?: object; note?: string; code?: string | null } = {}) =>
  tower.outcome(
    as,
    sql`select app.take_transition(${id}::uuid, ${transition}, ${JSON.stringify(answers)}::jsonb, ${note}, app.answers_sha256(${id}::uuid), ${randomUUID()}::uuid, now(),
      null::uuid, ${code}::text) as outcome`,
  );

/** A form of one optional textarea, `key`, for a Transition's pop-up. */
const textForm = (key: string, label: string) => ({ sections: [{ key, title: bilingual(label), fields: [{ key, type: "textarea", label: bilingual(label) }] }] });

beforeAll(async () => {
  migrator = new pg.Client({ connectionString: urls.migrator });
  await migrator.connect();
  app = createDb(urls.app, { max: 2 });
  const workflowId = await addTestWorkflow((text) => migrator.query(text), {
    name: bilingual(`RP-1067 approval log ${digits(6)}`),
    withApproveB: true,
    recommendCode: true,
    publish: false,
  });
  for (const [key, form] of [
    ["return", textForm("reason", "Reason")],
    ["send_back", textForm("reason", "Reason")],
    ["submit", textForm("cover_note", "Cover Note")],
  ] as const) {
    await migrator.query(
      `update workflow_transition tr set action_form = $1::jsonb from workflow_version v
       where v.id = tr.workflow_version_id and v.workflow_definition_id = $2 and tr.key = $3`,
      [JSON.stringify(form), workflowId, key],
    );
  }
  await migrator.query("update workflow_version set status = 'published', published_at = now() where workflow_definition_id = $1", [workflowId]);
  const formId = (await migrator.query("insert into form_definition (owner_kind, name) values ('rabaed', $1) returning id", [JSON.stringify(bilingual("Approval log (RP-1067)"))])).rows[0]
    .id as string;
  await migrator.query("insert into form_version (form_definition_id, version_no, status, published_at, schema) values ($1, 1, 'published', now(), $2::jsonb)", [
    formId,
    JSON.stringify({ sections: [{ key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] }] }),
  ]);
  await migrator.query(
    `insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
     values ('rabaed', 'submittals', $1, $2, $3, 'review_code', $4)`,
    [TYPE, JSON.stringify(bilingual("Approval log (RP-1067)")), workflowId, formId],
  );
  tower = await buildSeamTwoTower(app, migrator, towerOptions);
  const { c1, k1 } = tower;
  for (const [as, name] of [
    [c1.members.engineer, "C1 engineer"],
    [c1.members.project_manager, "C1 PM"],
    [k1.members.engineer, "K1 engineer"],
    [k1.members.manager, "K1 manager"],
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
  const { engineer: k1Engineer, manager } = k1.members;
  // C1: sent for review, Returned once with a reason, sent again, Submitted with a Cover Note and an Internal Note.
  expect(await take(engineer, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(pm, id)).toBe("picked_up");
  expect(await take(pm, "return", { answers: { reason: "Attach the datasheet" } })).toBe("applied");
  expect(await take(engineer, "send_for_review")).toBe("applied");
  expect(await tower.pickUp(pm, id)).toBe("picked_up");
  expect(await take(pm, "submit", { answers: { cover_note: "Trays for Level 2" }, note: "C1: quantities checked" })).toBe("applied");
  // K1: its engineer recommends Code B with an Internal Note; its manager Returns it; it is Sent Back to C1 with a reason.
  expect(await tower.pickUp(k1Engineer, id)).toBe("picked_up");
  expect(await take(k1Engineer, "send_to_manager", { note: "K1: compared with the sample", code: "B" })).toBe("applied");
  expect(await tower.pickUp(manager, id)).toBe("picked_up");
  expect(await take(manager, "return_to_engineer")).toBe("applied");
  expect(await take(k1Engineer, "send_back", { answers: { reason: "Wrong tray finish" } })).toBe("applied");
  // C1 Submits again; K1's engineer recommends B again and its manager issues Code B with Remarks, raising 3 Comments.
  expect(await tower.pickUp(pm, id)).toBe("picked_up");
  expect(await take(pm, "submit")).toBe("applied");
  expect(await tower.pickUp(k1Engineer, id)).toBe("picked_up");
  expect(await take(k1Engineer, "send_to_manager", { code: "B" })).toBe("applied");
  expect(await tower.pickUp(manager, id)).toBe("picked_up");
  const comments = [{ comment: "Seal the entries" }, { comment: "Earth the trays" }, { comment: "Label the runs" }];
  expect(await take(manager, "approve_b", { answers: { remarks: "Approved with comments", items_to_create: comments } })).toBe("applied");
});

afterAll(async () => {
  await app?.destroy();
  await migrator?.end();
});

describe("scenario RP-1067-1: C1's PM reads the approval log", () => {
  it("names C1's own people, and K1 by its Company name only but for the final Code's signer, with no Step", async () => {
    const rows = await historyOf(tower.c1.members.project_manager);
    const own = rows.filter((r) => r.company_name?.en === "C1");
    expect(own.length).toBeGreaterThan(0);
    expect(own.filter((r) => r.member_name === null)).toEqual([]); // not hidden-from: none of C1's own events is unnamed
    const k1 = rows.filter((r) => r.company_name?.en === "K1"); // not hidden-from: picks K1's events to compare whole
    expect(k1.map((r) => [r.type, r.audience, r.member_name, r.from_step_name, r.to_step_name, r.reason, r.remarks, r.internal_note, r.recommended_code, r.outcome])).toEqual([
      ["transition", "shared", null, null, null, "Wrong tray finish", null, null, null, null],
      ["issue_code", "shared", bilingual("manager"), null, null, null, "Approved with comments", null, null, "B"],
    ]);
  });

  it("reads as text boxes the Cover Note and the Remarks only; the Send Back's reason rides on K1's block (above)", async () => {
    const shared = (await historyOf(tower.c1.members.project_manager)).filter((r) => r.audience === "shared");
    const texts = shared.flatMap((r) => [r.answers?.cover_note, r.remarks, r.internal_note].filter((t) => typeof t === "string"));
    expect(texts).toEqual(["Trays for Level 2", "Approved with comments"]);
  });

  it("gives K1's internal events to K1 only", async () => {
    const { c1, k1 } = tower;
    const internal = (await eventsOf(k1.participantId)).filter((e) => e.audience === "internal");
    expect(internal.map((e) => e.type)).toEqual(expect.arrayContaining(["picked_up", "transition", "recommend_code", "internal_note"]));
    for (const event of internal) {
      await expectHiddenFrom({
        read: historyOf,
        target: eventAt(event),
        seenBy: [k1.members.manager, k1.members.engineer],
        hiddenFrom: [c1.members.project_manager, c1.members.engineer],
        idOf: eventAt,
        name: named,
        label: `K1's ${event.type}`,
      });
    }
  });

  it("counts on Code B's chip the 3 Comments C1 sees", async () => {
    const counts = await tower.call<{ type_code: string; open_count: number; closed_count: number }>(
      tower.c1.members.project_manager,
      sql`select type_code, open_count::integer, closed_count::integer from app.work_item_raised_item_counts(${id}::uuid)`,
    );
    expect(counts.map((c) => [c.type_code, c.open_count + c.closed_count])).toEqual([["CMT", 3]]);
  });
});

describe("scenario RP-1067-2: the log's start", () => {
  it("gives C1 the Creation Date and K1 none, so K1's log starts at C1's Submit", async () => {
    const { c1, k1 } = tower;
    const created = async (as: string) =>
      (await tower.call<{ at: Date | null }>(as, sql`select app.work_item_creation_date(${id}::uuid) as at`)).flatMap((r) => (r.at ? [{ id }] : []));
    await expectHiddenFrom({
      read: created,
      target: id,
      seenBy: [c1.members.project_manager, c1.members.engineer],
      hiddenFrom: [k1.members.manager, k1.members.engineer],
      name: named,
      label: "the Creation Date",
    });
    const first = (await historyOf(k1.members.manager))[0]!;
    expect([first.type, first.transition_label?.en, first.member_name]).toEqual(["transition", "Submit", null]);
  });
});

describe("scenario RP-1067-3: each Company's Internal Communication", () => {
  it("gives C1's Return with its reason and C1's Internal Note to C1 only", async () => {
    const { c1, k1 } = tower;
    // The `created` event is in nobody's history: C1 reads the Creation Date (RP-1067-2).
    const internal = (await eventsOf(c1.participantId)).filter((e) => e.audience === "internal" && e.type !== "created");
    expect(internal.map((e) => e.type)).toEqual(expect.arrayContaining(["internal_note"]));
    for (const event of internal) {
      await expectHiddenFrom({
        read: historyOf,
        target: eventAt(event),
        seenBy: [c1.members.project_manager, c1.members.engineer],
        hiddenFrom: [k1.members.manager, k1.members.engineer],
        idOf: eventAt,
        name: named,
        label: `C1's ${event.type}`,
      });
    }
    const rows = await historyOf(c1.members.project_manager);
    expect(rows.find((r) => r.reason === "Attach the datasheet")).toMatchObject({ type: "transition", audience: "internal" });
    expect(rows.find((r) => r.type === "internal_note")).toMatchObject({ internal_note: "C1: quantities checked" });
  });

  it("gives K1 its own Internal Note and Recommended Codes, and of C1's only its two Submits", async () => {
    const rows = await historyOf(tower.k1.members.manager);
    expect(rows.find((r) => r.type === "internal_note")).toMatchObject({ internal_note: "K1: compared with the sample", audience: "internal" });
    expect(rows.filter((r) => r.type === "recommend_code").map((r) => r.recommended_code)).toEqual(["B", "B"]);
    expect(rows.filter((r) => r.company_name?.en === "C1").map((r) => [r.type, r.audience, r.transition_label?.en])).toEqual([ // not hidden-from: C1's events K1 reads, compared whole
      ["transition", "shared", "Submit"],
      ["transition", "shared", "Submit"],
    ]);
  });
});
