import { describe, expect, it } from "vitest";
import { parseAudit, report, summary, warnings } from "./dependency-audit.ts";

// RP-1023: `pnpm audit --prod` in CI, reporting first. RP-635 checked a new
// library by hand, and the audit then showed 7 findings (2 high, in apps/web's
// `next`) that nothing in CI reported.

const advisory = (id: number, severity: string, module_name: string, title: string, paths: string[], patched_versions = ">=16.3.8", url = `https://github.com/advisories/GHSA-${id}`) => ({
  id,
  severity,
  module_name,
  title,
  patched_versions,
  url,
  findings: [{ version: "16.3.6", paths }],
});

const auditOf = (...advisories: ReturnType<typeof advisory>[]) =>
  JSON.stringify({ advisories: Object.fromEntries(advisories.map((a) => [String(a.id), a])), metadata: { vulnerabilities: {}, dependencies: 1 } });

// `pnpm audit --prod --json` on main, 2026-10-22 (four advisories of the seven).
const today = JSON.stringify({
  actions: [],
  advisories: {
    "1241209": advisory(1241209, "high", "source-map-js", "source-map-js allows event-loop denial of service through indexed source-map section offsets", ["apps__web>next>postcss>source-map-js"], ">=1.2.2"),
    "1241489": advisory(1241489, "moderate", "next", "Next.js: Pending `use cache` fill can leak Draft Mode content into regular responses and persisted pages", ["apps__web>next"]),
    "1241492": advisory(1241492, "low", "next", "Next.js has information disclosure in development server's Model Context Protocol endpoint", ["apps__web>next"]),
    "1241496": advisory(1241496, "high", "next", "Next.js has Server-Side Request Forgery in Image Optimization", ["apps__web>next"]),
  },
  muted: [],
  metadata: { vulnerabilities: { info: 0, low: 1, moderate: 1, high: 2, critical: 0 }, dependencies: 392, devDependencies: 0, optionalDependencies: 0, totalDependencies: 392 },
});

const clean = JSON.stringify({ actions: [], advisories: {}, muted: [], metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, dependencies: 392 } });

describe("parseAudit", () => {
  it("reads the advisories, most severe first, with paths from workspace folders", () => {
    const audit = parseAudit(today);
    expect(audit.advisories.map((a) => [a.severity, a.module])).toEqual([
      ["high", "next"],
      ["high", "source-map-js"],
      ["moderate", "next"],
      ["low", "next"],
    ]);
    expect(audit.advisories[1]?.paths).toEqual(["apps/web › next › postcss › source-map-js"]);
    expect(audit.packages).toBe(392);
  });

  it("refuses pnpm's error output, so a registry outage is not read as a clean audit", () => {
    const outage = JSON.stringify({ error: { code: "ECONNREFUSED", message: "request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed" } });
    expect(() => parseAudit(outage)).toThrow("pnpm audit failed: ECONNREFUSED request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed");
    expect(() => parseAudit("")).toThrow("pnpm audit printed no JSON");
    expect(() => parseAudit("[]")).toThrow("pnpm audit printed no JSON");
    expect(() => parseAudit("{}")).toThrow("pnpm audit printed no advisories");
  });

  it("counts a severity pnpm does not name yet as critical, so it is never hidden below the level", () => {
    expect(parseAudit(auditOf(advisory(1, "severe", "x", "t", ["apps__api>x"]))).advisories[0]?.severity).toBe("critical");
  });
});

describe("summary", () => {
  it("counts the findings at and below the level, and tables the ones at it", () => {
    const text = summary(parseAudit(today), "high");
    expect(text).toContain("## Package audit: 2 at high or above");
    expect(text).toContain("2 high, 1 moderate, 1 low in 392 production packages.");
    expect(text).toContain("| high | next | [Next.js has Server-Side Request Forgery in Image Optimization](https://github.com/advisories/GHSA-1241496) | >=16.3.8 | apps/web › next |");
    expect(text).toContain("Reporting only (RP-1023): this job does not fail on findings yet.");
  });

  it("puts the findings below the level in a closed section", () => {
    const text = summary(parseAudit(today), "high");
    const details = text.slice(text.indexOf("<details>"));
    expect(details).toContain("2 below high");
    expect(details).toContain("| moderate | next |");
    expect(details).toContain("| low | next |");
    expect(details).not.toContain("| high |");
  });

  it("says so when nothing reaches the level", () => {
    expect(summary(parseAudit(clean), "high")).toContain("## Package audit: nothing at high or above");
  });

  it("keeps an advisory's title and package name from breaking the table", () => {
    const text = summary(parseAudit(auditOf(advisory(1, "critical", "a|b\nc", "a | b\nc [d] <e> `f`", ["apps__api>x"]))), "high");
    expect(text).toContain("| critical | a\\|b c | [a \\| b c \\[d\\] &lt;e> \\`f\\`](https://github.com/advisories/GHSA-1) |");
  });

  it("keeps a URL from closing the link early, and links only https", () => {
    const parens = summary(parseAudit(auditOf(advisory(1, "high", "x", "t", ["apps__api>x"], ">=1", "https://x.test/a) [b](c|d"))), "high");
    expect(parens).toContain("[t](https://x.test/a%29%20%5Bb%5D%28c%7Cd)");
    const script = summary(parseAudit(auditOf(advisory(1, "high", "x", "t", ["apps__api>x"], ">=1", "javascript:alert(1)"))), "high");
    expect(script).toContain("| high | x | t | >=1 |");
    expect(script).not.toContain("javascript");
  });
});

describe("warnings", () => {
  it("warns once per advisory at the level, naming package, title and fix", () => {
    expect(warnings(parseAudit(today), "high")).toEqual([
      "::warning title=pnpm audit%3A high in next::Next.js has Server-Side Request Forgery in Image Optimization. Patched: >=16.3.8. Path: apps/web › next. https://github.com/advisories/GHSA-1241496",
      "::warning title=pnpm audit%3A high in source-map-js::source-map-js allows event-loop denial of service through indexed source-map section offsets. Patched: >=1.2.2. Path: apps/web › next › postcss › source-map-js. https://github.com/advisories/GHSA-1241209",
    ]);
  });

  it("escapes workflow-command characters, so registry text cannot start a command of its own", () => {
    const odd = auditOf(advisory(1, "high", "a,b:c\n::error::m", "50%\n::error::x", ["apps__api>x"], ">=1\r\n::error::p", "https://x.test/\n::error::u"));
    expect(warnings(parseAudit(odd), "high")).toEqual(["::warning title=pnpm audit%3A high in a%2Cb%3Ac%0A%3A%3Aerror%3A%3Am::50%25%0A::error::x. Patched: >=1%0D%0A::error::p. Path: apps/api › x. https://x.test/%0A::error::u"]);
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
    const result = report(JSON.stringify({ error: { code: "ENOTFOUND", message: "registry <b>down</b> | now" } }), "high");
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("## Package audit could not run");
    expect(result.summary).toContain("pnpm audit failed: ENOTFOUND registry &lt;b>down&lt;/b> \\| now");
    expect(result.lines).toEqual(["::error title=pnpm audit::pnpm audit failed: ENOTFOUND registry <b>down</b> | now"]);
  });
});
