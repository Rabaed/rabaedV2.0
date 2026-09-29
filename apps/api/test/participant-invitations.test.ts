// Seam 1: Participant Invitations with consent, and one answer to a CR number
// (RP-224; ADR 0009; visibility.md V15, scenarios 30 and 31).
import { randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, uniqueCr, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
// Reads the audit trail the way Rabaed Admin would.
const adminDb = createDb(testDatabaseUrls().admin, { max: 1 });
afterAll(async () => {
  await api.close();
  await adminDb.destroy();
});

type Company = { company: OnboardedCompany; caller: Caller };

let host: Company; // Its Authorized Person creates the Project and is its Project Admin.
let c1: Company; // A Participant that joined, with a Project Member.
let c1Member: Caller;
let projectId: string;

beforeAll(async () => {
  host = await api.projectCreator();
  c1 = await api.authorizedPerson();
  projectId = (await api.createProject(host.caller, { role: "owner" })).id;
  const c1Participant = await api.addParticipant(host.caller, projectId, c1.company, "contractor");
  const { member, caller } = await api.member(c1.caller);
  await api.addProjectMember(c1.caller, c1Participant, member.id);
  c1Member = caller;
});

/** A new Company with a signed-in Authorized Person, invited to the Project by the Project Admin. */
async function invited(role = "consultant"): Promise<Company & { invitationId: string }> {
  const company = await api.authorizedPerson();
  const res = await host.caller.post(`/v1/projects/${projectId}/participants`, { crNumber: company.company.crNumber, role });
  expect(res.statusCode).toBe(202);
  const invitationId = (await company.caller.get("/v1/participant-invitations")).json().invitations[0].id;
  return { ...company, invitationId };
}

const participantIds = async (caller: Caller) =>
  (await caller.get(`/v1/projects/${projectId}/participants`)).json().participants.map((p: { id: string }) => p.id);

describe("a Company invited to a Project, before it accepts (scenario 30)", () => {
  let k1: Company & { invitationId: string };

  beforeAll(async () => {
    k1 = await invited("consultant");
  });

  it("sees only the invitation: the Project's name, the Host Company and the offered Project Role", async () => {
    const res = await k1.caller.get("/v1/participant-invitations");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      invitations: [
        {
          id: k1.invitationId,
          project: { name: { en: "Riyadh Gate Tower", ar: "برج بوابة الرياض" } },
          hostCompany: { legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" } },
          projectRole: { baseRole: "consultant", name: { en: "Consultant", ar: "الاستشاري" } },
          invitedAt: expect.any(String),
        },
      ],
    });
    expect(res.body).not.toContain(projectId);
    // Nothing of the Project itself, nor a Participation to manage.
    expect((await k1.caller.get("/v1/participants")).json().participants).toEqual([]);
    for (const url of [
      `/v1/projects/${projectId}`,
      `/v1/projects/${projectId}/participants`,
      `/v1/participants/${k1.invitationId}/members`,
      `/v1/participants/${k1.invitationId}/visibility`,
    ]) {
      await expectHidden(k1.caller.get(url), url);
    }
    const add = await k1.caller.post(`/v1/participants/${k1.invitationId}/members`, { memberId: k1.company.authorizedPerson.id });
    await expectHidden(add);
  });

  it("appears nowhere for another Participant", async () => {
    expect(await participantIds(c1Member)).not.toContain(k1.invitationId);
    // C1's Authorized Person's Company Projects.
    const list = await c1.caller.get("/v1/participants");
    expect(list.body).not.toContain(k1.invitationId);
    expect(list.body).not.toContain(k1.company.companyId);
    await expectHidden(c1Member.get(`/v1/participants/${k1.invitationId}/members`));
    // Pending invitations are the Project Admins' alone.
    const res = await c1Member.get(`/v1/projects/${projectId}/invitations`);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden" });
  });

  it("is listed for the Project Admin as a pending invitation by CR number, never by name", async () => {
    expect(await participantIds(host.caller)).not.toContain(k1.invitationId);
    const res = await host.caller.get(`/v1/projects/${projectId}/invitations`);
    expect(res.statusCode).toBe(200);
    expect(res.json().invitations).toContainEqual({
      id: k1.invitationId,
      crNumber: k1.company.crNumber,
      projectRole: { baseRole: "consultant", name: { en: "Consultant", ar: "الاستشاري" } },
      invitedAt: expect.any(String),
    });
    expect(res.body).not.toContain(k1.company.companyId);
  });

  it("lists a CR number that isn't on Rabaed for the Project Admin just like one that is", async () => {
    const cr = uniqueCr();
    await host.caller.post(`/v1/projects/${projectId}/participants`, { crNumber: cr, role: "owner_representative" });
    const invitations = (await host.caller.get(`/v1/projects/${projectId}/invitations`)).json().invitations;
    expect(invitations).toContainEqual({
      id: expect.any(String),
      crNumber: cr,
      projectRole: { baseRole: "owner_representative", name: expect.any(Object) },
      invitedAt: expect.any(String),
    });
  });

  it("answers someone not on the Project as not found", async () => {
    const outsider = await api.projectCreator();
    for (const id of [projectId, randomUUID()]) {
      await expectHidden(outsider.caller.get(`/v1/projects/${id}/invitations`));
    }
  });
});

