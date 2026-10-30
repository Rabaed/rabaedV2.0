import { describe, expect, it } from "vitest";
import { adfText, checkSpec, formatReport, issuesUnderEpic, namedStories, namesSpec, parseArgs, run, scenarioIds, specJiraOverHttp, specStories, type Issue, type SpecJira } from "./spec-stories.ts";

const text = (t: string) => ({ type: "text", text: t });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const heading = (level: number, t: string) => ({ type: "heading", attrs: { level }, content: [text(t)] });
const item = (...content: unknown[]) => ({ type: "listItem", content });
const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });

describe("adfText", () => {
  it("keeps an ordered list's numbers, from the list's own start", () => {
    const out = adfText(doc({ type: "orderedList", attrs: { order: 13 }, content: [item(paragraph(text("As a Member, A"))), item(paragraph(text("As a Member, B")))] }));
    expect(out).toBe("13. As a Member, A\n14. As a Member, B");
  });

  it("writes headings with their level, hard breaks as new lines, and indents nested lists", () => {
    const out = adfText(
      doc(
        heading(2, "User Stories"),
        paragraph(text("Taking a Transition"), { type: "hardBreak" }, text("13. As a Member, C")),
        { type: "bulletList", content: [item(paragraph(text("outer")), { type: "orderedList", content: [item(paragraph(text("inner")))] })] },
      ),
    );
    expect(out).toBe("## User Stories\nTaking a Transition\n13. As a Member, C\n- outer\n  1. inner");
  });

  it("keeps a container of inline runs (a task item) on one line", () => {
    const task = { type: "taskList", content: [{ type: "taskItem", content: [{ type: "text", text: "13.", marks: [{ type: "strong" }] }, text(" As a Member, D")] }] };
    expect(adfText(doc(task))).toBe("13. As a Member, D");
  });

  it("reads text inside tables and panels, and returns a plain string as it is", () => {
    const table = { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [paragraph(text("RP-23-1"))] }] }] };
    expect(adfText(doc({ type: "panel", content: [paragraph(text("Note"))] }, table))).toBe("Note\nRP-23-1");
    expect(adfText("already text")).toBe("already text");
    expect(adfText(null)).toBe("");
  });
});

describe("specStories", () => {
  const spec = [
    "## Problem Statement",
    "1. not a story",
    "## User Stories",
    "### Requesting",
    "1. As a Contractor engineer, I want X",
    "2. As a Contractor engineer, I want Y",
    "**Taking a Transition**",
    "13\\. As a Member, I want Z", // Jira's markdown escape of a literal "13."
    "  1. a nested list item, not a story",
    "### Visibility",
    "38. As Contractor C2, I want nothing",
    "## Implementation Decisions",
    "1. write the Record Data",
  ].join("\n");

  it("lists the numbered lines under User Stories, across its sub-headings, and nothing after the next same-level heading", () => {
    expect(specStories(spec)).toEqual([1, 2, 13, 38]);
  });

  it("reads a bold \"User Stories\" line as the section's start, up to the next heading", () => {
    expect(specStories("Intro\n**User Stories**\n1. As a Member, A\n2. As a Member, B\n## Out of Scope\n3. not a story")).toEqual([1, 2]);
  });

  it("is empty when the spec has no User Stories section", () => {
    expect(specStories("## What to build\n1. a thing")).toEqual([]);
  });
});

describe("scenarioIds", () => {
  it("lists every RP-nnn-n the spec names once, expanding ranges, and ignores plain keys and branch names", () => {
    const spec = "Scenarios RP-23-1 to RP-23-3, RP-23-5 and RP-649-2. See RP-649, branch `RP-1095-visibility-tests`, `RP-<key>-n`.";
    expect(scenarioIds(spec)).toEqual(["RP-23-1", "RP-23-2", "RP-23-3", "RP-23-5", "RP-649-2"]);
  });

  it("reads a dash range and a range with the second key's prefix left off", () => {
    expect(scenarioIds("RP-23-1–RP-23-2; RP-30-4 – 5")).toEqual(["RP-23-1", "RP-23-2", "RP-30-4", "RP-30-5"]);
  });
});

