// Seam 1 for Revisions (RP-316, spec RP-311; workflow-engine.md §5.4 and §8,
// GLOSSARY "Revision", visibility.md the Revisions channel, V1, scenarios 51 and
// 56). After Code C, a C1 Member the MAR Workflow's Draft Step allows creates a
// Revision from the latest item of the chain: a new Draft with the answers and
// Documents copied, "No number yet" until it first leaves Draft, when it takes
// the chain's base number with " Rev n" and no counter moves. Only one Revision
// of a chain is open at a time. A Draft Revision can be discarded, and the next
// one takes its Rev number again. Until it is Submitted, nobody outside C1 sees
// anything of it.
import { randomUUID } from "node:crypto";
import type { DocumentList, LinkedFrom, RevisionChain, WorkItemDetail, WorkItemLinks } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachDatasheet, createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { all, bilingual, ok, only, projectMember, type Company } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let c1: Company; // Its Authorized Person created the Project: a Project Admin.
let engineer: Caller; // C1 engineer: raises the MARs and their Revisions.
let pm: Caller; // C1 PM: Submits.
let viewer: Caller; // C1 Member without a Position: the Draft Step doesn't allow them.
let k1Engineer: Caller;
let k1Manager: Caller; // Issues the Code.
let orEngineer: Caller; // Owner Representative (oversight).
let stranger: Caller; // A Company on no Project of these.
let projectId = "";
let electrical = "";
let buildingA = "";

const complete = {
  manufacturer: "Philips",
  description: "LED fixtures",
  items: [{ fixture_type: "Downlight", quantity: 120, unit: "pcs" }],
};

const take = (by: Caller, id: string, transition: string, answers: Record<string, unknown> = {}) =>
  ok(by.post(`/v1/work-items/${id}/transitions`, { transition, answers, idempotencyKey: randomUUID() }));
const detail = async (by: Caller, id: string): Promise<WorkItemDetail> => (await ok(by.get(`/v1/work-items/${id}`), 200)).json();
const saveOver = async (by: Caller, id: string, changes: Record<string, unknown>) =>
  ok(by.request("PUT", `/v1/work-items/${id}/answers`, { answers: { ...(await detail(by, id)).answers, ...changes } }));
const createRevision = (by: Caller, id: string, idempotencyKey: string = randomUUID()) =>
  by.post(`/v1/work-items/${id}/revisions`, { idempotencyKey });
const revisionOf = async (id: string) => (await ok(createRevision(engineer, id), 201)).json().id as string;
const discard = (by: Caller, id: string) => by.post(`/v1/work-items/${id}/discard`);
const links = async (by: Caller, id: string): Promise<WorkItemLinks> => (await ok(by.get(`/v1/work-items/${id}/links`), 200)).json();
const linkedFrom = async (by: Caller, id: string): Promise<LinkedFrom> => (await ok(by.get(`/v1/work-items/${id}/linked-from`), 200)).json();
const counters = async () => (await ok(c1.caller.get(`/v1/projects/${projectId}/numbering/counters`), 200)).json().counters;

/** Sends a Draft (a new MAR or a Revision) for review and Submits it to K1. */
async function submit(id: string) {
  await take(engineer, id, "send_for_review");
  await ok(pm.post(`/v1/work-items/${id}/claim`));
  await take(pm, id, "submit");
}

/** K1 verifies the submitted item and issues Code C. */
async function codeC(id: string) {
  await saveOver(k1Engineer, id, { sample_checked: true, matches_specification: false, verification_note: "Below the specified efficacy" });
  await ok(k1Manager.post(`/v1/work-items/${id}/claim`));
  await take(k1Manager, id, "revise_c", { remarks: "Resubmit with 110 lm/W luminaires" });
}

