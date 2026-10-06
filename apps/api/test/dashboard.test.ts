// Seam 1 for the Dashboard's Type cards (RP-351, spec RP-344; visibility.md
// "Dashboard and Location Status", V1, V3, scenarios 63 and 65). Cards per
// Module and Type count Revision chains by the latest Revision the viewer sees:
// Pending is Submitted and open, In preparation only for the raiser's own
// Participant, then the latest closed Revision's outcome. Every number opens the
// List of exactly the chains it counts: both come from the work item query.
import { randomUUID } from "node:crypto";
import { workItemSearchParams, type Dashboard, type DashboardCard, type DashboardFigure, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, draft, inInternalReview, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

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

/** K1 verifies item `id` and issues a Review Code. */
async function code(by: Caller, id: string, transition: "approve_a" | "revise_c") {
  const answers = (await ok(by.get(`/v1/work-items/${id}`), 200)).json().answers as Record<string, unknown>;
  const pass = transition === "approve_a";
  await ok(
    by.request("PUT", `/v1/work-items/${id}/answers`, {
      answers: { ...answers, sample_checked: true, matches_specification: pass, ...(pass ? {} : { verification_note: "Below the specified efficacy" }) },
    }),
  );
  await ok(by.post(`/v1/work-items/${id}/claim`));
  await ok(
    by.post(`/v1/work-items/${id}/transitions`, {
      transition,
      answers: pass ? {} : { remarks: "Resubmit with 110 lm/W luminaires" },
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
    expect(d.modules.map((m) => m.key)).toEqual(["submittals"]);
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
    await ok(c1Pm.post(`/v1/work-items/${revision}/claim`));
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

describe("refusals", () => {
  it("answers a Member off the Project as if it didn't exist", async () => {
    const tower = await buildTower(api, { c1, k1 }, "REF");
    await expectHidden(outsider.get(`/v1/projects/${tower.projectId}/dashboard`));
    await expectHidden(outsider.get(`/v1/projects/${randomUUID()}/dashboard`));
    await expectHidden(tower.c1Pm.get(`/v1/projects/not-an-id/dashboard`));
  });
});
