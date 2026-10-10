// Seam 1: free Links in the Links System Field (RP-291, spec RP-289;
// form-engine.md part 2b; visibility.md E1, the Links row, scenarios 11, 12 and
// 30). The raiser's Company adds and removes `related` Links while it can still
// edit the answers (Draft and its internal Steps); from Submit they are frozen.
// Only an item Link search could have offered can be linked: anything else is
// refused alike. Everyone who sees the item reads its Links as Document Number
// and Subject, with the linked item's id only when they can see it too.
//
// The Tower setup: C1 (Contractor, created the Project), C2 (a second
// Contractor) and K1 (the Consultant, covering the whole Project, with a
// manager covering Mechanical only).
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { linksChangeField, type WorkItemHistory, type WorkItemLinks } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, buildTower, draft, inInternalReview, ok, only, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let c1: Company;
let k1: Company;
let c2: Company;
let tower: Tower;
let elsewhere: Tower; // A second Project of C1's and K1's.
let c2Engineer: Caller;
let c2Pm: Caller;
let k1Mechanical: Caller; // A K1 manager covering Mechanical only.

const linksUrl = (id: string) => `/v1/work-items/${id}/links`;
const addLink = (by: Caller, from: string, to: string) => by.post(linksUrl(from), { workItemId: to });
const removeLink = (by: Caller, from: string, linkId: string) => by.request("DELETE", `${linksUrl(from)}/${linkId}`);
const links = async (by: Caller, id: string): Promise<WorkItemLinks> => (await ok(by.get(linksUrl(id)), 200)).json();
const number = async (id: string) => (await tower.c1Engineer.get(`/v1/work-items/${id}`)).json().documentNumber as string;

async function linksChanges(by: Caller, id: string) {
  const events: WorkItemHistory["events"] = (await ok(by.get(`/v1/work-items/${id}/history`), 200)).json().events;
  return events.filter((e) => e.type === "answers_changed").map((e) => e.changes);
}

/** How many outbox rows (notifications on their way) name any of `ids`, as the migrator sees them. */
const outboxRowsAbout = async (...ids: string[]) =>
  (
    await sql<{ n: number }>`select count(*)::integer as n from outbox where payload ->> 'work_item_id' = any(${ids}::text[])`.execute(
      migrator,
    )
  ).rows[0]!.n;

const item = { c1Draft: "", c1Internal: "", c1Submitted: "", c1Approved: "", c2Submitted: "", elsewhere: "" };
const numbers = { c1Submitted: "", c1Approved: "" };

