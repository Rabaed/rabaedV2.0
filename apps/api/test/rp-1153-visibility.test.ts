// Seam 1 for the bell's and the Notifications page's read (RP-1153; visibility.md
// "Notifications and emails"; scenarios RP-1153-1 and RP-1153-2). Each notification
// now names its Project, whether it reached the Member's Step Pool (and whether that
// Step still waits there), the outcome's name and kind, the item's Revision number,
// and whether the Company named is the Member's own. Every one of them is read as
// the Member sees the item now, and another Company only by its name (V14).
// Seam 2: packages/db/test/rp-1153-visibility-rls.test.ts.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { drainOutbox, expectHiddenFrom, testDatabaseUrls } from "@rabaed/db/test-support";
import type { ItemNotification, Notification, NotificationList, SignedInMember } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, type Caller } from "./support/harness.ts";
import { all, buildTower, draft, ok, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const worker = createDb(testDatabaseUrls().app, { max: 2 });
afterAll(async () => {
  await api.close();
  await worker.destroy();
});

let c1: Company;
let k1: Company;
let at: Tower;
let c1Pm2: Caller; // A second C1 Project Manager: the Internal Review pool has two.
let c2Engineer: Caller; // Another Contractor: never sees C1's items.
let k1Name = "";
let c1Name = "";

const list = async (by: Caller): Promise<Notification[]> => ((await ok(by.get("/v1/notifications"), 200)).json() as NotificationList).notifications;
const about = async (by: Caller, id: string): Promise<ItemNotification[]> =>
  (await list(by)).filter((n): n is ItemNotification => n.kind !== "package_submitted" && n.workItemId === id);
const named = (by: Caller) =>
  by === at.c1Engineer ? "C1 engineer" : by === at.c1Pm ? "C1 PM" : by === c1Pm2 ? "C1 PM 2" : by === at.k1Manager ? "K1 manager" : by === c2Engineer ? "C2 engineer" : "someone";

/** K1's manager picks up item `id` at Consultant review and issues a Review Code. */
async function issue(id: string, transition: "approve_a" | "revise_c") {
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await ok(
    at.k1Manager.post(`/v1/work-items/${id}/transitions`, {
      transition,
      answers: transition === "revise_c" ? { remarks: "Resubmit with 110 lm/W luminaires" } : {},
      confirmed: true,
      idempotencyKey: randomUUID(),
    }),
  );
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "TWR");
  c1Pm2 = await projectMember(api, c1, at.c1ParticipantId, ["project_manager"]);
  const c2 = await api.authorizedPerson();
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  const companyOf = async (by: Caller) => ((await ok(by.get("/v1/me"), 200)).json() as SignedInMember).company.legalName.en; // not hidden-from: its own Member reads it
  k1Name = await companyOf(k1.caller);
  c1Name = await companyOf(c1.caller);
  await drainOutbox(worker);
});

describe("scenario RP-1153-1: an item reaches C1's Internal Review pool of two Project Managers", () => {
  let id = "";
  beforeAll(async () => {
    id = await draft(at, at.c1Engineer, "Distribution boards");
    await take(at.c1Engineer, id, "send_for_review");
    await drainOutbox(worker);
  });

  it("names its Project, and that it reached their Step Pool and still waits there", async () => {
    const [n] = (await about(at.c1Pm, id)).filter((x) => x.kind === "step_reached");
    expect(n).toMatchObject({ project: { id: at.projectId, code: "TWR" }, pool: { waiting: true }, revisionNo: 0 });
    expect((await about(c1Pm2, id)).filter((x) => x.kind === "step_reached").map((x) => x.pool)).toEqual([{ waiting: true }]);
  });

  it("after one picks it up: theirs still says it reached the pool, no longer waiting; the other's is withdrawn", async () => {
    await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    expect((await about(at.c1Pm, id)).filter((x) => x.kind === "step_reached").map((x) => x.pool)).toEqual([{ waiting: false }]);
    expect((await about(c1Pm2, id)).filter((x) => x.kind === "step_reached")).toEqual([]); // not hidden-from: withdrawn by the pick-up
  });

  it("a Step that reached one Member alone is no pool's", async () => {
    await take(at.c1Pm, id, "return", { reason: "Wrong breaker rating" });
    await drainOutbox(worker);
    const [n] = (await about(at.c1Engineer, id)).filter((x) => x.kind === "step_reached");
    expect(n!.pool).toBeNull();
    // Nobody of another Company reads it, nor its Project through it.
    await expectHiddenFrom({ read: (who: Caller) => about(who, id), target: id, idOf: (x) => x.workItemId, seenBy: at.c1Engineer, hiddenFrom: [at.k1Manager, c2Engineer], name: named });
  });
});

describe("scenario RP-1153-2: K1 issues Code C on C1's MAR, which C1's engineer watches", () => {
  let id = "";
  beforeAll(async () => {
    id = await submitted(at, at.c1Engineer, at.c1Pm, "LED light fixtures");
    await issue(id, "revise_c");
    await drainOutbox(worker);
  });

  it("names the Review Code and its name, and K1 by name only, as another Company's", async () => {
    const [code] = (await about(at.c1Engineer, id)).filter((x) => x.event?.type === "issue_code");
    expect(code!.event).toMatchObject({
      outcome: "C",
      outcomeKind: "review_code",
      outcomeName: { en: "Revise and Resubmit", ar: "يُراجع ويُعاد تقديمه" },
      companyName: { en: k1Name },
      ownCompany: false,
    });
    expect(code!.project.code).toBe("TWR");
    expect(JSON.stringify(code)).not.toContain("110 lm/W"); // not hidden-from: the Code's remarks are in no notification at all
  });

  it("names C1's own Submit as its own Company's", async () => {
    const [submit] = (await about(at.c1Engineer, id)).filter((x) => x.event?.type === "transition" && x.event.transition?.en === "Submit");
    expect(submit!.event).toMatchObject({ companyName: { en: c1Name }, ownCompany: true, outcomeName: null, outcomeKind: null });
  });

  it("is nobody's of another Contractor", async () => {
    await expectHiddenFrom({ read: (who: Caller) => about(who, id), target: id, idOf: (x) => x.workItemId, seenBy: at.c1Engineer, hiddenFrom: [c2Engineer], name: named });
  });
});

describe("a new Revision: C1 raises Rev 1 after Code C, and its PM watches the chain", () => {
  let rev = "";
  beforeAll(async () => {
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Aluminium cladding panels");
    await issue(id, "revise_c");
    await ok(at.c1Pm.request("PUT", `/v1/work-items/${id}/watch`));
    await drainOutbox(worker);
    rev = (await ok(at.c1Engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;
    await ok(at.c1Engineer.post(`/v1/work-items/${rev}/transitions`, { transition: "send_for_review", answers: {}, confirmed: true, idempotencyKey: randomUUID() }));
    await drainOutbox(worker);
  });

  it("names the Revision's number and its raiser, C1, as the PM's own Company", async () => {
    const [n] = (await about(at.c1Pm, rev)).filter((x) => x.event?.type === "revision_created");
    expect(n).toMatchObject({ revisionNo: 1, event: { companyName: { en: c1Name }, ownCompany: true } });
  });

  it("is read by nobody outside C1 before it is Submitted (V1)", async () => {
    await expectHiddenFrom({ read: (who: Caller) => about(who, rev), target: rev, idOf: (x) => x.workItemId, seenBy: at.c1Pm, hiddenFrom: [at.k1Manager, c2Engineer], name: named });
  });
});
