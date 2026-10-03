import { randomInt, randomUUID } from "node:crypto";
import { closeOnboardingLead, createEngineer, listOnboardingLeads, onboardCompany, type CloseLeadResult } from "@rabaed/admin/services";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { BaseRole, CreateProjectRequest, InviteMemberRequest, OnboardCompanyRequest, OnboardingLeads } from "@rabaed/domain";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { expect } from "vitest";
import { buildApp, SESSION_COOKIE } from "../../src/app.ts";
import type { ApiConfig } from "../../src/config.ts";
import { createFileStore, ensureLocalBucket, fileStoreSettingsFromEnv } from "../../src/documents/file-store.ts";

export const HOUR = 3_600_000;

/**
 * Asserts the answer to something the caller may not see: exactly what an id
 * that doesn't exist gets, 404 with the body `{ error: "not_found" }` and nothing
 * else (visibility.md), so it never tells whether the thing exists.
 */
export async function expectHidden(response: LightMyRequestResponse | Promise<LightMyRequestResponse>, label?: string) {
  const res = await response;
  expect({ status: res.statusCode, body: res.body }, label).toEqual({
    status: 404,
    body: JSON.stringify({ error: "not_found" }),
  });
}

export const testConfig: ApiConfig = {
  sessionTtlMs: 12 * HOUR,
  invitationTtlMs: 72 * HOUR,
  cookieSecure: true,
  version: "0123abc",
  documents: { maxBytes: 1024 * 1024, contentTypes: ["application/pdf", "image/png", "text/plain"] },
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Calls the API like one browser: keeps the session cookie between requests. */
export interface Caller {
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, body?: unknown): Promise<LightMyRequestResponse>;
  patch(url: string, body?: unknown): Promise<LightMyRequestResponse>;
  delete(url: string): Promise<LightMyRequestResponse>;
  request(method: Method, url: string, body?: unknown): Promise<LightMyRequestResponse>;
  /** The current session token, to replay it after sign-out. */
  readonly sessionToken: string | undefined;
  /** Replaces the session token (e.g. to replay an old one). */
  useSessionToken(token: string | undefined): void;
}

export interface OnboardedCompany {
  companyId: string;
  authorizedPerson: { id: string; email: string };
  invitationToken: string;
  crNumber: string;
  vatNumber: string;
}

export interface InvitedMember {
  id: string;
  email: string;
  invitationToken: string;
}

export interface CreatedProject {
  id: string;
  projectNumber: number;
}

export interface TestApi {
  /** A caller with no session. */
  anonymous(): Caller;
  /** A new Rabaed Engineer, created as the `engineer:create` script does; returns their id. */
  engineer(): Promise<string>;
  /**
   * A Rabaed Engineer onboards a Company with unique CR, VAT and email, through
   * Rabaed Admin's onboarding service (apps/admin); overrides replace parts of the request.
   */
  onboardCompany(overrides?: Partial<OnboardCompanyRequest>): Promise<OnboardedCompany>;
  /** A Rabaed Engineer reads the onboarding leads, with a reason, through Rabaed Admin's service. */
  onboardingLeads(reason: string): Promise<OnboardingLeads["leads"]>;
  /** A Rabaed Engineer closes an open onboarding lead, with a reason, through Rabaed Admin's service. */
  closeOnboardingLead(leadId: string, reason: string): Promise<CloseLeadResult>;
  /** Accepts an invitation and returns the signed-in caller. */
  acceptInvitation(token: string, password?: string): Promise<Caller>;
  /** Onboards a Company and signs its Authorized Person in. */
  authorizedPerson(): Promise<{ company: OnboardedCompany; caller: Caller }>;
  /** The Authorized Person (`by`) invites a Member; overrides replace parts of the request. */
  inviteMember(by: Caller, overrides?: Partial<InviteMemberRequest>): Promise<InvitedMember>;
  /** The Authorized Person (`by`) invites a Member, who accepts and is signed in. */
  member(by: Caller): Promise<{ member: InvitedMember; caller: Caller }>;
  /** Onboards a Company and signs its Authorized Person in, flagged as a Project Creator. */
  projectCreator(): Promise<{ company: OnboardedCompany; caller: Caller }>;
  /** `by` (a Project Creator) creates a Project; overrides replace parts of the request. */
  createProject(by: Caller, overrides?: Partial<CreateProjectRequest>): Promise<CreatedProject>;
  /**
   * A Project Admin (`by`) invites a Company, whose Authorized Person (signed in
   * with the default password) accepts (ADR 0009); returns the Participant's id.
   */
  addParticipant(by: Caller, projectId: string, company: OnboardedCompany, role: BaseRole): Promise<string>;
  /** The Participant's Authorized Person (`by`) adds a Member of their Company to the Project. */
  addProjectMember(by: Caller, participantId: string, memberId: string): Promise<void>;
  signIn(email: string, password: string): Promise<Caller>;
  /** Moves the API's clock forward. */
  advanceClock(ms: number): void;
  close(): Promise<void>;
}

