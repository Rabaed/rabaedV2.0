// Seam 1 for "a Document Number is given at the first Submit" (RP-1316, ADR 0030; visibility.md V1 and
// scenario 53; scenarios RP-1316-1 and RP-1316-2), on the Rabaed Default MAR. Send for Review to the
// raiser's PM no longer numbers it; the PM's Submit to the Consultant does. Before then it reads
// "No number yet" (no number in any read) and its Subject inside C1, and reaches no other Company. An
// item C1 cancels in Internal Review never had a number, so the numbers K1, the Owner Representative and
// C2 see run with no gap. The Creation Date stays at the first exit from Draft, its Step Age counts there.
import { workItemSearchParams, type WorkItemList } from "@rabaed/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectHiddenFrom } from "@rabaed/db/test-support";
import { createTestApi, readById, type Caller, type TestApi } from "./support/harness.ts";
import { all, buildTower, detail, draft, ok, projectMember, take, type Company, type Tower } from "./support/tower.ts";

let api: TestApi;
let at: Tower;
let c2Engineer: Caller;
let orEngineer: Caller;

beforeAll(async () => {
  api = await createTestApi({ files: true });
  const c1: Company = await api.projectCreator();
  const k1 = await api.authorizedPerson();
  const c2 = await api.authorizedPerson();
  const or = await api.authorizedPerson();
  at = await buildTower(api, { c1, k1 }, "NFS");
  // The current MAR's Submit reaches the Consultant's engineer.
  await projectMember(api, k1, at.k1ParticipantId!, ["engineer"]);
  const c2Participant = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  await ok(c1.caller.request("PUT", `/v1/participants/${c2Participant}/visibility`, { trade: all, location: all }));
  c2Engineer = await projectMember(api, c2, c2Participant, ["engineer"]);
  const orParticipant = await api.addParticipant(c1.caller, at.projectId, or.company, "owner_representative");
  await ok(c1.caller.request("PUT", `/v1/participants/${orParticipant}/visibility`, { trade: all, location: all }));
  orEngineer = await projectMember(api, or, orParticipant, ["engineer"]);
});

afterAll(async () => {
  await api?.close();
});

const MAR = { type: "MAR" } as const;
const inReview = async (title: string) => {
  const id = await draft(at, at.c1Engineer, title, MAR);
  await take(at.c1Engineer, id, "send_for_review");
  return id;
};
const submit = async (id: string) => {
  await ok(at.c1Pm.post(`/v1/work-items/${id}/pick-up`));
  await take(at.c1Pm, id, "submit");
};
const submitted = async (title: string) => {
  const id = await inReview(title);
  await submit(id);
  return id;
};
const list = async (by: Caller, q?: string): Promise<WorkItemList> =>
  (await ok(by.get(`/v1/projects/${at.projectId}/modules/submittals/work-items?${workItemSearchParams(q === undefined ? {} : { q })}`), 200)).json();
const seq = (n: string) => Number(n.slice(-4));

describe("the Document Number comes at the first Submit (ADR 0030)", () => {
  it("Send for Review gives none: C1 reads the item with no number, its Subject, its Creation Date and a Step Age", async () => {
    const id = await inReview("Busbar trunking, no number yet");
    const read = await detail(at.c1Engineer, id);
    expect(read.documentNumber).toBeNull();
    expect(read.title).toBe("Busbar trunking, no number yet");
    expect(read.creationDate).not.toBeNull();
    expect(read.submissionDate).toBeNull();
    const row = (await list(at.c1Pm)).items.find((r) => r.id === id);
    expect(row).toMatchObject({ documentNumber: null });
    expect(row?.stepAgeWeeks, "an item in Internal Review has a Step Age, a Draft has none").not.toBeNull();
    // Search by Subject finds it inside C1 (AC 2).
    expect((await list(at.c1Pm, "Busbar trunking")).items.map((r) => r.id)).toContain(id);
  });

  it("the PM's Submit gives it, with the Submission Date; the Creation Date stays at Send for Review", async () => {
    const id = await inReview("Cable ladders");
    const before = await detail(at.c1Engineer, id);
    await submit(id);
    const after = await detail(at.c1Engineer, id);
    expect(after.documentNumber).toMatch(/^NFS-MAR-\d{2}-\d{4}$/);
    expect(after.submissionDate).not.toBeNull();
    expect(after.creationDate).toBe(before.creationDate);
    expect((await detail(at.k1Manager, id)).documentNumber).toBe(after.documentNumber);
  });
});

describe("visibility.md, Document Numbers (RP-1316)", () => {
  it("RP-1316-1: C1 cancels one MAR in Internal Review; K1, the Owner Representative and C2 see no gap in C1's numbers", async () => {
    const first = await submitted("No gap: first");
    const cancelled = await inReview("No gap: cancelled in Internal Review");
    await ok(at.c1Pm.post(`/v1/work-items/${cancelled}/pick-up`));
    await take(at.c1Pm, cancelled, "cancel_review");
    const next = await submitted("No gap: next");
    const firstNumber = (await detail(at.c1Engineer, first)).documentNumber!;
    const nextNumber = (await detail(at.c1Engineer, next)).documentNumber!;
    expect(seq(nextNumber), `${nextNumber} follows ${firstNumber}`).toBe(seq(firstNumber) + 1);
    expect((await detail(at.c1Engineer, cancelled)).documentNumber, "the cancelled one never had a number").toBeNull();
    for (const by of [at.k1Manager, orEngineer]) {
      expect((await detail(by, next)).documentNumber).toBe(nextNumber);
      const numbers = (await list(by)).items.map((r) => r.documentNumber).filter((n): n is string => n?.startsWith(firstNumber.slice(0, -4)) ?? false);
      const sorted = numbers.map(seq).sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!, "C1's numbers they read run with no gap").toBe(1);
    }
    // The cancelled one is C1's alone; C2 reads none of C1's items (V3).
    await expectHiddenFrom({ read: readById(`/v1/work-items/${cancelled}`), target: cancelled, seenBy: at.c1Engineer, hiddenFrom: [at.k1Manager, orEngineer, c2Engineer], label: "the cancelled one" });
    for (const id of [first, next]) {
      await expectHiddenFrom({ read: readById(`/v1/work-items/${id}`), target: id, seenBy: [at.c1Engineer, at.k1Manager, orEngineer], hiddenFrom: c2Engineer, label: "C2" });
    }
  });

  it("RP-1316-2: before its first Submit, C1's MAR reaches no other Company: no item, no number, no count", async () => {
    const id = await inReview("Before Submit: C1's own");
    const others = [at.k1Manager, orEngineer, c2Engineer];
    await expectHiddenFrom({ read: readById(`/v1/work-items/${id}`), target: id, seenBy: [at.c1Engineer, at.c1Pm], hiddenFrom: others, label: "the item" });
    await expectHiddenFrom({ read: async (by: Caller) => (await list(by, "Before Submit")).items, target: id, seenBy: [at.c1Engineer, at.c1Pm], hiddenFrom: others, label: "search by Subject" });
    await expectHiddenFrom({ read: async (by: Caller) => (await list(by)).items, target: id, seenBy: at.c1Pm, hiddenFrom: others, label: "the List" });
  });
});
