// Seam 1: Participant Codes (RP-314, spec RP-311; GLOSSARY.md "Participant Code";
// data-model.md participant.code; visibility.md V15). A Project Admin gives each
// Participant a 2-6 letter-or-digit code; numbers print it where the pattern has
// the Participant segment, the Participant's position (01) until it is set, and
// it is fixed once a number uses it.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller } from "./support/harness.ts";
import { buildTower, draft, ok, projectMember, type Company, type Tower } from "./support/tower.ts";

const api = await createTestApi({ files: true });
afterAll(() => api.close());

let c1: Company;
let k1: Company;
let c2: Company;

beforeAll(async () => {
  c1 = await api.projectCreator();
  k1 = await api.authorizedPerson();
  c2 = await api.authorizedPerson();
});

const code = (by: Caller, participantId: string, value: string) =>
  by.request("PUT", `/v1/participants/${participantId}/code`, { code: value });

const sendForReview = (by: Caller, id: string) =>
  ok(by.post(`/v1/work-items/${id}/transitions`, { transition: "send_for_review", idempotencyKey: randomUUID() }));

const numberOf = async (by: Caller, id: string) => (await by.get(`/v1/work-items/${id}`)).json().documentNumber;

/** A Project of C1's with K1 as Consultant and C2 as another Contractor. */
async function project(projectCode: string): Promise<Tower & { k1ParticipantId: string; c2ParticipantId: string }> {
  const at = await buildTower(api, { c1, k1 }, projectCode);
  const c2ParticipantId = await api.addParticipant(c1.caller, at.projectId, c2.company, "contractor");
  const listed = (await c1.caller.get(`/v1/projects/${at.projectId}/participants`)).json().participants;
  const k1ParticipantId = listed.find((p: { company: { id: string } }) => p.company.id === k1.company.companyId).id;
  return { ...at, k1ParticipantId, c2ParticipantId };
}

const codesOf = async (by: Caller, projectId: string) =>
  Object.fromEntries(
    (await by.get(`/v1/projects/${projectId}/participants`)).json().participants.map(
      (p: { id: string; code: string | null }) => [p.id, p.code],
    ),
  );

describe("setting a Participant Code", () => {
  it("is set by the Project Admin, uppercased, and listed with the Participant", async () => {
    const at = await project("PC1");
    expect(await codesOf(c1.caller, at.projectId)).toEqual({
      [at.c1ParticipantId]: null,
      [at.k1ParticipantId]: null,
      [at.c2ParticipantId]: null,
    });
    await ok(code(c1.caller, at.c1ParticipantId, "ccm"));
    await ok(code(c1.caller, at.k1ParticipantId, "K1"));
    expect(await codesOf(c1.caller, at.projectId)).toMatchObject({ [at.c1ParticipantId]: "CCM", [at.k1ParticipantId]: "K1" });
  });

  it("accepts 2 to 6 letters or digits, with at least one letter, and refuses anything else", async () => {
    const at = await project("PC2");
    for (const bad of ["A", "ABCDEFG", "AB-1", "AB 1", "12", "123456", "", "ÄB"]) {
      const res = await code(c1.caller, at.k1ParticipantId, bad);
      expect(res.statusCode, bad).toBe(422);
    }
    for (const good of ["AB", "A1", "ABCDEF", "1A2B3C"]) await ok(code(c1.caller, at.k1ParticipantId, good));
  });

  it("is unique in the Project, whatever the letter case, but may repeat on another Project", async () => {
    const at = await project("PC3");
    await ok(code(c1.caller, at.c1ParticipantId, "ccm"));
    const taken = await code(c1.caller, at.k1ParticipantId, "CCM");
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ error: "duplicate_code" });
    const other = await project("PC4");
    await ok(code(c1.caller, other.c1ParticipantId, "CCM"));
  });

  it("is refused for anyone but a Project Admin, and hidden from a Member who cannot see the Participant (V15)", async () => {
    const at = await project("PC5");
    const engineer = at.c1Engineer; // C1's own engineer: sees C1's Participant, is no Project Admin
    expect((await code(engineer, at.c1ParticipantId, "CCM")).statusCode).toBe(403);
    expect((await code(at.k1Manager, at.k1ParticipantId, "KKK")).statusCode).toBe(403);
    // C1's engineer can't see K1's Participant: a 404 that names nothing.
    await expectHidden(code(engineer, at.k1ParticipantId, "KKK"));
    await expectHidden(code(engineer, randomUUID(), "KKK"));
    expect(await codesOf(c1.caller, at.projectId)).toMatchObject({ [at.c1ParticipantId]: null, [at.k1ParticipantId]: null });
  });
});

