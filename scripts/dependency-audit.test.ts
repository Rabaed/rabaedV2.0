import { describe, expect, it } from "vitest";
import { workflowCommands, parseAllowlist, parseAudit, report, summary } from "./dependency-audit.ts";

// RP-1023: `pnpm audit --prod` in CI, reporting first. RP-635 checked a new
// library by hand, and the audit then showed 7 findings (2 high, in apps/web's
// `next`) that nothing in CI reported.

const advisory = (id: number, severity: string, module_name: string, title: string, paths: string[], patched_versions = ">=16.3.8", url = `https://github.com/advisories/GHSA-${id}`) => ({
  id,
  github_advisory_id: `GHSA-${id}`,
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

  it("reads each advisory's GitHub id, the key the allow-list uses", () => {
    expect(parseAudit(today).advisories.map((a) => a.id)).toEqual(["GHSA-1241496", "GHSA-1241209", "GHSA-1241489", "GHSA-1241492"]);
  });

  it("falls back to pnpm's own id when an advisory has no GitHub id", () => {
    const { github_advisory_id: _, ...npmOnly } = advisory(7, "high", "x", "t", ["apps__api>x"]);
    expect(parseAudit(auditOf(npmOnly as ReturnType<typeof advisory>)).advisories[0]?.id).toBe("7");
  });

  it("counts a severity pnpm does not name yet as critical, so it is never hidden below the level", () => {
    expect(parseAudit(auditOf(advisory(1, "severe", "x", "t", ["apps__api>x"]))).advisories[0]?.severity).toBe("critical");
  });
});