describe("namedStories", () => {
  it("reads 'story n', lists and ranges, with or without a colon", () => {
    expect(namedStories("A card (story 32). Stories: 1, 2, 5–7 and 9. Also stories 40 to 41.")).toEqual([1, 2, 5, 6, 7, 9, 32, 40, 41]);
  });

  it("reads nothing from words that only start like 'story'", () => {
    expect(namedStories("storybook 3, a storey 4, history 5")).toEqual([]);
  });

  it("ignores a range too wide to be meant", () => {
    expect(namedStories("stories 1-5000")).toEqual([]);
  });
});

describe("scenarioIds in an issue", () => {
  it("lists the scenario ids an issue names, ranges expanded", () => {
    expect(scenarioIds("Seam 2: RP-23-1 to RP-23-2 (scenario `RP-170-n`)")).toEqual(["RP-23-1", "RP-23-2"]);
  });
});

describe("namesSpec", () => {
  it("is true for the key itself or one of its scenario ids, not a longer key", () => {
    expect(namesSpec("Spec **RP-649** (Inspections)", "RP-649")).toBe(true);
    expect(namesSpec("covers RP-649-2", "RP-649")).toBe(true);
    expect(namesSpec("see RP-6490", "RP-649")).toBe(false);
    expect(namesSpec("see XRP-649", "RP-649")).toBe(false);
  });
});

const spec: Issue = { key: "RP-632", summary: "Spec: Signing", text: "## User Stories\n55. As a Member, I want A\n56. As a Member, I want B\n57. As a viewer, I want C\n## Testing\nScenarios RP-23-1 to RP-23-2.", labels: ["spec"], status: "To Do", statusCategory: "new", parent: "RP-23" };
const task = (key: string, body: string, status = "Done"): Issue => ({ key, summary: `${key} summary`, text: body, labels: [], status, statusCategory: status === "Done" ? "done" : "new", parent: "RP-23" });

describe("checkSpec", () => {
  it("names each story's and scenario's issues, and lists those no issue names (RP-1087: story 57)", () => {
    const report = checkSpec(spec, [task("RP-85", "Spec RP-632. Stories: 55, 56. Seam 2: RP-23-1"), task("RP-86", "Spec RP-632, story 56", "To Do")]);
    expect(report.stories).toEqual([
      { id: 55, by: ["RP-85"] },
      { id: 56, by: ["RP-85", "RP-86"] },
      { id: 57, by: [] },
    ]);
    expect(report.missingStories).toEqual([57]);
    expect(report.missingScenarios).toEqual(["RP-23-2"]);
    expect(report.openIssues).toEqual(["RP-86"]);
    expect(report.ok).toBe(false);
  });

  it("counts only issues that name the spec, so a story number for another spec is not taken", () => {
    const report = checkSpec(spec, [task("RP-90", "Spec RP-619, stories 55 to 57. RP-23-1 to RP-23-2")]);
    expect(report.missingStories).toEqual([55, 56, 57]);
    expect(report.children).toEqual([]);
  });

  it("checks only scenarios keyed by the spec or its Epic, and lists cited ones (RP-616 cites RP-588-1)", () => {
    const citing = { ...spec, text: `${spec.text}\nAgainst RP-588-1 and RP-632-1.` };
    const report = checkSpec(citing, [task("RP-85", "RP-632 stories 55–57, RP-23-1 to RP-23-2, RP-632-1")]);
    expect(report.scenarios.map((s) => s.id)).toEqual(["RP-23-1", "RP-23-2", "RP-632-1"]);
    expect(report.cited).toEqual(["RP-588-1"]);
    expect(report.ok).toBe(true);
    expect(formatReport(report)).toContain("Cited from other keys, not checked: RP-588-1");
  });

  it("fails a spec that mentions User Stories when none is read, rather than passing empty", () => {
    const unreadable = { ...spec, text: "User Stories are in the attached page.\n- As a Member, I want A" };
    const report = checkSpec(unreadable, []);
    expect(report).toMatchObject({ ok: false, unreadStories: true, stories: [] });
    expect(formatReport(report)).toContain("no numbered story was read");
  });

  it("is ok when every story and scenario is named, and when the spec numbers none", () => {
    expect(checkSpec(spec, [task("RP-85", "RP-632: stories 55–57, RP-23-1 to RP-23-2")]).ok).toBe(true);
    const plain = { ...spec, text: "## What to build\nOne PR, then a second." };
    const report = checkSpec(plain, []);
    expect(report).toMatchObject({ ok: true, stories: [], scenarios: [] });
  });
});