describe("who sees a code (V15)", () => {
  it("shows each Member the codes of the Participants they can see, and nobody another Company's", async () => {
    const at = await project("PC6");
    await ok(code(c1.caller, at.c1ParticipantId, "CCM"));
    await ok(code(c1.caller, at.k1ParticipantId, "KNS"));
    await ok(code(c1.caller, at.c2ParticipantId, "CTW"));
    // The Consultant sees only its own Participant, with its own code.
    const k1Sees = (await at.k1Manager.get(`/v1/projects/${at.projectId}/participants`)).json().participants;
    expect(k1Sees.map((p: { id: string; code: string }) => [p.id, p.code])).toEqual([[at.k1ParticipantId, "KNS"]]);
    expect(JSON.stringify(k1Sees)).not.toMatch(/CCM|CTW/);
    // C1's engineer sees C1's own Participant and code, and no other code.
    const engineerSees = (await at.c1Engineer.get(`/v1/projects/${at.projectId}/participants`)).json().participants;
    expect(engineerSees.map((p: { id: string; code: string }) => [p.id, p.code])).toEqual([[at.c1ParticipantId, "CCM"]]);
  });
});

describe("Document Numbers", () => {
  it("print the ordinal until a code is set, then the code under the Rabaed Default, on a counter of its own", async () => {
    const at = await project("PC7");
    const first = await draft(at, at.c1Engineer, "Before the code");
    await sendForReview(at.c1Engineer, first);
    expect(await numberOf(at.c1Engineer, first)).toBe("PC7-MAR-01-0001");

    await ok(code(c1.caller, at.c1ParticipantId, "ccm"));
    const second = await draft(at, at.c1Engineer, "After the code");
    await sendForReview(at.c1Engineer, second);
    // The ordinal counter's issued numbers stay; the code starts its own run.
    expect(await numberOf(at.c1Engineer, first)).toBe("PC7-MAR-01-0001");
    expect(await numberOf(at.c1Engineer, second)).toBe("PC7-MAR-CCM-0001");
    const third = await draft(at, at.c1Engineer, "Another");
    await sendForReview(at.c1Engineer, third);
    expect(await numberOf(at.c1Engineer, third)).toBe("PC7-MAR-CCM-0002");
  });

  it("fix the code once one uses it: changing it is refused, repeating it is not", async () => {
    const at = await project("PC8");
    await ok(code(c1.caller, at.c1ParticipantId, "CCM"));
    // A code nothing used yet can still change.
    await ok(code(c1.caller, at.c1ParticipantId, "CMC"));
    const id = await draft(at, at.c1Engineer, "Uses the code");
    await sendForReview(at.c1Engineer, id);
    expect(await numberOf(at.c1Engineer, id)).toBe("PC8-MAR-CMC-0001");

    const changed = await code(c1.caller, at.c1ParticipantId, "CCM");
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toEqual({ error: "code_in_use" });
    await ok(code(c1.caller, at.c1ParticipantId, "CMC"));
    expect((await codesOf(c1.caller, at.projectId))[at.c1ParticipantId]).toBe("CMC");
    // Another Participant's code is still free to change.
    await ok(code(c1.caller, at.k1ParticipantId, "KNS"));
    await ok(code(c1.caller, at.k1ParticipantId, "KN2"));
  });

  it("don't fix a code that the numbers printed so far did not use", async () => {
    const at = await project("PC9");
    const id = await draft(at, at.c1Engineer, "Numbered by position");
    await sendForReview(at.c1Engineer, id);
    await ok(code(c1.caller, at.c1ParticipantId, "CCM"));
    await ok(code(c1.caller, at.c1ParticipantId, "CC2"));
  });
});

describe("a Project Member of another Company", () => {
  it("cannot set a code on a Participant of a Project they are not on", async () => {
    const at = await project("PC10");
    const outsider = await projectMember(api, c2, at.c2ParticipantId, ["engineer"]);
    await expectHidden(code(outsider, at.c1ParticipantId, "ZZZ"));
  });
});
