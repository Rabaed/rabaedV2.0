// Seam 1: Participants and Project Members (RP-190; RP-185 stories 18–21;
// RP-185 scenario 10: a removed Project Member loses access immediately).
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { expectHiddenFrom } from "@rabaed/db/test-support";
import type { BaseRole, ParticipantMembers, ProjectParticipants } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { createTestApi, expectHidden, readById, uniqueCr, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };

/** The Host Company as every Participant sees it: its name only (V15). */
const HOST_COMPANY = { legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" } }; // not hidden-from: the name V15 shows every Participant

/** Who a Caller is, in a failure. */
const names = new Map<Caller, string>();
const who = (by: Caller) => names.get(by) ?? "a Member";

/** Project `id` as `by` reads it, for expectHiddenFrom: `[{ id }]`, or `[]` for the plain 404. */
const projectRead = (id: string) => readById<{ id: string }>(`/v1/projects/${id}`);
/** The Participants of Project `id` that `by` lists, or none for the plain 404. */
const participantsRead = (id: string) => async (by: Caller) =>
  (await readById<ProjectParticipants>(`/v1/projects/${id}/participants`)(by)).flatMap((list) => list.participants);
/** Participant `id`'s Project Members list as `by` reads it: `[{ id }]`, naming the Participant, or `[]` for the plain 404. */
const membersRead = (id: string) => async (by: Caller) =>
  (await readById<ParticipantMembers>(`/v1/participants/${id}/members`)(by)).map((list) => ({ id: list.participant.id }));
/** The Projects on `by`'s own list. */
const myProjects = async (by: Caller) => {
  const res = await by.get("/v1/projects");
  expect(res.statusCode).toBe(200);
  return res.json().projects as { id: string }[];
};
/** Each id of `candidates` found anywhere in what `by` gets from `path`: a row named in any field counts. */
const mentioned = (path: string, candidates: readonly string[]) => async (by: Caller) => {
  const res = await by.get(path);
  expect(res.statusCode, path).toBe(200);
  return candidates.filter((id) => res.body.includes(id)).map((id) => ({ id }));
};

let host: Company; // The Host Company: its Authorized Person is a Project Creator and the Project Admin.
let consultant: Company; // Another Company, added as a Participant.
let projectId: string;
let consultantParticipantId: string;

beforeAll(async () => {
  host = await api.projectCreator();
  consultant = await api.authorizedPerson();
  names.set(host.caller, "the host's Project Admin").set(consultant.caller, "the consultant's Authorized Person");
  projectId = (await api.createProject(host.caller)).id;
  consultantParticipantId = await api.addParticipant(host.caller, projectId, consultant.company, "consultant");
});

/** A fresh Project hosted by `host`, with `consultant` added in `role`. */
async function projectWithConsultant(role: "consultant" | "contractor" = "consultant") {
  const id = (await api.createProject(host.caller)).id;
  return { projectId: id, participantId: await api.addParticipant(host.caller, id, consultant.company, role) };
}

describe("adding a Participant", () => {
  it("lists it on the Project with its Company's name and Project Role", async () => {
    const res = await host.caller.get(`/v1/projects/${projectId}/participants`);
    expect(res.statusCode).toBe(200);
    expect(res.json().hostCompany).toEqual(HOST_COMPANY);
    expect(res.json().participants).toEqual([
      {
        id: expect.any(String),
        company: { id: host.company.companyId, legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" } }, // not hidden-from: the Project Admin's own full list, matched by id
        projectRole: { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } },
        code: null,
        ordinal: 1,
        codeLocked: false,
        isOwnCompany: true,
      },
      {
        id: consultantParticipantId,
        company: { id: consultant.company.companyId, legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" } }, // not hidden-from: the Project Admin's own full list, matched by id
        projectRole: { baseRole: "consultant", name: { en: "Consultant", ar: "الاستشاري" } },
        code: null,
        ordinal: 2,
        codeLocked: false,
        isOwnCompany: false,
      },
    ]);
  });

  it("rejects the same Company twice on one Project, in any role", async () => {
    for (const role of ["consultant", "owner"]) {
      const res = await host.caller.post(`/v1/projects/${projectId}/participants`, {
        crNumber: consultant.company.crNumber,
        role,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "already_participant" });
    }
    const hostAgain = await host.caller.post(`/v1/projects/${projectId}/participants`, {
      crNumber: host.company.crNumber,
      role: "owner",
    });
    expect(hostAgain.statusCode).toBe(409);
  });

  it("lets a Company be Contractor on one Project and Consultant on another", async () => {
    const asContractor = await projectWithConsultant("contractor");
    const asConsultant = await projectWithConsultant("consultant");
    const roleOn = async (id: string) =>
      (await host.caller.get(`/v1/projects/${id}/participants`)).json().participants.find(
        (p: { company: { id: string } }) => p.company.id === consultant.company.companyId,
      ).projectRole.baseRole;
    expect(await roleOn(asContractor.projectId)).toBe("contractor");
    expect(await roleOn(asConsultant.projectId)).toBe("consultant");
  });

  it("answers a CR number that isn't on Rabaed exactly as one that is (scenario 31)", async () => {
    const answer = (res: LightMyRequestResponse) => ({
      status: res.statusCode,
      body: res.body,
      headers: Object.keys(res.headers).filter((h) => h !== "date").sort(),
    });
    const { id } = await api.createProject(host.caller);
    const invite = async (crNumber: string) => {
      const started = performance.now();
      const res = await host.caller.post(`/v1/projects/${id}/participants`, { crNumber, role: "owner" });
      return { answer: answer(res), ms: performance.now() - started };
    };
    // Every Company is onboarded before any request is timed, so no sample comes
    // straight after an onboarding's sign-in hash and writes (RP-257).
    const pairs = 30;
    const onRabaed: string[] = [];
    for (let i = 0; i < pairs + 2; i++) onRabaed.push((await api.onboardCompany()).crNumber);
    // Warm-up, untimed: each path twice, in both orders.
    for (const crNumber of [onRabaed.pop()!, uniqueCr(), uniqueCr(), onRabaed.pop()!]) await invite(crNumber);

    const known: number[] = [];
    const unknown: number[] = [];
    for (const [i, crNumber] of onRabaed.entries()) {
      // Alternate which goes first, so neither path always follows the other.
      const [first, second] = i % 2 ? [uniqueCr(), crNumber] : [crNumber, uniqueCr()];
      const a = await invite(first);
      const b = await invite(second);
      const [isOn, isNotOn] = i % 2 ? [b, a] : [a, b];
      expect(isNotOn.answer).toEqual(isOn.answer);
      known.push(isOn.ms);
      unknown.push(isNotOn.ms);
    }
    // Timing within normal variance: neither answer's median is twice the other's.
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const [fast, slow] = [median(known), median(unknown)].sort((a, b) => a - b);
    expect(slow! / fast!).toBeLessThan(2);
  });

  it("rejects a malformed request", async () => {
    expect((await host.caller.post(`/v1/projects/${projectId}/participants`, { crNumber: "123", role: "owner" })).statusCode).toBe(400);
    expect(
      (await host.caller.post(`/v1/projects/${projectId}/participants`, { crNumber: uniqueCr(), role: "pmc" })).statusCode,
    ).toBe(400);
  });

  it("is only for a Project Admin", async () => {
    const { member, caller } = await api.member(host.caller);
    const hostParticipantId = (await host.caller.get(`/v1/projects/${projectId}/participants`)).json().participants[0].id;
    await api.addProjectMember(host.caller, hostParticipantId, member.id);
    const other = await api.authorizedPerson();
    const res = await caller.post(`/v1/projects/${projectId}/participants`, { crNumber: other.company.crNumber, role: "owner" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden" });
  });

  it("does not exist for a Member who is not on the Project", async () => {
    const outsider = await api.projectCreator();
    const other = await api.authorizedPerson();
    const madeUp = randomUUID();
    for (const id of [projectId, madeUp]) {
      const res = await outsider.caller.post(`/v1/projects/${id}/participants`, { crNumber: other.company.crNumber, role: "owner" });
      await expectHidden(res); // not hidden-from: a refused write, the plain 404 for a real and a made-up Project alike
    }
    // The list: the Project Admin reads it; the outsider gets the plain 404 (readById fails on anything else) for it and a made-up id alike.
    await expectHiddenFrom({
      read: ([by, id]: readonly [Caller, string]) => participantsRead(id)(by),
      target: consultantParticipantId,
      seenBy: [[host.caller, projectId]],
      hiddenFrom: [
        [outsider.caller, projectId],
        [outsider.caller, madeUp],
      ],
      name: ([by, id]) => `${by === outsider.caller ? "the outsider" : who(by)} on ${id === madeUp ? "a made-up id" : "the Project"}`,
    });
  });
});

describe("the Authorized Person of a Participant", () => {
  it("sees the Projects their Company takes part in, before being on them", async () => {
    const res = await consultant.caller.get("/v1/participants");
    expect(res.statusCode).toBe(200);
    expect(res.json().participants).toContainEqual({
      id: consultantParticipantId,
      project: { id: projectId, projectNumber: expect.any(Number), code: "TWR", name: expect.any(Object) },
      hostCompany: HOST_COMPANY,
      projectRole: { baseRole: "consultant", name: { en: "Consultant", ar: "الاستشاري" } },
    });
    // Not on the Project yet, so it is not among their own Projects.
    await expectHiddenFrom({ read: projectRead(projectId), target: projectId, seenBy: host.caller, hiddenFrom: consultant.caller, name: who });
  });

  it("adds their own Members, who then see the Project in their Company's role", async () => {
    const { participantId, projectId: id } = await projectWithConsultant();
    const { member, caller } = await api.member(consultant.caller);
    names.set(caller, "the consultant's Member");
    await expectHiddenFrom({ read: projectRead(id), target: id, seenBy: host.caller, hiddenFrom: caller, name: who });

    expect((await consultant.caller.post(`/v1/participants/${participantId}/members`, { memberId: member.id })).statusCode).toBe(204);
    const project = await caller.get(`/v1/projects/${id}`);
    expect(project.statusCode).toBe(200);
    expect(project.json()).toMatchObject({ projectRole: { baseRole: "consultant" }, isProjectAdmin: false });

    const list = await consultant.caller.get(`/v1/participants/${participantId}/members`);
    expect(list.json().members).toEqual([{ id: member.id, email: member.email, fullName: { en: "Test Member", ar: "عضو الاختبار" }, positions: [] }]);
  });

  it("can add themselves", async () => {
    const { participantId, projectId: id } = await projectWithConsultant();
    await api.addProjectMember(consultant.caller, participantId, consultant.company.authorizedPerson.id);
    expect((await consultant.caller.get(`/v1/projects/${id}`)).statusCode).toBe(200);
  });

  it("cannot add Members of another Company", async () => {
    const { participantId } = await projectWithConsultant();
    const { member: hostMember } = await api.member(host.caller);
    const res = await consultant.caller.post(`/v1/participants/${participantId}/members`, { memberId: hostMember.id });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "member_not_found" });
  });

  it("cannot manage another Participant's Project Members", async () => {
    const hostParticipantId = (await host.caller.get(`/v1/projects/${projectId}/participants`)).json().participants[0].id;
    const { member: consultantMember } = await api.member(consultant.caller);
    for (const res of [
      await consultant.caller.post(`/v1/participants/${hostParticipantId}/members`, { memberId: consultantMember.id }),
      await consultant.caller.delete(`/v1/participants/${hostParticipantId}/members/${host.company.authorizedPerson.id}`),
    ]) {
      await expectHidden(res); // not hidden-from: refused writes, the plain 404; the read is checked below
    }
    await expectHiddenFrom({ read: membersRead(hostParticipantId), target: hostParticipantId, seenBy: host.caller, hiddenFrom: consultant.caller, name: who });
  });

  it("is the only one: a Project Admin or a plain Member cannot add or remove", async () => {
    const { participantId } = await projectWithConsultant();
    const { member, caller: plain } = await api.member(consultant.caller);
    await api.addProjectMember(consultant.caller, participantId, member.id);

    // The host's Project Admin: the Participant is another Company's, so it's not theirs to see.
    await expectHidden(host.caller.post(`/v1/participants/${participantId}/members`, { memberId: member.id })); // not hidden-from: a refused write, the plain 404
    // A Member of the Participant who is not the Authorized Person.
    const add = await plain.post(`/v1/participants/${participantId}/members`, { memberId: consultant.company.authorizedPerson.id });
    expect(add.statusCode).toBe(403);
    expect((await plain.delete(`/v1/participants/${participantId}/members/${member.id}`)).statusCode).toBe(403);
  });
});

describe("removing a Project Member", () => {
  it("cuts their access to the Project at once (scenario 10)", async () => {
    const { participantId, projectId: id } = await projectWithConsultant();
    const { member, caller } = await api.member(consultant.caller);
    await api.addProjectMember(consultant.caller, participantId, member.id);
    expect((await caller.get(`/v1/projects/${id}`)).statusCode).toBe(200);

    expect((await consultant.caller.delete(`/v1/participants/${participantId}/members/${member.id}`)).statusCode).toBe(204);

    names.set(caller, "the removed Member");
    await expectHiddenFrom({ read: projectRead(id), target: id, seenBy: host.caller, hiddenFrom: caller, name: who, label: "the Project" });
    await expectHiddenFrom({ read: participantsRead(id), target: participantId, seenBy: host.caller, hiddenFrom: caller, name: who, label: "its Participants" });
    await expectHiddenFrom({ read: membersRead(participantId), target: participantId, seenBy: consultant.caller, hiddenFrom: caller, name: who, label: "its Project Members" });
    await expectHiddenFrom({ read: myProjects, target: id, seenBy: host.caller, hiddenFrom: caller, name: who, label: "their Projects" });
    expect((await consultant.caller.get(`/v1/participants/${participantId}/members`)).json().members).toEqual([]); // not hidden-from: the Authorized Person's own list, the removed Member gone (state)
  });

  it("can be undone by adding them again", async () => {
    const { participantId, projectId: id } = await projectWithConsultant();
    const { member, caller } = await api.member(consultant.caller);
    await api.addProjectMember(consultant.caller, participantId, member.id);
    await consultant.caller.delete(`/v1/participants/${participantId}/members/${member.id}`);
    await api.addProjectMember(consultant.caller, participantId, member.id);
    expect((await caller.get(`/v1/projects/${id}`)).statusCode).toBe(200);
  });

  it("answers a Member who is not on the Project as not found", async () => {
    const { participantId } = await projectWithConsultant();
    const { member } = await api.member(consultant.caller);
    const res = await consultant.caller.delete(`/v1/participants/${participantId}/members/${member.id}`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "member_not_found" });
  });
});

describe("a Participant's Project Members list", () => {
  it("is visible to that Participant's own Members on the Project, and to no other Participant", async () => {
    const { participantId, projectId: id } = await projectWithConsultant();
    const { member, caller: consultantMember } = await api.member(consultant.caller);
    await api.addProjectMember(consultant.caller, participantId, member.id);

    const own = await consultantMember.get(`/v1/participants/${participantId}/members`);
    expect(own.statusCode).toBe(200);
    expect(own.json().members.map((m: { id: string }) => m.id)).toEqual([member.id]);

    // The host sees the Participant on the Project, but not who its Members are.
    // The scan finds the Member's id where it is, in the Participant's own list, and not in the host's.
    const hostView = await host.caller.get(`/v1/projects/${id}/participants`);
    expect(hostView.statusCode).toBe(200);
    await expectHiddenFrom({
      read: async (body: string) => (body.includes(member.id) ? [{ id: member.id }] : []),
      target: member.id,
      seenBy: own.body,
      hiddenFrom: hostView.body,
      name: (body) => (body === own.body ? "the Participant's own Project Members list" : "the host's list of Participants"),
    });
    names.set(consultantMember, "the consultant's Member");
    await expectHiddenFrom({ read: membersRead(participantId), target: participantId, seenBy: consultantMember, hiddenFrom: host.caller, name: who });
  });
});

// visibility.md V15, scenarios 28 and 29 (RP-223): a Participant sees only its
// own participation and the Host Company's name; Project Admins see every Participant.
describe("the Participants of a Project", () => {
  type Guest = "c1" | "c2" | "k1" | "or";
  let tower: string;
  const ids: Record<"host" | Guest, string> = { host: "", c1: "", c2: "", k1: "", or: "" };
  /** A Member of each Participant on the Tower, who reads its own Participant: the host's is its Project Admin. */
  const readers = {} as Record<"host" | Guest, Caller>;
  let c1: Company;
  let c1Member: Caller;
  let c1MemberId: string;

  beforeAll(async () => {
    tower = (await api.createProject(host.caller, { role: "owner" })).id;
    ids.host = (await host.caller.get(`/v1/projects/${tower}/participants`)).json().participants[0].id;
    // Each Participant with one Project Member of its own.
    const join = async (key: Guest, role: BaseRole) => {
      const company = await api.authorizedPerson();
      ids[key] = await api.addParticipant(host.caller, tower, company.company, role);
      const { member, caller } = await api.member(company.caller);
      await api.addProjectMember(company.caller, ids[key], member.id);
      readers[key] = caller;
      names.set(caller, `${key.toUpperCase()}'s Member`).set(company.caller, `${key.toUpperCase()}'s Authorized Person`);
      return { company, member, caller };
    };
    readers.host = host.caller;
    const first = await join("c1", "contractor");
    [c1, c1Member, c1MemberId] = [first.company, first.caller, first.member.id];
    await join("c2", "contractor");
    await join("k1", "consultant");
    await join("or", "owner_representative");
  });

  it("shows a C1 member only C1's own Participant and the Host Company's name (scenario 28)", async () => {
    const res = await c1Member.get(`/v1/projects/${tower}/participants`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      hostCompany: HOST_COMPANY,
      participants: [
        {
          id: ids.c1,
          company: { id: c1.company.companyId, legalName: expect.any(Object) }, // not hidden-from: C1's own row, matched by id
          projectRole: { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } },
          code: null,
          // Not even its own order on the Project, which would count the others (RP-381-1).
          ordinal: null,
          codeLocked: false,
          isOwnCompany: true,
        },
      ],
    });
    // Nowhere in the answer: the Project Admin's names each of these.
    const others = [ids.host, ids.c2, ids.k1, ids.or, host.company.companyId];
    for (const other of others) {
      await expectHiddenFrom({ read: mentioned(`/v1/projects/${tower}/participants`, others), target: other, seenBy: host.caller, hiddenFrom: c1Member, name: who });
    }
  });

  it("shows C1 its own Project Members with their Positions", async () => {
    const res = await c1Member.get(`/v1/participants/${ids.c1}/members`);
    expect(res.statusCode).toBe(200);
    expect(res.json().participant.hostCompany).toEqual(HOST_COMPANY);
    expect(res.json().members).toEqual([expect.objectContaining({ id: c1MemberId, positions: [] })]);
    for (const other of ["host", "c2", "k1", "or"] as const) {
      await expectHiddenFrom({ read: membersRead(ids[other]), target: ids[other], seenBy: readers[other], hiddenFrom: c1Member, name: who });
    }
  });

  it("shows a Project Admin every Participant (scenario 29)", async () => {
    const res = await host.caller.get(`/v1/projects/${tower}/participants`);
    expect(res.statusCode).toBe(200);
    expect(res.json().participants.map((p: { id: string }) => p.id)).toEqual([ids.host, ids.c1, ids.c2, ids.k1, ids.or]);
  });

  it("shows a host Member who is not a Project Admin only their own Participant", async () => {
    const { member, caller } = await api.member(host.caller);
    await api.addProjectMember(host.caller, ids.host, member.id);
    const res = await caller.get(`/v1/projects/${tower}/participants`);
    expect(res.json().participants.map((p: { id: string }) => p.id)).toEqual([ids.host]);
  });

  it("shows the Company Projects view the Host Company's name and the Company's own Project Role", async () => {
    const res = await c1.caller.get("/v1/participants");
    expect(res.json().participants).toContainEqual({
      id: ids.c1,
      project: { id: tower, projectNumber: expect.any(Number), code: "TWR", name: expect.any(Object) },
      hostCompany: HOST_COMPANY,
      projectRole: { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } },
    });
  });

  // Scenario RP-1051-1 (V15): every Member of a Participant reads Company Projects, read-only.
  it("shows a C1 member who is not the Authorized Person C1's Company Projects, only those they are on (scenario RP-1051-1)", async () => {
    // A second Project C1 takes part in, without this Member: theirs to read only once they are on it.
    const annex = (await api.createProject(host.caller, { role: "owner" })).id;
    const annexC1 = await api.addParticipant(host.caller, annex, c1.company, "contractor");

    const res = await c1Member.get("/v1/participants");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      participants: [
        {
          id: ids.c1,
          project: { id: tower, projectNumber: expect.any(Number), code: "TWR", name: expect.any(Object) },
          hostCompany: HOST_COMPANY,
          projectRole: { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } },
        },
      ],
    });
    // No other Participant, and another Company only as the Host Company's name.
    // Each named nowhere in the answer, though its own reader's Company Projects names it.
    const others = [ids.host, ids.c2, ids.k1, ids.or, host.company.companyId, annex, annexC1];
    for (const [other, seenBy] of [
      [ids.host, readers.host],
      [ids.c2, readers.c2],
      [ids.k1, readers.k1],
      [ids.or, readers.or],
      [annex, c1.caller],
      [annexC1, c1.caller],
    ] as const) {
      await expectHiddenFrom({ read: mentioned("/v1/participants", others), target: other, seenBy, hiddenFrom: c1Member, name: who });
    }
    expect(res.body).not.toContain(host.company.companyId); // not hidden-from: no Company Projects answer, anyone's, has a Company id: the Host Company only by name (V15)
    // The Authorized Person reads both; their Company's pending invitations stay theirs (ADR 0009).
    expect((await c1.caller.get("/v1/participants")).json().participants.map((p: { id: string }) => p.id)).toEqual([annexC1, ids.c1]);
    expect((await c1Member.get("/v1/participant-invitations")).statusCode).toBe(403);

    // A C1 Member on no Project of C1's reads an empty list.
    const { caller: offProject } = await api.member(c1.caller);
    const none = await offProject.get("/v1/participants");
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ participants: [] });
  });
});
