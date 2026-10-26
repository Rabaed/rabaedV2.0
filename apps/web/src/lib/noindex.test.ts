import { readFileSync } from "node:fs";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.ts";

// Dev and UAT are noindex (ADR 0026): every page, route and file web serves says so,
// and robots.txt turns crawlers away. There is no sitemap.
describe("web", () => {
  it("sends X-Robots-Tag: noindex on every path", async () => {
    const rules = (await nextConfig(PHASE_PRODUCTION_SERVER).headers?.()) ?? [];
    expect(rules).toContainEqual({ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] });
  });

  it("serves a robots.txt that disallows everything", () => {
    expect(readFileSync(new URL("../app/robots.txt", import.meta.url), "utf8")).toBe("User-agent: *\nDisallow: /\n");
  });
});
