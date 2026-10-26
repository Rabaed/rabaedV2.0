import { createDb } from "@rabaed/db";
import { existsSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { buildAdminApp } from "./app.ts";

// Rabaed Admin is noindex everywhere (ADR 0026): its pages, its assets, its refusals
// and its unknown urls all say so. None of these reach the database.
const db = createDb("postgres://nobody@127.0.0.1:1/none", { max: 1 });
const app = await buildAdminApp({
  db,
  config: { cookieSecure: true, version: "local", webUrl: "https://web.rabaed.test", invitationTtlMs: 3_600_000 },
  mailer: { async send() {} },
  logger: false,
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe("Rabaed Admin responses", () => {
  it.each([
    ["the home page", "/", 200],
    ["a page's script", "/assets/admin.js", 200],
    ["a refusal", "/v1/onboarding-leads", 401],
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

// The fonts key is never in a Vercel project (ADR 0026): the UAT deploy Action fetches
// the Thmanyah fonts on its runner before `vercel build`; a preview Vercel builds keeps IBM Plex.
describe("Rabaed Admin's vercel.json", () => {
  it("builds without fetching the fonts", () => {
    const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { buildCommand: string };
    expect(vercel.buildCommand).toBe("pnpm run build");
  });
});
