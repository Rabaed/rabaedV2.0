// Seam 1 for Home across my Projects (RP-407, spec RP-447; visibility.md "Home
// across Projects", the Need My Action and Activity Feed channels, V3, V14,
// scenarios RP-407-1 to RP-407-8). Home adds no read of its own: its counts are
// sums of each Project's, its lists merges of each Project's List and Activity
// Feed, over the Member's active Projects only. So C2 never counts C1's items, a
// Draft is never counted for anyone, a closed Project contributes nothing, and a
// Member on two Projects sees each count only for the Projects he is on.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { activityFeedSearchParams, workItemSearchParams, type ActivityFeed, type Home, type ProjectSummary, type WorkItemList } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, draft, inInternalReview, memberOnProject, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
// What no api does: closing a Project, and an item that has been at its Step for weeks.
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

const C1_NAME = "Home Contractor Co";
const K1_NAME = "Home Consultants LLC";

let c1: Company;
let k1: Company;
let twr: Tower; // the first Project: K1's two managers, A and B, are on it
let jcv: Tower; // the second: only K1 manager A is on it
let k1A: Caller;
let k1B: Caller;
let c2: Company;
let c2Engineer: Caller;

const onboard = async (legalName: string): Promise<Company> => {
  const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
  return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
};

/** A Participant of `at`'s Project other than C1, by its Company's name. */
async function participantOf(at: Tower, name: string): Promise<string> {
  return (await c1.caller.get(`/v1/projects/${at.projectId}/participants`))
    .json()
    .participants.find((p: { company: { legalName: { en: string } } }) => p.company.legalName.en === name).id as string;
}

/** Home as `by` sees it, and everything the api said. */
async function home(by: Caller): Promise<Home & { body: string }> {
  const res = await ok(by.get("/v1/home"), 200);
  return { ...(res.json() as Home), body: res.body };
}
const listed = (h: Home) => h.needsMyAction.map((i) => i.id);

/** The Projects page, as `by` sees it. */
async function cards(by: Caller): Promise<ProjectSummary[]> {
  return (await ok(by.get("/v1/projects"), 200)).json().projects;
}

/** The List's Need My Action toggle on one Project, as `by` sees it. */
async function toggle(by: Caller, at: Tower): Promise<string[]> {
  const list: WorkItemList = (await ok(by.get(`/v1/projects/${at.projectId}/work-items?${workItemSearchParams({ needMyAction: true })}`), 200)).json();
  return list.items.map((i) => i.id);
}

/** The item has been at its Step, and with its holder, since `weeks` weeks ago. */
async function aged(id: string, weeks: number) {
  await sql`
    update work_item set step_entered_at = now() - make_interval(weeks => ${weeks}), participant_entered_at = now() - make_interval(weeks => ${weeks})
    where id = ${id}::uuid
  `.execute(migrator);
}

