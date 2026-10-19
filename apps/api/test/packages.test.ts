// Seam 1: Packages (spec RP-616; RP-636 an Open Package; visibility.md scenario
// RP-588-1; data-model.md package). A Member of a Participant creates a Package
// on the Tower, numbered PKG-001… per Project and owning Participant, and adds
// the submittals their Participant raised that they see: their own Drafts, items
// at internal review, Submitted items. While it is Open they remove items, rename
// it or delete it (its Drafts stay, without a Package). Nobody outside the owning
// Participant reads anything of an Open Package: a 404 that names nothing, no row
// in the list, no Package on an item's row.
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import {
  filterPackages,
  packageFilterChoices,
  type PackageComments,
  type PackageDetail,
  type PackageSummary,
  type WorkItemDetail,
  type WorkItemHistory,
  type WorkItemRow,
} from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoSignaturePng } from "../src/demo/demo-signature.ts";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { lockedWhileWaitingOnPackage } from "./support/lock-order.ts";
import { addSendBackType } from "./support/send-back.ts";
import {
  all,
  bilingual,
  buildTower,
  detail,
  draft,
  inInternalReview,
  memberOnProject,
  ok,
  only,
  projectMember,
  submitted,
  take,
  type Company,
  type Tower,
} from "./support/tower.ts";

const api = await createTestApi({ files: true });
const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await api.close();
  await migrator.destroy();
});

let at: Tower;
let c1: Company;
let k1: Company;
let c2Engineer: Caller; // Another Contractor's engineer.
let owner: Caller; // The Owner's representative.

const name = (text: string) => ({ en: text, ar: `${text} ع` });

// A submittal Type the Consultant may Send Back (RP-638).
const SEND_BACK_TYPE = "PKGSB";
const sendBackSchema = {
  sections: [
    { key: "material", title: bilingual("Material"), fields: [{ key: "model", type: "text", label: bilingual("Model") }] },
    {
      key: "classification",
      title: bilingual("Classification"),
      fields: [
        { key: "trade", type: "trade", label: bilingual("Trade") },
        { key: "location", type: "location", label: bilingual("Location") },
        { key: "scopes", type: "scopes", label: bilingual("Scopes") },
      ],
    },
  ],
};

/** `by` creates a Package named `text` on the Tower: its id and number. */
async function createPackage(by: Caller, text: string, projectId = at.projectId): Promise<{ id: string; number: string }> {
  return (await ok(by.post(`/v1/projects/${projectId}/packages`, { name: name(text) }), 201)).json();
}

const addItem = (by: Caller, packageId: string, workItemId: string) => by.post(`/v1/packages/${packageId}/items`, { workItemId });
const removeItem = (by: Caller, packageId: string, workItemId: string) => by.request("DELETE", `/v1/packages/${packageId}/items/${workItemId}`);

/** Package `id` as `by` reads it. */
const getPackage = async (by: Caller, id: string): Promise<PackageDetail> => (await ok(by.get(`/v1/packages/${id}`), 200)).json();
/** The Tower's Packages as `by` lists them. */
const listPackages = async (by: Caller): Promise<PackageSummary[]> =>
  (await ok(by.get(`/v1/projects/${at.projectId}/packages`), 200)).json().packages;

/** The rows of the Tower's Submittals List `by` reads, by id. */
async function rows(by: Caller): Promise<Map<string, WorkItemRow>> {
  const list = (await ok(by.get(`/v1/projects/${at.projectId}/work-items?page=1&pageSize=50`), 200)).json();
  return new Map((list.items as WorkItemRow[]).map((r) => [r.id, r]));
}

/** A refused command's status and body. */
const refusal = async (res: ReturnType<Caller["post"]>) => {
  const r = await res;
  return { status: r.statusCode, body: r.json() };
};

beforeAll(async () => {
  await addSendBackType(migrator, SEND_BACK_TYPE, { en: "Package Send Back submittal", ar: "اعتماد حزمة مُرجع" }, sendBackSchema);
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "TWP");
  const other = async (role: "contractor" | "owner", positions: string[]) => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, at.projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return projectMember(api, company, participantId, positions);
  };
  c2Engineer = await other("contractor", ["engineer"]);
  owner = await other("owner", ["representative"]);
});

describe("building an Open Package", () => {
  it("is created by a Member of a Participant with the next PKG number, and read by its Participant's Members", async () => {
    const created = await createPackage(at.c1Engineer, "Bathrooms – Tower 1");
    expect(created.number).toBe("PKG-001");
    for (const by of [at.c1Engineer, at.c1Pm]) {
      const p = await getPackage(by, created.id);
      expect(p).toMatchObject({
        id: created.id,
        projectId: at.projectId,
        number: "PKG-001",
        name: name("Bathrooms – Tower 1"),
        status: "open",
        items: [],
      });
      expect(p.owner.companyName.en).toBeTruthy();
      expect((await listPackages(by)).map((x) => x.id)).toContain(created.id);
    }
  });

  it("takes its Participant's submittals the Member sees: their own Draft, one at internal review, one Submitted", async () => {
    const pkg = await createPackage(at.c1Pm, "Lighting");
    const ownDraft = await draft(at, at.c1Pm, "PM's own Draft");
    const inReview = await inInternalReview(at, at.c1Engineer, "At internal review");
    const sent = await submitted(at, at.c1Engineer, at.c1Pm, "Already Submitted");
    for (const id of [ownDraft, inReview, sent]) await ok(addItem(at.c1Pm, pkg.id, id));
    // Adding it again changes nothing.
    await ok(addItem(at.c1Pm, pkg.id, sent));
    const p = await getPackage(at.c1Pm, pkg.id);
    expect(p.items.map((i) => i.id).sort()).toEqual([ownDraft, inReview, sent].sort());
    expect(p.items.find((i) => i.id === ownDraft)).toMatchObject({ id: ownDraft, documentNumber: null, title: "PM's own Draft" });
    // The work item query gives each its Package, by number and name.
    const mine = await rows(at.c1Pm);
    for (const id of [ownDraft, inReview, sent]) expect(mine.get(id)?.package).toEqual({ id: pkg.id, number: pkg.number, name: name("Lighting") });
  });
});

describe("scenario RP-588-1: C1's Open Package of two Drafts is C1's alone", () => {
  let pkg = { id: "", number: "" };
  let drafts: string[] = [];
  // Another Open Package of C1's, of an item at C1's internal review. (A Package with a Submitted
  // item is In Progress since RP-638, and seen by those who see the item since RP-641: RP-588-2.)
  let other = "";

  beforeAll(async () => {
    pkg = await createPackage(at.c1Engineer, "Bathrooms – Tower 2");
    drafts = [await draft(at, at.c1Engineer, "Tiles"), await draft(at, at.c1Engineer, "Sanitary ware")];
    for (const id of drafts) await ok(addItem(at.c1Engineer, pkg.id, id));
    other = (await createPackage(at.c1Pm, "Cables")).id;
    await ok(addItem(at.c1Pm, other, await inInternalReview(at, at.c1Engineer, "Cables at review")));
  });

  it("C1's Members read it with its two Drafts", async () => {
    for (const by of [at.c1Engineer, at.c1Pm]) {
      expect((await getPackage(by, pkg.id)).items.map((i) => i.id).sort()).toEqual([...drafts].sort());
      expect((await listPackages(by)).map((p) => p.id)).toEqual(expect.arrayContaining([pkg.id, other]));
    }
  });

  it("K1, C2 and the Owner read nothing of it: a 404 that names nothing, no row, no name, no Package on an item's row", async () => {
    for (const [who, by] of [
      ["K1's manager", at.k1Manager],
      ["K1's Authorized Person", k1.caller],
      ["C2's engineer", c2Engineer],
      ["the Owner", owner],
    ] as const) {
      for (const id of [pkg.id, other]) await expectHidden(by.get(`/v1/packages/${id}`), `${who} reads ${id}`);
      const listed = await by.get(`/v1/projects/${at.projectId}/packages`);
      if (listed.statusCode === 200) {
        // The In Progress Packages of earlier tests may be listed (RP-588-2); never these.
        const ids = (listed.json().packages as PackageSummary[]).map((p) => p.id);
        expect(ids, who).not.toContain(pkg.id);
        expect(ids, who).not.toContain(other);
        for (const text of ["Bathrooms – Tower 2", "Cables"]) expect(listed.body, who).not.toContain(text);
        // The List's rows hold neither, nor their names.
        const seen = await rows(by);
        for (const r of seen.values()) expect([pkg.id, other], who).not.toContain(r.package?.id);
        const body = (await by.get(`/v1/projects/${at.projectId}/work-items?page=1&pageSize=50`)).body;
        for (const text of ["Bathrooms – Tower 2", "Cables"]) expect(body, who).not.toContain(text);
      } else {
        // K1's Authorized Person is not a Project Member: the Project itself is hidden.
        await expectHidden(Promise.resolve(listed), who);
      }
    }
  });

  it("K1, C2 and the Owner can change nothing of it: every command is the same 404", async () => {
    for (const by of [at.k1Manager, k1.caller, c2Engineer, owner]) {
      await expectHidden(by.patch(`/v1/packages/${pkg.id}`, { name: name("Mine now") }));
      await expectHidden(addItem(by, pkg.id, drafts[0]!));
      await expectHidden(removeItem(by, pkg.id, drafts[0]!));
      await expectHidden(by.request("DELETE", `/v1/packages/${pkg.id}`));
    }
    expect((await getPackage(at.c1Engineer, pkg.id)).name).toEqual(name("Bathrooms – Tower 2"));
    expect((await getPackage(at.c1Engineer, pkg.id)).items).toHaveLength(2);
  });
});

