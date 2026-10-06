// Seam 1 for dragging on the Kanban (RP-350, spec RP-344; visibility.md "Refusals
// of a Transition", V14). The board says, per card, which Transitions the viewer
// may take on it now, each with the Stage it leads to and its Action Form. They
// are exactly the buttons the item's page shows: a card the viewer may not act
// on has none, and nothing says why a Transition is missing. A Stage reached by
// two of them is no drop target (the web decides that from these moves).
//
// The seeded MAR has one Transition to each Stage, so this file adds a test-only
// Work Item Type whose Consultant Step has two Transitions into Approved.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { dropTargets, workItemSearchParams, type WorkItemBoard, type WorkItemDetail } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, memberOnProject, ok, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const TYPE = "MARTWO";

/** The test-only Type: the MAR's Steps, but its Consultant Step has two Approvals (A and B) into Approved. */
async function addTwoApprovalsType() {
  await sql`
    do $$
      declare
        v_definition uuid;
        v_version uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then return; end if;
        insert into workflow_definition (owner_kind, name)
        values ('rabaed', '{"en": "Two approvals (test)", "ar": "اعتمادان (اختبار)"}')
        returning id into v_definition;
        insert into workflow_version (workflow_definition_id, version_no, status, published_at)
        values (v_definition, 1, 'published', now())
        returning id into v_version;

        insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode) values
          (v_version, 'draft', '{"en": "Draft", "ar": "مسودة"}', 'draft', '{"base_role": "contractor", "permission": "create"}', 'none'),
          (v_version, 'internal_review', '{"en": "Contractor review", "ar": "مراجعة المقاول"}', 'internal_review',
            '{"base_role": "contractor", "permission": "review"}', 'none'),
          (v_version, 'consultant_review', '{"en": "Consultant review", "ar": "مراجعة الاستشاري"}', 'pending_approval',
            '{"base_role": "consultant", "permission": "approve"}', 'issue_code'),
          (v_version, 'approved', '{"en": "Approved", "ar": "معتمد"}', 'approved', '{}', 'none'),
          (v_version, 'revise_resubmit', '{"en": "Revise & Resubmit", "ar": "مراجعة وإعادة تقديم"}', 'revise_resubmit', '{}', 'none');

        insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort)
        select v_version, t.key, f.id, s.id, t.label::jsonb, t.kind, t.outcome, t.permission, t.sort
        from (values
          ('send_for_review', 'draft', 'internal_review', '{"en": "Send for Review", "ar": "إرسال للمراجعة"}', 'send', null, 'create', 1),
          ('submit', 'internal_review', 'consultant_review', '{"en": "Submit", "ar": "تقديم"}', 'submit', null, 'submit', 2),
          ('approve_a', 'consultant_review', 'approved', '{"en": "Approve · A", "ar": "اعتماد · A"}', 'close', 'A', 'approve', 3),
          ('approve_b', 'consultant_review', 'approved', '{"en": "Approve · B", "ar": "اعتماد · B"}', 'close', 'B', 'approve', 4),
          ('revise_c', 'consultant_review', 'revise_resubmit', '{"en": "Revise & Resubmit · C", "ar": "مراجعة وإعادة تقديم · C"}',
            'close', 'C', 'approve', 5)
        ) as t (key, from_key, to_key, label, kind, outcome, permission, sort)
        join workflow_step f on f.workflow_version_id = v_version and f.key = t.from_key
        join workflow_step s on s.workflow_version_id = v_version and s.key = t.to_key;

        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', ${sql.lit(TYPE)}, '{"en": "Two approvals", "ar": "اعتمادان"}',
          v_definition, 'review_code', (select form_definition_id from work_item_type where code = 'MAR'));
      end
    $$
  `.execute(migrator);
}

let c1: Company;
let c1Engineer: Caller; // Raises; holds its Drafts.
let c1Pm: Caller;
let c2Engineer: Caller; // A second Contractor (V3).
let k1ManagerA: Caller; // In the review Step's pool; claims.
let k1ManagerB: Caller; // In the same pool; does not.
let projectId = "";
let trade = "";
let location = "";

const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};

const take = (by: Caller, id: string, transition: string, answers: Record<string, unknown> = {}) =>
  ok(by.post(`/v1/work-items/${id}/transitions`, { transition, answers, idempotencyKey: randomUUID() }));

async function board(by: Caller): Promise<WorkItemBoard> {
  return (await ok(by.get(`/v1/projects/${projectId}/work-items/kanban?${workItemSearchParams({})}`), 200)).json();
}

/** The buttons the item's page shows `by`: what the board's moves must equal. */
async function pageTransitions(by: Caller, id: string): Promise<string[]> {
  const detail: WorkItemDetail = (await ok(by.get(`/v1/work-items/${id}`), 200)).json();
  return detail.actions.transitions.map((t) => t.key);
}

async function draft(type: string, title: string): Promise<string> {
  const res = await ok(c1Engineer.post(`/v1/projects/${projectId}/work-items`, { type, title, answers: { ...complete, trade, location } }), 201);
  const id = res.json().id as string;
  await attachDatasheet(c1Engineer, id);
  return id;
}