describe("answering an invitation", () => {
  it("accepting makes the Company a Participant in the offered Project Role", async () => {
    const k2 = await invited("owner_representative");
    const res = await k2.caller.post(`/v1/participant-invitations/${k2.invitationId}/accept`);
    expect(res.statusCode).toBe(204);

    expect((await k2.caller.get("/v1/participant-invitations")).json().invitations).toEqual([]);
    expect((await k2.caller.get("/v1/participants")).json().participants).toEqual([
      expect.objectContaining({
        id: k2.invitationId,
        project: expect.objectContaining({ id: projectId }),
        projectRole: expect.objectContaining({ baseRole: "owner_representative" }),
      }),
    ]);
    expect(await participantIds(host.caller)).toContain(k2.invitationId);
    const pending = (await host.caller.get(`/v1/projects/${projectId}/invitations`)).json().invitations;
    expect(pending.map((i: { id: string }) => i.id)).not.toContain(k2.invitationId);
    // Its Authorized Person now adds Project Members (V15), who then see the Project.
    const { member, caller } = await api.member(k2.caller);
    await api.addProjectMember(k2.caller, k2.invitationId, member.id);
    expect((await caller.get(`/v1/projects/${projectId}`)).statusCode).toBe(200);
    // Other Participants still don't see it (V15).
    expect(await participantIds(c1Member)).not.toContain(k2.invitationId);
    // Inviting it again: every Project Admin sees it on the Project already.
    const again = await host.caller.post(`/v1/projects/${projectId}/participants`, { crNumber: k2.company.crNumber, role: "owner" });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "already_participant" });
  });

  it("declining changes nothing on the Project", async () => {
    const k3 = await invited();
    const before = await participantIds(host.caller);
    expect((await k3.caller.post(`/v1/participant-invitations/${k3.invitationId}/decline`)).statusCode).toBe(204);

    expect((await k3.caller.get("/v1/participant-invitations")).json().invitations).toEqual([]);
    expect((await k3.caller.get("/v1/participants")).json().participants).toEqual([]);
    expect(await participantIds(host.caller)).toEqual(before);
    const pending = (await host.caller.get(`/v1/projects/${projectId}/invitations`)).json().invitations;
    // Still "awaiting an answer" for the Project Admin, like a CR number that isn't on
    // Rabaed: a decline doesn't reveal that the Company is a customer (scenario 31).
    expect(pending).toContainEqual({
      id: k3.invitationId,
      crNumber: k3.company.crNumber,
      projectRole: expect.objectContaining({ baseRole: "consultant" }),
      invitedAt: expect.any(String),
    });
    // Answered already: nothing left to accept.
    await expectHidden(k3.caller.post(`/v1/participant-invitations/${k3.invitationId}/accept`));
  });

  it("is for the invited Company's Authorized Person only", async () => {
    const k4 = await invited();
    const { caller: k4Member } = await api.member(k4.caller);
    for (const answer of ["accept", "decline"]) {
      const url = `/v1/participant-invitations/${k4.invitationId}/${answer}`;
      // Another Company's Authorized Person, the Project Admin included: as if it didn't exist.
      for (const caller of [c1.caller, host.caller]) {
        const res = await caller.post(url);
        await expectHidden(res);
      }
      expect((await k4Member.post(url)).statusCode).toBe(403);
      expect((await api.anonymous().post(url)).statusCode).toBe(401);
    }
    expect((await k4Member.get("/v1/participant-invitations")).statusCode).toBe(403);
    for (const id of [randomUUID(), "not-a-uuid"]) {
      await expectHidden(k4.caller.post(`/v1/participant-invitations/${id}/accept`));
    }
    // Still pending.
    expect((await k4.caller.get("/v1/participant-invitations")).json().invitations).toHaveLength(1);
  });

  it("is only for a Project Admin to send", async () => {
    const other = await api.authorizedPerson();
    const res = await c1Member.post(`/v1/projects/${projectId}/participants`, { crNumber: other.company.crNumber, role: "owner" });
    expect(res.statusCode).toBe(403);
    expect((await other.caller.get("/v1/participant-invitations")).json().invitations).toEqual([]);
  });
});

describe("an onboarding lead", () => {
  it("records a CR number that isn't on Rabaed, readable only through Rabaed Admin with a reason (V9)", async () => {
    const cr = uniqueCr();
    await host.caller.post(`/v1/projects/${projectId}/participants`, { crNumber: cr, role: "consultant" });

    const engineer = await api.engineer();
    const reason = `Weekly onboarding follow-up ${randomUUID()}`;
    const res = await engineer.get(`/admin/v1/onboarding-leads?reason=${encodeURIComponent(reason)}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().leads).toContainEqual({
      id: expect.any(String),
      crNumber: cr,
      project: { id: projectId, projectNumber: expect.any(Number), code: "TWR", name: expect.any(Object) },
      hostCompany: { id: host.company.companyId, legalName: expect.any(Object) },
      baseRole: "consultant",
      requestedAt: expect.any(String),
    });
    // A Company on Rabaed is invited, never a lead.
    expect(res.body).not.toContain(c1.company.crNumber);

    const logged = await adminDb
      .selectFrom("admin_action")
      .select(["action", "target_kind", "target_id"])
      .where("reason", "=", reason)
      .execute();
    expect(logged).toEqual([{ action: "read_onboarding_leads", target_kind: "onboarding_lead", target_id: null }]);
  });

  it("needs a reason", async () => {
    const engineer = await api.engineer();
    for (const url of ["/admin/v1/onboarding-leads", "/admin/v1/onboarding-leads?reason=%20%20"]) {
      expect((await engineer.get(url)).statusCode, url).toBe(400);
    }
  });

  it("does not exist for a Member", async () => {
    for (const caller of [host.caller, api.anonymous()]) {
      const res = await caller.get("/admin/v1/onboarding-leads?reason=curious");
      await expectHidden(res);
    }
  });
});