describe("what a Package refuses", () => {
  let pkg = { id: "", number: "" };

  beforeAll(async () => {
    pkg = await createPackage(at.c1Pm, "Refusals");
  });

  const notOffered = { status: 422, body: { error: "item_not_offered" } };

  it("an item of another Participant, also one the Member sees: one answer, as for an item they don't see or a made-up id", async () => {
    // C2's own items: C1 doesn't see them (V3).
    const c2Draft = await draft(at, c2Engineer, "C2's Draft");
    expect(await refusal(addItem(at.c1Pm, pkg.id, c2Draft))).toEqual(notOffered);
    expect(await refusal(addItem(at.c1Pm, pkg.id, randomUUID()))).toEqual(notOffered);
    // K1's own Package can't take C1's Submitted item, though K1 sees it.
    const sent = await submitted(at, at.c1Engineer, at.c1Pm, "Seen by K1");
    const k1Package = await createPackage(at.k1Manager, "K1's own");
    expect(await refusal(addItem(at.k1Manager, k1Package.id, sent))).toEqual(notOffered);
    expect((await getPackage(at.k1Manager, k1Package.id)).items).toEqual([]);
  });

  it("an item the Member doesn't see: C1's engineer's Draft is not C2's to add", async () => {
    const c1Draft = await draft(at, at.c1Engineer, "Not C2's");
    const c2Package = await createPackage(c2Engineer, "C2's own");
    expect(await refusal(addItem(c2Engineer, c2Package.id, c1Draft))).toEqual(notOffered);
  });

  it("an item that isn't a submittal", async () => {
    const res = await ok(
      at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
        type: "WIR",
        title: "Slab rebar",
        answers: { description: "Slab rebar, Level 2", trade: at.electrical, location: at.buildingA },
      }),
      201,
    );
    expect(await refusal(addItem(at.c1Engineer, pkg.id, res.json().id))).toEqual(notOffered);
  });

  it("an item already in another Package: a submittal is in at most one", async () => {
    const sent = await submitted(at, at.c1Engineer, at.c1Pm, "In one Package");
    await ok(addItem(at.c1Pm, pkg.id, sent));
    const second = await createPackage(at.c1Pm, "Second");
    expect(await refusal(addItem(at.c1Pm, second.id, sent))).toEqual({ status: 409, body: { error: "in_another_package" } });
    expect((await getPackage(at.c1Pm, second.id)).items).toEqual([]);
  });

  it("a Draft the Member may not edit: C1's PM sees the engineer's Draft but doesn't hold it", async () => {
    const engineersDraft = await draft(at, at.c1Engineer, "The engineer's Draft");
    expect(await refusal(addItem(at.c1Pm, pkg.id, engineersDraft))).toEqual({ status: 409, body: { error: "not_editable" } });
    // The engineer, who holds it, may.
    await ok(addItem(at.c1Engineer, pkg.id, engineersDraft));
  });

  it("a name that isn't English and Arabic", async () => {
    const res = await at.c1Pm.post(`/v1/projects/${at.projectId}/packages`, { name: { en: "Only English" } });
    expect(res.statusCode).toBe(400);
    expect((await at.c1Pm.patch(`/v1/packages/${pkg.id}`, { name: { en: " ", ar: " " } })).statusCode).toBe(400);
  });

  it("a Project the Member isn't on, and a made-up Package: the plain 404", async () => {
    await expectHidden(k1.caller.post(`/v1/projects/${at.projectId}/packages`, { name: name("Not a Member") }));
    await expectHidden(at.c1Pm.post(`/v1/projects/${randomUUID()}/packages`, { name: name("Nowhere") }));
    await expectHidden(at.c1Pm.get(`/v1/packages/${randomUUID()}`));
    await expectHidden(at.c1Pm.get("/v1/packages/not-an-id"));
    await expectHidden(addItem(at.c1Pm, randomUUID(), randomUUID()));
  });
});

describe("reshaping an Open Package", () => {
  it("removes items, renames it, and deletes it: its Drafts stay, without a Package, and nobody sees it again", async () => {
    const pkg = await createPackage(at.c1Engineer, "Reshaped");
    const [kept, removed] = [await draft(at, at.c1Engineer, "Kept"), await draft(at, at.c1Engineer, "Removed")];
    for (const id of [kept, removed]) await ok(addItem(at.c1Engineer, pkg.id, id));

    await ok(removeItem(at.c1Engineer, pkg.id, removed));
    expect((await getPackage(at.c1Engineer, pkg.id)).items.map((i) => i.id)).toEqual([kept]);
    expect((await rows(at.c1Engineer)).get(removed)?.package).toBeUndefined();
    // Removing it again, or an item that never was in it, is refused.
    expect(await refusal(removeItem(at.c1Engineer, pkg.id, removed))).toEqual({ status: 422, body: { error: "item_not_in_package" } });
    // The removed Draft may join another Package now.
    const other = await createPackage(at.c1Engineer, "Another");
    await ok(addItem(at.c1Engineer, other.id, removed));

    await ok(at.c1Pm.patch(`/v1/packages/${pkg.id}`, { name: name("Renamed") }));
    expect((await getPackage(at.c1Engineer, pkg.id)).name).toEqual(name("Renamed"));
    expect((await rows(at.c1Engineer)).get(kept)?.package?.name).toEqual(name("Renamed"));

    expect((await getPackage(at.c1Engineer, pkg.id)).actions).toEqual({ rename: true, addItems: true, removeItems: true, delete: true, submit: false });
    await ok(at.c1Pm.request("DELETE", `/v1/packages/${pkg.id}`));
    for (const by of [at.c1Engineer, at.c1Pm]) {
      await expectHidden(by.get(`/v1/packages/${pkg.id}`));
      expect((await listPackages(by)).map((p) => p.id)).not.toContain(pkg.id);
    }
    // Its Draft is as it was, without a Package, and may join another.
    expect((await rows(at.c1Engineer)).get(kept)).toMatchObject({ title: "Kept", documentNumber: null });
    expect((await rows(at.c1Engineer)).get(kept)?.package).toBeUndefined();
    await ok(addItem(at.c1Engineer, other.id, kept));
    await expectHidden(addItem(at.c1Engineer, pkg.id, kept));
  });
});

/** `by` Submits Package `id`, confirmed in its pop-up (ADR 0017), with key `key`. */
const submitPackage = (by: Caller, id: string, key: string = randomUUID()) =>
  by.post(`/v1/packages/${id}/submit`, { confirmed: true, idempotencyKey: key });

/** A MAR at C1's internal review, picked up by C1's PM: ready for them to Submit. */
async function readyForPm(title: string, trade = at.electrical): Promise<string> {
  const id = await inInternalReview(at, at.c1Engineer, title, { trade });
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  return id;
}

