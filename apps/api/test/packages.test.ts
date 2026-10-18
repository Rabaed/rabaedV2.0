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
import type { PackageDetail, PackageSummary, WorkItemHistory, WorkItemRow } from "@rabaed/domain";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { addSendBackType } from "./support/send-back.ts";
import {
  all,
  bilingual,
  buildTower,
  detail,
  draft,
  inInternalReview,
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
    expect(p.items.find((i) => i.id === ownDraft)).toEqual({ id: ownDraft, documentNumber: null, title: "PM's own Draft" });
    // The work item query gives each its Package, by number and name.
    const mine = await rows(at.c1Pm);
    for (const id of [ownDraft, inReview, sent]) expect(mine.get(id)?.package).toEqual({ id: pkg.id, number: pkg.number, name: name("Lighting") });
  });
});

describe("scenario RP-588-1: C1's Open Package of two Drafts is C1's alone", () => {
  let pkg = { id: "", number: "" };
  let drafts: string[] = [];
  let sent = ""; // A Submitted item K1 and the Owner see, in another Open Package of C1's.
  let other = "";

  beforeAll(async () => {
    pkg = await createPackage(at.c1Engineer, "Bathrooms – Tower 2");
    drafts = [await draft(at, at.c1Engineer, "Tiles"), await draft(at, at.c1Engineer, "Sanitary ware")];
    for (const id of drafts) await ok(addItem(at.c1Engineer, pkg.id, id));
    other = (await createPackage(at.c1Pm, "Cables")).id;
    sent = await submitted(at, at.c1Engineer, at.c1Pm, "Submitted cables");
    await ok(addItem(at.c1Pm, other, sent));
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
        expect(listed.json(), who).toEqual({ packages: [] });
        // The List's rows hold no Package: not of the Submitted item they see, nor any name or number of one.
        const seen = await rows(by);
        for (const r of seen.values()) expect(r.package, who).toBeUndefined();
        const body = (await by.get(`/v1/projects/${at.projectId}/work-items?page=1&pageSize=50`)).body;
        for (const text of ["Bathrooms", "Cables", "PKG-"]) expect(body, who).not.toContain(text);
      } else {
        // K1's Authorized Person is not a Project Member: the Project itself is hidden.
        await expectHidden(Promise.resolve(listed), who);
      }
    }
    // The Owner and K1's manager do see the Submitted item itself.
    for (const by of [at.k1Manager, owner]) expect((await rows(by)).has(sent)).toBe(true);
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
