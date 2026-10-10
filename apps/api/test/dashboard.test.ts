// Seam 1 for the Dashboard's Type cards (RP-351, spec RP-344; visibility.md
// "Dashboard and Location Status", V1, V3, scenarios 63 and 65). Cards per
// Module and Type count Revision chains by the latest Revision the viewer sees:
// Pending is Submitted and open, In preparation only for the raiser's own
// Participant, then the latest closed Revision's outcome. Every number opens the
// List of exactly the chains it counts: both come from the work item query.
// The Code C line (RP-352, scenario 64) counts each chain that has had a Code C
// once, by the latest Revision the viewer sees.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { moduleKeys, workItemSearchParams, type Dashboard, type DashboardCard, type DashboardFigure, type WorkItemList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, draft, inInternalReview, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company;
let k1: Company;
let c2: Company;
let outsider: Caller;

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

/** A second Contractor on `at`'s Project, with an engineer and a PM. */
async function secondContractor(at: Tower) {
  const participantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
  return {
    engineer: await projectMember(api, c2, participantId, ["engineer"]),
    pm: await projectMember(api, c2, participantId, ["project_manager"]),
  };
}

async function dashboard(by: Caller, projectId: string): Promise<Dashboard> {
  return (await ok(by.get(`/v1/projects/${projectId}/dashboard`), 200)).json();
}

/** The card of Type `code`, from wherever its Module puts it. */
function card(d: Dashboard, code: string): DashboardCard {
  const found = d.modules.flatMap((m) => m.cards).find((c) => c.type.code === code);
  if (!found) throw new Error(`no ${code} card`);
  return found;
}

function marCard(d: Dashboard) {
  const c = card(d, "MAR");
  if (c.kind !== "outcomes") throw new Error("expected an outcomes card");
  return c;
}

const bar = (d: Dashboard, bucket: string) => marCard(d).bars.find((b) => b.bucket === bucket)!.count;

/** Every number on the Dashboard, named. */
function figures(d: Dashboard): [string, DashboardFigure][] {
  return d.modules.flatMap((m) =>
    m.cards.flatMap((c): [string, DashboardFigure][] => {
      const named = (name: string, f: DashboardFigure | null): [string, DashboardFigure][] => (f ? [[`${c.type.code} ${name}`, f]] : []);
      return c.kind === "outcomes"
        ? [
            ...named("total", c.total),
            ...c.bars.flatMap((b) => named(b.bucket, b)),
            ...named("in preparation", c.inPreparation),
            ...named("approved", c.approved),
            ...(c.codeC
              ? [
                  ...named("Code C", c.codeC.total),
                  ...named("approved on revision", c.codeC.approvedOnRevision),
                  ...named("awaiting revision", c.codeC.awaitingRevision),
                  ...named("no Revision yet", c.codeC.split?.noRevisionYet ?? null),
                  ...named("Revision in progress", c.codeC.split?.revisionInProgress ?? null),
                  ...named("rejected after C", c.codeC.rejectedAfterC),
                ]
              : []),
          ]
        : [...named("total", c.total), ...named("open", c.open), ...named("closed", c.closed)];
    }),
  );
}

/** Every chain the List shows `by` for a Dashboard number's filter, all pages. */
async function listed(by: Caller, projectId: string, query: DashboardFigure["query"]): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page: WorkItemList = (await ok(by.get(`/v1/projects/${projectId}/work-items?${workItemSearchParams({ ...query, ...(cursor ? { cursor } : {}) })}`), 200)).json();
    expect(page.stages.reduce((sum, s) => sum + s.count, 0)).toBeGreaterThanOrEqual(page.items.length);
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return ids;
}

