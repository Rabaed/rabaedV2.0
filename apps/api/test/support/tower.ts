// The Tower setup shared by the Links tests (spec RP-289): a Project of C1's
// (Contractor, its creator) with K1 as its Consultant, and the MARs those tests
// link to, from Draft to Submitted.
import { randomUUID } from "node:crypto";
import type { VisibilityGrant, WorkItemDetail } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { attachDatasheet, type Caller, type OnboardedCompany, type TestApi } from "./harness.ts";

/** An onboarded Company and its signed-in Authorized Person. */
export type Company = { company: OnboardedCompany; caller: Caller };

export const bilingual = (text: string) => ({ en: text, ar: text });
/** Visibility of all of a dimension. */
export const all: VisibilityGrant = { isAll: true, valueIds: [] };
/** Visibility of these values of a dimension only. */
export const only = (...valueIds: string[]): VisibilityGrant => ({ isAll: false, valueIds });

/** Asserts the response's status (204 by default) and returns it. */
export async function ok(res: Promise<LightMyRequestResponse>, status = 204) {
  const r = await res;
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

/** What sets a Member on a Project apart: their Trade Visibility (all by default) and their name. */
export type MemberOptions = { trade?: VisibilityGrant; name?: string };

/** A signed-in Member of `company` (named `name`, if given), on the Project through `participantId`, with `positions` and that Trade Visibility, and their id and email. */
export async function memberOnProject(
  api: TestApi,
  company: Pick<Company, "caller">,
  participantId: string,
  positions: string[],
  { trade = all, name }: MemberOptions = {},
) {
  const member = await api.inviteMember(company.caller, name === undefined ? {} : { fullName: bilingual(name) });
  const caller = await api.acceptInvitation(member.invitationToken);
  await api.addProjectMember(company.caller, participantId, member.id);
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/visibility`, { trade, location: all }));
  await ok(company.caller.request("PUT", `/v1/participants/${participantId}/members/${member.id}/positions`, { positions }));
  return { id: member.id, caller, email: member.email };
}

/** A signed-in Member of `company` (named `name`, if given), on the Project through `participantId`, with `positions` and that Trade Visibility. */
export async function projectMember(api: TestApi, company: Pick<Company, "caller">, participantId: string, positions: string[], options: MemberOptions = {}) {
  return (await memberOnProject(api, company, participantId, positions, options)).caller;
}

/** What a Transition may carry: `reason` and `remarks` are answers; `answers` are all of them (given with either, `reason` and `remarks` win). */
export type TakeOptions = {
  reason?: string;
  remarks?: string;
  answers?: Record<string, unknown>;
  internalNote?: string;
  idempotencyKey?: string;
  /** "Assign to" (WF-8): the next holder picked. */
  assignTo?: string;
  /** The Recommended Code (RP-433), from a Step that Recommends a Code. */
  recommendedCode?: string;
};

/** `by` takes Transition `transition` on item `id`, and the response is returned as it came, for a test of a refusal. */
export const tryTake = (by: Caller, id: string, transition: string, { reason, remarks, answers, ...rest }: TakeOptions = {}) => {
  const own = { ...answers, ...(reason === undefined ? {} : { reason }), ...(remarks === undefined ? {} : { remarks }) };
  const hasAnswers = answers !== undefined || reason !== undefined || remarks !== undefined;
  return by.post(`/v1/work-items/${id}/transitions`, { transition, idempotencyKey: randomUUID(), ...(hasAnswers ? { answers: own } : {}), ...rest });
};

/** `by` takes Transition `transition` on item `id`, and it is accepted. */
export const take = (by: Caller, id: string, transition: string, options: TakeOptions = {}) => ok(tryTake(by, id, transition, options));

/** Item `id` as `by` reads it. */
export const detail = async (by: Caller, id: string): Promise<WorkItemDetail> => (await ok(by.get(`/v1/work-items/${id}`), 200)).json();

/** One Project as buildTower builds it, with the people who work on it. */
export type Tower = {
  projectId: string;
  c1ParticipantId: string;
  electrical: string;
  mechanical: string;
  buildingA: string;
  c1Engineer: Caller;
  c1Pm: Caller;
  k1Manager: Caller;
};

/** A Project of C1's, with a C1 engineer and PM, and K1 as its Consultant with a manager; both see all of it. */
export async function buildTower(api: TestApi, { c1, k1 }: { c1: Company; k1: Company }, code: string): Promise<Tower> {
  const projectId = (await api.createProject(c1.caller, { code })).id;
  const post = async (path: string, body: unknown) => (await c1.caller.post(`/v1/projects/${projectId}/${path}`, body)).json().id;
  const electrical = await post("trades", { code: "EL", name: bilingual("Electrical") });
  const mechanical = await post("trades", { code: "ME", name: bilingual("Mechanical") });
  const buildingA = await post("locations", { code: "BA", name: bilingual("Building A"), parentId: null });
  const c1ParticipantId = (await c1.caller.get(`/v1/projects/${projectId}/participants`))
    .json()
    .participants.find((p: { isOwnCompany: boolean }) => p.isOwnCompany).id;
  await ok(c1.caller.request("PUT", `/v1/participants/${c1ParticipantId}/visibility`, { trade: all, location: all }));
  const k1ParticipantId = await api.addParticipant(c1.caller, projectId, k1.company, "consultant");
  await ok(c1.caller.request("PUT", `/v1/participants/${k1ParticipantId}/visibility`, { trade: all, location: all }));
  return {
    projectId,
    c1ParticipantId,
    electrical,
    mechanical,
    buildingA,
    c1Engineer: await projectMember(api, c1, c1ParticipantId, ["engineer"]),
    c1Pm: await projectMember(api, c1, c1ParticipantId, ["project_manager"]),
    k1Manager: await projectMember(api, k1, k1ParticipantId, ["manager"]),
  };
}

/** A Draft MAR with the Subject `title`, on `at`'s Project, in Building A. */
export async function draft(at: Tower, engineer: Caller, title: string, trade = at.electrical): Promise<string> {
  const res = await engineer.post(`/v1/projects/${at.projectId}/work-items`, {
    type: "MAR",
    title,
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade, location: at.buildingA },
  });
  expect(res.statusCode, res.body).toBe(201);
  await attachDatasheet(engineer, res.json().id);
  return res.json().id;
}

/** A MAR sent to the raiser's own internal review. */
export async function inInternalReview(at: Tower, engineer: Caller, title: string): Promise<string> {
  const id = await draft(at, engineer, title);
  await take(engineer, id, "send_for_review");
  return id;
}

/** A MAR Submitted to the Consultant. */
export async function submitted(at: Tower, engineer: Caller, pm: Caller, title: string, trade = at.electrical): Promise<string> {
  const id = await draft(at, engineer, title, trade);
  await take(engineer, id, "send_for_review");
  await ok(pm.post(`/v1/work-items/${id}/claim`));
  await take(pm, id, "submit");
  return id;
}