describe("formatReport", () => {
  it("prints each missing story and scenario, then the verdict", () => {
    const out = formatReport(checkSpec(spec, [task("RP-85", "RP-632 stories 55, 56; RP-23-1", "In Progress")]));
    expect(out).toContain("RP-632: 3 stories, 2 scenarios, 1 issue naming the spec");
    expect(out).toContain("story 57: named by no issue");
    expect(out).toContain("RP-23-2: named by no issue");
    expect(out).toContain("Not Done yet: RP-85");
    expect(out.trimEnd().split("\n").at(-1)).toBe("FAIL: 1 story and 1 scenario are named by no issue. Write each in the issue that builds it (\"Stories: n, m\" in its description), or open an issue for it.");
  });

  it("ends with OK when nothing is missing", () => {
    const out = formatReport(checkSpec(spec, [task("RP-85", "RP-632 stories 55–57, RP-23-1 to RP-23-2")]));
    expect(out.trimEnd().split("\n").at(-1)).toBe("OK: every story and scenario of RP-632 is named by an issue.");
  });
});

describe("parseArgs", () => {
  it("takes one key and an optional --close", () => {
    expect(parseArgs(["RP-632"])).toEqual({ key: "RP-632", close: false });
    expect(parseArgs(["--close", "RP-632"])).toEqual({ key: "RP-632", close: true });
  });

  it("refuses no key, a malformed key and unknown flags", () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(["632"])).toThrow(/usage/);
    expect(() => parseArgs(["RP-632", "--force"])).toThrow(/usage/);
  });
});

function fakeJira(issues: Issue[], children: Issue[]): SpecJira & { closed: { key: string; comment: string }[] } {
  const closed: { key: string; comment: string }[] = [];
  return {
    closed,
    issue: async (key) => {
      const found = issues.find((i) => i.key === key);
      if (!found) throw new Error(`Jira GET issue/${key} answered 404`);
      return found;
    },
    issuesUnder: async () => children,
    closeWithComment: async (key, comment) => {
      closed.push({ key, comment });
    },
  };
}

describe("run", () => {
  const covering = task("RP-85", "RP-632 stories 55–57, RP-23-1 to RP-23-2");

  it("reports and exits 1 when something is missing, and never closes", async () => {
    const jira = fakeJira([spec], [task("RP-85", "RP-632 story 55")]);
    const result = await run({ key: "RP-632", close: true }, jira);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Not closed: the spec stays open while a story or scenario is named by no issue.");
    expect(jira.closed).toEqual([]);
  });

  it("exits 0 and closes only with --close", async () => {
    const jira = fakeJira([spec], [covering]);
    expect((await run({ key: "RP-632", close: false }, jira)).exitCode).toBe(0);
    expect(jira.closed).toEqual([]);
    const closing = await run({ key: "RP-632", close: true }, jira);
    expect(closing.exitCode).toBe(0);
    expect(jira.closed).toEqual([{ key: "RP-632", comment: "Closed by scripts/spec-stories.ts: 3 stories and 2 scenarios, each named by an issue (RP-85)." }]);
    expect(closing.output).toContain("Closed RP-632.");
  });

  it("refuses --close while an issue naming the spec is not Done", async () => {
    const jira = fakeJira([spec], [task("RP-85", "RP-632 stories 55–57, RP-23-1 to RP-23-2", "In Progress")]);
    const result = await run({ key: "RP-632", close: true }, jira);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Not closed: 1 issue naming the spec is not Done yet (RP-85).");
    expect(jira.closed).toEqual([]);
    expect((await run({ key: "RP-632", close: false }, jira)).exitCode).toBe(0);
  });

  it("refuses --close on an issue without the spec label, or already Done", async () => {
    const notSpec = { ...spec, labels: [] };
    const jira = fakeJira([notSpec], [covering]);
    const result = await run({ key: "RP-632", close: true }, jira);
    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.output).toContain("RP-632 has no `spec` label");
    const done = fakeJira([{ ...spec, status: "Done", statusCategory: "done" }], [covering]);
    expect((await run({ key: "RP-632", close: true }, done)).output).toContain("RP-632 is already Done");
    expect(done.closed).toEqual([]);
  });

  it("refuses a spec with no parent Epic, since its issues are found under the Epic", async () => {
    const jira = fakeJira([{ ...spec, parent: undefined }], []);
    const result = await run({ key: "RP-632", close: false }, jira);
    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.output).toContain("RP-632 has no parent Epic");
  });
});