/** C1 raises a Revision of `id` (after its Code C), Submits it, and returns it. */
async function submittedRevision(at: Tower, id: string): Promise<string> {
  const revision = (await ok(at.c1Engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
  await take(at.c1Engineer, revision, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${revision}/pick-up`));
  await take(at.c1Pm, revision, "submit");
  return revision;
}

/** K1 verifies item `id` and issues a Review Code. */
async function code(by: Caller, id: string, transition: "approve_a" | "revise_c") {
  const answers = (await ok(by.get(`/v1/work-items/${id}`), 200)).json().answers as Record<string, unknown>;
  const pass = transition === "approve_a";
  await ok(
    by.request("PUT", `/v1/work-items/${id}/answers`, {
      answers: { ...answers, sample_checked: true, matches_specification: pass, ...(pass ? {} : { verification_note: "Below the specified efficacy" }) },
    }),
  );
  await ok(by.post(`/v1/work-items/${id}/pick-up`));
  await ok(
    by.post(`/v1/work-items/${id}/transitions`, {
      transition,
      answers: pass ? {} : { remarks: "Resubmit with 110 lm/W luminaires" },
      confirmed: true,
      idempotencyKey: randomUUID(),
    }),
  );
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await onboard("Design Consultants LLC");
  c2 = await onboard("Second Contractor Co");
  outsider = (await api.authorizedPerson()).caller;
});

describe("scenario 63: Pending and In preparation", () => {
  let tower: Tower;
  beforeAll(async () => {
    tower = await buildTower(api, { c1, k1 }, "TWR");
    const { c1Engineer, c1Pm } = tower;
    await draft(tower, c1Engineer, "Fixtures, draft 1");
    await draft(tower, c1Engineer, "Fixtures, draft 2");
    await inInternalReview(tower, c1Engineer, "Fixtures, in internal review");
    for (let i = 1; i <= 4; i++) await submitted(tower, c1Engineer, c1Pm, `Fixtures, submitted ${i}`);
  });

  it("shows C1 Pending 4 and In preparation 3", async () => {
    const d = await dashboard(tower.c1Pm, tower.projectId);
    expect(bar(d, "pending")).toBe(4);
    expect(marCard(d).inPreparation?.count).toBe(3);
    expect(marCard(d).total.count).toBe(7);
  });

  it("shows K1 Pending 4 for C1's MARs, and no In preparation figure", async () => {
    const d = await dashboard(tower.k1Manager, tower.projectId);
    expect(bar(d, "pending")).toBe(4);
    expect(marCard(d).inPreparation).toBeNull();
    expect(marCard(d).total.count).toBe(4);
  });

  it("groups cards under their Module, with no time axis", async () => {
    const d = await dashboard(tower.c1Pm, tower.projectId);
    // In the Dashboard's order; other test files add test-only Types (e.g. the Snag List one below).
    const keys = d.modules.map((m) => m.key);
    expect(keys).toContain("submittals");
    expect(keys).toEqual(moduleKeys.filter((k) => keys.includes(k)));
    expect(marCard(d).bars.map((b) => b.bucket)).toEqual(["pending", "C", "A", "B", "D"]);
    expect(JSON.stringify(d)).not.toMatch(/time|date|due/i);
  });
});

describe("a chain with Code C and an approved Rev 1", () => {
  let tower: Tower;
  beforeAll(async () => {
    tower = await buildTower(api, { c1, k1 }, "CCH");
    const { c1Engineer, c1Pm, k1Manager } = tower;
    const original = await submitted(tower, c1Engineer, c1Pm, "Luminaires");
    await code(k1Manager, original, "revise_c");
    const revision = (await ok(c1Engineer.post(`/v1/work-items/${original}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
    await take(c1Engineer, revision, "send_for_review");
    await ok(c1Pm.post(`/v1/work-items/${revision}/pick-up`));
    await take(c1Pm, revision, "submit");
    await code(k1Manager, revision, "approve_a");
  });

  it("counts it once, as Approved (A), for both Companies", async () => {
    for (const by of [tower.c1Pm, tower.k1Manager]) {
      const d = await dashboard(by, tower.projectId);
      expect(marCard(d).total.count).toBe(1);
      expect(bar(d, "A")).toBe(1);
      expect(bar(d, "C")).toBe(0);
      expect(marCard(d).approved).toMatchObject({ count: 1, percent: 100 });
    }
  });
});

