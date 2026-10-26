import { createDb } from "@rabaed/db";
import { existsSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { apiConfigFromEnv } from "./config.ts";

// Dev and UAT are noindex (ADR 0026): every answer of the api says so, refusals and
// unknown urls included, so a search engine that finds the address keeps none of it.
// No database is reached: a stranger is refused and an unknown url answered first.
const db = createDb("postgres://nobody@127.0.0.1:1/none", { max: 1 });
const app = await buildApp({ db, config: apiConfigFromEnv({}), logger: false });
afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe("api responses", () => {
  it.each([
    ["a refusal", "/v1/projects", 401],
    ["an unknown url", "/nowhere", 404],
  ])("send X-Robots-Tag: noindex on %s", async (_name, url, status) => {
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(status);
    expect(response.headers["x-robots-tag"]).toBe("noindex");
  });

  it("leave Vercel a robots.txt that disallows everything, and no sitemap", () => {
    expect(readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8")).toBe("User-agent: *\nDisallow: /\n");
    expect(existsSync(new URL("../public/sitemap.xml", import.meta.url))).toBe(false);
  });
});