beforeAll(async () => {
  c1 = await api.projectCreator();
  const onboard = async (legalName: string): Promise<Company> => {
    const onboarded = await api.onboardCompany({ legalName: bilingual(legalName) });
    return { company: onboarded, caller: await api.acceptInvitation(onboarded.invitationToken) };
  };
  k1 = await onboard("Design Consultants LLC");
  c2 = await onboard("Second Contractor Co");
  tower = await buildTower(api, { c1, k1 }, "TWR");
  elsewhere = await buildTower(api, { c1, k1 }, "MAL");

  const c2ParticipantId = await api.addParticipant(c1.caller, tower.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2ParticipantId}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2ParticipantId, ["engineer"]);
  c2Pm = await projectMember(api, c2, c2ParticipantId, ["project_manager"]);
  const k1ParticipantId = (await tower.k1Manager.get(`/v1/projects/${tower.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  k1Mechanical = await projectMember(api, k1, k1ParticipantId, ["manager"], { trade: only(tower.mechanical) });

  const { c1Engineer, c1Pm, k1Manager } = tower;
  item.c1Draft = await draft(tower, c1Engineer, "Cable trays, draft");
  item.c1Internal = await inInternalReview(tower, c1Engineer, "Cable trays, in internal review");
  item.c1Submitted = await submitted(tower, c1Engineer, c1Pm, "Cable trays, submitted");
  item.c1Approved = await submitted(tower, c1Engineer, c1Pm, "Cable trays, approved");
  await ok(k1Manager.post(`/v1/work-items/${item.c1Approved}/pick-up`));
  await verified(k1Manager, item.c1Approved);
  await take(k1Manager, item.c1Approved, "approve_a");
  item.c2Submitted = await submitted(tower, c2Engineer, c2Pm, "Cable trays, second contractor");
  item.elsewhere = await submitted(elsewhere, elsewhere.c1Engineer, elsewhere.c1Pm, "Cable trays, another Project");
  numbers.c1Submitted = await number(item.c1Submitted);
  numbers.c1Approved = await number(item.c1Approved);
});

describe("free Links", () => {
  // A Mechanical MAR of C1's: K1's Mechanical manager will see it, but not the Electrical items it links to.
  let mar = "";
  let toSubmitted = "";
  let toApproved = "";

  beforeAll(async () => {
    mar = await draft(tower, tower.c1Engineer, "Chilled water pipes", tower.mechanical);
  });

  it("are added by the raiser in Draft, and read as Document Number and Subject with the linked item's id", async () => {
    const res = await ok(addLink(tower.c1Engineer, mar, item.c1Submitted), 201);
    toSubmitted = res.json().id;
    expect(await links(tower.c1Engineer, mar)).toEqual({
      links: [
        {
          id: toSubmitted,
          kind: "related",
          fieldKey: null,
          documentNumber: numbers.c1Submitted,
          subject: "Cable trays, submitted",
          workItemId: item.c1Submitted,
        },
      ],
      canChange: true,
    });
    // The Draft itself: nothing on the record yet.
    expect(await linksChanges(tower.c1Engineer, mar)).toEqual([]);
  });

  it("never link the same item twice, or the item to itself", async () => {
    const twice = await addLink(tower.c1Engineer, mar, item.c1Submitted);
    expect(twice.statusCode, twice.body).toBe(409);
    expect(twice.json()).toEqual({ error: "already_linked" });
    const itself = await addLink(tower.c1Engineer, mar, mar);
    expect(itself.statusCode, itself.body).toBe(422);
    expect(itself.json()).toEqual({ error: "target_not_found" });
  });

  it("refuse a hidden, Draft, internal, other-Project or made-up item with one identical answer (scenario 80)", async () => {
    const refusals = await Promise.all(
      [item.c2Submitted, item.c1Draft, item.c1Internal, item.elsewhere, randomUUID()].map((to) => addLink(tower.c1Engineer, mar, to)),
    );
    for (const r of refusals) {
      expect(r.statusCode, r.body).toBe(422);
      expect(r.body).toBe(refusals[0]!.body);
    }
    expect(refusals[0]!.json()).toEqual({ error: "target_not_found" });
    expect((await links(tower.c1Engineer, mar)).links.map((l) => l.workItemId)).toEqual([item.c1Submitted]);
  });

  it("refuse C2 a Link to C1's approved MAR, which it can't see (scenario 11)", async () => {
    const c2Draft = await draft(tower, c2Engineer, "Cable ladders");
    const r = await addLink(c2Engineer, c2Draft, item.c1Approved);
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json()).toEqual({ error: "target_not_found" });
  });

  it("are removed by the raiser in Draft; a Link not on the item is not found", async () => {
    const added = (await ok(addLink(tower.c1Engineer, mar, item.c1Approved), 201)).json().id;
    await ok(removeLink(tower.c1Engineer, mar, added));
    expect((await links(tower.c1Engineer, mar)).links.map((l) => l.id)).toEqual([toSubmitted]);
    await expectHidden(removeLink(tower.c1Engineer, mar, added));
    await expectHidden(removeLink(tower.c1Engineer, mar, randomUUID()));
    await expectHidden(removeLink(tower.c1Engineer, mar, "not-an-id"));
  });

  it("change in the raiser's internal review, each change on its history after Draft, notifying nobody", async () => {
    await take(tower.c1Engineer, mar, "send_for_review");
    const outboxBefore = await outboxRowsAbout(item.c1Submitted, item.c1Approved, mar);
    toApproved = (await ok(addLink(tower.c1Pm, mar, item.c1Approved), 201)).json().id;
    await ok(removeLink(tower.c1Engineer, mar, toSubmitted));
    expect(await outboxRowsAbout(item.c1Submitted, item.c1Approved, mar)).toBe(outboxBefore);

    const submittedLink = { documentNumber: numbers.c1Submitted, subject: "Cable trays, submitted" };
    const approvedLink = { documentNumber: numbers.c1Approved, subject: "Cable trays, approved" };
    expect(await linksChanges(tower.c1Engineer, mar)).toEqual([
      [{ field: linksChangeField, old: [submittedLink], new: [submittedLink, approvedLink] }],
      [{ field: linksChangeField, old: [submittedLink, approvedLink], new: [approvedLink] }],
    ]);
  });

  it("are frozen from Submit: adding and removing are refused", async () => {
    await ok(tower.c1Pm.post(`/v1/work-items/${mar}/pick-up`));
    await take(tower.c1Pm, mar, "submit");
    for (const r of [await addLink(tower.c1Engineer, mar, item.c1Submitted), await removeLink(tower.c1Pm, mar, toApproved)]) {
      expect(r.statusCode, r.body).toBe(409);
      expect(r.json()).toEqual({ error: "not_editable" });
    }
    expect(await links(tower.c1Engineer, mar)).toMatchObject({ links: [{ id: toApproved }], canChange: false });
  });

  it("show a linked item the reader can't see as its number and Subject only, never its id; its URL is 404 (scenario 12)", async () => {
    const res = await ok(k1Mechanical.get(linksUrl(mar)), 200);
    expect(res.json()).toEqual({
      links: [
        {
          id: toApproved,
          kind: "related",
          fieldKey: null,
          documentNumber: numbers.c1Approved,
          subject: "Cable trays, approved",
          workItemId: null,
        },
      ],
      canChange: false,
    });
    expect(res.body).not.toContain(item.c1Approved);
    await expectHidden(k1Mechanical.get(`/v1/work-items/${item.c1Approved}`));
    // A K1 manager who sees the linked item gets its id; the changes stay the raiser's own (V5).
    expect((await links(tower.k1Manager, mar)).links.map((l) => l.workItemId)).toEqual([item.c1Approved]);
    expect(await linksChanges(tower.k1Manager, mar)).toEqual([]);
  });

  it("are changed by nobody but the raiser's Company, and hidden like the item from whoever can't see it", async () => {
    const k1Adds = await addLink(tower.k1Manager, mar, item.c1Submitted);
    expect(k1Adds.statusCode, k1Adds.body).toBe(409);
    for (const r of [
      c2Engineer.get(linksUrl(mar)),
      addLink(c2Engineer, mar, item.c2Submitted),
      removeLink(c2Engineer, mar, toApproved),
      tower.k1Manager.get(linksUrl(item.c1Draft)),
      addLink(tower.k1Manager, item.c1Draft, item.c1Submitted),
      tower.c1Engineer.get(linksUrl(randomUUID())),
      tower.c1Engineer.get(linksUrl("not-an-id")),
    ]) {
      await expectHidden(r);
    }
  });

  it("are for signed-in Members only", async () => {
    expect((await api.anonymous().get(linksUrl(mar))).statusCode).toBe(401);
  });
});

/** The Consultant's verification (MAR Form Version 4, RP-306), saved by the Code's signer before the Code. */
async function verified(by: Caller, id: string) {
  const answers = (await by.get(`/v1/work-items/${id}`)).json().answers as Record<string, unknown>;
  const saved = await by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...answers, sample_checked: true, matches_specification: true } });
  expect(saved.statusCode, saved.body).toBe(204);
}