describe("scenario 65 and every number equals its List", () => {
  let tower: Tower;
  let c2Engineer: Caller;
  let c2Item = "";
  beforeAll(async () => {
    tower = await buildTower(api, { c1, k1 }, "EVR");
    const { c1Engineer, c1Pm, k1Manager } = tower;
    ({ engineer: c2Engineer } = await secondContractor(tower));
    await draft(tower, c1Engineer, "Pumps, draft");
    await inInternalReview(tower, c1Engineer, "Pumps, in internal review");
    await submitted(tower, c1Engineer, c1Pm, "Pumps, submitted");
    await code(k1Manager, await submitted(tower, c1Engineer, c1Pm, "Pumps, approved"), "approve_a");
    await code(k1Manager, await submitted(tower, c1Engineer, c1Pm, "Pumps, revise"), "revise_c");
    // A Revision still in C1's Draft: K1 counts the Code C original, C1 the Draft.
    const coded = await submitted(tower, c1Engineer, c1Pm, "Pumps, coded then revised");
    await code(k1Manager, coded, "revise_c");
    await ok(c1Engineer.post(`/v1/work-items/${coded}/revisions`, { idempotencyKey: randomUUID() }), 201);
    c2Item = await draft(tower, c2Engineer, "C2 chillers");
  });

  it("shows C2 nothing of C1's in any bar or total (V3)", async () => {
    const d = await dashboard(c2Engineer, tower.projectId);
    const mar = marCard(d);
    expect(mar.total.count).toBe(1);
    expect(mar.inPreparation?.count).toBe(1);
    expect(mar.bars.every((b) => b.count === 0)).toBe(true);
    expect(mar.approved.count).toBe(0);
    expect(mar.codeC).toBeNull();
    expect(await listed(c2Engineer, tower.projectId, mar.total.query)).toEqual([c2Item]);
  });

  it("shows K1 the Code C original while C1's Revision is a Draft (V1)", async () => {
    const k1View = await dashboard(tower.k1Manager, tower.projectId);
    expect(bar(k1View, "C")).toBe(2);
    expect(bar(k1View, "pending")).toBe(1);
    expect(marCard(k1View).inPreparation).toBeNull();
    const c1View = await dashboard(tower.c1Pm, tower.projectId);
    expect(bar(c1View, "C")).toBe(1);
    expect(marCard(c1View).inPreparation?.count).toBe(3);
  });

  it("opens, from every number, the List of exactly that many chains", async () => {
    for (const by of [tower.c1Pm, tower.c1Engineer, tower.k1Manager, c2Engineer]) {
      const d = await dashboard(by, tower.projectId);
      for (const [name, f] of figures(d)) {
        const ids = await listed(by, tower.projectId, f.query);
        expect(ids.length, name).toBe(f.count);
        expect(new Set(ids).size, name).toBe(ids.length);
      }
    }
  });
});

