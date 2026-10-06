// Seam 1 for Need My Action, the Projects page's counts and the Module tabs
// (RP-346, spec RP-344; visibility.md the Need My Action channel, V3, V14,
// scenario 70). The toggle keeps the Steps I hold and the unclaimed Steps of my
// Step Pool, on items I can see, plus my own Drafts, which are never counted.
// The count on the Project card is the toggle's rows minus my Drafts, and a
// closed Project has none.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { workItemSearchParams, type ProjectSummary, type WorkItemList, type WorkItemQueryInput } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, projectMember, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
// What no api does yet: closing a Project, adding a Project's own Work Item Type.
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company;
let c1Engineer: Caller; // raises the MARs
let c1Colleague: Caller; // another C1 engineer
let c1Pm: Caller; // holds C1's internal review
let c2Engineer: Caller; // a second Contractor (V3)
let k1A: Caller; // K1, in the review Step's pool
let k1B: Caller; // K1, in the same pool
let projectId = "";
let electrical = "";
let buildingA = "";

const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};

const take = (by: Caller, id: string, transition: string) =>
  ok(by.post(`/v1/work-items/${id}/transitions`, { transition, answers: {}, idempotencyKey: randomUUID() }));

async function list(by: Caller, query: WorkItemQueryInput = {}, project = projectId): Promise<WorkItemList> {
  return (await ok(by.get(`/v1/projects/${project}/work-items?${workItemSearchParams({ needMyAction: true, ...query })}`), 200)).json();
}
const ids = (l: WorkItemList) => l.items.map((i) => i.id);

/** The Project as the Projects page shows it to `by`. */
async function card(by: Caller, project = projectId): Promise<ProjectSummary> {
  const projects: ProjectSummary[] = (await ok(by.get("/v1/projects"), 200)).json().projects;
  const found = projects.find((p) => p.id === project);
  if (!found) throw new Error("not on the Projects page");
  expect((await ok(by.get(`/v1/projects/${project}`), 200)).json()).toEqual(found);
  return found;
}

/** A Draft MAR raised by `by`, complete, with its datasheet. */
async function draft(by: Caller, title: string, project = projectId, answers: Record<string, unknown> = {}): Promise<string> {
  const res = await ok(
    by.post(`/v1/projects/${project}/work-items`, { type: "MAR", title, answers: { ...complete, trade: electrical, location: buildingA, ...answers } }),
    201,
  );
  const id = res.json().id as string;
  await attachDatasheet(by, id);
  return id;
}

/** Sends a Draft for C1's internal review, where it waits in the PM's pool. */
const sendForReview = (id: string) => take(c1Engineer, id, "send_for_review");

