// Seam 1: every Rabaed Admin route that isn't public on purpose refuses a caller who
// isn't a signed-in Rabaed Engineer with 401 `not_signed_in` (RP-452), as the api does.
// The refusal happens in one onRequest hook in the app: before the body is parsed (so
// malformed JSON, an unsupported content type or an oversized body still get 401, not
// 400, 415 or 413) and before the query and path params are validated (so a stranger
// never learns a route's schema, as RP-427's Workflow routes once let them). An unknown
// url stays 404. A route is public only by `config: { public: true }`. The test lists
// the routes from the app itself, so a new route is covered the day it is added; one
// meant to be public goes in `PUBLIC` with its reason.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import type { RouteOptions } from "fastify";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/**
 * The pages' scripts, styles and fonts, whatever names the build gives them: static, the
 * same for everyone. Only a GET of one fixed path whose file is on disk, in the build's
 * dist/ or among src/pages/ (admin.js, admin.css): no params, no wildcard, nothing else
 * under /assets/.
 */
const isBuiltAsset = (method: string, url: string) => {
  if ((method !== "GET" && method !== "HEAD") || !url.startsWith("/assets/") || /[:*]/.test(url)) return false;
  const name = url.slice("/assets/".length);
  return existsSync(fileURLToPath(new URL(`../dist/${name}`, import.meta.url))) || existsSync(fileURLToPath(new URL(`../src/pages/${name}`, import.meta.url)));
};

const db = createDb(testDatabaseUrls().admin, { max: 2 });
const routes: { method: string; url: string; isPublic: boolean }[] = [];
const app = await buildAdminApp({
  db,
  config: testConfig,
  mailer: { async send() {} },
  logger: false,
  onRoute: (route: RouteOptions) => {
    for (const method of [route.method].flat()) routes.push({ method, url: route.url, isPublic: route.config?.public === true });
  },
});
await app.ready();
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const key = (method: string, url: string) => `${method === "HEAD" ? "GET" : method} ${url}`;
const guarded = routes.filter((r) => !(key(r.method, r.url) in PUBLIC) && !isBuiltAsset(r.method, r.url));

/** The route's url with junk in every path param and wildcard, and a query no schema accepts. */
const junkUrl = (url: string) => `${url.replace(/:[A-Za-z0-9_]+(\([^)]*\))?/g, "junk").replace(/\*/g, "junk")}?reason=&page=junk&limit=-1`;

/**
 * The bodies sent to every route that takes one: JSON no schema accepts, JSON that
 * doesn't parse (400 if parsed), and a content type Rabaed Admin has no parser for (415
 * if parsed). The 401 comes before parsing, so each must get it.
 */
const junkBodies = [
  { payload: "[1, 2, 3]", headers: { "content-type": "application/json" } },
  { payload: '{"not json', headers: { "content-type": "application/json" } },
  { payload: "<junk/>", headers: { "content-type": "application/xml" } },
];

/** Each guarded route called with junk; returns "METHOD url -> status body" for every answer that isn't the 401. */
async function refusals(cookies: Record<string, string>): Promise<string[]> {
  const wrong: string[] = [];
  for (const { method, url } of guarded) {
    for (const body of method === "GET" || method === "HEAD" ? [{}] : junkBodies) {
      const res = await app.inject({ method: method as "GET", url: junkUrl(url), cookies, ...body });
      const expected = method === "HEAD" ? "" : JSON.stringify({ error: "not_signed_in" });
      if (res.statusCode !== 401 || res.body !== expected) wrong.push(`${method} ${url} ${JSON.stringify(body)} -> ${res.statusCode} ${res.body.slice(0, 120)}`);
    }
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

  it("is marked public in the app exactly where PUBLIC says, and on the built static files", () => {
    const marked = [...new Set(routes.filter((r) => r.isPublic && !isBuiltAsset(r.method, r.url)).map((r) => key(r.method, r.url)))].sort();
    expect(marked).toEqual(Object.keys(PUBLIC).sort());
    const assetsNotMarked = routes.filter((r) => isBuiltAsset(r.method, r.url) && !r.isPublic).map((r) => key(r.method, r.url));
    expect(assetsNotMarked).toEqual([]);
  });

  it("gets 404 for a url Rabaed Admin doesn't have, whatever the body", async () => {
    for (const url of ["/v1/no-such-route", "/assets/no-such-file.js"]) {
      const res = await app.inject({ method: "POST", url, payload: '{"not json', headers: { "content-type": "application/json" } });
      expect([url, res.statusCode, res.body]).toEqual([url, 404, JSON.stringify({ error: "not_found" })]);
    }
  });

  it("gets 401, not 413, for a body over the size limit", async () => {
    const post = guarded.find((r) => r.method === "POST")!;
    const res = await app.inject({
      method: "POST",
      url: junkUrl(post.url),
      payload: JSON.stringify({ junk: "x".repeat(2 * 1024 * 1024) }),
      headers: { "content-type": "application/json" },
    });
    expect([res.statusCode, res.body]).toEqual([401, JSON.stringify({ error: "not_signed_in" })]);
  });

  it("gets 401 not_signed_in from every other route, whatever the body, query or path", async () => {
    expect(await refusals({})).toEqual([]);
  });

  it("gets the same 401 with a session cookie that isn't a session", async () => {
    expect(await refusals({ [cookieNames.session]: "not-a-session-token" })).toEqual([]);
  });
});
