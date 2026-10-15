import { describe, expect, it } from "vitest";
import { specIssues, unreservedSpecIssues, type MigrationDaysSeam } from "./migration-days.ts";

// Jira's description (ADF): a paragraph, a table without a Ticket column, then the spec's issue table.
type Node = { type: string; text?: string; attrs?: { url: string }; content?: Node[] };
const text = (value: string): Node => ({ type: "text", text: value });
const card = (key: string): Node => ({ type: "inlineCard", attrs: { url: `https://rabaedsa.atlassian.net/browse/${key}` } });
const cell = (inline: Node | string, type = "tableCell"): Node => ({ type, content: [{ type: "paragraph", content: [typeof inline === "string" ? text(inline) : inline] }] });
const row = (...cells: Node[]): Node => ({ type: "tableRow", content: cells });
const table = (...rows: Node[]): Node => ({ type: "table", content: rows });
const header = (...names: string[]) => row(...names.map((name) => cell(name, "tableHeader")));
const describing = (...rows: Node[]): Node => ({
  type: "doc",
  content: [{ type: "paragraph", content: [text("Settled with RP-26 in mind.")] }, table(header("Day", "Issue"), row(cell("20270401"), cell("RP-1"))), table(header("Suggested lane", "Ticket", "Blocked by"), ...rows)],
});
const spec = describing(row(cell("B"), cell("RP-593"), cell("—")), row(cell("B"), card("RP-596"), cell("RP-593")), row(cell("D"), cell("RP-597"), cell("RP-590, 591")));

const days = `| Day | Issue or spec | Lane | Purpose |
| --- | --- | --- | --- |
| 20270401 | RP-593 | B | The Owner's review |
| 20270402 | RP-596 | B | Default Workflows |
| 20270409 | spec RP-598 | B | Review fixes |
`;
const allDays = `${days}| 20270408 | RP-597 | B | Demo |\n`;

function fakeSeam(overrides: Partial<MigrationDaysSeam> = {}): MigrationDaysSeam {
  return {
    fetchMain: () => true,
    credentials: () => true,
    specDescription: async () => spec,
    reservations: () => [days, days],
    ...overrides,
  };
}

describe("specIssues", () => {
  it("reads the Ticket column of the issue table, smart links too, not the other tables or the Blocked by column", () => {
    expect(specIssues(spec)).toEqual({ found: true, issues: ["RP-593", "RP-596", "RP-597"], unreadable: [] });
  });

  it("names a Ticket cell that isn't one key alone", () => {
    const loose = describing(row(cell("B"), cell("RP-593"), cell("—")), row(cell("B"), cell("RP-596 (Opus)"), cell("RP-593")));
    expect(specIssues(loose)).toEqual({ found: true, issues: ["RP-593"], unreadable: ["RP-596 (Opus)"] });
  });

  it("finds nothing in a description without a Ticket column", () => {
    expect(specIssues({ type: "doc", content: [table(header("Day", "Issue"), row(cell("20270401"), cell("RP-1")))] }).found).toBe(false);
    expect(specIssues(null).found).toBe(false);
  });
});

describe("migration-days", () => {
  it("passes a spec whose issues all have a day", async () => {
    const result = await unreservedSpecIssues(["--spec", "RP-598"], fakeSeam({ reservations: () => [allDays, allDays] }));
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("RP-593, RP-596, RP-597");
  });

  it("names the issue with no reserved day, and fails", async () => {
    const result = await unreservedSpecIssues(["--spec", "RP-598"], fakeSeam());
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("reserved for RP-597 of RP-598.");
  });

  it("counts the branch's rows as well as main's", async () => {
    const result = await unreservedSpecIssues(["--spec", "RP-598"], fakeSeam({ reservations: () => [days, allDays] }));
    expect(result.ok).toBe(true);
  });

  it("fails on an unreadable Ticket cell, naming it", async () => {
    const loose = describing(row(cell("B"), cell("RP-596 (Opus)"), cell("RP-593")));
    const result = await unreservedSpecIssues(["--spec", "RP-598"], fakeSeam({ specDescription: async () => loose, reservations: () => [allDays, allDays] }));
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain('"RP-596 (Opus)"');
  });

  it("warns when the fetch fails, and checks the last-fetched main", async () => {
    const result = await unreservedSpecIssues(["--spec", "RP-598"], fakeSeam({ fetchMain: () => false, reservations: () => [allDays, allDays] }));
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("git fetch origin main failed");
  });

  it("checks a --tickets list offline, without Jira", async () => {
    let read = false;
    const seam = fakeSeam({
      credentials: () => false,
      specDescription: async () => {
        read = true;
        return spec;
      },
    });
    const result = await unreservedSpecIssues(["--spec", "RP-598", "--tickets", "RP-593,RP-596"], seam);
    expect(result.ok).toBe(true);
    expect(read).toBe(false);
  });

  it("takes --tickets split by commas, spaces or arguments (PowerShell splits RP-a,RP-b)", async () => {
    const seam = fakeSeam({ credentials: () => false });
    for (const keys of [["RP-593,RP-597"], ["RP-593", "RP-597"], ["RP-593, RP-597"]]) {
      const result = await unreservedSpecIssues(["--tickets", ...keys], seam);
      expect(result.lines.join("\n")).toContain("reserved for RP-597.");
    }
  });

  it("asks for --tickets when Jira credentials are missing", async () => {
    const result = await unreservedSpecIssues(["--spec", "RP-598"], fakeSeam({ credentials: () => false }));
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("--tickets");
  });

  it("fails a spec whose description has no issue table", async () => {
    const result = await unreservedSpecIssues(["--spec", "RP-598"], fakeSeam({ specDescription: async () => ({ type: "doc", content: [] }) }));
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("no issue table");
  });

  it("refuses bad arguments with the usage", async () => {
    for (const args of [[], ["--spec"], ["--spec", "598"], ["--tickets", "RP-1,x"], ["--tickets"]]) {
      const result = await unreservedSpecIssues(args, fakeSeam());
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("Usage: pnpm migration-days");
    }
  });
});
