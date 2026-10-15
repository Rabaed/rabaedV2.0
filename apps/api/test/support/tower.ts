// The Tower setup shared by the Links tests (spec RP-289): a Project of C1's
// (Contractor, its creator) with K1 as its Consultant, and the MARs those tests
// link to, from Draft to Submitted.
//
// The MARs are the legacy MAR (LEGACY_MAR, "MARV"), not the real "MAR", unless the test
// passes { type: "MAR" } to draft() or inInternalReview(); submitted() always raises the
// legacy MAR. See draft() for why, and when a test passes the type.
import { randomUUID } from "node:crypto";
import type { VisibilityGrant, WorkItemDetail } from "@rabaed/domain";
import type { LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { attachDatasheet, type Caller, type OnboardedCompany, type TestApi } from "./harness.ts";
import { LEGACY_MAR } from "@rabaed/db/test-support";

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

/**
 * A new approved supplier for Trade `tradeId` on `projectId`, added by `admin` (a Project Admin), and its id: the
 * MAR Form Version 6 (RP-595) asks for one to leave Draft. Each call adds its own, so names never clash.
 */
export async function approvedSupplier(admin: Caller, projectId: string, tradeId: string): Promise<string> {
  const name = bilingual(`Supplier ${randomUUID().slice(0, 8)}`);
  const res = await ok(admin.post(`/v1/projects/${projectId}/approved-suppliers`, { tradeId, scopeId: null, name }), 201);
  return res.json().id as string;
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
  // Confirmed in the pop-up, as every Transition is (ADR 0017).
  return by.post(`/v1/work-items/${id}/transitions`, {
    transition,
    confirmed: true,
    idempotencyKey: randomUUID(),
    ...(hasAnswers ? { answers: own } : {}),
    ...rest,
  });
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
  /** C1's Authorized Person, the Project's Admin: keeps its Approved Supplier List (set by buildTower; a Tower built by hand may lack it). */
  admin?: Caller;
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
    admin: c1.caller,
  };
}

/** Which Draft `draft` raises: its Trade (Electrical by default) and Type (by default the legacy MAR, LEGACY_MAR). */
export type DraftOptions = { trade?: string; type?: string };

/**
 * A Draft MAR with the Subject `title`, on `at`'s Project, in Building A. By default it raises the legacy MAR
 * (LEGACY_MAR: copies of MAR's Form Version 3 and Workflow Version 2, as items started before RP-437 ran), not
 * the real "MAR": the engine's general tests drive that route. A test about the real MAR's current Version, or
 * one that binds, duplicates or changes a Project's or Company's MAR Workflow, passes `{ type: "MAR" }`, or its
 * item runs MARV, not the Workflow it set up (RP-576).
 */
export async function draft(at: Tower, engineer: Caller, title: string, { trade = at.electrical, type = LEGACY_MAR }: DraftOptions = {}): Promise<string> {
  // The current MAR Form asks for an approved supplier of the Trade to leave Draft (RP-595); the legacy one has none.
  // Only where the Project's MAR Form has the field (a Company's own Form copy may not).
  const form = type === "MAR" ? (await engineer.get(`/v1/projects/${at.projectId}/work-item-types/MAR/form`)).json() : null;
  const asksSupplier = JSON.stringify(form?.schema ?? "").includes('"approved_supplier"');
  if (asksSupplier && !at.admin) throw new Error("This Tower has no admin to keep an Approved Supplier List: build it with buildTower.");
  const supplier = asksSupplier && at.admin ? { supplier: await approvedSupplier(at.admin, at.projectId, trade) } : {};
  const res = await engineer.post(`/v1/projects/${at.projectId}/work-items`, {
    type,
    title,
    answers: { manufacturer: "ACME Cables", description: "Galvanised, 300 mm", trade, location: at.buildingA, ...supplier },
  });
  expect(res.statusCode, res.body).toBe(201);
  await attachDatasheet(engineer, res.json().id);
  return res.json().id;
}

/** A MAR sent to the raiser's own internal review. */
export async function inInternalReview(at: Tower, engineer: Caller, title: string, options: DraftOptions = {}): Promise<string> {
  const id = await draft(at, engineer, title, options);
  await take(engineer, id, "send_for_review");
  return id;
}

/** A MAR Submitted to the Consultant. */
export async function submitted(at: Tower, engineer: Caller, pm: Caller, title: string, trade = at.electrical): Promise<string> {
  const id = await draft(at, engineer, title, { trade });
  await take(engineer, id, "send_for_review");
  await ok(pm.post(`/v1/work-items/${id}/pick-up`));
  await take(pm, id, "submit");
  return id;
}