beforeAll(async () => {
  c1 = await onboard(C1_NAME);
  await ok(c1.caller.patch(`/v1/members/${c1.company.authorizedPerson.id}`, { canCreateProjects: true }), 200);
  k1 = await onboard(K1_NAME);
  twr = await buildTower(api, { c1, k1 }, "HOM");
  jcv = await buildTower(api, { c1, k1 }, "HJV");
  const a = await memberOnProject(api, k1, await participantOf(twr, K1_NAME), ["manager"]);
  k1A = a.caller;
  const onJcv = await participantOf(jcv, K1_NAME);
  await api.addProjectMember(k1.caller, onJcv, a.id);
  await ok(k1.caller.request("PUT", `/v1/participants/${onJcv}/members/${a.id}/visibility`, { trade: all, location: all }));
  await ok(k1.caller.request("PUT", `/v1/participants/${onJcv}/members/${a.id}/positions`, { positions: ["manager"] }));
  k1B = await projectMember(api, k1, await participantOf(twr, K1_NAME), ["manager"]);
  c2 = await onboard("Home Second Contractor");
  const c2Participant = await api.addParticipant(c1.caller, twr.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
});

it("is for signed-in Members only", async () => {
  expect((await api.anonymous().get("/v1/home")).statusCode).toBe(401);
});

describe("a Member on two Projects (RP-407-6)", () => {
  let atTwr = "";
  let atJcv = "";
  beforeAll(async () => {
    atTwr = await submitted(twr, twr.c1Engineer, twr.c1Pm, "Cable trays");
    atJcv = await submitted(jcv, jcv.c1Engineer, jcv.c1Pm, "Villa pumps");
  });

  it("counts and lists each Project's Need My Action only for the Projects he is on", async () => {
    const a = await home(k1A);
    expect(a.counts.activeProjects).toBe(2);
    expect(a.counts.needMyAction).toBe(2);
    // Newest-waiting first.
    expect(listed(a)).toEqual([atJcv, atTwr]);
    expect(a.needsMyAction.map((i) => i.project.code)).toEqual(["HJV", "HOM"]);
    expect(a.needsMyAction.every((i) => i.moduleKey === "submittals")).toBe(true);
    expect(a.projects.map((p) => p.code).toSorted()).toEqual(["HJV", "HOM"]);

    const b = await home(k1B);
    expect(b.counts.activeProjects).toBe(1);
    expect(b.counts.needMyAction).toBe(1);
    expect(listed(b)).toEqual([atTwr]);
    expect(b.projects.map((p) => p.code)).toEqual(["HOM"]);
    expect(b.body).not.toContain(jcv.projectId);
    expect(b.body).not.toContain("Villa pumps");
  });

  it("is the sum of the Projects page's counts, and lists the toggle's rows", async () => {
    for (const who of [k1A, k1B, twr.c1Pm, twr.k1Manager, jcv.k1Manager]) {
      const h = await home(who);
      const sum = (await cards(who)).reduce((n, p) => n + p.needMyAction, 0);
      expect(h.counts.needMyAction).toBe(sum);
      expect(h.needsMyAction).toHaveLength(sum);
      for (const id of listed(h)) {
        const at = h.needsMyAction.find((i) => i.id === id)!.project.id === twr.projectId ? twr : jcv;
        expect(await toggle(who, at)).toContain(id);
      }
    }
  });

  it("merges the Projects' Activity Feeds, as each feed shows them (RP-407-5)", async () => {
    const a = await home(k1A);
    const feeds = await Promise.all(
      [twr, jcv].map(async (at) => (await ok(k1A.get(`/v1/projects/${at.projectId}/activity?${activityFeedSearchParams({ limit: 100 })}`), 200)).json() as ActivityFeed),
    );
    const everything = feeds.flatMap((f) => f.entries).toSorted((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
    expect(a.activity.map((e) => e.id)).toEqual(everything.slice(0, a.activity.length).map((e) => e.id));
    expect(a.activity.length).toBeGreaterThan(0);
    // At most five entries, and "View all" only when the feeds hold more.
    expect(a.activity.length).toBeLessThanOrEqual(5);
    expect(a.moreActivity).toBe(everything.length > a.activity.length);
    expect(new Set(a.activity.map((e) => e.project.code))).toEqual(new Set(["HJV", "HOM"]));
    // C1 by its name only, never its people (V14); C1's internal review never reaches K1 (V5).
    for (const e of a.activity) {
      expect(e.audience).toBe("shared");
      if (e.by.companyName?.en === C1_NAME) expect(e.by.memberName).toBeNull();
    }
    const submit = a.activity.find((e) => e.workItem.id === atJcv && e.type === "transition");
    expect(submit?.by).toEqual({ companyName: bilingual(C1_NAME), memberName: null });
    // K1 manager B is not on the second Project: nothing of it.
    expect((await home(k1B)).activity.every((e) => e.project.id === twr.projectId)).toBe(true);
  });
});

describe("a second Contractor (RP-407-1)", () => {
  it("never counts, lists or hears of a C1 item", async () => {
    const c1Item = await submitted(twr, twr.c1Engineer, twr.c1Pm, "C1 switchboards");
    await inInternalReview(twr, twr.c1Engineer, "C1 busbars");
    const h = await home(c2Engineer);
    expect(h.counts.needMyAction).toBe(0);
    expect(h.counts.longAtStep).toBe(0);
    expect(h.needsMyAction).toEqual([]);
    expect(h.activity).toEqual([]);
    expect(h.body).not.toContain(c1Item);
    expect(h.body).not.toContain("C1 switchboards");
    expect(h.body).not.toContain("C1 busbars");
    // C1's name reaches C2 only as the Host Company on its Project card (V15), never through an item.
    expect(h.projects.map((p) => p.hostCompany.legalName.en)).toEqual([C1_NAME]);
  });
});

describe("a Draft (RP-407-2)", () => {
  it("is never counted for anyone, not even its raiser, however long it has been a Draft", async () => {
    const engineer = await projectMember(api, c1, twr.c1ParticipantId, ["engineer"]);
    const mine = await draft(twr, engineer, "Lighting, still a Draft");
    await aged(mine, 6);
    // The List's toggle lists it to its raiser...
    expect(await toggle(engineer, twr)).toEqual([mine]);
    // ...but Home neither counts nor lists it.
    const h = await home(engineer);
    expect(h.counts.needMyAction).toBe(0);
    expect(h.counts.longAtStep).toBe(0);
    expect(h.needsMyAction).toEqual([]);
    for (const who of [twr.c1Pm, k1A, k1B, c2Engineer]) expect((await home(who)).body).not.toContain(mine);
  });
});

describe("4+ weeks at their Step (RP-407-4)", () => {
  it("counts my own Participant's open items, aged from when they reached it: never another Company's, never its internal time", async () => {
    const pm = await projectMember(api, c1, twr.c1ParticipantId, ["project_manager"]);
    const k1 = (await home(k1A)).counts.longAtStep;
    const c1Engineer = (await home(twr.c1Engineer)).counts.longAtStep;
    const id = await inInternalReview(twr, twr.c1Engineer, "Fire pumps");
    await aged(id, 5);
    // Five weeks in C1's own review: C1's PMs (in the review's pool) count it; K1 doesn't see it at all.
    expect((await home(pm)).counts.longAtStep).toBe(1);
    expect((await home(k1A)).counts.longAtStep).toBe(k1);

    await ok(pm.post(`/v1/work-items/${id}/claim`));
    await take(pm, id, "submit");
    // With K1 now: its age is from when it reached K1, not the five weeks at C1 (V14).
    expect((await home(pm)).counts.longAtStep).toBe(0);
    expect((await home(k1A)).counts.longAtStep).toBe(k1);
    expect((await home(k1A)).needsMyAction.find((i) => i.id === id)?.stepAgeWeeks).toBe(1);

    await aged(id, 4);
    expect((await home(k1A)).counts.longAtStep).toBe(k1 + 1);
    expect((await home(k1B)).counts.longAtStep).toBeGreaterThanOrEqual(1);
    // C1 sees the item, but K1 holds it: not C1's to count.
    expect((await home(twr.c1Engineer)).counts.longAtStep).toBe(c1Engineer);
    expect((await home(pm)).counts.longAtStep).toBe(0);
  });
});

describe("a closed Project (RP-407-3)", () => {
  it("contributes nothing: no active Project, count, row, aged item or activity", async () => {
    const closing = await buildTower(api, { c1, k1 }, "HCL");
    const id = await inInternalReview(closing, closing.c1Engineer, "Closing pumps");
    await aged(id, 5);
    const before = await home(closing.c1Pm);
    expect(before.counts).toEqual({ activeProjects: 1, needMyAction: 1, longAtStep: 1, waitingWithOthers: 0 });
    expect(before.submittals).toEqual({ [closing.projectId]: 1 });
    expect(listed(before)).toEqual([id]);
    expect(before.activity.length).toBeGreaterThan(0);

    await sql`update project set status = 'closed', closed_at = now() where id = ${closing.projectId}::uuid`.execute(migrator);
    const after = await home(closing.c1Pm);
    expect(after.counts).toEqual({ activeProjects: 0, needMyAction: 0, longAtStep: 0, waitingWithOthers: 0 });
    expect(after.submittals).toEqual({});
    expect(after.needsMyAction).toEqual([]);
    expect(after.activity).toEqual([]);
    // Still on the Projects list, as closed.
    expect(after.projects.map((p) => [p.code, p.status])).toEqual([["HCL", "closed"]]);
  });
});

describe("Submitted by my Company, waiting with others (RP-407-7)", () => {
  let at: Tower;
  let c2OnAt: Caller;
  let sent = "";
  let internal = "";
  let mine = "";
  beforeAll(async () => {
    at = await buildTower(api, { c1, k1 }, "HWO");
    const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
    await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
    c2OnAt = await projectMember(api, c2, c2Participant, ["engineer"]);
    mine = await draft(at, at.c1Engineer, "Waiting: still a Draft");
    internal = await inInternalReview(at, at.c1Engineer, "Waiting: at our review");
    sent = await submitted(at, at.c1Engineer, at.c1Pm, "Waiting: with the Consultant");
  });

  it("counts my own Company's open items another Participant holds, never a Draft or one we hold", async () => {
    // C1 raised all three; only the Submitted one is with another Participant (K1).
    expect((await home(at.c1Engineer)).counts.waitingWithOthers).toBe(1);
    expect((await home(at.c1Pm)).counts.waitingWithOthers).toBe(1);
  });

  it("never counts another Company's items, even the ones its holder sees", async () => {
    // K1 holds C1's item: not K1's own, so not K1's to count as waiting with others.
    expect((await home(at.k1Manager)).counts.waitingWithOthers).toBe(0);
    // C2 sees none of C1's items, and counts none.
    const h = await home(c2OnAt);
    expect(h.counts.waitingWithOthers).toBe(0);
    for (const id of [sent, internal, mine]) expect(h.body).not.toContain(id);
  });

  it("stops counting an item once it is closed", async () => {
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Waiting: soon approved");
    expect((await home(at.c1Pm)).counts.waitingWithOthers).toBe(2);
    // K1's manager verifies it and issues Code A, which closes it.
    const answers = (await ok(at.k1Manager.get(`/v1/work-items/${id}`), 200)).json().answers as Record<string, unknown>;
    await ok(at.k1Manager.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...answers, sample_checked: true, matches_specification: true } }));
    await ok(at.k1Manager.post(`/v1/work-items/${id}/claim`));
    await take(at.k1Manager, id, "approve_a");
    expect((await home(at.c1Pm)).counts.waitingWithOthers).toBe(1);
  });

  it("gives each Project card the number of items its Member sees there, never another Company's internal ones (RP-407-8)", async () => {
    const shown = async (by: Caller) => ((await ok(by.get(`/v1/projects/${at.projectId}/work-items`), 200)).json() as WorkItemList).items.length;
    for (const who of [at.c1Engineer, at.c1Pm, at.k1Manager, c2OnAt]) {
      expect((await home(who)).submittals[at.projectId]).toBe(await shown(who));
    }
    // The raiser: his Draft, the internal review, the waiting and the approved item.
    expect((await home(at.c1Engineer)).submittals[at.projectId]).toBe(4);
    // K1: the two Submitted items only, never C1's Draft or internal review. C2: none of C1's.
    expect((await home(at.k1Manager)).submittals[at.projectId]).toBe(2);
    expect((await home(c2OnAt)).submittals[at.projectId]).toBe(0);
  });
});
