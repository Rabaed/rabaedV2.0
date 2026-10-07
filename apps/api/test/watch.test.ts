// Seam 1 for Watch (RP-354, spec RP-344; GLOSSARY "Watch"; visibility.md the
// Watch row and scenario 67). A Member watches any item they can see, and the
// Watch follows the item's Revision chain. The raiser and the Member who takes
// the Submit out of the raiser's Participant watch it from the start. Each
// Member reads only their own "Watching": no read returns who else watches, nor
// how many do. A hidden item is the plain 404.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { buildTower, detail, draft, inInternalReview, ok, only, projectMember, submitted, take, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let c1: Company;
let k1: Company;
let at: Tower;
let k1ParticipantId = "";
let k1Engineer: Caller;
let c1Viewer: Caller; // C1 Member without a Position.
let k1Mechanical: Caller; // K1 engineer whose Visibility is Mechanical only: the Electrical MARs are hidden.
let stranger: Caller; // A Company on no Project of these.

const watchRead = (by: Caller, id: string) => by.get(`/v1/work-items/${id}/watch`);
const watching = async (by: Caller, id: string): Promise<boolean> => (await ok(watchRead(by, id), 200)).json().watching;
const watch = (by: Caller, id: string) => ok(by.request("PUT", `/v1/work-items/${id}/watch`));
const unwatch = (by: Caller, id: string) => ok(by.delete(`/v1/work-items/${id}/watch`));

/** K1 verifies a Submitted MAR and issues Code C, closing it. */
async function codeC(id: string, k1Manager: Caller) {
  const answers = { ...(await detail(k1Engineer, id)).answers, sample_checked: true, matches_specification: false, verification_note: "Too dim" };
  await ok(k1Engineer.request("PUT", `/v1/work-items/${id}/answers`, { answers }));
  await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
  await ok(k1Manager.post(`/v1/work-items/${id}/transitions`, { transition: "revise_c", answers: { remarks: "Resubmit" }, idempotencyKey: randomUUID() }));
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "WCH");
  k1ParticipantId = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => !p.isOwnCompany).id;
  k1Engineer = await projectMember(api, k1, k1ParticipantId, ["engineer"]);
  k1Mechanical = await projectMember(api, k1, k1ParticipantId, ["engineer"], only(at.mechanical));
  c1Viewer = await projectMember(api, c1, at.c1ParticipantId, []);
  stranger = (await api.authorizedPerson()).caller;
});

describe("scenario 67: a K1 engineer and the C1 PM both watch the MAR", () => {
  let mar = "";
  beforeAll(async () => {
    mar = await submitted(at, at.c1Engineer, at.c1Pm, "Cable trays");
    await watch(k1Engineer, mar);
  });

  it("shows each of them only their own Watching", async () => {
    expect(await watching(at.c1Pm, mar)).toBe(true);
    expect(await watching(k1Engineer, mar)).toBe(true);
    expect(await watching(at.k1Manager, mar)).toBe(false);
  });

  it("returns no list or count of watchers in any read", async () => {
    for (const who of [at.c1Pm, k1Engineer, at.k1Manager]) {
      expect((await ok(watchRead(who, mar), 200)).json()).toEqual({ watching: expect.any(Boolean) });
      for (const path of ["", "/history", "/links", "/revisions"]) {
        expect((await ok(who.get(`/v1/work-items/${mar}${path}`), 200)).body.toLowerCase(), path).not.toContain("watch");
      }
      expect((await ok(who.get(`/v1/projects/${at.projectId}/work-items`), 200)).body.toLowerCase()).not.toContain("watch");
    }
  });
});

describe("auto-watch", () => {
  it("has the raiser watching their Draft, and nobody else", async () => {
    const id = await draft(at, at.c1Engineer, "Busbars");
    expect(await watching(at.c1Engineer, id)).toBe(true);
    for (const who of [at.c1Pm, c1Viewer]) expect(await watching(who, id)).toBe(false);
  });

  it("does not make the internal reviewer a watcher", async () => {
    const id = await inInternalReview(at, at.c1Engineer, "Earthing");
    await ok(at.c1Pm.post(`/v1/work-items/${id}/claim`));
    expect(await watching(at.c1Pm, id)).toBe(false);
  });

  it("has the raiser and the Submitter watching after the Submit, and nobody else", async () => {
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Switchgear");
    expect(await watching(at.c1Engineer, id)).toBe(true);
    expect(await watching(at.c1Pm, id)).toBe(true);
    for (const who of [c1Viewer, at.k1Manager, k1Engineer]) expect(await watching(who, id)).toBe(false);
  });

  it("does not make K1, which issues the Code, a watcher", async () => {
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Sockets");
    await codeC(id, at.k1Manager);
    for (const who of [at.k1Manager, k1Engineer]) expect(await watching(who, id)).toBe(false);
  });
});