export const DEFAULT_PASSWORD = "a long enough test password";

const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
export const uniqueCr = () => digits(10);
export const uniqueVat = () => `3${digits(13)}3`;
export const uniqueEmail = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

function cookieFrom(res: LightMyRequestResponse): { value: string } | undefined {
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  return cookie ? { value: cookie.value } : undefined;
}

function callerFor(app: FastifyInstance): Caller {
  let token: string | undefined;
  const request = async (method: Method, url: string, body?: unknown) => {
    const res = await app.inject({
      method,
      url,
      cookies: token ? { [SESSION_COOKIE]: token } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    const set = cookieFrom(res);
    if (set) token = set.value || undefined;
    return res;
  };
  return {
    request,
    get: (url) => request("GET", url),
    post: (url, body) => request("POST", url, body ?? {}),
    patch: (url, body) => request("PATCH", url, body ?? {}),
    delete: (url) => request("DELETE", url),
    get sessionToken() {
      return token;
    },
    useSessionToken(value) {
      token = value;
    },
  };
}

function expectStatus(res: LightMyRequestResponse, status: number, what: string) {
  if (res.statusCode !== status) throw new Error(`${what}: expected ${status}, got ${res.statusCode} ${res.body}`);
}

/**
 * `files`: the suite uploads and downloads Documents, through the local file
 * store (FILE_STORE_ENDPOINT; docker-compose.yml locally, ci.yml in CI).
 */
export async function createTestApi(options: { databaseUrl?: string; files?: boolean } = {}): Promise<TestApi> {
  const urls = testDatabaseUrls();
  const db = createDb(options.databaseUrl ?? urls.app);
  // Rabaed Admin's connection, for onboarding only: the customer api has none (ADR 0010).
  const adminDb = createDb(urls.admin, { max: 2 });
  const migratorDb = createDb(urls.migrator, { max: 1 });
  let offset = 0;
  const now = () => new Date(Date.now() + offset);
  let files;
  if (options.files) {
    const settings = fileStoreSettingsFromEnv();
    await ensureLocalBucket(settings);
    files = createFileStore(settings);
  }
  const app = await buildApp({ db, config: testConfig, now, logger: false, ...(files ? { files } : {}) });

  // One Engineer per TestApi does every onboarding.
  let engineerId: string | undefined;
  const theEngineer = async () => (engineerId ??= await api.engineer());

  const api: TestApi = {
    anonymous: () => callerFor(app),

    async engineer() {
      return createEngineer(migratorDb, { email: uniqueEmail("engineer"), fullName: "Test Engineer", password: DEFAULT_PASSWORD });
    },

    async onboardCompany(overrides = {}) {
      const body: OnboardCompanyRequest = {
        legalName: { en: "Test Constructions", ar: "إنشاءات الاختبار" },
        crNumber: uniqueCr(),
        vatNumber: uniqueVat(),
        authorizedPerson: {
          email: uniqueEmail("authorized-person"),
          fullName: { en: "Test Person", ar: "شخص الاختبار" },
          locale: "en",
        },
        reason: "Signed contract, test onboarding",
        ...overrides,
      };
      const result = await onboardCompany(adminDb, await theEngineer(), body, now(), testConfig.invitationTtlMs);
      if (!result.ok) throw new Error(`onboard company: duplicate ${result.conflict}`);
      return {
        companyId: result.companyId,
        authorizedPerson: { id: result.authorizedPersonId, email: body.authorizedPerson.email },
        invitationToken: result.invitation.token,
        crNumber: body.crNumber,
        vatNumber: body.vatNumber,
      };
    },

    async onboardingLeads(reason) {
      return listOnboardingLeads(adminDb, await theEngineer(), reason);
    },

    async closeOnboardingLead(leadId, reason) {
      return closeOnboardingLead(adminDb, await theEngineer(), leadId, reason, now());
    },

    async acceptInvitation(token, password = DEFAULT_PASSWORD) {
      const caller = callerFor(app);
      expectStatus(await caller.post("/v1/invitations/accept", { token, password }), 204, "accept invitation");
      return caller;
    },

    async authorizedPerson() {
      const company = await api.onboardCompany();
      return { company, caller: await api.acceptInvitation(company.invitationToken) };
    },

    async inviteMember(by, overrides = {}) {
      const body: InviteMemberRequest = {
        email: uniqueEmail("member"),
        fullName: { en: "Test Member", ar: "عضو الاختبار" },
        locale: "en",
        ...overrides,
      };
      const res = await by.post("/v1/members", body);
      expectStatus(res, 201, "invite member");
      const json = res.json();
      return { id: json.memberId, email: body.email, invitationToken: json.invitation.token };
    },

    async member(by) {
      const member = await api.inviteMember(by);
      return { member, caller: await api.acceptInvitation(member.invitationToken) };
    },

    async projectCreator() {
      const { company, caller } = await api.authorizedPerson();
      const res = await caller.patch(`/v1/members/${company.authorizedPerson.id}`, { canCreateProjects: true });
      expectStatus(res, 200, "flag project creator");
      return { company, caller };
    },

    async createProject(by, overrides = {}) {
      const body: CreateProjectRequest = {
        name: { en: "Riyadh Gate Tower", ar: "برج بوابة الرياض" },
        code: "TWR",
        role: "contractor",
        ...overrides,
      };
      const res = await by.post("/v1/projects", body);
      expectStatus(res, 201, "create project");
      const json = res.json();
      return { id: json.projectId, projectNumber: json.projectNumber };
    },

    async addParticipant(by, projectId, company, role) {
      const res = await by.post(`/v1/projects/${projectId}/participants`, { crNumber: company.crNumber, role });
      expectStatus(res, 202, "invite participant");
      const invited = await api.signIn(company.authorizedPerson.email, DEFAULT_PASSWORD);
      // The newest pending invitation: the one just sent.
      const participantId: string = (await invited.get("/v1/participant-invitations")).json().invitations[0].id;
      expectStatus(await invited.post(`/v1/participant-invitations/${participantId}/accept`), 204, "accept participant invitation");
      return participantId;
    },

    async addProjectMember(by, participantId, memberId) {
      expectStatus(await by.post(`/v1/participants/${participantId}/members`, { memberId }), 204, "add project member");
    },

    async signIn(email, password) {
      const caller = callerFor(app);
      expectStatus(await caller.post("/v1/session", { email, password }), 204, "sign in");
      return caller;
    },

    advanceClock(ms) {
      offset += ms;
    },

    async close() {
      await app.close();
      await Promise.all([db.destroy(), adminDb.destroy(), migratorDb.destroy()]);
    },
  };
  return api;
}