describe("issuesUnderEpic", () => {
  const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  it("pages the Epic's issues by nextPageToken and reads their description as text", async () => {
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    const pages = [
      { issues: [{ key: "RP-85", fields: { summary: "S", description: doc(paragraph(text("RP-632 story 55"))), labels: [], status: { name: "Done", statusCategory: { key: "done" } }, parent: { key: "RP-23" } } }], nextPageToken: "t2", isLast: false },
      { issues: [{ key: "RP-86", fields: { summary: "T", description: null, labels: ["x"], status: { name: "To Do", statusCategory: { key: "new" } } } }], isLast: true },
    ];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("Authorization") });
      return response(pages[calls.length - 1]);
    }) as typeof fetch;

    const issues = await issuesUnderEpic("a@b.c", "tok", "RP-23", "RP-632", fetchImpl);
    expect(issues.map((i) => [i.key, i.text, i.statusCategory])).toEqual([
      ["RP-85", "RP-632 story 55", "done"],
      ["RP-86", "", "new"],
    ]);
    expect(calls[0]?.url).toBe("https://rabaedsa.atlassian.net/rest/api/3/search/jql");
    expect(calls[0]?.body).toMatchObject({ jql: "project = RP AND parent = RP-23 AND key != RP-632 ORDER BY key ASC" });
    expect(calls[1]?.body).toMatchObject({ nextPageToken: "t2" });
    // The token stays in the header, never in the URL.
    expect(calls.every((c) => !c.url.includes("tok") && c.auth?.startsWith("Basic "))).toBe(true);
  });

  it("keeps paging while a nextPageToken comes back, even with no isLast", async () => {
    const pages = [
      { issues: [{ key: "RP-85", fields: {} }], nextPageToken: "t2" },
      { issues: [{ key: "RP-86", fields: {} }] },
    ];
    let n = 0;
    const fetchImpl = (async () => response(pages[n++])) as unknown as typeof fetch;
    expect((await issuesUnderEpic("a@b.c", "tok", "RP-23", "RP-632", fetchImpl)).map((i) => i.key)).toEqual(["RP-85", "RP-86"]);
  });

  it("names only the status when Jira refuses, never Jira's error text", async () => {
    const fetchImpl = (async () => new Response("secret detail", { status: 401 })) as unknown as typeof fetch;
    await expect(issuesUnderEpic("a@b.c", "tok", "RP-23", "RP-632", fetchImpl)).rejects.toThrow(/^Jira POST search\/jql answered 401$/);
  });
});

describe("specJiraOverHttp", () => {
  it("reads one issue with the fields the check needs, its description as text", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      const fields = { summary: "Spec: Signing", description: doc(heading(2, "User Stories"), paragraph(text("1. As a Member, A"))), labels: ["spec"], status: { name: "In Progress", statusCategory: { key: "indeterminate" } }, parent: { key: "RP-23" } };
      return new Response(JSON.stringify({ key: "RP-632", fields }), { status: 200 });
    }) as typeof fetch;
    const issue = await specJiraOverHttp("a@b.c", "tok", fetchImpl).issue("RP-632");
    expect(urls).toEqual(["https://rabaedsa.atlassian.net/rest/api/3/issue/RP-632?fields=summary,description,labels,status,parent"]);
    expect(issue).toEqual({ key: "RP-632", summary: "Spec: Signing", text: "## User Stories\n1. As a Member, A", labels: ["spec"], status: "In Progress", statusCategory: "indeterminate", parent: "RP-23" });
  });
});