describe("Watch and Unwatch", () => {
  it("lets a Member who sees an item watch it, and stop", async () => {
    const id = await submitted(at, at.c1Engineer, at.c1Pm, "Luminaires");
    await watch(c1Viewer, id);
    expect(await watching(c1Viewer, id)).toBe(true);
    await watch(c1Viewer, id); // Again: still one Watch.
    await unwatch(c1Viewer, id);
    expect(await watching(c1Viewer, id)).toBe(false);
    await unwatch(c1Viewer, id); // Not watching: nothing to do.
    expect(await watching(c1Viewer, id)).toBe(false);
  });

  it("lets the raiser stop watching their own item", async () => {
    const id = await draft(at, at.c1Engineer, "Conduits");
    await unwatch(at.c1Engineer, id);
    expect(await watching(at.c1Engineer, id)).toBe(false);
  });
});

describe("a Revision chain", () => {
  let original = "";
  let rev1 = "";
  beforeAll(async () => {
    original = await submitted(at, at.c1Engineer, at.c1Pm, "Fixtures");
    await codeC(original, at.k1Manager);
    await watch(k1Engineer, original);
    rev1 = (await ok(at.c1Engineer.post(`/v1/work-items/${original}/revisions`, { idempotencyKey: randomUUID() }), 201)).json().id;
  });

  it("is watched on its new Revision by whoever watches the original", async () => {
    expect(await watching(at.c1Engineer, rev1)).toBe(true);
    expect(await watching(at.c1Pm, rev1)).toBe(true);
  });

  it("keeps a Draft Revision hidden from another Company's watcher (V1), until it is Submitted", async () => {
    await expectHidden(watchRead(k1Engineer, rev1));
    await take(at.c1Engineer, rev1, "send_for_review");
    await ok(at.c1Pm.post(`/v1/work-items/${rev1}/claim`));
    await take(at.c1Pm, rev1, "submit");
    expect(await watching(k1Engineer, rev1)).toBe(true);
  });

  it("is unwatched whole when any Revision is: Rev 1 unwatches the original, and the other way round", async () => {
    await unwatch(at.c1Pm, rev1);
    expect(await watching(at.c1Pm, original)).toBe(false);
    expect(await watching(at.c1Pm, rev1)).toBe(false);

    await unwatch(k1Engineer, original);
    expect(await watching(k1Engineer, rev1)).toBe(false);
    expect(await watching(k1Engineer, original)).toBe(false);

    await watch(at.c1Pm, original);
    expect(await watching(at.c1Pm, rev1)).toBe(true);
  });
});

describe("a hidden item", () => {
  let id = "";
  beforeAll(async () => {
    id = await submitted(at, at.c1Engineer, at.c1Pm, "Cable ladders");
  });

  it("is the plain 404 to read, watch or unwatch, exactly like a made-up id", async () => {
    for (const [who, item] of [
      [k1Mechanical, id],
      [stranger, id],
      [at.c1Engineer, randomUUID()],
      [at.c1Engineer, "not-an-id"],
    ] as const) {
      await expectHidden(watchRead(who, item));
      await expectHidden(who.request("PUT", `/v1/work-items/${item}/watch`));
      await expectHidden(who.delete(`/v1/work-items/${item}/watch`));
    }
    // Nothing was written by the refused Watch: once the item is in sight, it isn't watched.
    await ok(k1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/members/${await memberIdOf(k1Mechanical)}/visibility`, {
      trade: only(at.electrical, at.mechanical),
      location: { isAll: true, valueIds: [] },
    }));
    expect(await watching(k1Mechanical, id)).toBe(false);
  });
});

async function memberIdOf(who: Caller): Promise<string> {
  return (await ok(who.get("/v1/me"), 200)).json().member.id;
}
