// Seam 1: Participants and Project Members (RP-190; RP-185 stories 18–21;
// RP-185 scenario 10: a removed Project Member loses access immediately).
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { BaseRole } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { createTestApi, expectHidden, uniqueCr, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

type Company = { company: OnboardedCompany; caller: Caller };

/** The Host Company as every Participant sees it: its name only (V15). */
const HOST_COMPANY = { legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" } };

let host: Company; // The Host Company: its Authorized Person is a Project Creator and the Project Admin.
let consultant: Company; // Another Company, added as a Participant.
let projectId: string;
let consultantParticipantId: string;

beforeAll(async () => {
  host = await api.projectCreator();
  consultant = await api.authorizedPerson();
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
        company: { id: host.company.companyId, legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" } },
        projectRole: { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } },
        isOwnCompany: true,
      },
      {
        id: consultantParticipantId,
        company: { id: consultant.company.companyId, legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" } },
        projectRole: { baseRole: "consultant", name: { en: "Consultant", ar: "الاستشاري" } },
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
    for (const id of [projectId, randomUUID()]) {
      const res = await outsider.caller.post(`/v1/projects/${id}/participants`, { crNumber: other.company.crNumber, role: "owner" });
      await expectHidden(res);
      await expectHidden(outsider.caller.get(`/v1/projects/${id}/participants`));
    }
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
    await expectHidden(consultant.caller.get(`/v1/projects/${projectId}`));
  });

  it("adds their own Members, who then see the Project in their Company's role", async () => {
    const { participantId, projectId: id } = await projectWithConsultant();
    const { member, caller } = await api.member(consultant.caller);
    await expectHidden(caller.get(`/v1/projects/${id}`));

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
      await consultant.caller.get(`/v1/participants/${hostParticipantId}/members`),
    ]) {
      await expectHidden(res);
    }
  });

  it("is the only one: a Project Admin or a plain Member cannot add or remove", async () => {
    const { participantId } = await projectWithConsultant();
    const { member, caller: plain } = await api.member(consultant.caller);
    await api.addProjectMember(consultant.caller, participantId, member.id);

    // The host's Project Admin: the Participant is another Company's, so it's not theirs to see.
    await expectHidden(host.caller.post(`/v1/participants/${participantId}/members`, { memberId: member.id }));
    // A Member of the Participant who is not the Authorized Person.
    const add = await plain.post(`/v1/participants/${participantId}/members`, { memberId: consultant.company.authorizedPerson.id });
    expect(add.statusCode).toBe(403);
    expect((await plain.delete(`/v1/participants/${participantId}/members/${member.id}`)).statusCode).toBe(403);
    expect((await plain.get("/v1/participants")).statusCode).toBe(403);
  });
});

describe("removing a Project Member", () => {
  it("cuts their access to the Project at once (scenario 10)", async () => {
    const { participantId, projectId: id } = await projectWithConsultant();
    const { member, caller } = await api.member(consultant.caller);
    await api.addProjectMember(consultant.caller, participantId, member.id);
    expect((await caller.get(`/v1/projects/${id}`)).statusCode).toBe(200);

    expect((await consultant.caller.delete(`/v1/participants/${participantId}/members/${member.id}`)).statusCode).toBe(204);

    for (const url of [`/v1/projects/${id}`, `/v1/projects/${id}/participants`, `/v1/participants/${participantId}/members`]) {
      const res = await caller.get(url);
      await expectHidden(res, url);
    }
    expect((await caller.get("/v1/projects")).json().projects.map((p: { id: string }) => p.id)).not.toContain(id);
    expect((await consultant.caller.get(`/v1/participants/${participantId}/members`)).json().members).toEqual([]);
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
    const hostView = (await host.caller.get(`/v1/projects/${id}/participants`)).json();
    expect(JSON.stringify(hostView)).not.toContain(member.id);
    const res = await host.caller.get(`/v1/participants/${participantId}/members`);
    await expectHidden(res);
  });
});

// visibility.md V15, scenarios 28 and 29 (RP-223): a Participant sees only its
// own participation and the Host Company's name; Project Admins see every Participant.
describe("the Participants of a Project", () => {
  type Guest = "c1" | "c2" | "k1" | "or";
  let tower: string;
  const ids: Record<"host" | Guest, string> = { host: "", c1: "", c2: "", k1: "", or: "" };
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
      return { company, member, caller };
    };
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
          company: { id: c1.company.companyId, legalName: expect.any(Object) },
          projectRole: { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } },
          isOwnCompany: true,
        },
      ],
    });
    for (const other of [ids.host, ids.c2, ids.k1, ids.or, host.company.companyId]) expect(res.body).not.toContain(other);
  });

  it("shows C1 its own Project Members with their Positions", async () => {
    const res = await c1Member.get(`/v1/participants/${ids.c1}/members`);
    expect(res.statusCode).toBe(200);
    expect(res.json().participant.hostCompany).toEqual(HOST_COMPANY);
    expect(res.json().members).toEqual([expect.objectContaining({ id: c1MemberId, positions: [] })]);
    for (const other of [ids.host, ids.c2, ids.k1, ids.or]) {
      await expectHidden(c1Member.get(`/v1/participants/${other}/members`));
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
});