/** A MAR with its datasheet, closed at Code C. */
async function closedAtCodeC(title: string): Promise<string> {
  const res = await ok(
    engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title, answers: { ...complete, trade: electrical, location: buildingA } }),
    201,
  );
  const id = res.json().id as string;
  await attachDatasheet(engineer, id);
  await submit(id);
  await codeC(id);
  return id;
}

beforeAll(async () => {
  c1 = await api.projectCreator();
  projectId = (await api.createProject(c1.caller)).id;
  electrical = (await c1.caller.post(`/v1/projects/${projectId}/trades`, { code: "EL", name: bilingual("Electrical") })).json().id;
  buildingA = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BA", name: bilingual("Building A"), parentId: null }))
    .json().id;
  const own = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${own}/visibility`, { trade: all, location: all }));
  const otherParticipant = async (role: "consultant" | "owner_representative") => {
    const company = await api.authorizedPerson();
    const participantId = await api.addParticipant(c1.caller, projectId, company.company, role);
    await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: all }));
    return { company, participantId };
  };
  engineer = await projectMember(api, c1, own, ["engineer"]);
  pm = await projectMember(api, c1, own, ["project_manager"]);
  viewer = await projectMember(api, c1, own, []);
  const k1 = await otherParticipant("consultant");
  k1Engineer = await projectMember(api, k1.company, k1.participantId, ["engineer"]);
  k1Manager = await projectMember(api, k1.company, k1.participantId, ["manager"]);
  const or = await otherParticipant("owner_representative");
  orEngineer = await projectMember(api, or.company, or.participantId, ["engineer"]);
  stranger = (await api.authorizedPerson()).caller;
});

describe("C1 creates a Revision of a MAR that got Code C", () => {
  let closed = "";
  let revision = "";
  beforeAll(async () => {
    closed = await closedAtCodeC("Fixtures");
    revision = await revisionOf(closed);
  });

  it("is a new Draft with no number yet, Revision 1, with the raiser's answers and an empty Consultant verification (scenario 49)", async () => {
    const d = await detail(engineer, revision);
    expect(d).toMatchObject({
      title: "Fixtures",
      documentNumber: null,
      revisionNo: 1,
      stage: { key: "draft" },
      outcome: null,
      answers: { ...complete, trade: electrical, location: buildingA },
    });
    for (const key of ["sample_checked", "matches_specification", "verification_note"]) expect(d.answers).not.toHaveProperty(key);
    expect(d.actions.saveAnswers).toBe(true);
    expect(d.actions.discardRevision).toBe(true);
  });

  it("has the Documents copied as new rows the raiser can still change", async () => {
    const original: DocumentList = (await ok(engineer.get(`/v1/work-items/${closed}/documents`), 200)).json();
    const copied: DocumentList = (await ok(engineer.get(`/v1/work-items/${revision}/documents`), 200)).json();
    expect(copied.documents.map((d) => [d.fileName, d.fieldKey, d.frozen])).toEqual(original.documents.map((d) => [d.fileName, d.fieldKey, false]));
    expect(copied.documents.map((d) => d.id)).not.toEqual(expect.arrayContaining(original.documents.map((d) => d.id)));
    expect(copied.canChange).toBe(true);
    const url = async (item: string, id: string) => (await ok(engineer.get(`/v1/work-items/${item}/documents/${id}/download`), 200)).json().url as string;
    const copy = await fetch(await url(revision, copied.documents[0]!.id));
    expect(copy.status).toBe(200);
    const source = await fetch(await url(closed, original.documents[0]!.id));
    expect(await copy.text()).toBe(await source.text());
  });

  it("leaves the closed MAR closed with its Code, its Consultant answers and its number", async () => {
    for (const who of [engineer, k1Manager, orEngineer]) {
      expect(await detail(who, closed)).toMatchObject({
        outcome: "C",
        revisionNo: 0,
        documentNumber: expect.stringMatching(/-0001$/),
        answers: { sample_checked: true, matches_specification: false, verification_note: "Below the specified efficacy" },
      });
    }
  });

  it("is hidden from K1 and the Owner Representative while it is a Draft (V1, scenario 51)", async () => {
    for (const who of [k1Engineer, k1Manager, orEngineer, stranger]) {
      await expectHidden(who.get(`/v1/work-items/${revision}`));
      await expectHidden(who.get(`/v1/work-items/${revision}/history`));
      await expectHidden(who.get(`/v1/work-items/${revision}/documents`));
    }
    for (const who of [k1Manager, orEngineer]) {
      const list = (await ok(who.get(`/v1/projects/${projectId}/work-items`), 200)).json();
      expect(list.items.map((i: { id: string }) => i.id)).not.toContain(revision);
      const links: WorkItemLinks = (await ok(who.get(`/v1/work-items/${closed}/links`), 200)).json();
      expect(JSON.stringify(links)).not.toContain(revision);
      expect(links.links).toEqual([]);
    }
  });

  it("is offered to nobody else while it is open: one open Revision per chain", async () => {
    for (const who of [engineer, pm, viewer, k1Manager, orEngineer]) expect((await detail(who, closed)).actions.createRevision).toBe(false);
    const again = await createRevision(engineer, closed);
    expect({ status: again.statusCode, body: again.json() }).toEqual({ status: 409, body: { error: "revision_not_allowed" } });
  });
});

describe("who may create a Revision", () => {
  let closed = "";
  beforeAll(async () => {
    closed = await closedAtCodeC("Cable trays");
  });

  it("is offered to C1 Members the Draft Step allows, and to nobody else", async () => {
    expect((await detail(engineer, closed)).actions.createRevision).toBe(true);
    expect((await detail(pm, closed)).actions.createRevision).toBe(true);
    for (const who of [viewer, k1Engineer, k1Manager, orEngineer]) expect((await detail(who, closed)).actions.createRevision).toBe(false);
  });

  it("is refused for anyone else, alike, and with a 404 naming nothing to whoever can't see the item", async () => {
    for (const who of [viewer, k1Manager, orEngineer]) {
      const res = await createRevision(who, closed);
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 409, body: { error: "revision_not_allowed" } });
    }
    await expectHidden(createRevision(stranger, closed));
    await expectHidden(createRevision(engineer, randomUUID()));
  });

  it("is refused for an item without Code C", async () => {
    const draft = (await ok(engineer.post(`/v1/projects/${projectId}/work-items`, { type: "MAR", title: "Draft", answers: { ...complete, trade: electrical } }), 201)).json()
      .id as string;
    expect((await createRevision(engineer, draft)).statusCode).toBe(409);
    expect((await detail(engineer, draft)).actions.createRevision).toBe(false);
  });

  it("applies once for the same idempotency key", async () => {
    const key = randomUUID();
    const first = (await ok(createRevision(engineer, closed, key), 201)).json().id;
    const second = (await ok(createRevision(engineer, closed, key), 201)).json().id;
    expect(second).toBe(first);
  });
});

describe("the Revision's Document Number", () => {
  let closed = "";
  let base = "";
  let rev1 = "";
  beforeAll(async () => {
    closed = await closedAtCodeC("Switchgear");
    base = (await detail(engineer, closed)).documentNumber!;
    rev1 = await revisionOf(closed);
  });

  it("is the chain's base number with ' Rev 1' once it first leaves Draft, and no counter moves", async () => {
    const before = await counters();
    await take(engineer, rev1, "send_for_review");
    expect((await detail(engineer, rev1)).documentNumber).toBe(`${base} Rev 1`);
    expect(await counters()).toEqual(before);
  });

  it("reaches K1 when Submitted, with a related Link from the closed item", async () => {
    await expectHidden(k1Manager.get(`/v1/work-items/${rev1}`));
    await ok(pm.post(`/v1/work-items/${rev1}/claim`));
    await take(pm, rev1, "submit");
    expect(await detail(k1Manager, rev1)).toMatchObject({ documentNumber: `${base} Rev 1`, revisionNo: 1 });
    for (const who of [engineer, k1Manager]) {
      const links: WorkItemLinks = (await ok(who.get(`/v1/work-items/${closed}/links`), 200)).json();
      expect(links.links).toEqual([expect.objectContaining({ kind: "related", documentNumber: `${base} Rev 1`, workItemId: rev1 })]);
    }
  });

  it("is ' Rev 2' for a Revision of Rev 1, created only from the latest of the chain", async () => {
    await codeC(rev1);
    expect((await detail(engineer, closed)).actions.createRevision).toBe(false);
    expect((await createRevision(engineer, closed)).statusCode).toBe(409);
    const rev2 = await revisionOf(rev1);
    expect((await detail(engineer, rev2)).revisionNo).toBe(2);
    await take(engineer, rev2, "send_for_review");
    expect((await detail(engineer, rev2)).documentNumber).toBe(`${base} Rev 2`);
  });
});

describe("the Revision drop-down (RP-318; scenarios 51 and 52)", () => {
  let closed = "";
  let base = "";
  let rev1 = "";
  const chain = async (by: Caller, id: string): Promise<RevisionChain> => (await ok(by.get(`/v1/work-items/${id}/revisions`), 200)).json();
  beforeAll(async () => {
    closed = await closedAtCodeC("Distribution boards");
    base = (await detail(engineer, closed)).documentNumber!;
    rev1 = await revisionOf(closed);
    await saveOver(engineer, rev1, { manufacturer: "Schneider" });
  });

  it("lists only the original to K1 and the Owner Representative while Rev 1 is C1's (scenario 51)", async () => {
    for (const who of [k1Engineer, k1Manager, orEngineer]) {
      expect(await chain(who, closed)).toEqual({ revisions: [{ id: closed, documentNumber: base, revisionNo: 0 }] });
      await expectHidden(who.get(`/v1/work-items/${rev1}/revisions`));
    }
  });

  it("lists the original and the Draft Rev 1, with no number yet, to C1", async () => {
    const expected = {
      revisions: [
        { id: closed, documentNumber: base, revisionNo: 0 },
        { id: rev1, documentNumber: null, revisionNo: 1 },
      ],
    };
    for (const who of [engineer, pm, viewer]) {
      expect(await chain(who, closed)).toEqual(expected);
      expect(await chain(who, rev1)).toEqual(expected);
    }
  });

  it("answers a 404 naming nothing to whoever can't see the item", async () => {
    await expectHidden(stranger.get(`/v1/work-items/${closed}/revisions`));
    await expectHidden(engineer.get(`/v1/work-items/${randomUUID()}/revisions`));
    await expectHidden(engineer.get(`/v1/work-items/not-an-id/revisions`));
  });

  it("lists the original and Rev 1 to K1 once Submitted, and the original keeps its own answers, Documents and history (scenario 52)", async () => {
    await submit(rev1);
    const expected = {
      revisions: [
        { id: closed, documentNumber: base, revisionNo: 0 },
        { id: rev1, documentNumber: `${base} Rev 1`, revisionNo: 1 },
      ],
    };
    for (const who of [k1Manager, orEngineer]) {
      expect(await chain(who, rev1)).toEqual(expected);
      expect(await chain(who, closed)).toEqual(expected);
    }
    expect(await detail(k1Manager, closed)).toMatchObject({ outcome: "C", answers: { manufacturer: "Philips", sample_checked: true } });
    expect(await detail(k1Manager, rev1)).toMatchObject({ outcome: null, answers: { manufacturer: "Schneider" } });
    expect((await detail(k1Manager, rev1)).answers).not.toHaveProperty("sample_checked");
    const documents = async (id: string): Promise<DocumentList> => (await ok(k1Manager.get(`/v1/work-items/${id}/documents`), 200)).json();
    const [originalDocs, revisionDocs] = [await documents(closed), await documents(rev1)];
    expect(originalDocs.documents).toHaveLength(1);
    expect(revisionDocs.documents).toHaveLength(1);
    expect(revisionDocs.documents[0]!.id).not.toBe(originalDocs.documents[0]!.id);
    const history = async (id: string) => (await ok(k1Manager.get(`/v1/work-items/${id}/history`), 200)).json().events as { type: string }[];
    expect((await history(closed)).map((e) => e.type)).toContain("issue_code");
    expect((await history(rev1)).map((e) => e.type)).not.toContain("issue_code");
  });
});

describe("discarding a Draft Revision (scenario 56)", () => {
  let closed = "";
  let discarded = "";
  beforeAll(async () => {
    closed = await closedAtCodeC("Luminaires");
    discarded = await revisionOf(closed);
  });

  it("is offered only on a Revision still in Draft, to C1", async () => {
    expect((await detail(engineer, closed)).actions.discardRevision).toBe(false);
    expect((await discard(engineer, closed)).statusCode).toBe(409);
    await expectHidden(discard(k1Manager, discarded));
  });

  it("takes it away for everyone, and the next Revision is Rev 1 again", async () => {
    await ok(discard(engineer, discarded));
    for (const who of [engineer, pm, k1Manager, orEngineer]) await expectHidden(who.get(`/v1/work-items/${discarded}`));
    expect((await detail(engineer, closed)).actions.createRevision).toBe(true);
    const again = await revisionOf(closed);
    expect(again).not.toBe(discarded);
    expect((await detail(engineer, again)).revisionNo).toBe(1);
    await submit(again);
    const base = (await detail(engineer, closed)).documentNumber!;
    expect((await detail(k1Manager, again)).documentNumber).toBe(`${base} Rev 1`);
    await expectHidden(k1Manager.get(`/v1/work-items/${discarded}`));
  });

  it("is refused once the Revision has left Draft", async () => {
    const closedToo = await closedAtCodeC("Panels");
    const rev = await revisionOf(closedToo);
    await take(engineer, rev, "send_for_review");
    expect((await discard(engineer, rev)).statusCode).toBe(409);
    expect((await detail(engineer, rev)).actions.discardRevision).toBe(false);
  });
});

// RP-311 review, settled with the user: the Link from the revised item to its
// Revision follows the drop-down. Rev 1 moves to Building B: an Owner
// Representative covering only Building A sees the original but not Rev 1, one
// covering only Building B sees Rev 1 but not the original. Neither reads the
// other item through a Link, Linked from or a link answer, not even by its number.
describe("the Links of a chain whose Revision moved Location (scenario 58)", () => {
  let closed = "";
  let base = "";
  let rev1 = "";
  let orA: Caller;
  let orB: Caller;
  beforeAll(async () => {
    const buildingB = (await c1.caller.post(`/v1/projects/${projectId}/locations`, { code: "BB", name: bilingual("Building B"), parentId: null }))
      .json().id as string;
    const representative = async (location: string) => {
      const company = await api.authorizedPerson();
      const participantId = await api.addParticipant(c1.caller, projectId, company.company, "owner_representative");
      await ok(c1.caller.request("PUT", `/v1/participants/${participantId}/visibility`, { trade: all, location: only(location) }));
      return projectMember(api, company, participantId, ["engineer"]);
    };
    orA = await representative(buildingA);
    orB = await representative(buildingB);
    closed = await closedAtCodeC("Busbar trunking");
    base = (await detail(engineer, closed)).documentNumber!;
    rev1 = await revisionOf(closed);
    // Rev 1 moves to Building B, and its link question names the item it revises.
    await saveOver(engineer, rev1, { location: buildingB, related_submittals: [closed] });
    await submit(rev1);
  });

  it("gives whoever sees both the Link, Linked from and the link answer", async () => {
    for (const who of [engineer, k1Manager]) {
      expect((await links(who, closed)).links).toEqual([expect.objectContaining({ kind: "related", workItemId: rev1 })]);
      expect((await linkedFrom(who, closed)).items).toEqual([expect.objectContaining({ workItemId: rev1 })]);
      expect((await detail(who, rev1)).answers).toMatchObject({ related_submittals: [closed] });
    }
  });

  it("never shows Rev 1 to a reader who sees only the original", async () => {
    await expectHidden(orA.get(`/v1/work-items/${rev1}`));
    expect((await ok(orA.get(`/v1/work-items/${closed}/revisions`), 200)).json()).toEqual({
      revisions: [{ id: closed, documentNumber: base, revisionNo: 0 }],
    });
    expect((await links(orA, closed)).links).toEqual([]);
    expect((await linkedFrom(orA, closed)).items).toEqual([]);
    const body = (await orA.get(`/v1/work-items/${closed}/links`)).body + (await orA.get(`/v1/work-items/${closed}/linked-from`)).body;
    expect(body).not.toContain(`${base} Rev 1`);
  });

  it("never shows the original to a reader who sees only Rev 1", async () => {
    await expectHidden(orB.get(`/v1/work-items/${closed}`));
    expect((await ok(orB.get(`/v1/work-items/${rev1}/revisions`), 200)).json()).toEqual({
      revisions: [{ id: rev1, documentNumber: `${base} Rev 1`, revisionNo: 1 }],
    });
    expect((await linkedFrom(orB, rev1)).items).toEqual([]);
    expect((await links(orB, rev1)).links).toEqual([]);
    const d = await detail(orB, rev1);
    expect(d.answers).toMatchObject({ related_submittals: [] });
    expect(JSON.stringify(d)).not.toContain(`"${base}"`);
  });

  it("keeps the original in Rev 1's link answer for whoever sees it", async () => {
    expect((await detail(engineer, rev1)).answers).toMatchObject({ related_submittals: [closed] });
  });
});

// RP-311 review: a discarded Revision, its copied Documents and its link answers
// reach nobody through a Link read (scenario 56).
describe("the Links of a discarded Revision", () => {
  let target = "";
  let closed = "";
  let discarded = "";
  beforeAll(async () => {
    target = await closedAtCodeC("Earthing");
    const res = await ok(
      engineer.post(`/v1/projects/${projectId}/work-items`, {
        type: "MAR",
        title: "Earthing pits",
        answers: { ...complete, trade: electrical, location: buildingA, related_submittals: [target] },
      }),
      201,
    );
    closed = res.json().id as string;
    await attachDatasheet(engineer, closed);
    await submit(closed);
    await codeC(closed);
    discarded = await revisionOf(closed);
    expect((await links(engineer, discarded)).links).toEqual([expect.objectContaining({ kind: "relies_on", workItemId: target })]);
    expect((await ok(engineer.get(`/v1/work-items/${discarded}/documents`), 200)).json().documents).toHaveLength(1);
    await ok(discard(engineer, discarded));
  });

  it("is left out of the Linked from of the item its answers named, and of the revised item's Links", async () => {
    for (const who of [engineer, pm, k1Manager, orEngineer]) {
      const from = (await linkedFrom(who, target)).items;
      expect(from.map((i) => i.workItemId)).toEqual([closed]);
      expect(JSON.stringify(from)).not.toContain(discarded);
      expect((await links(who, closed)).links.map((l) => l.workItemId)).toEqual([target]);
    }
  });

  it("answers its Links, Linked from and Documents with a 404 naming nothing", async () => {
    for (const who of [engineer, k1Manager]) {
      await expectHidden(who.get(`/v1/work-items/${discarded}/links`));
      await expectHidden(who.get(`/v1/work-items/${discarded}/linked-from`));
      await expectHidden(who.get(`/v1/work-items/${discarded}/documents`));
    }
  });
});
