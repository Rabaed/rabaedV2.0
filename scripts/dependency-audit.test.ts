import { describe, expect, it } from "vitest";
import { annotations, parseAudit, report, summary } from "./dependency-audit.ts";

// RP-1023: `pnpm audit --prod` in CI, reporting first. RP-635 checked a new
// library by hand, and the audit then showed 7 findings (2 high, in apps/web's
// `next`) that nothing in CI reported.

const advisory = (id: number, severity: string, module_name: string, title: string, paths: string[]) => ({
  id,
  severity,
  module_name,
  title,
  patched_versions: ">=16.3.8",
  url: `https://github.com/advisories/GHSA-${id}`,
  findings: [{ version: "16.3.6", paths }],
});

// `pnpm audit --prod --json` on main, 2026-10-22 (four advisories of the seven).
const today = JSON.stringify({
  actions: [],
  advisories: {
    "1241209": advisory(1241209, "high", "source-map-js", "source-map-js allows event-loop denial of service through indexed source-map section offsets", ["apps__web>next>postcss>source-map-js"]),
    "1241489": advisory(1241489, "moderate", "next", "Next.js: Pending `use cache` fill can leak Draft Mode content into regular responses and persisted pages", ["apps__web>next"]),
    "1241492": advisory(1241492, "low", "next", "Next.js has information disclosure in development server's Model Context Protocol endpoint", ["apps__web>next"]),
    "1241496": advisory(1241496, "high", "next", "Next.js has Server-Side Request Forgery in Image Optimization", ["apps__web>next"]),
  },
  muted: [],
  metadata: { vulnerabilities: { info: 0, low: 1, moderate: 1, high: 2, critical: 0 }, dependencies: 392, devDependencies: 0, optionalDependencies: 0, totalDependencies: 392 },
});

const clean = JSON.stringify({ actions: [], advisories: {}, muted: [], metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, dependencies: 392 } });

describe("parseAudit", () => {
  it("reads the advisories, most severe first, with paths as workspace folders", () => {
    const audit = parseAudit(today);
    expect(audit.advisories.map((a) => [a.severity, a.module])).toEqual([
      ["high", "next"],
      ["high", "source-map-js"],
      ["moderate", "next"],
      ["low", "next"],
    ]);
    expect(audit.advisories[1]?.paths).toEqual(["apps/web › next › postcss › source-map-js"]);
    expect(audit.dependencies).toBe(392);
  });

  it("refuses pnpm's error output, so a registry outage is not read as a clean audit", () => {
    const outage = JSON.stringify({ error: { code: "ECONNREFUSED", message: "request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed" } });
    expect(() => parseAudit(outage)).toThrow("pnpm audit failed: ECONNREFUSED request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed");
    expect(() => parseAudit("")).toThrow("pnpm audit printed no JSON");
    expect(() => parseAudit("{}")).toThrow("pnpm audit printed no advisories");
  });
});

describe("summary", () => {
  it("counts the findings at and below the bar, and tables the ones at it", () => {
    const text = summary(parseAudit(today), "high");
    expect(text).toContain("## Dependency audit: 2 at high or above");
    expect(text).toContain("2 high, 1 moderate, 1 low in 392 production dependencies.");
    expect(text).toContain("| high | `next` | [Next.js has Server-Side Request Forgery in Image Optimization](https://github.com/advisories/GHSA-1241496) | >=16.3.8 | apps/web › next |");
    expect(text).toContain("Reporting only (RP-1023): this job does not fail on findings yet.");
  });

  it("puts the findings below the bar in a closed section", () => {
    const text = summary(parseAudit(today), "high");
    const details = text.slice(text.indexOf("<details>"));
    expect(details).toContain("2 below high");
    expect(details).toContain("| moderate | `next` |");
    expect(details).toContain("| low | `next` |");
    expect(details).not.toContain("| high |");
  });

  it("says so when nothing reaches the bar", () => {
    expect(summary(parseAudit(clean), "high")).toContain("## Dependency audit: nothing at high or above");
  });

  it("keeps an advisory title from breaking the table", () => {
    const odd = JSON.stringify({ advisories: { "1": advisory(1, "critical", "x", "a | b\nc [d] <e>", ["apps__api>x"]) }, metadata: { vulnerabilities: { critical: 1 }, dependencies: 1 } });
    expect(summary(parseAudit(odd), "high")).toContain("[a \\| b c \\[d\\] &lt;e>](https://github.com/advisories/GHSA-1)");
  });
});

describe("annotations", () => {
  it("warns once per advisory at the bar, naming package, title and fix", () => {
    expect(annotations(parseAudit(today), "high")).toEqual([
      "::warning title=pnpm audit%3A high in next::Next.js has Server-Side Request Forgery in Image Optimization. Patched: >=16.3.8. Path: apps/web › next. https://github.com/advisories/GHSA-1241496",
      "::warning title=pnpm audit%3A high in source-map-js::source-map-js allows event-loop denial of service through indexed source-map section offsets. Patched: >=16.3.8. Path: apps/web › next › postcss › source-map-js. https://github.com/advisories/GHSA-1241209",
    ]);
  });

  it("escapes workflow-command characters, so a title cannot start a command of its own", () => {
    const odd = JSON.stringify({ advisories: { "1": advisory(1, "high", "a,b:c", "50%\n::error::x", ["apps__api>x"]) }, metadata: { vulnerabilities: { high: 1 }, dependencies: 1 } });
    expect(annotations(parseAudit(odd), "high")).toEqual(["::warning title=pnpm audit%3A high in a%2Cb%3Ac::50%25%0A::error::x. Patched: >=16.3.8. Path: apps/api › x. https://github.com/advisories/GHSA-1"]);
  });
});

describe("report", () => {
  it("passes with findings, writing the summary and the warnings (reporting only)", () => {
    const result = report(today, "high");
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("2 at high or above");
    expect(result.lines).toHaveLength(2);
  });

  it("fails when the audit could not run, with the reason in the summary and an error line", () => {
    const result = report(JSON.stringify({ error: { code: "ENOTFOUND", message: "registry down" } }), "high");
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("## Dependency audit could not run");
    expect(result.summary).toContain("pnpm audit failed: ENOTFOUND registry down");
    expect(result.lines).toEqual(["::error title=pnpm audit::pnpm audit failed: ENOTFOUND registry down"]);
  });
});
