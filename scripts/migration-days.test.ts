import { describe, expect, it } from "vitest";
import { migrationDays, specIssues, type MigrationDaysSeam } from "./migration-days.ts";

// Jira's description (ADF): a paragraph, then the spec's ticket table.
const text = (value: string) => ({ type: "text", text: value });
const cell = (value: string, type = "tableCell") => ({ type, content: [{ type: "paragraph", content: [text(value)] }] });
const row = (...cells: ReturnType<typeof cell>[]) => ({ type: "tableRow", content: cells });
const spec = {
  type: "doc",
  content: [
    { type: "paragraph", content: [text("Settled with RP-26 in mind.")] },
    {
      type: "table",
      content: [
        row(cell("Suggested lane", "tableHeader"), cell("Ticket", "tableHeader"), cell("Blocked by", "tableHeader")),
        row(cell("B"), cell("RP-593"), cell("—")),
        row(cell("B"), cell("RP-596"), cell("RP-593, RP-591")),
        row(cell("D"), cell("RP-597"), cell("RP-590, 591")),
      ],
    },
  ],
};

const days = `| Day | Issue or spec | Lane | Purpose |
| --- | --- | --- | --- |
| 20270401 | RP-593 | B | The Owner's review |
| 20270402 | RP-596 | B | Default Workflows |
| 20270409 | spec RP-598 | B | Review fixes |
`;

function fakeSeam(overrides: Partial<MigrationDaysSeam> = {}): MigrationDaysSeam {
  return {
    credentials: () => true,
    specDescription: async () => spec,
    reservations: () => [days, days],
    ...overrides,
  };
}

describe("specIssues", () => {
  it("reads each table row's ticket cell, not the Blocked by cells or the text", () => {
    expect(specIssues(spec)).toEqual(["RP-593", "RP-596", "RP-597"]);
  });

  it("is empty for a description without a table", () => {
    expect(specIssues({ type: "doc", content: [{ type: "paragraph", content: [text("RP-1")] }] })).toEqual([]);
    expect(specIssues(null)).toEqual([]);
  });
});

describe("migration-days", () => {
  it("passes a spec whose tickets all have a day", async () => {
    const reserved = `${days}| 20270408 | RP-597 | B | Demo |\n`;
    const result = await migrationDays(["--spec", "RP-598"], fakeSeam({ reservations: () => [reserved, reserved] }));
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("RP-593, RP-596, RP-597");
  });

  it("names the ticket with no reserved day, and fails", async () => {
    const result = await migrationDays(["--spec", "RP-598"], fakeSeam());
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("RP-597");
    expect(result.lines.join("\n")).not.toContain("RP-593,");
  });

  it("counts the branch's rows as well as main's", async () => {
    const onBranch = `${days}| 20270408 | RP-597 | B | Demo |\n`;
    const result = await migrationDays(["--spec", "RP-598"], fakeSeam({ reservations: () => [days, onBranch] }));
    expect(result.ok).toBe(true);
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
    const result = await migrationDays(["--spec", "RP-598", "--tickets", "RP-593,RP-596"], seam);
    expect(result.ok).toBe(true);
    expect(read).toBe(false);
  });

  it("takes --tickets split by commas, spaces or arguments (PowerShell splits RP-a,RP-b)", async () => {
    const seam = fakeSeam({ credentials: () => false });
    for (const tickets of [["RP-593,RP-597"], ["RP-593", "RP-597"], ["RP-593, RP-597"]]) {
      const result = await migrationDays(["--tickets", ...tickets], seam);
      expect(result.lines.join("\n")).toContain("reserved for RP-597.");
    }
  });

  it("asks for --tickets when Jira credentials are missing", async () => {
    const result = await migrationDays(["--spec", "RP-598"], fakeSeam({ credentials: () => false }));
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("--tickets");
  });

  it("fails a spec whose description has no ticket table", async () => {
    const result = await migrationDays(["--spec", "RP-598"], fakeSeam({ specDescription: async () => ({ type: "doc", content: [] }) }));
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("no issue table");
  });

  it("refuses bad arguments with the usage", async () => {
    for (const args of [[], ["--spec"], ["--spec", "598"], ["--tickets", "RP-1,x"]]) {
      const result = await migrationDays(args, fakeSeam());
      expect(result.ok).toBe(false);
      expect(result.lines.join("\n")).toContain("Usage: pnpm migration-days");
    }
  });
});
