import { randomInt, randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { OnboardCompanyRequest } from "@rabaed/domain";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp, SESSION_COOKIE } from "../../src/app.ts";
import type { ApiConfig } from "../../src/config.ts";
import { createEngineer } from "../../src/identity/engineers.ts";

export const HOUR = 3_600_000;

export const testConfig: ApiConfig = {
  sessionTtlMs: 12 * HOUR,
  invitationTtlMs: 72 * HOUR,
  cookieSecure: true,
  version: "0123abc",
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Calls the API like one browser: keeps the session cookie between requests. */
export interface Caller {
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, body?: unknown): Promise<LightMyRequestResponse>;
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

export interface TestApi {
  /** A caller with no session. */
  anonymous(): Caller;
  /** A new Rabaed Engineer, created as the `engineer:create` script does, signed in. */
  engineer(): Promise<Caller>;
  /** Onboards a Company with unique CR, VAT and email; overrides replace parts of the request. */
  onboardCompany(overrides?: Partial<OnboardCompanyRequest>): Promise<OnboardedCompany>;
  /** Accepts an invitation and returns the signed-in caller. */
  acceptInvitation(token: string, password?: string): Promise<Caller>;
  /** Onboards a Company and signs its Authorized Person in. */
  authorizedPerson(): Promise<{ company: OnboardedCompany; caller: Caller }>;
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

export async function createTestApi(options: { databaseUrl?: string } = {}): Promise<TestApi> {
  const urls = testDatabaseUrls();
  const db = createDb(options.databaseUrl ?? urls.app);
  const adminDb = createDb(urls.admin, { max: 2 });
  const migratorDb = createDb(urls.migrator, { max: 1 });
  let offset = 0;
  const app = await buildApp({
    db,
    adminDb,
    config: testConfig,
    now: () => new Date(Date.now() + offset),
    logger: false,
  });

  // One Engineer per TestApi; signed in afresh for each onboarding, since tests move the clock.
  let engineerEmail: string | undefined;
  const signInEngineer = async (email: string) => {
    const caller = callerFor(app);
    expectStatus(await caller.post("/admin/v1/session", { email, password: DEFAULT_PASSWORD }), 204, "engineer sign-in");
    return caller;
  };

  const api: TestApi = {
    anonymous: () => callerFor(app),

    async engineer() {
      const email = uniqueEmail("engineer");
      await createEngineer(migratorDb, { email, fullName: "Test Engineer", password: DEFAULT_PASSWORD });
      engineerEmail ??= email;
      return signInEngineer(email);
    },

    async onboardCompany(overrides = {}) {
      const engineerCaller = engineerEmail ? await signInEngineer(engineerEmail) : await api.engineer();
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
      const res = await engineerCaller.post("/admin/v1/companies", body);
      expectStatus(res, 201, "onboard company");
      const json = res.json();
      return {
        companyId: json.companyId,
        authorizedPerson: { id: json.authorizedPersonId, email: body.authorizedPerson.email },
        invitationToken: json.invitation.token,
        crNumber: body.crNumber,
        vatNumber: body.vatNumber,
      };
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