/** C1's PM claims the internal review and Submits it to K1, where it waits in the review Step's pool. */
async function submit(id: string) {
  await ok(c1Pm.post(`/v1/work-items/${id}/claim`));
  await take(c1Pm, id, "submit");
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${projectId}/${path}`, body), 201)).json().id;
  electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
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
  c1Engineer = await projectMember(api, c1, own, ["engineer"]);
  c1Colleague = await projectMember(api, c1, own, ["engineer"]);
  c1Pm = await projectMember(api, c1, own, ["project_manager"]);
  const c2 = await participant("contractor");
  c2Engineer = await projectMember(api, c2.company, c2.participantId, ["engineer"]);
  const k1 = await participant("consultant");
  k1A = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  k1B = await projectMember(api, k1.company, k1.participantId, ["manager"]);
});

describe("Need My Action", () => {
  let myDraft = "";
  let colleaguesDraft = "";
  let inReview = "";
  let pooled = "";
  beforeAll(async () => {
    myDraft = await draft(c1Engineer, "Fixtures, still a Draft");
    colleaguesDraft = await draft(c1Colleague, "Colleague's Draft");
    inReview = await draft(c1Engineer, "Cable trays");
    await sendForReview(inReview);
    pooled = await draft(c1Engineer, "Switchboards");
    await sendForReview(pooled);
    await submit(pooled);
  });

  it("lists my own Drafts but never counts them, and never lists a colleague's", async () => {
    const mine = await list(c1Engineer);
    expect(ids(mine)).toContain(myDraft);
    expect(ids(mine)).not.toContain(colleaguesDraft);
    // Sent on: nobody is waiting on me for these any more.
    expect(ids(mine)).not.toContain(inReview);
    expect(ids(mine)).not.toContain(pooled);
    expect((await card(c1Engineer)).needMyAction).toBe(0);
    expect(ids(await list(c1Colleague))).toEqual([colleaguesDraft]);
  });

  it("lists an unclaimed Step in my pool, and the Step once I hold it", async () => {
    expect(ids(await list(c1Pm))).toEqual([inReview]);
    expect((await card(c1Pm)).needMyAction).toBe(1);
    await ok(c1Pm.post(`/v1/work-items/${inReview}/claim`));
    expect(ids(await list(c1Pm))).toEqual([inReview]);
    expect((await card(c1Pm)).needMyAction).toBe(1);
  });

  it("leaves the other pool members' Need My Action and counts when one of them claims it (scenario 70)", async () => {
    for (const k1 of [k1A, k1B]) {
      expect(ids(await list(k1))).toEqual([pooled]);
      expect((await card(k1)).needMyAction).toBe(1);
    }
    await ok(k1A.post(`/v1/work-items/${pooled}/claim`));
    expect(ids(await list(k1A))).toEqual([pooled]);
    expect((await card(k1A)).needMyAction).toBe(1);
    expect(ids(await list(k1B))).toEqual([]);
    expect((await card(k1B)).needMyAction).toBe(0);
    // Without the toggle the item is still in the colleague's List.
    expect(ids(await list(k1B, { needMyAction: false }))).toContain(pooled);
  });

  it("counts exactly the toggle's rows minus my own Drafts", async () => {
    const extra = await draft(c1Engineer, "Busbars");
    await sendForReview(extra);
    for (const [who, drafts] of [
      [c1Engineer, [myDraft]],
      [c1Colleague, [colleaguesDraft]],
      [c1Pm, []],
      [k1A, []],
      [k1B, []],
    ] as const) {
      const rows = ids(await list(who)).filter((id) => !(drafts as readonly string[]).includes(id));
      expect((await card(who)).needMyAction).toBe(rows.length);
    }
    expect((await card(c1Pm)).needMyAction).toBe(2);
  });

  it("counts one per Revision chain, as the toggle lists it: never a Revision that isn't the latest I see", async () => {
    // Two items waiting in the PM's pool, made one chain: the second is the first's next Revision. The API never
    // leaves an earlier Revision open, so the chain is made by hand, to prove the count follows the List's rule.
    const earlier = await draft(c1Engineer, "Lighting, Rev 0");
    await sendForReview(earlier);
    const later = await draft(c1Engineer, "Lighting, Rev 1");
    await sendForReview(later);
    const before = (await card(c1Pm)).needMyAction;
    await sql`update work_item set root_id = ${earlier}::uuid, revision_of_id = ${earlier}::uuid, revision_no = 1 where id = ${later}::uuid`.execute(migrator);
    const rows = ids(await list(c1Pm));
    expect(rows).toContain(later);
    expect(rows).not.toContain(earlier);
    expect((await card(c1Pm)).needMyAction).toBe(rows.length);
    expect((await card(c1Pm)).needMyAction).toBe(before - 1);
  });

  it("combines with the other filters", async () => {
    expect(ids(await list(c1Pm, { stage: ["draft"] }))).toEqual([]);
    expect(ids(await list(c1Pm, { with: ["me"] }))).toEqual([inReview]);
  });
});

describe("a second Contractor (V3)", () => {
  it("never lists or counts a C1 item", async () => {
    const own = await draft(c2Engineer, "C2 pumps");
    expect(ids(await list(c2Engineer))).toEqual([own]);
    expect(ids(await list(c2Engineer, { allRevisions: true }))).toEqual([own]);
    expect((await card(c2Engineer)).needMyAction).toBe(0);
    await sendForReview(await draft(c1Engineer, "Another C1 item"));
    expect((await card(c2Engineer)).needMyAction).toBe(0);
  });
});

describe("a closed Project", () => {
  it("has an empty Need My Action and a count of 0", async () => {
    const closing = (await api.createProject(c1.caller, { code: "CLS" })).id;
    const post = async (path: string, body: unknown) => (await ok(c1.caller.post(`/v1/projects/${closing}/${path}`, body), 201)).json().id;
    const trade = await post("trades", { code: "EL", name: bilingual("Electrical") });
    const location = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
    const own = (await c1.caller.get(`/v1/projects/${closing}/participants`))
      .json()
      .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
    await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
    const engineer = await projectMember(api, c1, own, ["engineer"]);
    const pm = await projectMember(api, c1, own, ["project_manager"]);
    const item = await draft(engineer, "Pumps", closing, { trade, location });
    await take(engineer, item, "send_for_review");
    await draft(engineer, "A Draft", closing, { trade, location });
    expect((await card(pm, closing)).needMyAction).toBe(1);
    expect(ids(await list(engineer, {}, closing))).toHaveLength(1);

    await sql`update project set status = 'closed', closed_at = now() where id = ${closing}`.execute(migrator);
    expect((await card(pm, closing)).needMyAction).toBe(0);
    expect(ids(await list(pm, {}, closing))).toEqual([]);
    expect(ids(await list(engineer, {}, closing))).toEqual([]);
    // Still readable without the toggle.
    expect(ids(await list(pm, { needMyAction: false }, closing))).toContain(item);
  });
});

describe("Module tabs", () => {
  it("are the Modules the Project has a Work Item Type in: Submittals only, by default", async () => {
    expect((await card(c1Engineer)).modules).toEqual(["submittals"]);
  });

  it("grow with a Project's own Type in another Module, on that Project only", async () => {
    const other = (await api.createProject(c1.caller, { code: "INS" })).id;
    await sql`
      insert into work_item_type (owner_kind, project_id, module_key, code, name, workflow_definition_id, outcome_kind)
      select 'project', ${other}::uuid, 'inspections', 'WIR', ${JSON.stringify(bilingual("Work Inspection"))}::jsonb, workflow_definition_id, 'inspection_result'
      from work_item_type where code = 'MAR' and project_id is null
    `.execute(migrator);
    expect((await card(c1.caller, other)).modules).toEqual(["submittals", "inspections"]);
    expect((await card(c1.caller)).modules).toEqual(["submittals"]);
  });

  it("each lead to their Module's List and Kanban, of that Module's Types only", async () => {
    const path = (module: string, view = "") => `/v1/projects/${projectId}/modules/${module}/work-items${view}`;
    // Before the Project has an Inspections Type, its Inspections answer as if they didn't exist, like a made-up Module.
    await expectHidden(c1Engineer.get(path("inspections")));
    await expectHidden(c1Engineer.get(path("inspections", "/kanban")));
    await expectHidden(c1Engineer.get(path("rfis")));
    const submittals: WorkItemList = (await ok(c1Engineer.get(path("submittals")), 200)).json();
    expect(submittals.items.length).toBeGreaterThan(0);
    expect(submittals.filters.types.map((t) => t.code)).toContain("MAR");

    await sql`
      insert into work_item_type (owner_kind, project_id, module_key, code, name, workflow_definition_id, outcome_kind)
      select 'project', ${projectId}::uuid, 'inspections', 'WIR', ${JSON.stringify(bilingual("Work Inspection"))}::jsonb, workflow_definition_id, 'inspection_result'
      from work_item_type where code = 'MAR' and project_id is null
    `.execute(migrator);
    const inspections: WorkItemList = (await ok(c1Engineer.get(path("inspections")), 200)).json();
    expect(inspections.filters.types.map((t) => t.code)).toEqual(["WIR"]);
    // Not one Submittal.
    expect(inspections.items).toEqual([]);
    expect((await ok(c1Engineer.get(path("inspections", "/kanban")), 200)).json().columns.flatMap((c: { lanes: unknown[] }) => c.lanes)).toEqual([]);
    // Another Company's Member who isn't on the Project: not found, as ever.
    await expectHidden((await api.authorizedPerson()).caller.get(path("inspections")));
  });
});