describe("parseAllowlist", () => {
  it("reads each entry's id, reason and review date", () => {
    const text = JSON.stringify({ advisories: [{ id: "GHSA-1241496", reason: "No patched release yet.", review: "2026-12-01" }] });
    expect(parseAllowlist(text)).toEqual([{ id: "GHSA-1241496", reason: "No patched release yet.", review: "2026-12-01" }]);
  });

  it("reads a missing file as an empty list", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it("refuses an entry without a reason or a real review date, naming the entry", () => {
    const entries = (...advisories: unknown[]) => JSON.stringify({ advisories });
    expect(() => parseAllowlist("{")).toThrow(".audit-allowlist.json is not JSON");
    expect(() => parseAllowlist("[]")).toThrow('.audit-allowlist.json needs an "advisories" list');
    expect(() => parseAllowlist(entries({ id: "GHSA-1", review: "2026-12-01" }))).toThrow('.audit-allowlist.json entry 1 (GHSA-1) needs an "id", a "reason" and a "review" date (YYYY-MM-DD)');
    expect(() => parseAllowlist(entries({ id: "GHSA-1", reason: " ", review: "2026-12-01" }))).toThrow("entry 1 (GHSA-1) needs");
    expect(() => parseAllowlist(entries({ reason: "r", review: "2026-12-01" }))).toThrow("entry 1 needs");
    expect(() => parseAllowlist(entries({ id: "GHSA-1", reason: "r", review: "1 December" }))).toThrow("entry 1 (GHSA-1) needs");
    expect(() => parseAllowlist(entries({ id: "GHSA-1", reason: "r", review: "2026-02-30" }))).toThrow("entry 1 (GHSA-1) needs");
    expect(() => parseAllowlist(entries({ id: "GHSA-1", reason: "r", review: "2026-13-01" }))).toThrow("entry 1 (GHSA-1) needs");
    expect(() => parseAllowlist(entries("GHSA-1"))).toThrow("entry 1 needs");
    // The summary prints an id in a code span: only an advisory id's own characters.
    expect(() => parseAllowlist(entries({ id: "GHSA-1` <b>", reason: "r", review: "2026-12-01" }))).toThrow("entry 1 needs");
  });

  it("refuses an id listed twice", () => {
    const entry = { id: "GHSA-1", reason: "r", review: "2026-12-01" };
    expect(() => parseAllowlist(JSON.stringify({ advisories: [entry, entry] }))).toThrow(".audit-allowlist.json lists GHSA-1 twice");
  });
});

describe("summary", () => {
  it("counts the findings at and below the level, and tables the ones at it", () => {
    const text = summary(parseAudit(today), "high");
    expect(text).toContain("## Package audit failed: 2 at high or above, not allow-listed");
    expect(text).toContain("2 high, 1 moderate, 1 low in 392 production packages.");
    expect(text).toContain("| high | next | [Next.js has Server-Side Request Forgery in Image Optimization](https://github.com/advisories/GHSA-1241496) | >=16.3.8 | apps/web › next |");
    expect(text).toContain("The job fails on an advisory at high or above that `.audit-allowlist.json` does not list (RP-1032).");
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

describe("workflowCommands", () => {
  it("errors once per advisory at the level, naming package, title and fix", () => {
    expect(workflowCommands(parseAudit(today), "high")).toEqual([
      "::error title=pnpm audit%3A high in next::Next.js has Server-Side Request Forgery in Image Optimization. Patched: >=16.3.8. Path: apps/web › next. https://github.com/advisories/GHSA-1241496",
      "::error title=pnpm audit%3A high in source-map-js::source-map-js allows event-loop denial of service through indexed source-map section offsets. Patched: >=1.2.2. Path: apps/web › next › postcss › source-map-js. https://github.com/advisories/GHSA-1241209",
    ]);
  });

  it("escapes workflow-command characters, so registry text cannot start a command of its own", () => {
    const odd = auditOf(advisory(1, "high", "a,b:c\n::error::m", "50%\n::error::x", ["apps__api>x"], ">=1\r\n::error::p", "https://x.test/\n::error::u"));
    expect(workflowCommands(parseAudit(odd), "high")).toEqual(["::error title=pnpm audit%3A high in a%2Cb%3Ac%0A%3A%3Aerror%3A%3Am::50%25%0A::error::x. Patched: >=1%0D%0A::error::p. Path: apps/api › x. https://x.test/%0A::error::u"]);
  });
});

// RP-1032: the allow-list, and the failing exit. Dates are fixed: "today" is the run's UTC date.
const on = "2026-10-28";
const allowlist = (...advisories: { id: string; reason?: string; review?: string }[]) =>
  JSON.stringify({ advisories: advisories.map((a) => ({ reason: "No patched release fits yet.", review: "2026-12-01", ...a })) });

describe("report", () => {
  it("fails on an advisory at the level that the allow-list does not name, still writing the table", () => {
    const result = report(today, "high", { allowlist: allowlist({ id: "GHSA-1241209" }), today: on });
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("## Package audit failed: 1 at high or above, not allow-listed");
    expect(result.summary).toContain("| high | next | [Next.js has Server-Side Request Forgery in Image Optimization](https://github.com/advisories/GHSA-1241496) | >=16.3.8 | apps/web › next |");
    expect(result.lines).toEqual([expect.stringMatching(/^::error title=pnpm audit%3A high in next::/)]);
  });

  it("fails with no allow-list file at all", () => {
    const result = report(today, "high", { allowlist: undefined, today: on });
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("## Package audit failed: 2 at high or above, not allow-listed");
    expect(result.lines).toHaveLength(2);
  });

  it("passes when every advisory at the level is allow-listed, and tables those with their reason and review date", () => {
    const result = report(today, "high", { allowlist: allowlist({ id: "GHSA-1241496", reason: "Next 16.4 | breaks the build." }, { id: "GHSA-1241209" }), today: on });
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.summary).toContain("## Package audit: nothing at high or above outside the allow-list");
    const listed = result.summary.slice(result.summary.indexOf("### Allow-listed"));
    expect(listed).toContain("### Allow-listed: 2");
    expect(listed).toContain("| Severity | Package | Advisory | Reason | Review by |");
    expect(listed).toContain("| high | next | [Next.js has Server-Side Request Forgery in Image Optimization](https://github.com/advisories/GHSA-1241496) | Next 16.4 \\| breaks the build. | 2026-12-01 |");
    expect(result.summary.slice(result.summary.indexOf("<details>"))).not.toContain("| high |");
  });

  it("passes with findings below the level only", () => {
    const below = auditOf(advisory(1, "moderate", "x", "t", ["apps__api>x"]));
    expect(report(below, "high", { allowlist: undefined, today: on }).exitCode).toBe(0);
    expect(report(clean, "high", { allowlist: undefined, today: on }).exitCode).toBe(0);
  });

  it("names an entry past its review date, in the summary and as a warning, and still skips its advisory", () => {
    const result = report(today, "high", { allowlist: allowlist({ id: "GHSA-1241496", review: "2026-10-27" }, { id: "GHSA-1241209", review: on }), today: on });
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("**Review date passed:** `GHSA-1241496` (review by 2026-10-27). Fix it, or give it a new reason and review date.");
    expect(result.summary).not.toContain("`GHSA-1241209` (review by");
    expect(result.lines).toEqual(["::warning title=pnpm audit%3A allow-list::GHSA-1241496 was to be reviewed by 2026-10-27. Fix it, or give it a new reason and review date in .audit-allowlist.json."]);
  });

  it("names an entry the audit no longer finds, so the allow-list does not keep it forever", () => {
    const result = report(clean, "high", { allowlist: allowlist({ id: "GHSA-9" }), today: on });
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("**No longer found:** `GHSA-9`. Remove it from `.audit-allowlist.json`.");
    expect(result.lines).toEqual(["::warning title=pnpm audit%3A allow-list::GHSA-9 is no longer found. Remove it from .audit-allowlist.json."]);
  });

  it("fails on a malformed allow-list, as when the audit could not run", () => {
    const result = report(today, "high", { allowlist: allowlist({ id: "GHSA-1", review: "soon" }), today: on });
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("## Package audit could not run");
    expect(result.summary).toContain(".audit-allowlist.json entry 1 (GHSA-1) needs");
  });

  it("fails when the audit could not run, with the reason in the summary and an error line", () => {
    const result = report(JSON.stringify({ error: { code: "ENOTFOUND", message: "registry <b>down</b> | now" } }), "high", { allowlist: undefined, today: on });
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("## Package audit could not run");
    expect(result.summary).toContain("pnpm audit failed: ENOTFOUND registry &lt;b>down&lt;/b> \\| now");
    expect(result.lines).toEqual(["::error title=pnpm audit::pnpm audit failed: ENOTFOUND registry <b>down</b> | now"]);
  });
});