describe("scenario 64: the Code C line while C1's Revision is a Draft", () => {
  let tower: Tower;
  let unrevised = "";
  let original = "";
  let revision = "";
  beforeAll(async () => {
    tower = await buildTower(api, { c1, k1 }, "S64");
    const { c1Engineer, c1Pm, k1Manager } = tower;
    unrevised = await submitted(tower, c1Engineer, c1Pm, "Luminaires, not revised yet");
    await code(k1Manager, unrevised, "revise_c");
    original = await submitted(tower, c1Engineer, c1Pm, "Luminaires, revised");
    await code(k1Manager, original, "revise_c");
    revision = (await ok(c1Engineer.post(`/v1/work-items/${original}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
  });

  it("shows K1 both chains as awaiting revision, one figure, without the Draft (V1)", async () => {
    const line = marCard(await dashboard(tower.k1Manager, tower.projectId)).codeC!;
    expect(line.total.count).toBe(2);
    expect(line.awaitingRevision.count).toBe(2);
    expect(line.split).toBeNull();
    expect(line.approvedOnRevision).toMatchObject({ count: 0, percent: 0 });
    expect(line.rejectedAfterC).toBeNull();
    expect((await listed(tower.k1Manager, tower.projectId, line.awaitingRevision.query)).sort()).toEqual([unrevised, original].sort());
    for (const codeC of ["noRevisionYet", "revisionInProgress"] as const) {
      expect(await listed(tower.k1Manager, tower.projectId, { module: "submittals", type: ["MAR"], bucket: [], codeC: [codeC] })).toEqual([]);
    }
  });

  it("shows C1 \"no Revision yet\" and \"Revision in progress\"", async () => {
    const line = marCard(await dashboard(tower.c1Pm, tower.projectId)).codeC!;
    expect(line.total.count).toBe(2);
    expect(line.awaitingRevision.count).toBe(2);
    expect(line.split?.noRevisionYet.count).toBe(1);
    expect(line.split?.revisionInProgress.count).toBe(1);
    expect(await listed(tower.c1Pm, tower.projectId, line.split!.noRevisionYet.query)).toEqual([unrevised]);
    expect(await listed(tower.c1Pm, tower.projectId, line.split!.revisionInProgress.query)).toEqual([revision]);
  });

  it("keeps the split once C1 Submits the Revision, and K1 still sees one figure", async () => {
    await take(tower.c1Engineer, revision, "send_for_review");
    await ok(tower.c1Pm.post(`/v1/work-items/${revision}/pick-up`));
    await take(tower.c1Pm, revision, "submit");
    const c1Line = marCard(await dashboard(tower.c1Pm, tower.projectId)).codeC!;
    expect(c1Line.split?.revisionInProgress.count).toBe(1);
    const k1Line = marCard(await dashboard(tower.k1Manager, tower.projectId)).codeC!;
    expect(k1Line.awaitingRevision.count).toBe(2);
    expect(k1Line.split).toBeNull();
    expect((await listed(tower.k1Manager, tower.projectId, k1Line.awaitingRevision.query)).sort()).toEqual([unrevised, revision].sort());
  });
});

describe("a chain with two Code Cs and an approved Rev 2", () => {
  let tower: Tower;
  let rev2 = "";
  beforeAll(async () => {
    tower = await buildTower(api, { c1, k1 }, "TWC");
    const { c1Engineer, c1Pm, k1Manager } = tower;
    const original = await submitted(tower, c1Engineer, c1Pm, "Chillers");
    await code(k1Manager, original, "revise_c");
    const rev1 = await submittedRevision(tower, original);
    await code(k1Manager, rev1, "revise_c");
    rev2 = await submittedRevision(tower, rev1);
    await code(k1Manager, rev2, "approve_a");
  });

  it("counts it once, as approved on revision, for both Companies", async () => {
    for (const by of [tower.c1Pm, tower.k1Manager]) {
      const line = marCard(await dashboard(by, tower.projectId)).codeC!;
      expect(line.total.count).toBe(1);
      expect(line.approvedOnRevision).toMatchObject({ count: 1, percent: 100 });
      expect(line.awaitingRevision.count).toBe(0);
      expect(line.split).toBeNull();
      expect(await listed(by, tower.projectId, line.approvedOnRevision.query)).toEqual([rev2]);
      expect(await listed(by, tower.projectId, line.total.query)).toEqual([rev2]);
    }
  });
});

describe("the Approved %", () => {
  let tower: Tower;
  beforeAll(async () => {
    tower = await buildTower(api, { c1, k1 }, "PCT");
    const { c1Engineer, c1Pm, k1Manager } = tower;
    await draft(tower, c1Engineer, "Valves, draft");
    await inInternalReview(tower, c1Engineer, "Valves, in internal review");
    await submitted(tower, c1Engineer, c1Pm, "Valves, submitted");
    await code(k1Manager, await submitted(tower, c1Engineer, c1Pm, "Valves, approved"), "approve_a");
    await code(k1Manager, await submitted(tower, c1Engineer, c1Pm, "Valves, revise"), "revise_c");
  });

  it("is the same for C1 and K1 over the same Submitted chains: C1's In preparation is left out", async () => {
    const c1View = marCard(await dashboard(tower.c1Pm, tower.projectId));
    const k1View = marCard(await dashboard(tower.k1Manager, tower.projectId));
    expect(c1View.inPreparation?.count).toBe(2);
    expect(c1View.total.count).toBe(5);
    expect(k1View.total.count).toBe(3);
    expect(c1View.approved).toMatchObject({ count: 1, percent: 33 });
    expect(k1View.approved).toMatchObject({ count: 1, percent: 33 });
  });
});

describe("a Type of another Module: the Snag List", () => {
  // A test-only Rabaed Type in the Snag List runs on the MAR's Workflow and Form, its
  // Stages the Submittals' under the Snag List, beside the Comment (CMT, RP-434), the
  // Snag List's one Rabaed Default, which has no item here.
  const SNAG = "SNT";
  let tower: Tower;
  let c1Items: string[] = [];

  async function addSnagType() {
    await sql`
      insert into stage (owner_kind, module_key, key, name, category, sort)
      select s.owner_kind, 'snag_list', s.key, s.name, s.category, s.sort from stage s
      where s.owner_kind = 'rabaed' and s.module_key = 'submittals'
        and not exists (select 1 from stage x where x.owner_kind = 'rabaed' and x.module_key = 'snag_list' and x.key = s.key)
    `.execute(migrator);
    await sql`
      insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
      select t.owner_kind, 'snag_list', ${SNAG}, ${JSON.stringify(bilingual("Snag (test)"))}::jsonb, t.workflow_definition_id, t.outcome_kind, t.form_definition_id
      from work_item_type t
      where t.owner_kind = 'rabaed' and t.code = 'MAR'
        and not exists (select 1 from work_item_type x where x.owner_kind = 'rabaed' and x.code = ${SNAG})
    `.execute(migrator);
  }

  /** A Draft Snag on `at`'s Project, as `draft` raises a MAR. */
  async function snag(at: Tower, title: string): Promise<string> {
    const res = await at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
      type: SNAG,
      title,
      answers: { manufacturer: "ACME Cables", description: "Cracked tile", trade: at.electrical, location: at.buildingA },
    });
    expect(res.statusCode, res.body).toBe(201);
    await attachDatasheet(at.c1Engineer, res.json().id);
    return res.json().id;
  }

  async function submittedSnag(at: Tower, title: string): Promise<string> {
    const id = await snag(at, title);
    await take(at.c1Engineer, id, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    await take(at.c1Pm, id, "submit");
    return id;
  }

  beforeAll(async () => {
    await addSnagType();
    tower = await buildTower(api, { c1, k1 }, "SNL");
    // Each Position's Submittals permissions, in the Snag List too.
    await sql`
      insert into position_permission (position_id, module_key, permission)
      select position_id, 'snag_list', permission from position_permission where module_key = 'submittals'
      on conflict do nothing
    `.execute(migrator);
    const draftSnag = await snag(tower, "Tile, draft");
    const pendingSnag = await submittedSnag(tower, "Tile, submitted");
    const closedSnag = await submittedSnag(tower, "Tile, approved");
    await code(tower.k1Manager, closedSnag, "approve_a");
    c1Items = [draftSnag, pendingSnag, closedSnag];
    await submitted(tower, tower.c1Engineer, tower.c1Pm, "A MAR beside the Snags");
  });

  // The test-only Type then stays on this Project only, so no other Project gains a Snag List tab (RP-346).
  afterAll(async () => {
    await sql`update work_item_type set owner_kind = 'project', project_id = ${tower.projectId}::uuid where owner_kind = 'rabaed' and code = ${SNAG}`.execute(migrator);
  });

  function snagCard(d: Dashboard) {
    const c = card(d, SNAG);
    if (c.kind !== "open_closed") throw new Error("expected an open/closed card");
    return c;
  }

  it("shows open and closed that add up to the total, for C1 and K1", async () => {
    const c1Card = snagCard(await dashboard(tower.c1Pm, tower.projectId));
    expect([c1Card.total.count, c1Card.open.count, c1Card.closed.count]).toEqual([3, 2, 1]);
    const k1Card = snagCard(await dashboard(tower.k1Manager, tower.projectId));
    expect([k1Card.total.count, k1Card.open.count, k1Card.closed.count]).toEqual([2, 1, 1]);
  });

  it("opens, from each of its numbers, the Snag List of exactly those chains", async () => {
    for (const by of [tower.c1Pm, tower.k1Manager]) {
      const c = snagCard(await dashboard(by, tower.projectId));
      for (const f of [c.total, c.open, c.closed]) {
        expect(f.query.module).toBe("snag_list");
        expect((await listed(by, tower.projectId, f.query)).length).toBe(f.count);
      }
    }
    expect((await listed(tower.c1Pm, tower.projectId, snagCard(await dashboard(tower.c1Pm, tower.projectId)).total.query)).sort()).toEqual(
      [...c1Items].sort(),
    );
  });

  it("keeps the Submittals List to the Submittals, and the Snag List to its Stages and Types", async () => {
    const submittals: WorkItemList = (await ok(tower.c1Pm.get(`/v1/projects/${tower.projectId}/work-items`), 200)).json();
    expect(submittals.items.map((i) => i.type.code)).toEqual(["MAR"]);
    const snags: WorkItemList = (await ok(tower.c1Pm.get(`/v1/projects/${tower.projectId}/work-items?module=snag_list`), 200)).json();
    expect(snags.items.map((i) => i.type.code)).toEqual([SNAG, SNAG, SNAG]);
    expect(snags.filters.types.map((t) => t.code).sort()).toEqual(["CMT", SNAG].sort());
    expect(snags.stages.reduce((sum, s) => sum + s.count, 0)).toBe(3);
  });
});

describe("refusals", () => {
  it("answers a Member off the Project as if it didn't exist", async () => {
    const tower = await buildTower(api, { c1, k1 }, "REF");
    await expectHidden(outsider.get(`/v1/projects/${tower.projectId}/dashboard`));
    await expectHidden(outsider.get(`/v1/projects/${randomUUID()}/dashboard`));
    await expectHidden(tower.c1Pm.get(`/v1/projects/not-an-id/dashboard`));
  });
});