/** What K1's manager reads of item `id` that a Submit decides: where it is, its number, its history's event types. */
async function asK1Reads(id: string) {
  const d = await detail(at.k1Manager, id);
  const history = (await ok(at.k1Manager.get(`/v1/work-items/${id}/history`), 200)).json() as WorkItemHistory;
  return { step: d.step.key, numbered: d.documentNumber !== null, events: history.events.map((e) => e.type) };
}

describe("Submit Package", () => {
  it("takes each not-yet-Submitted item's own Submit in one go, exactly as a single Submit", async () => {
    const pkg = await createPackage(at.c1Pm, "Bathrooms – Tower 3");
    const items = [await readyForPm("Tiles T3"), await readyForPm("Sanitary ware T3")];
    const earlier = await submitted(at, at.c1Engineer, at.c1Pm, "Already sent T3");
    for (const id of [...items, earlier]) await ok(addItem(at.c1Pm, pkg.id, id));
    expect((await getPackage(at.c1Pm, pkg.id)).actions.submit).toBe(true);
    // The engineer holds none of them: nothing for them to Submit.
    expect((await getPackage(at.c1Engineer, pkg.id)).actions.submit).toBe(false);
    // A control item, Submitted alone.
    const single = await submitted(at, at.c1Engineer, at.c1Pm, "Single T3");

    const res = await ok(submitPackage(at.c1Pm, pkg.id), 200);
    const answer = res.json() as { submitted: { id: string; documentNumber: string | null }[] };
    expect(answer.submitted.map((i) => i.id).sort()).toEqual([...items].sort());
    for (const i of answer.submitted) expect(i.documentNumber).toBe((await detail(at.c1Pm, i.id)).documentNumber);
    const control = await asK1Reads(single);
    for (const id of items) {
      expect((await detail(at.c1Pm, id)).documentNumber).toMatch(/\S/);
      expect(await asK1Reads(id)).toEqual(control);
    }
    // Nothing left to Submit: no longer offered, and refused.
    const after = await getPackage(at.c1Pm, pkg.id);
    expect(after.status).toBe("in_progress");
    expect(after.actions.submit).toBe(false);
    expect(await refusal(submitPackage(at.c1Pm, pkg.id))).toEqual({ status: 409, body: { error: "nothing_to_submit" } });
  });

  it("the Package's answer says who owns it and which items are still to Submit, so no page works it out again", async () => {
    const pkg = await createPackage(at.c1Pm, "Says what is left");
    const left = await readyForPm("Left to Submit");
    const sent = await submitted(at, at.c1Engineer, at.c1Pm, "Sent alone");
    for (const id of [left, sent]) await ok(addItem(at.c1Pm, pkg.id, id));
    const owner = await getPackage(at.c1Pm, pkg.id);
    expect(owner.owned).toBe(true);
    expect(new Map(owner.items.map((i) => [i.id, i.toSubmit]))).toEqual(
      new Map([
        [left, true],
        [sent, false],
      ]),
    );
    // Each item is its List row, and the table's outcomes, Trades and Locations come with it.
    expect(owner.items.find((i) => i.id === sent)).toMatchObject({ type: { code: expect.any(String) }, stage: { key: expect.any(String) } });
    expect(owner.filters.outcomes.length).toBeGreaterThan(0);
    expect(owner.filters.trades.map((t) => t.id)).toContain(at.electrical);
    // K1 reads it as a viewer: not theirs, nothing to Submit.
    const k1Reads = await getPackage(at.k1Manager, pkg.id);
    expect(k1Reads.owned).toBe(false);
    expect(k1Reads.items.map((i) => [i.id, i.toSubmit])).toEqual([[sent, false]]);
  });

  it("is all or nothing: one item not ready and nothing is Submitted; the answer lists the ones not ready, and why", async () => {
    // A second PM: C1's review is a Step Pool of two, picked up rather than held by its only Member.
    await projectMember(api, c1, at.c1ParticipantId, ["project_manager"]);
    const pkg = await createPackage(at.c1Pm, "Partly ready");
    const ready = await readyForPm("Ready one");
    const pooled = await inInternalReview(at, at.c1Engineer, "Waiting in the pool");
    for (const id of [ready, pooled]) await ok(addItem(at.c1Pm, pkg.id, id));
    // The engineer's Draft: C1's PM can't Submit it from where it is.
    const engineersDraft = await draft(at, at.c1Engineer, "Still a Draft");
    await ok(addItem(at.c1Engineer, pkg.id, engineersDraft));
    expect((await getPackage(at.c1Pm, pkg.id)).actions.submit).toBe(false);

    const refused = await refusal(submitPackage(at.c1Pm, pkg.id));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("package_not_ready");
    expect(refused.body.othersNotReady, JSON.stringify(refused.body)).toBe(false);
    expect(refused.body.notReady, JSON.stringify(refused.body)).toHaveLength(2);
    expect(new Map(refused.body.notReady.map((i: { id: string; reason: string }) => [i.id, i.reason]))).toEqual(
      new Map([
        [pooled, "pick_up_first"],
        [engineersDraft, "cannot_submit"],
      ]),
    );
    expect(refused.body.notReady.find((i: { id: string }) => i.id === pooled)).toMatchObject({ title: "Waiting in the pool" });
    // Nothing was taken: the ready one is where it was, and the Package still Open.
    expect(await detail(at.c1Pm, ready)).toMatchObject({ step: { key: "internal_review" } });
    await expectHidden(at.k1Manager.get(`/v1/work-items/${ready}`));
    expect((await getPackage(at.c1Pm, pkg.id)).status).toBe("open");

    // Once each waits for the PM, Submit Package is offered and takes all three.
    await ok(at.c1Pm.post(`/v1/work-items/${pooled}/pick-up`));
    await take(at.c1Engineer, engineersDraft, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${engineersDraft}/pick-up`));
    expect((await getPackage(at.c1Pm, pkg.id)).actions.submit).toBe(true);
    expect((await ok(submitPackage(at.c1Pm, pkg.id), 200)).json().submitted).toHaveLength(3);
  });

  /** `by`'s Package of two items they picked up; Submit Package is refused, naming `reason` on each, and nothing is Submitted. */
  async function refusedForEach(by: Caller, reason: "no_signature" | "no_stamp", text: string, beforeSubmit: () => Promise<void> = async () => {}) {
    const pkg = await createPackage(by, text);
    const items: string[] = [];
    for (const title of [`${text} one`, `${text} two`]) {
      const id = await inInternalReview(at, at.c1Engineer, title);
      await ok(by.post(`/v1/work-items/${id}/pick-up`));
      await ok(addItem(by, pkg.id, id));
      items.push(id);
    }
    await beforeSubmit();
    const refused = await refusal(submitPackage(by, pkg.id));
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.error).toBe("package_not_ready");
    expect(refused.body.othersNotReady).toBe(false);
    expect(new Map(refused.body.notReady.map((i: { id: string; reason: string }) => [i.id, i.reason]))).toEqual(new Map(items.map((id) => [id, reason])));
    for (const id of items) expect(await detail(by, id)).toMatchObject({ step: { key: "internal_review" } });
    expect((await getPackage(by, pkg.id)).status).toBe("open");
  }

  // ADR 0017: a Member needs a saved Signature before taking any Transition; each item's Submit refuses without one.
  it("a PM without a Signature is refused, every item naming no_signature, and nothing is Submitted", async () => {
    const unsigned = await memberOnProject(api, c1, at.c1ParticipantId, ["project_manager"]);
    await api.withoutSignature(unsigned.id);
    await refusedForEach(unsigned.caller, "no_signature", "Unsigned PM");
  });

  // RP-617: while the Company has no Stamp none of its Members takes a Transition.
  it("a PM whose Company has no Stamp is refused, every item naming no_stamp, and nothing is Submitted", async () => {
    try {
      // The items are made while the Stamp is there; Submit Package is taken once it is gone.
      await refusedForEach(at.c1Pm, "no_stamp", "Unstamped Company", () => api.withoutStamp(c1.company.companyId));
    } finally {
      const stamp = demoSignaturePng(21).toString("base64");
      await ok(c1.caller.request("PUT", `/v1/companies/${c1.company.companyId}/stamp`, { contentType: "image/png", data: stamp }), 200);
    }
  });

  it("the same request again applies nothing and answers the same; nobody outside C1 may Submit it", async () => {
    const pkg = await createPackage(at.c1Pm, "Twice");
    const id = await readyForPm("Sent once");
    await ok(addItem(at.c1Pm, pkg.id, id));
    for (const by of [at.k1Manager, c2Engineer, owner]) await expectHidden(submitPackage(by, pkg.id));
    // Unconfirmed, nothing moves.
    const unconfirmed = await at.c1Pm.post(`/v1/packages/${pkg.id}/submit`, { idempotencyKey: randomUUID() });
    expect({ status: unconfirmed.statusCode, body: unconfirmed.json() }).toEqual({ status: 422, body: { error: "not_confirmed" } });
    const key = randomUUID();
    const first = (await ok(submitPackage(at.c1Pm, pkg.id, key), 200)).json();
    expect(first.submitted.map((i: { id: string }) => i.id)).toEqual([id]);
    expect((await ok(submitPackage(at.c1Pm, pkg.id, key), 200)).json()).toEqual(first);
    const history = (await ok(at.k1Manager.get(`/v1/work-items/${id}/history`), 200)).json() as WorkItemHistory;
    expect(history.events.filter((e) => e.type === "transition")).toHaveLength(1);
  });
});

// The lock order (data-model.md "Lock order"): a single Transition locks its item, then (the
// status trigger) its Package; Submit Package locks all its items first, by id, then the Package.
describe("Submit Package locks all its items before the Package", () => {
  it("while it waits on the Package, it already holds every item still to Submit", async () => {
    const pkg = await createPackage(at.c1Pm, "Lock order");
    const items = [await readyForPm("Locked one"), await readyForPm("Locked two"), await readyForPm("Locked three")];
    for (const id of items) await ok(addItem(at.c1Pm, pkg.id, id));
    const { held, result } = await lockedWhileWaitingOnPackage(pkg.id, items, () => submitPackage(at.c1Pm, pkg.id));
    expect(held).toEqual(Object.fromEntries(items.map((id) => [id, true])));
    expect(result.statusCode, result.body).toBe(200);
  });
});

describe("an In Progress Package", () => {
  it("is In Progress once any item in it is Submitted, alone too; then items are added, never removed, and it is never deleted", async () => {
    const pkg = await createPackage(at.c1Pm, "Grows");
    const first = await readyForPm("First in");
    const other = await readyForPm("Second in");
    for (const id of [first, other]) await ok(addItem(at.c1Pm, pkg.id, id));
    // A single Submit of one of its items, not Submit Package.
    await take(at.c1Pm, first, "submit");
    const p = await getPackage(at.c1Pm, pkg.id);
    expect(p.status).toBe("in_progress");
    expect(p.actions).toEqual({ rename: true, addItems: true, removeItems: false, delete: false, submit: true });

    const notOpen = { status: 409, body: { error: "package_not_open" } };
    for (const id of [first, other]) expect(await refusal(removeItem(at.c1Pm, pkg.id, id))).toEqual(notOpen);
    expect(await refusal(at.c1Pm.request("DELETE", `/v1/packages/${pkg.id}`))).toEqual(notOpen);
    // A forgotten item joins it, and goes with the rest.
    const late = await readyForPm("Forgotten one");
    await ok(addItem(at.c1Pm, pkg.id, late));
    const sent = (await ok(submitPackage(at.c1Pm, pkg.id), 200)).json().submitted.map((i: { id: string }) => i.id);
    expect(sent.sort()).toEqual([other, late].sort());
    await ok(at.c1Pm.patch(`/v1/packages/${pkg.id}`, { name: name("Grown") }));
    expect(await getPackage(at.c1Pm, pkg.id)).toMatchObject({ name: name("Grown"), status: "in_progress" });
    expect((await getPackage(at.c1Pm, pkg.id)).items.map((i) => i.id).sort()).toEqual([first, other, late].sort());
  });

  it("an already-Submitted item added to an Open Package makes it In Progress", async () => {
    const pkg = await createPackage(at.c1Pm, "Starts with a sent one");
    const d = await draft(at, at.c1Pm, "A Draft of the PM's");
    await ok(addItem(at.c1Pm, pkg.id, d));
    expect((await getPackage(at.c1Pm, pkg.id)).status).toBe("open");
    await ok(addItem(at.c1Pm, pkg.id, await submitted(at, at.c1Engineer, at.c1Pm, "Sent before")));
    expect((await getPackage(at.c1Pm, pkg.id)).status).toBe("in_progress");
    expect(await refusal(removeItem(at.c1Pm, pkg.id, d))).toEqual({ status: 409, body: { error: "package_not_open" } });
  });

  it("a submittal Sent Back comes back alone, and is re-Submitted alone; the others stay where they are", async () => {
    const pkg = await createPackage(at.c1Pm, "Pumps");
    const items: string[] = [];
    for (const model of ["P1", "P2"]) {
      const res = await ok(
        at.c1Engineer.post(`/v1/projects/${at.projectId}/work-items`, {
          type: SEND_BACK_TYPE,
          title: `Pump ${model}`,
          answers: { model, trade: at.electrical, location: at.buildingA },
        }),
        201,
      );
      const id = res.json().id as string;
      await take(at.c1Engineer, id, "send_for_review");
      await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
      await ok(addItem(at.c1Pm, pkg.id, id));
      items.push(id);
    }
    await ok(submitPackage(at.c1Pm, pkg.id), 200);
    const [back, stays] = items as [string, string];
    await ok(at.k1Manager.post(`/v1/work-items/${back}/pick-up`));
    await take(at.k1Manager, back, "send_back");

    expect(await detail(at.c1Pm, back)).toMatchObject({ step: { key: "internal_review" } });
    const where = (await detail(at.k1Manager, stays)).step.key;
    expect(where).not.toBe("internal_review");
    // Still In Progress, with both; Submit Package has nothing to take (the Sent Back one was Submitted).
    const p = await getPackage(at.c1Pm, pkg.id);
    expect(p).toMatchObject({ status: "in_progress", actions: { submit: false, removeItems: false } });
    expect(p.items.map((i) => i.id).sort()).toEqual([...items].sort());
    // It is re-Submitted alone.
    await ok(at.c1Pm.post(`/v1/work-items/${back}/pick-up`));
    await take(at.c1Pm, back, "submit");
    expect((await detail(at.k1Manager, back)).step.key).toBe(where);
    expect((await detail(at.k1Manager, stays)).step.key).toBe(where);
  });
});

describe("an item still to Submit that the Member doesn't see", () => {
  it("stops their Submit Package without naming it", async () => {
    const narrowedPm = await projectMember(api, c1, at.c1ParticipantId, ["project_manager"], { trade: only(at.mechanical) });
    const pkg = await createPackage(at.c1Pm, "Mixed trades");
    const electrical = await readyForPm("Electrical, unseen by the narrowed PM");
    const mechanical = await inInternalReview(at, at.c1Engineer, "Mechanical one", { trade: at.mechanical });
    await ok(narrowedPm.post(`/v1/work-items/${mechanical}/pick-up`));
    for (const id of [electrical, mechanical]) await ok(addItem(at.c1Pm, pkg.id, id));

    const p = await getPackage(narrowedPm, pkg.id);
    expect(p.items.map((i) => i.id)).toEqual([mechanical]);
    expect(p.actions.submit).toBe(false);
    const res = await submitPackage(narrowedPm, pkg.id);
    expect({ status: res.statusCode, body: res.json() }).toEqual({
      status: 409,
      body: { error: "package_not_ready", notReady: [], othersNotReady: true },
    });
    expect(res.body).not.toContain(electrical);
    // Once C1's PM has Submitted the Electrical one, only theirs is left.
    await take(at.c1Pm, electrical, "submit");
    expect((await getPackage(narrowedPm, pkg.id)).actions.submit).toBe(true);
    expect((await ok(submitPackage(narrowedPm, pkg.id), 200)).json().submitted.map((i: { id: string }) => i.id)).toEqual([mechanical]);
  });
});

describe("numbering", () => {
  it("gives each Package the next number of its Participant on the Project, never reused, and another Company's count stays its own", async () => {
    const seq = (number: string) => Number(number.slice("PKG-".length));
    const first = await createPackage(at.c1Pm, "Numbered");
    expect(first.number).toMatch(/^PKG-\d{3}$/);
    const second = await createPackage(at.c1Engineer, "Numbered next");
    expect(seq(second.number)).toBe(seq(first.number) + 1);
    // A deleted Package keeps its number: the next is the one after.
    await ok(at.c1Pm.request("DELETE", `/v1/packages/${second.id}`));
    expect(seq((await createPackage(at.c1Pm, "After a deletion")).number)).toBe(seq(first.number) + 2);
    // C1 has made several; C2's numbers count C2's Packages only, so they never tell how many C1 has (RP-588-1: no count).
    expect(seq(first.number)).toBeGreaterThan(5);
    const c2Numbers = (await listPackages(c2Engineer)).map((p) => p.number);
    expect(c2Numbers).toEqual(["PKG-001"]);
    expect((await createPackage(c2Engineer, "C2's next")).number).toBe("PKG-002");
  });
});

describe("on a Closed Project", () => {
  it("refuses every change: create, rename, add, remove, delete", async () => {
    const closing = await buildTower(api, { c1, k1 }, "TWC");
    const pkg = await createPackage(closing.c1Engineer, "Before closing", closing.projectId);
    const [inIt, notYet] = [await draft(closing, closing.c1Engineer, "In it"), await draft(closing, closing.c1Engineer, "Not yet")];
    await ok(addItem(closing.c1Engineer, pkg.id, inIt));
    await sql`update project set status = 'closed', closed_at = now() where id = ${closing.projectId}::uuid`.execute(migrator);

    const closed = { status: 409, body: { error: "project_closed" } };
    expect(await refusal(closing.c1Engineer.post(`/v1/projects/${closing.projectId}/packages`, { name: name("After closing") }))).toEqual(closed);
    expect(await refusal(closing.c1Engineer.patch(`/v1/packages/${pkg.id}`, { name: name("Renamed") }))).toEqual(closed);
    expect(await refusal(addItem(closing.c1Engineer, pkg.id, notYet))).toEqual(closed);
    expect(await refusal(removeItem(closing.c1Engineer, pkg.id, inIt))).toEqual(closed);
    expect(await refusal(closing.c1Engineer.request("DELETE", `/v1/packages/${pkg.id}`))).toEqual(closed);
    // It is still read, as it was, and offers nothing.
    const p = await getPackage(closing.c1Engineer, pkg.id);
    expect(p).toMatchObject({ name: name("Before closing"), items: [{ id: inIt }] });
    expect(p.actions).toEqual({ rename: false, addItems: false, removeItems: false, delete: false, submit: false });
    expect(await refusal(submitPackage(closing.c1Engineer, pkg.id))).toEqual(closed);
  });
});

describe("RP-641: the Packages board and each viewer's counts (scenarios RP-588-2, RP-588-3)", () => {
  let pkg = { id: "", number: "" };
  let k1Electrical: Caller; // A K1 engineer who sees Electrical only.
  let c1Name = { en: "", ar: "" };
  let k1Name = { en: "", ar: "" };
  const electricalItems: string[] = [];
  const mechanicalItems: string[] = [];
  const nothingOffered = { rename: false, addItems: false, removeItems: false, delete: false, submit: false };

  /** The Tower's items whose Subject has "Plant room", as `by` reads them in the List, by id. */
  async function listed(by: Caller): Promise<Map<string, WorkItemRow>> {
    const list = (await ok(by.get(`/v1/projects/${at.projectId}/work-items?page=1&pageSize=50&q=${encodeURIComponent("Plant room")}`), 200)).json();
    return new Map((list.items as WorkItemRow[]).map((r) => [r.id, r]));
  }
  const boardEntry = async (by: Caller) => {
    const entries = (await listPackages(by)).filter((p) => p.id === pkg.id);
    expect(entries.length).toBeLessThanOrEqual(1);
    return entries[0];
  };

  beforeAll(async () => {
    const participants = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants as {
      id: string;
      company: { id: string; legalName: { en: string; ar: string } };
    }[];
    const k1Participant = participants.find((p) => p.company.id === k1.company.companyId)!;
    k1Name = k1Participant.company.legalName;
    c1Name = participants.find((p) => p.id === at.c1ParticipantId)!.company.legalName;
    k1Electrical = await projectMember(api, k1, k1Participant.id, ["engineer"], { trade: only(at.electrical) });

    pkg = await createPackage(at.c1Pm, "Plant room – Tower 1");
    for (let i = 1; i <= 6; i++) electricalItems.push(await readyForPm(`Plant room EL ${i}`));
    for (let i = 1; i <= 2; i++) mechanicalItems.push(await readyForPm(`Plant room ME ${i}`, at.mechanical));
    for (const id of [...electricalItems, ...mechanicalItems]) await ok(addItem(at.c1Pm, pkg.id, id));
    expect((await ok(submitPackage(at.c1Pm, pkg.id), 200)).json().submitted).toHaveLength(8);
    // K1's manager codes one of each Trade: an Electrical one A, a Mechanical one C.
    await ok(at.k1Manager.post(`/v1/work-items/${electricalItems[0]}/pick-up`));
    await take(at.k1Manager, electricalItems[0]!, "approve_a");
    await ok(at.k1Manager.post(`/v1/work-items/${mechanicalItems[0]}/pick-up`));
    await take(at.k1Manager, mechanicalItems[0]!, "revise_c", { remarks: "Resubmit with the pump curves" });
  });

  it("RP-588-2: K1's PM (Visibility all) reads 8; its engineer narrowed to Electrical reads 6 and the status, never the Mechanical items", async () => {
    // The Trades of the items each reads (RP-953), in the Project's order of Trades.
    const projectTrades = (await getPackage(at.c1Pm, pkg.id)).filters.trades;
    const tradesOf = (...ids: string[]) => projectTrades.filter((t) => ids.includes(t.id));
    const summary = (counts: PackageSummary["counts"], trades = tradesOf(at.electrical, at.mechanical)): PackageSummary => ({
      id: pkg.id,
      projectId: at.projectId,
      number: pkg.number,
      name: name("Plant room – Tower 1"),
      status: "in_progress",
      // The owner by its Company's name, for every viewer (V14).
      owner: { participantId: at.c1ParticipantId, companyName: c1Name },
      trades,
      counts,
    });
    const all = summary({ total: 8, open: 6, codes: { A: 1, C: 1 } });
    for (const by of [at.c1Pm, at.k1Manager, owner]) {
      expect(await boardEntry(by)).toEqual(all);
      const p = await getPackage(by, pkg.id);
      expect(p).toMatchObject(all);
      expect(p.items).toHaveLength(8);
    }

    const narrowed = summary({ total: 6, open: 5, codes: { A: 1 } }, tradesOf(at.electrical));
    expect(await boardEntry(k1Electrical)).toEqual(narrowed);
    const p = await getPackage(k1Electrical, pkg.id);
    expect(p).toMatchObject(narrowed);
    expect(p.items.map((i) => i.id).sort()).toEqual([...electricalItems].sort());
    for (const i of p.items) expect(i.trade.id).toBe(at.electrical);
    // Nothing of the Mechanical items: no id, no Subject, no number, no total of 8.
    const mechanicalNumbers = await Promise.all(mechanicalItems.map(async (id) => (await detail(at.k1Manager, id)).documentNumber!));
    const bodies = [(await k1Electrical.get(`/v1/projects/${at.projectId}/packages`)).body, (await k1Electrical.get(`/v1/packages/${pkg.id}`)).body];
    for (const body of bodies) {
      for (const text of [...mechanicalItems, ...mechanicalNumbers, "Plant room ME", '"total":8']) expect(body).not.toContain(text);
    }
    // Each Electrical item's row names its Package for them too.
    const rowsSeen = await listed(k1Electrical);
    for (const id of electricalItems) expect(rowsSeen.get(id)?.package).toEqual({ id: pkg.id, number: pkg.number, name: name("Plant room – Tower 1") });
  });

  it("RP-953-1: an engineer narrowed to Electrical gets no Mechanical-only Trade choice, and no Package or owning Company they can't see", async () => {
    // A Mechanical-only Package of C1, Submitted: K1's manager sees it, the Electrical engineer nothing of it.
    const mechanicalOnly = await createPackage(at.c1Pm, "Chillers – Tower 1");
    await ok(addItem(at.c1Pm, mechanicalOnly.id, await readyForPm("Chillers ME 1", at.mechanical)));
    await ok(submitPackage(at.c1Pm, mechanicalOnly.id), 200);
    // C2's Open Package: C2's alone (RP-588-1), so C2 is no owning Company K1 may filter by.
    const c2Open = await createPackage(c2Engineer, "C2's chillers");

    const managers = await listPackages(at.k1Manager);
    expect(managers.map((p) => p.id)).toContain(mechanicalOnly.id);
    expect(packageFilterChoices(managers, "en").trades.map((t) => t.id)).toContain(at.mechanical);

    const listed = await listPackages(k1Electrical);
    const ids = listed.map((p) => p.id);
    expect(ids).toContain(pkg.id);
    expect(ids).not.toContain(mechanicalOnly.id);
    expect(ids).not.toContain(c2Open.id);
    // Each Package's Trades are those of the items the engineer sees: Electrical only.
    for (const p of listed) expect(p.trades.map((t) => t.id)).toEqual([at.electrical]);
    const choices = packageFilterChoices(listed, "en");
    expect(choices.trades.map((t) => t.id)).toEqual([at.electrical]);
    expect(choices.companies).toEqual([{ participantId: at.c1ParticipantId, companyName: c1Name }]);
    const body = (await k1Electrical.get(`/v1/projects/${at.projectId}/packages`)).body;
    for (const text of [at.mechanical, mechanicalOnly.id, "Chillers", "C2's"]) expect(body).not.toContain(text);
    // Filtering by Mechanical leaves them nothing; their search finds the Package by number and by either name.
    expect(filterPackages(listed, { trade: [at.mechanical], company: [] })).toEqual([]);
    for (const q of [pkg.number, "plant room", name("Plant room – Tower 1").ar]) {
      expect(filterPackages(listed, { q, trade: [], company: [] }).map((p) => p.id)).toContain(pkg.id);
    }
  });

  it("lists each item the viewer sees with its Document Number, Subject, Trade, 'With' whom and Review Code, as the List gives them", async () => {
    for (const by of [at.c1Pm, at.k1Manager, k1Electrical]) {
      const rowsSeen = await listed(by);
      for (const item of (await getPackage(by, pkg.id)).items) {
        const r = rowsSeen.get(item.id)!;
        expect(item).toEqual({ ...r, bulkTransitions: expect.any(Array), toSubmit: expect.any(Boolean) });
      }
    }
    const items = new Map((await getPackage(at.c1Pm, pkg.id)).items.map((i) => [i.id, i]));
    expect(items.get(electricalItems[0]!)).toMatchObject({ title: "Plant room EL 1", outcome: "A", with: null });
    expect(items.get(mechanicalItems[0]!)).toMatchObject({ outcome: "C", with: null });
    // With K1, by its Company's name only, for C1 (V14).
    expect(items.get(electricalItems[1]!)).toMatchObject({ outcome: null, with: { kind: "company", companyName: k1Name } });
    expect(items.get(electricalItems[1]!)!.documentNumber).toMatch(/\S/);
  });

  it("RP-588-3: C2 reads nothing of it, while K1 and the Owner do; and only C1 may change it", async () => {
    await expectHidden(c2Engineer.get(`/v1/packages/${pkg.id}`));
    expect((await listPackages(c2Engineer)).map((p) => p.id)).not.toContain(pkg.id);
    expect((await c2Engineer.get(`/v1/projects/${at.projectId}/packages`)).body).not.toContain("Plant room");
    expect((await c2Engineer.get(`/v1/projects/${at.projectId}/work-items?page=1&pageSize=50`)).body).not.toContain("Plant room");

    for (const by of [at.k1Manager, k1Electrical, owner]) {
      expect((await getPackage(by, pkg.id)).actions).toEqual(nothingOffered);
      await expectHidden(by.patch(`/v1/packages/${pkg.id}`, { name: name("Mine now") }));
      await expectHidden(addItem(by, pkg.id, electricalItems[1]!));
      await expectHidden(removeItem(by, pkg.id, electricalItems[1]!));
      await expectHidden(by.request("DELETE", `/v1/packages/${pkg.id}`));
      await expectHidden(submitPackage(by, pkg.id));
    }
    const p = await getPackage(at.c1Pm, pkg.id);
    expect(p).toMatchObject({ name: name("Plant room – Tower 1"), actions: { rename: true, addItems: true, removeItems: false, delete: false } });
    expect(p.items).toHaveLength(8);
  });
});

// RP-642: when a Package is Done (spec RP-616 stories 21–23, 26–28). Its status follows
// its submittals by itself: Done once every latest Revision in it has closed at an
// outcome that offers no Revision (Code A, B or D in the Rabaed Defaults); a Code C
// keeps it In Progress until its Revision closes. Revisions and replacements join it
// by themselves; a cancelled or discarded item drops out.

/** K1's manager picks up item `id` and closes it with `transition` (Code A or C). */
async function codeAs(id: string, transition: "approve_a" | "revise_c") {
  await ok(at.k1Manager.post(`/v1/work-items/${id}/pick-up`));
  await take(at.k1Manager, id, transition, transition === "revise_c" ? { remarks: "Resubmit with 110 lm/W luminaires" } : {});
}

/** A Package of C1's PM holding `count` MARs, Submitted with Submit Package: the Package and its items. */
async function submittedPackage(text: string, count: number): Promise<{ id: string; items: string[] }> {
  const pkg = await createPackage(at.c1Pm, text);
  const items: string[] = [];
  for (let i = 1; i <= count; i++) items.push(await readyForPm(`${text} ${i}`));
  for (const id of items) await ok(addItem(at.c1Pm, pkg.id, id));
  await ok(submitPackage(at.c1Pm, pkg.id), 200);
  return { id: pkg.id, items };
}

/** C1's engineer raises a Revision of `id` (after its Code C): its id. */
const revisionOf = async (id: string) =>
  (await ok(at.c1Engineer.post(`/v1/work-items/${id}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id as string;

/** C1 sends Draft `id` for review and Submits it. */
async function submitAlone(id: string) {
  await take(at.c1Engineer, id, "send_for_review");
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
}

const statusOf = async (id: string) => (await getPackage(at.c1Pm, id)).status;

describe("RP-642: a Package is Done once every latest item in it has closed", () => {
  it("stays In Progress while any item is open, and is Done once the last closes at Code A", async () => {
    const pkg = await submittedPackage("Lighting – Tower 1", 2);
    const [first, second] = pkg.items as [string, string];
    await codeAs(first, "approve_a");
    expect(await statusOf(pkg.id)).toBe("in_progress");
    await codeAs(second, "approve_a");
    expect(await statusOf(pkg.id)).toBe("done");
  });
});

describe("RP-642: a Code C keeps the Package In Progress until its Revision closes", () => {
  it("the Revision joins the Package by itself, and the Package is Done once it closes at Code A", async () => {
    const pkg = await submittedPackage("Cables – Tower 1", 2);
    const [passed, revised] = pkg.items as [string, string];
    await codeAs(passed, "approve_a");
    await codeAs(revised, "revise_c");
    // Every item is closed, but a Code C waits for its Revision.
    expect(await statusOf(pkg.id)).toBe("in_progress");

    const revision = await revisionOf(revised);
    // Story 30: the latest Revision of each chain only, the Code C left out once its Revision is raised.
    expect((await getPackage(at.c1Pm, pkg.id)).items.map((i) => i.id).sort()).toEqual([passed, revision].sort());
    await submitAlone(revision);
    expect(await statusOf(pkg.id)).toBe("in_progress");
    await codeAs(revision, "approve_a");
    expect(await statusOf(pkg.id)).toBe("done");
  });
});

// Story 30, as the product owner settled it on 2026-10-19: the counts are of the latest
// Revision of each chain only, as Done reads them, on the board and the Package page.
describe("story 30: a Package counts the latest Revision of each chain", () => {
  it('a Code C and its open Revision count "open 1, total 1", for C1 and for K1; K1 counts the Code C until it sees the Revision', async () => {
    const pkg = await submittedPackage("Switchgear – Tower 1", 1);
    const [revised] = pkg.items as [string];
    await codeAs(revised, "revise_c");
    const counts = async (by: Caller) => ({
      page: (await getPackage(by, pkg.id)).counts,
      board: (await listPackages(by)).find((p) => p.id === pkg.id)!.counts,
    });
    const codedC = { total: 1, open: 0, codes: { C: 1 } };
    expect(await counts(at.c1Pm)).toEqual({ page: codedC, board: codedC });

    const revision = await revisionOf(revised);
    const reopened = { total: 1, open: 1, codes: {} };
    expect(await counts(at.c1Pm)).toEqual({ page: reopened, board: reopened });
    expect((await getPackage(at.c1Pm, pkg.id)).items.map((i) => i.id)).toEqual([revision]);
    // C1's Draft R1 is C1's own: K1 neither counts it nor learns it exists.
    expect(await counts(at.k1Manager)).toEqual({ page: codedC, board: codedC });
    expect((await getPackage(at.k1Manager, pkg.id)).items.map((i) => i.id)).toEqual([revised]);
    await submitAlone(revision);
    expect(await counts(at.k1Manager)).toEqual({ page: reopened, board: reopened });
  });
});

// As the product owner settled it on 2026-10-19: the owner may still add items to a Done
// Package, and it goes back to In Progress until they close.
describe("adding an item to a Done Package", () => {
  it("is allowed, and puts the Package back In Progress until the new item closes", async () => {
    const pkg = await submittedPackage("Lifts – Tower 1", 1);
    await codeAs(pkg.items[0]!, "approve_a");
    expect(await statusOf(pkg.id)).toBe("done");
    expect((await getPackage(at.c1Pm, pkg.id)).actions.addItems).toBe(true);

    const late = await readyForPm("Lifts – Tower 1 late");
    await ok(addItem(at.c1Pm, pkg.id, late));
    expect(await statusOf(pkg.id)).toBe("in_progress");
    await ok(submitPackage(at.c1Pm, pkg.id), 200);
    await codeAs(late, "approve_a");
    expect(await statusOf(pkg.id)).toBe("done");
  });
});

describe("RP-642: a replacement of a Code D item joins its Package", () => {
  it("a Code D counts as closed; its replacement, raised after the Package is Done, puts it back In Progress until it closes", async () => {
    const pkg = await submittedPackage("Pumps – Tower 1", 1);
    const [rejected] = pkg.items as [string];
    await codeAs(rejected, "revise_c");
    // The legacy MAR Workflow ends in A and C only; the outcome is set as a Code D Transition would leave it (replacements.test.ts).
    await sql`update work_item set outcome = 'D' where id = ${rejected}::uuid`.execute(migrator);
    expect(await statusOf(pkg.id)).toBe("done");

    const replacement = (await ok(at.c1Engineer.post(`/v1/work-items/${rejected}/replacements`, { idempotencyKey: randomUUID() }), 201)).json()
      .id as string;
    expect(await statusOf(pkg.id)).toBe("in_progress");
    expect((await getPackage(at.c1Pm, pkg.id)).items.map((i) => i.id).sort()).toEqual([rejected, replacement].sort());
    await submitAlone(replacement);
    await codeAs(replacement, "approve_a");
    expect(await statusOf(pkg.id)).toBe("done");
  });
});

describe("RP-642: a cancelled or discarded item doesn't hold the Package open", () => {
  /** The legacy MAR Workflow has no Cancel; a Workflow that has one leaves the item so (replacements.test.ts). */
  const cancel = (id: string) => sql`update work_item set outcome = 'cancelled', closed_at = now() where id = ${id}::uuid`.execute(migrator);

  it("a cancelled item drops out: the rest closed at Code A make it Done; cancelled alone it is not Done", async () => {
    const pkg = await submittedPackage("Valves – Tower 1", 2);
    const [passed, cancelled] = pkg.items as [string, string];
    await codeAs(passed, "approve_a");
    expect(await statusOf(pkg.id)).toBe("in_progress");
    await cancel(cancelled);
    expect(await statusOf(pkg.id)).toBe("done");

    // Done needs at least one item that counts.
    const alone = await submittedPackage("Only cancelled", 1);
    await cancel(alone.items[0]!);
    expect(await statusOf(alone.id)).toBe("in_progress");
  });

  it("a discarded Draft drops out of the Package's list and its status", async () => {
    const pkg = await submittedPackage("Fans – Tower 1", 1);
    const d = await draft(at, at.c1Pm, "A Draft never sent");
    await ok(addItem(at.c1Pm, pkg.id, d));
    await codeAs(pkg.items[0]!, "approve_a");
    expect(await statusOf(pkg.id)).toBe("in_progress");
    await ok(at.c1Pm.post(`/v1/work-items/${d}/discard-draft`));
    const p = await getPackage(at.c1Pm, pkg.id);
    expect(p).toMatchObject({ status: "done" });
    expect(p.items.map((i) => i.id)).toEqual(pkg.items);
  });

  it("a discarded Draft Revision of a Code C leaves the Code C waiting: still In Progress", async () => {
    const pkg = await submittedPackage("Doors – Tower 1", 1);
    const [revised] = pkg.items as [string];
    await codeAs(revised, "revise_c");
    const revision = await revisionOf(revised);
    await ok(at.c1Engineer.post(`/v1/work-items/${revision}/discard`));
    const p = await getPackage(at.c1Pm, pkg.id);
    expect(p).toMatchObject({ status: "in_progress" });
    expect(p.items.map((i) => i.id)).toEqual([revised]);
  });
});

// RP-647: filter Submittals by Package, and the Comments raised from a Package's
// submittals on its page (spec RP-616 stories 35, 37; visibility.md RP-647-1). On a
// Tower of its own, with a submittal Type whose Workflow has Code B: its rows become
// Comments, raised_from-linked to the item, seen where the item is (RP-434).
describe("RP-647: the packageId filter and the Package's Comments (scenario RP-647-1)", () => {
  const CODE_B_TYPE = "PKGCB";
  let tower: Tower;
  let k1Electrical: Caller; // A K1 engineer who sees Electrical only.
  let c2: Caller; // Another Contractor's engineer, who sees none of the Package's items.
  let pkg = { id: "", number: "" };
  let other = { id: "", number: "" }; // Another Package of C1's.
  let electricalItems: string[] = [];
  let mechanicalItem = "";
  let loose = ""; // A submittal in no Package.

  /** The ids of the Submittals List `by` reads with `query`. */
  const listedIds = async (by: Caller, query: string) => {
    const res = await ok(by.get(`/v1/projects/${tower.projectId}/work-items?page=1&pageSize=50&${query}`), 200);
    return ((res.json().items as WorkItemRow[]).map((r) => r.id)).sort();
  };

  /** A submittal of the Code B Type raised by C1's engineer, at C1's PM's internal review, picked up. */
  async function readyForPmB(title: string, trade: string): Promise<string> {
    const id = (
      await ok(
        tower.c1Engineer.post(`/v1/projects/${tower.projectId}/work-items`, {
          type: CODE_B_TYPE,
          title,
          answers: { model: title, trade, location: tower.buildingA },
        }),
        201,
      )
    ).json().id as string;
    await take(tower.c1Engineer, id, "send_for_review");
    await ok(tower.c1Pm.post(`/v1/work-items/${id}/pick-up`));
    return id;
  }

  /** K1's manager closes Submitted item `id` with Code B, its table of comments `rows`. */
  async function codeB(id: string, rows: string[]) {
    await ok(tower.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.k1Manager, id, "send_to_manager");
    await ok(tower.k1Manager.post(`/v1/work-items/${id}/pick-up`));
    await take(tower.k1Manager, id, "approve_b", { answers: { remarks: "Approved with comments", items_to_create: rows.map((comment) => ({ comment })) } });
  }

  beforeAll(async () => {
    await addSendBackType(migrator, CODE_B_TYPE, { en: "Package Code B submittal", ar: "اعتماد حزمة بملاحظات" }, sendBackSchema, { withApproveB: true });
    tower = await buildTower(api, { c1, k1 }, "TWK");
    const participants = (await c1.caller.get(`/v1/projects/${tower.projectId}/participants`)).json().participants as {
      id: string;
      company: { id: string };
    }[];
    const k1Participant = participants.find((p) => p.company.id === k1.company.companyId)!.id;
    k1Electrical = await projectMember(api, k1, k1Participant, ["engineer"], { trade: only(tower.electrical) });
    const c2Company = await api.authorizedPerson();
    const c2Participant = await api.addParticipant(c1.caller, tower.projectId, c2Company.company, "contractor");
    await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
    c2 = await projectMember(api, c2Company, c2Participant, ["engineer"]);
    await ok(
      c2.post(`/v1/projects/${tower.projectId}/work-items`, {
        type: CODE_B_TYPE,
        title: "C2's own",
        answers: { model: "C2's own", trade: tower.electrical, location: tower.buildingA },
      }),
      201,
    );

    pkg = await createPackage(tower.c1Pm, "Switchgear – Tower 2", tower.projectId);
    electricalItems = [await readyForPmB("Switchgear EL 1", tower.electrical), await readyForPmB("Switchgear EL 2", tower.electrical)];
    mechanicalItem = await readyForPmB("Switchgear ME 1", tower.mechanical);
    for (const id of [...electricalItems, mechanicalItem]) await ok(addItem(tower.c1Pm, pkg.id, id));
    expect((await ok(submitPackage(tower.c1Pm, pkg.id), 200)).json().submitted).toHaveLength(3);

    other = await createPackage(tower.c1Pm, "Other set", tower.projectId);
    const inOther = await readyForPmB("Other set EL", tower.electrical);
    await ok(addItem(tower.c1Pm, other.id, inOther));
    await ok(submitPackage(tower.c1Pm, other.id), 200);
    loose = await readyForPmB("Loose EL", tower.electrical);
    await take(tower.c1Pm, loose, "submit");
    electricalItems.sort();
  });

  it("filters the List to the Package's submittals the viewer sees", async () => {
    const q = `packageId=${pkg.id}`;
    for (const by of [tower.c1Pm, tower.k1Manager]) expect(await listedIds(by, q)).toEqual([...electricalItems, mechanicalItem].sort());
    expect(await listedIds(k1Electrical, q)).toEqual(electricalItems);
    // Unfiltered, the other Package's item and the loose one are listed too.
    expect(await listedIds(tower.k1Manager, "")).toEqual(expect.arrayContaining([loose]));
    expect((await listedIds(tower.k1Manager, "")).length).toBe(5);
  });

  it("RP-647-1: a Package the viewer doesn't see filters to nothing, the same answer as a made-up id", async () => {
    const path = (id: string) => `/v1/projects/${tower.projectId}/work-items?page=1&pageSize=50&packageId=${id}`;
    // C2 has its own Draft in the List, and sees none of the Package's items.
    expect((await listedIds(c2, "")).length).toBe(1);
    // C1's Open Package holds a Draft: K1 sees neither.
    const open = await createPackage(tower.c1Pm, "Still open", tower.projectId);
    await ok(addItem(tower.c1Pm, open.id, await readyForPmB("Still open EL", tower.electrical)));
    expect(await listedIds(tower.c1Pm, `packageId=${open.id}`)).toHaveLength(1);
    for (const [by, id] of [
      [c2, pkg.id],
      [tower.k1Manager, open.id],
      [k1Electrical, open.id],
    ] as const) {
      const unseen = await ok(by.get(path(id)), 200);
      expect(unseen.json().items).toEqual([]);
      expect(unseen.body).toBe((await ok(by.get(path(randomUUID())), 200)).body);
      expect(unseen.body).not.toContain(id);
    }
    expect((await c2.get(path("not-an-id"))).statusCode).toBe(400);
  });

  describe("the Comments raised from its submittals' Code B", () => {
    const comments = async (by: Caller, id = pkg.id): Promise<PackageComments> => (await ok(by.get(`/v1/packages/${id}/comments`), 200)).json();
    let numbers = new Map<string, string>(); // Each item's Document Number.

    beforeAll(async () => {
      await codeB(electricalItems[0]!, ["Add the short-circuit rating", "Confirm the IP class"]);
      await codeB(electricalItems[1]!, ["Label the feeders"]);
      await codeB(mechanicalItem, ["Show the ventilation louvres"]);
      await codeB(loose, ["Not in any Package"]);
      numbers = new Map(
        await Promise.all([...electricalItems, mechanicalItem].map(async (id) => [id, (await detail(tower.k1Manager, id)).documentNumber!] as const)),
      );
    });

    it("lists each Comment the viewer sees, with the submittal it was raised from, for information", async () => {
      for (const by of [tower.c1Pm, tower.k1Manager]) {
        const read = await comments(by);
        expect(read.forInformation).toBe(true);
        expect(read.comments.map((c) => [c.title, c.raisedFrom]).sort()).toEqual(
          [
            ["Add the short-circuit rating", { id: electricalItems[0], documentNumber: numbers.get(electricalItems[0]!) }],
            ["Confirm the IP class", { id: electricalItems[0], documentNumber: numbers.get(electricalItems[0]!) }],
            ["Label the feeders", { id: electricalItems[1], documentNumber: numbers.get(electricalItems[1]!) }],
            ["Show the ventilation louvres", { id: mechanicalItem, documentNumber: numbers.get(mechanicalItem) }],
          ].sort(),
        );
        for (const c of read.comments) {
          expect(c.type.code).toBe("CMT");
          expect(c.documentNumber).toMatch(/\S/);
          expect(c.stage.key).toBe("open");
        }
      }
    });

    it("are not part of the Package: not in its items, its counts or its status, which is Done", async () => {
      const p = await getPackage(tower.k1Manager, pkg.id);
      expect(p.items.map((i) => i.id).sort()).toEqual([...electricalItems, mechanicalItem].sort());
      expect(p).toMatchObject({ status: "done", counts: { total: 3, open: 0, codes: { B: 3 } } });
      expect(await listedIds(tower.k1Manager, `packageId=${pkg.id}`)).toEqual([...electricalItems, mechanicalItem].sort());
    });

    it("RP-647-1: a Member who doesn't see a Comment doesn't read it there; one who sees no item reads the plain 404", async () => {
      const narrowed = await comments(k1Electrical);
      expect(narrowed.comments.map((c) => c.title).sort()).toEqual(["Add the short-circuit rating", "Confirm the IP class", "Label the feeders"]);
      const body = (await k1Electrical.get(`/v1/packages/${pkg.id}/comments`)).body;
      for (const text of ["ventilation", mechanicalItem, numbers.get(mechanicalItem)!, "Not in any Package"]) expect(body).not.toContain(text);

      await expectHidden(c2.get(`/v1/packages/${pkg.id}/comments`));
      await expectHidden(c2.get(`/v1/packages/${randomUUID()}/comments`));
      // Another Package's submittals raised none.
      expect((await comments(tower.c1Pm, other.id)).comments).toEqual([]);
    });
  });
});

describe("RP-659: the item page's Package chip", () => {
  /** Item `id` as `by` reads it on its page. */
  const itemPage = async (by: Caller, id: string): Promise<WorkItemDetail> => (await ok(by.get(`/v1/work-items/${id}`), 200)).json();

  it("names the item's Package, by number and name, to its owning Participant's Members", async () => {
    const pkg = await createPackage(at.c1Engineer, "Chip – Open");
    const d = await draft(at, at.c1Engineer, "Chip Draft");
    const outside = await draft(at, at.c1Engineer, "Chip Draft in no Package");
    await ok(addItem(at.c1Engineer, pkg.id, d));
    expect((await itemPage(at.c1Engineer, d)).package).toEqual({ id: pkg.id, number: pkg.number, name: name("Chip – Open") });
    expect((await itemPage(at.c1Engineer, outside)).package).toBeUndefined();
    // Removed, or its Package deleted: the item has none again.
    await ok(removeItem(at.c1Engineer, pkg.id, d));
    expect((await itemPage(at.c1Engineer, d)).package).toBeUndefined();
    await ok(addItem(at.c1Engineer, pkg.id, d));
    await ok(at.c1Engineer.request("DELETE", `/v1/packages/${pkg.id}`));
    expect((await itemPage(at.c1Engineer, d)).package).toBeUndefined();
  });

  it("names an In Progress Package to another Company that sees the item, and nothing of it to one that doesn't see the item", async () => {
    const pkg = await createPackage(at.c1Pm, "Chip – In Progress");
    const sent = await submitted(at, at.c1Engineer, at.c1Pm, "Chip Submitted");
    await ok(addItem(at.c1Pm, pkg.id, sent));
    for (const by of [at.c1Pm, at.k1Manager]) {
      expect((await itemPage(by, sent)).package).toEqual({ id: pkg.id, number: pkg.number, name: name("Chip – In Progress") });
    }
    await expectHidden(c2Engineer.get(`/v1/work-items/${sent}`));
  });
});
