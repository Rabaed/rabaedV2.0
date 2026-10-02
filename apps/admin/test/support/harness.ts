import { randomInt, randomUUID } from "node:crypto";
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { MailMessage, Mailer } from "@rabaed/mailer";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildAdminApp } from "../../src/app.ts";
import type { AdminConfig } from "../../src/config.ts";
import { createEngineer } from "../../src/engineers.ts";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DEFAULT_PASSWORD = "a long enough test password";

export const testConfig: AdminConfig = {
  cookieSecure: true,
  version: "0123abc",
  webUrl: "https://web.rabaed.test",
  invitationTtlMs: 72 * HOUR,
};

const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join("");
export const uniqueCr = () => digits(10);
export const uniqueVat = () => `3${digits(13)}3`;
export const uniqueEmail = (who: string) => `${who}-${randomUUID().slice(0, 8)}@rabaed.test`;

type Method = "GET" | "POST" | "DELETE";

/** Calls Rabaed Admin like one browser: keeps every cookie it is given. */
export interface Browser {
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, body?: unknown): Promise<LightMyRequestResponse>;
  delete(url: string): Promise<LightMyRequestResponse>;
  cookie(name: string): string | undefined;
  setCookie(name: string, value: string | undefined): void;
}

/** Every email Rabaed Admin sent, newest last. */
export interface Outbox {
  messages: MailMessage[];
  to(email: string): MailMessage[];
  /** The code in the newest sign-in code email to `email`. */
  lastCode(email: string): string;
}

export interface TestAdmin {
  app: FastifyInstance;
  outbox: Outbox;
  browser(): Browser;
  /** A new Rabaed Engineer, created as `engineer:create` does; not signed in. */
  newEngineer(): Promise<{ id: string; email: string }>;
  /** A new Rabaed Engineer, signed in with password and emailed code in a new browser. */
  signedInEngineer(): Promise<{ id: string; email: string; browser: Browser }>;
  /** Password, then the emailed code, in `browser`; fails the test unless both succeed. */
  signIn(browser: Browser, email: string, password?: string): Promise<void>;
  advanceClock(ms: number): void;
  close(): Promise<void>;
}

function browserFor(app: FastifyInstance): Browser {
  const jar = new Map<string, string>();
  const request = async (method: Method, url: string, body?: unknown) => {
    const res = await app.inject({
      method,
      url,
      cookies: Object.fromEntries(jar),
      ...(body === undefined ? {} : { payload: body as object }),
    });
    for (const c of res.cookies) {
      if (c.value && (!c.expires || c.expires.getTime() > Date.now())) jar.set(c.name, c.value);
      else jar.delete(c.name);
    }
    return res;
  };
  return {
    get: (url) => request("GET", url),
    post: (url, body) => request("POST", url, body ?? {}),
    delete: (url) => request("DELETE", url),
    cookie: (name) => jar.get(name),
    setCookie: (name, value) => (value === undefined ? jar.delete(name) : jar.set(name, value)),
  };
}

function expectStatus(res: LightMyRequestResponse, status: number, what: string) {
  if (res.statusCode !== status) throw new Error(`${what}: expected ${status}, got ${res.statusCode} ${res.body}`);
}

export async function createTestAdmin(): Promise<TestAdmin> {
  const urls = testDatabaseUrls();
  const db = createDb(urls.admin, { max: 2 });
  const migratorDb = createDb(urls.migrator, { max: 1 });
  let offset = 0;

  const messages: MailMessage[] = [];
  const mailer: Mailer = {
    async send(message) {
      messages.push(message as MailMessage);
    },
  };
  const outbox: Outbox = {
    messages,
    to: (email) => messages.filter((m) => m.to === email),
    lastCode(email) {
      const codes = messages.filter((m) => m.to === email && m.template === "sign-in-code");
      const last = codes.at(-1) as MailMessage<"sign-in-code"> | undefined;
      if (!last) throw new Error(`no sign-in code sent to ${email}`);
      return last.values.code;
    },
  };

  const app = await buildAdminApp({ db, config: testConfig, mailer, now: () => new Date(Date.now() + offset), logger: false });

  const admin: TestAdmin = {
    app,
    outbox,
    browser: () => browserFor(app),

    async newEngineer() {
      const email = uniqueEmail("engineer");
      const id = await createEngineer(migratorDb, { email, fullName: "Test Engineer", password: DEFAULT_PASSWORD });
      return { id, email };
    },

    async signIn(browser, email, password = DEFAULT_PASSWORD) {
      expectStatus(await browser.post("/v1/sign-in", { email, password }), 202, "password");
      expectStatus(await browser.post("/v1/sign-in/code", { code: outbox.lastCode(email) }), 204, "code");
    },

    async signedInEngineer() {
      const engineer = await admin.newEngineer();
      const browser = admin.browser();
      await admin.signIn(browser, engineer.email);
      return { ...engineer, browser };
    },

    advanceClock(ms) {
      offset += ms;
    },

    async close() {
      await app.close();
      await Promise.all([db.destroy(), migratorDb.destroy()]);
    },
  };
  return admin;
}
