import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { LightMyRequestResponse } from "fastify";
import { buildApp, type Authenticate } from "../../src/app.ts";

// Test-only: the stub identity travels in this header. The production server
// never installs this authenticator.
const STUB_HEADER = "x-test-member-id";

const stubAuthenticate: Authenticate = async (request) => {
  const memberId = request.headers[STUB_HEADER];
  return typeof memberId === "string" ? { memberId } : null;
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Caller {
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, body?: unknown): Promise<LightMyRequestResponse>;
  request(method: Method, url: string, body?: unknown): Promise<LightMyRequestResponse>;
}

export interface TestApi {
  /** Calls the API as this signed-in Member. */
  as(memberId: string): Caller;
  /** Calls the API with no session. */
  anonymous(): Caller;
  close(): Promise<void>;
}

export async function createTestApi(options: { databaseUrl?: string } = {}): Promise<TestApi> {
  const db = createDb(options.databaseUrl ?? testDatabaseUrls().app);
  const app = await buildApp({ db, authenticate: stubAuthenticate, logger: false });

  const caller = (headers: Record<string, string>): Caller => {
    const request = (method: Method, url: string, body?: unknown) =>
      app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body as object }) });
    return {
      request,
      get: (url) => request("GET", url),
      post: (url, body) => request("POST", url, body),
    };
  };

  return {
    as: (memberId) => caller({ [STUB_HEADER]: memberId }),
    anonymous: () => caller({}),
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
}