/** Submitted to K1 and claimed by manager A: waiting for A's decision. */
async function atK1(type: string, title: string): Promise<string> {
  const id = await draft(type, title);
  await take(c1Engineer, id, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${id}/claim`));
  await take(c1Pm, id, "submit");
  await ok(k1ManagerA.post(`/v1/work-items/${id}/claim`));
  return id;
}

let marAtK1 = "";
let twoApprovalsAtK1 = "";
let pooled = ""; // Submitted, nobody has claimed it yet.
let aDraft = "";

beforeAll(async () => {
  await addTwoApprovalsType();
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id;
  trade = await post("trades", { code: "EL", name: bilingual("Electrical") });
  location = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const participant = async (role: "contractor" | "consultant") => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return { company, participantId };
  };
  c1Engineer = (await memberOnProject(api, c1, own, ["engineer"])).caller;
  c1Pm = (await memberOnProject(api, c1, own, ["project_manager"])).caller;
  const c2 = await participant("contractor");
  c2Engineer = (await memberOnProject(api, c2.company, c2.participantId, ["engineer"])).caller;
  const k1 = await participant("consultant");
  k1ManagerA = (await memberOnProject(api, k1.company, k1.participantId, ["manager"])).caller;
  k1ManagerB = (await memberOnProject(api, k1.company, k1.participantId, ["manager"])).caller;

  aDraft = await draft("MAR", "Fire alarm cables");
  marAtK1 = await atK1("MAR", "Cable trays");
  twoApprovalsAtK1 = await atK1(TYPE, "Busbars");
  pooled = await draft("MAR", "Chillers");
  await take(c1Engineer, pooled, "send_for_review");
  await ok(c1Pm.post(`/v1/work-items/${pooled}/claim`));
  await take(c1Pm, pooled, "submit");
});

describe("a card's moves", () => {
  it("lists the Transitions the holder may take, each with the Stage it leads to and its Action Form", async () => {
    const b = await board(k1ManagerA);
    const moves = b.moves[marAtK1]!;
    expect(moves.map((m) => [m.transition, m.stageKey])).toEqual([
      ["approve_a", "approved"],
      ["revise_c", "revise_resubmit"],
    ]);
    expect(moves.find((m) => m.transition === "revise_c")?.actionForm?.sections.length).toBeGreaterThan(0);
    // Every Stage a move names is a column of the board.
    for (const m of moves) expect(b.stages.map((s) => s.key)).toContain(m.stageKey);
    expect([...dropTargets(moves, "pending_approval").keys()].sort()).toEqual(["approved", "revise_resubmit"]);
  });

  it("makes a Stage two Transitions lead to no drop target", async () => {
    const moves = (await board(k1ManagerA)).moves[twoApprovalsAtK1]!;
    expect(moves.map((m) => m.transition)).toEqual(["approve_a", "approve_b", "revise_c"]);
    expect([...dropTargets(moves, "pending_approval").keys()]).toEqual(["revise_resubmit"]);
  });

  it("gives the raiser's own Draft its one move", async () => {
    const moves = (await board(c1Engineer)).moves[aDraft]!;
    expect(moves.map((m) => [m.transition, m.stageKey])).toEqual([["send_for_review", "internal_review"]]);
  });
});

describe("a Member who may not act on a card", () => {
  it("has no moves for it: not the pool's other Members, not another Company, not the raiser", async () => {
    expect((await board(k1ManagerB)).moves[marAtK1]).toBeUndefined();
    expect((await board(k1ManagerB)).moves[pooled]).toBeUndefined();
    expect((await board(c1Engineer)).moves[marAtK1]).toBeUndefined();
    expect((await board(c1Pm)).moves[marAtK1]).toBeUndefined();
    expect((await board(c2Engineer)).moves).toEqual({});
  });

  it("says nothing of a Transition they could not take: the moves are exactly the item page's buttons", async () => {
    for (const by of [c1Engineer, c1Pm, c2Engineer, k1ManagerA, k1ManagerB]) {
      const b = await board(by);
      const cards = b.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards));
      for (const card of cards) {
        const onPage = await pageTransitions(by, card.id);
        expect((b.moves[card.id] ?? []).map((m) => m.transition), card.title).toEqual(onPage);
      }
      // Moves are only for cards on the board, and only where there is something to take.
      expect(Object.keys(b.moves).every((id) => cards.some((c) => c.id === id) && b.moves[id]!.length > 0)).toBe(true);
    }
  });

  it("does not leak another Company's Transitions or Steps into C1's board", async () => {
    const json = JSON.stringify(await board(c1Engineer));
    for (const secret of ["approve_a", "revise_c", "consultant_review"]) expect(json).not.toContain(secret);
  });
});

describe("under a search", () => {
  it("has moves only for the cards the search shows", async () => {
    const res = await ok(k1ManagerA.get(`/v1/projects/${projectId}/work-items/kanban?${workItemSearchParams({ q: "Busbars" })}`), 200);
    const b: WorkItemBoard = res.json();
    const ids = b.columns.flatMap((c) => c.lanes.flatMap((l) => l.cards.map((card) => card.id)));
    expect(ids).toEqual([twoApprovalsAtK1]);
    expect(Object.keys(b.moves)).toEqual([twoApprovalsAtK1]);
  });
});

describe("dropping", () => {
  it("takes the Transition, and the card is in its new Stage on the next read", async () => {
    const before = await board(k1ManagerA);
    const move = dropTargets(before.moves[marAtK1]!, "pending_approval").get("revise_resubmit")!;
    // The Consultant's verification is part of the Form, filled before a Code.
    const answers = (await ok(k1ManagerA.get(`/v1/work-items/${marAtK1}`), 200)).json().answers;
    await ok(
      k1ManagerA.request("PUT", `/v1/work-items/${marAtK1}/answers`, {
        answers: { ...answers, sample_checked: true, matches_specification: false, verification_note: "Below the specified efficacy" },
      }),
    );
    await take(k1ManagerA, marAtK1, move.transition,{ remarks: "Resubmit with 110 lm/W luminaires" });
    const after = await board(k1ManagerA);
    const column = after.columns.find((c) => c.stageKey === "revise_resubmit")!;
    expect(column.lanes.flatMap((l) => l.cards).map((c) => c.id)).toContain(marAtK1);
    expect(after.moves[marAtK1]).toBeUndefined();
  });
});
