// Seam 1: a Project Creator creates a Project; only its Members see it
// (RP-189; RP-185 stories 14–17, 26; visibility.md scenario matrix, RP-185 scenario 9).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, expectHidden, type Caller, type OnboardedCompany } from "./support/harness.ts";

const api = await createTestApi();
afterAll(() => api.close());

let a: { company: OnboardedCompany; caller: Caller };
beforeAll(async () => {
  a = await api.projectCreator();
});

const projectIds = (res: { json(): { projects: { id: string }[] } }) => res.json().projects.map((p) => p.id);

describe("creating a Project", () => {
  it("makes the creator's Company a Participant and the creator a Project Admin and Project Member", async () => {
    const res = await a.caller.post("/v1/projects", {
      name: { en: "Riyadh Gate Tower – Phase 2", ar: "برج بوابة الرياض – المرحلة الثانية" },
      code: "twr",
      role: "contractor",
    });
    expect(res.statusCode).toBe(201);
    const { projectId, projectNumber } = res.json();

    const project = await a.caller.get(`/v1/projects/${projectId}`);
    expect(project.statusCode).toBe(200);
    expect(project.json()).toEqual({
      id: projectId,
      projectNumber,
      code: "TWR",
      name: { en: "Riyadh Gate Tower – Phase 2", ar: "برج بوابة الرياض – المرحلة الثانية" },
      status: "active",
      projectRole: { baseRole: "contractor", name: { en: "Contractor", ar: "المقاول" } },
      isProjectAdmin: true,
      needMyAction: 0,
      modules: ["submittals"],
    });
    expect(projectIds(await a.caller.get("/v1/projects"))).toContain(projectId);
  });

  it("lets the creator's Company take any Project Role", async () => {
    for (const role of ["consultant", "owner", "owner_representative"] as const) {
      const { id } = await api.createProject(a.caller, { role });
      expect((await a.caller.get(`/v1/projects/${id}`)).json().projectRole.baseRole).toBe(role);
    }
  });

  it("rejects a malformed request", async () => {
    const valid = { name: { en: "X", ar: "س" }, code: "ABC", role: "contractor" };
    for (const body of [
      { ...valid, code: "A" },
      { ...valid, code: "WAY-TOO-LONG" },
      { ...valid, role: "subcontractor" },
      { ...valid, name: { en: "X" } },
    ]) {
      expect((await a.caller.post("/v1/projects", body)).statusCode).toBe(400);
    }
  });
});

describe("who can create a Project", () => {
  it("is only a Member flagged Project Creator", async () => {
    const { caller: ap } = await api.authorizedPerson();
    const request = { name: { en: "X", ar: "س" }, code: "ABC", role: "contractor" };

    const refused = await ap.post("/v1/projects", request);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: "forbidden" });
    expect((await ap.get("/v1/projects")).json().projects).toEqual([]);

    const { member, caller } = await api.member(ap);
    expect((await caller.post("/v1/projects", request)).statusCode).toBe(403);
    await ap.patch(`/v1/members/${member.id}`, { canCreateProjects: true });
    expect((await caller.post("/v1/projects", request)).statusCode).toBe(201);

    await ap.patch(`/v1/members/${member.id}`, { canCreateProjects: false });
    expect((await caller.post("/v1/projects", request)).statusCode).toBe(403);
  });

  it("needs a signed-in Member", async () => {
    const res = await api.anonymous().post("/v1/projects", { name: { en: "X", ar: "س" }, code: "ABC", role: "contractor" });
    expect(res.statusCode).toBe(401);
  });
});

describe("Project Numbers", () => {
  it("run 1, 2, 3… per Host Company", async () => {
    const b = await api.projectCreator();
    const c = await api.projectCreator();
    expect((await api.createProject(b.caller)).projectNumber).toBe(1);
    expect((await api.createProject(c.caller)).projectNumber).toBe(1);
    expect((await api.createProject(b.caller)).projectNumber).toBe(2);
    expect((await api.createProject(b.caller)).projectNumber).toBe(3);
    expect((await api.createProject(c.caller)).projectNumber).toBe(2);
  });

  it("stay distinct and gap-free when created at the same moment", async () => {
    const b = await api.projectCreator();
    const c = await api.projectCreator();
    const created = await Promise.all([
      ...Array.from({ length: 6 }, () => api.createProject(b.caller)),
      ...Array.from({ length: 4 }, () => api.createProject(c.caller)),
    ]);
    const numbers = (from: number, to: number) => created.slice(from, to).map((p) => p.projectNumber).sort((x, y) => x - y);
    expect(numbers(0, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numbers(6, 10)).toEqual([1, 2, 3, 4]);
  });
});

describe("a Project is invisible to anyone not on it", () => {
  it("for a Member of the same Company", async () => {
    const project = await api.createProject(a.caller);
    const { caller: colleague } = await api.member(a.caller);
    expect(projectIds(await colleague.get("/v1/projects"))).not.toContain(project.id);
    const res = await colleague.get(`/v1/projects/${project.id}`);
    await expectHidden(res);
  });

  it("for another Company, exactly like an id that doesn't exist (scenario 9)", async () => {
    const project = await api.createProject(a.caller);
    const other = await api.projectCreator();
    await api.createProject(other.caller);
    expect(projectIds(await other.caller.get("/v1/projects"))).not.toContain(project.id);

    const hidden = await other.caller.get(`/v1/projects/${project.id}`);
    const missing = await other.caller.get(`/v1/projects/${randomUUID()}`);
    const malformed = await other.caller.get("/v1/projects/not-an-id");
    for (const res of [hidden, missing, malformed]) {
      await expectHidden(res);
    }
  });

  it("and needs a signed-in Member", async () => {
    const project = await api.createProject(a.caller);
    expect((await api.anonymous().get("/v1/projects")).statusCode).toBe(401);
    expect((await api.anonymous().get(`/v1/projects/${project.id}`)).statusCode).toBe(401);
  });
});

describe("the Projects page", () => {
  it("lists the Member's Projects, newest first", async () => {
    const b = await api.projectCreator();
    const first = await api.createProject(b.caller, { code: "ONE" });
    const second = await api.createProject(b.caller, { code: "TWO" });
    const res = await b.caller.get("/v1/projects");
    expect(res.statusCode).toBe(200);
    expect(projectIds(res)).toEqual([second.id, first.id]);
  });
});
