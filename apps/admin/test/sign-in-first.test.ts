// Seam 1: every Rabaed Admin route that isn't public on purpose refuses a caller who
// isn't a signed-in Rabaed Engineer with 401 `not_signed_in`, before it reads the
// body, query or path (RP-452). A route that validated first would answer 400 and
// tell a stranger its schema (as RP-427's Workflow routes once did). The test lists
// the routes from the app itself, so a new route is covered the day it is added; one
// meant to be public goes in `PUBLIC` with its reason.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { RouteOptions } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { buildAdminApp, cookieNames } from "../src/app.ts";
import { testConfig } from "./support/harness.ts";

/** The routes anyone may call, by "METHOD /url", each with why. HEAD follows its GET. */
const PUBLIC: Record<string, string> = {
  "GET /health": "the load balancer and ECS ask it; it says only whether the database answers",
  "GET /": "the home page: static, the same for everyone; its script asks the API, which checks",
  "GET /workflows": "the Workflows page: static, the same for everyone; its script asks the API, which checks",
  "POST /v1/sign-in": "sign-in, step one (the password): the caller has no session yet",
  "POST /v1/sign-in/code": "sign-in, step two (the emailed code): the challenge cookie is the credential",
  "DELETE /v1/session": "sign-out: ends whatever session the browser has, and is a no-op without one",
};
/** The pages' scripts, styles and fonts, whatever names the build gives them: static, the same for everyone. */
const isAsset = (method: string, url: string) => (method === "GET" || method === "HEAD") && url.startsWith("/assets/");

const db = createDb(testDatabaseUrls().admin, { max: 2 });
const routes: { method: string; url: string }[] = [];
const app = await buildAdminApp({
  db,
  config: testConfig,
  mailer: { async send() {} },
  logger: false,
  onRoute: (route: RouteOptions) => {
    for (const method of [route.method].flat()) routes.push({ method, url: route.url });
  },
});
await app.ready();
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const key = (method: string, url: string) => `${method === "HEAD" ? "GET" : method} ${url}`;
const guarded = routes.filter((r) => !(key(r.method, r.url) in PUBLIC) && !isAsset(r.method, r.url));

/** The route's url with junk in every path param and wildcard, and a query no schema accepts. */
const junkUrl = (url: string) => `${url.replace(/:[A-Za-z0-9_]+(\([^)]*\))?/g, "junk").replace(/\*/g, "junk")}?reason=&page=junk&limit=-1`;

/** Each guarded route called with junk; returns "METHOD url -> status body" for every answer that isn't the 401. */
async function refusals(cookies: Record<string, string>): Promise<string[]> {
  const wrong: string[] = [];
  for (const { method, url } of guarded) {
    const res = await app.inject({
      method: method as "GET",
      url: junkUrl(url),
      cookies,
      ...(method === "GET" || method === "HEAD" ? {} : { payload: "[1, 2, 3]", headers: { "content-type": "application/json" } }),
    });
    const body = method === "HEAD" ? "" : JSON.stringify({ error: "not_signed_in" });
    if (res.statusCode !== 401 || res.body !== body) wrong.push(`${method} ${url} -> ${res.statusCode} ${res.body.slice(0, 120)}`);
  }
  return wrong;
}

describe("a caller who isn't a signed-in Rabaed Engineer", () => {
  it("finds Rabaed Admin's routes, the public ones among them", () => {
    expect(guarded.length).toBeGreaterThan(20);
    for (const name of Object.keys(PUBLIC)) {
      expect(routes.some((r) => key(r.method, r.url) === name), `PUBLIC lists ${name}, which Rabaed Admin doesn't have`).toBe(true);
    }
  });

  it("gets 401 not_signed_in from every other route, whatever the body, query or path", async () => {
    expect(await refusals({})).toEqual([]);
  });

  it("gets the same 401 with a session cookie that isn't a session", async () => {
    expect(await refusals({ [cookieNames.session]: "not-a-session-token" })).toEqual([]);
  });
});
