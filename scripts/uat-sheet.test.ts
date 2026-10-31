import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { caseFromIssue, casesFromScenarios, numberedSteps, renderSheet, roundFromWaits, searchIssues, startUrl, type JiraIssue, type SheetCase } from "./uat-sheet.ts";
import { buildXlsx } from "./uat-sheet/xlsx.mjs";

// fflate is the zip the sheet inlines; the test loads the same copy from the pnpm store.
const store = resolve(import.meta.dirname, "../node_modules/.pnpm");
const fflateDir = readdirSync(store).filter((d) => d.startsWith("fflate@")).sort().pop()!;
const fflate = createRequire(join(store, fflateDir, "node_modules", "fflate", "package.json"))("fflate") as typeof import("fflate");

const markdown = [
  "**Part SUB: Submittals** · Scenario `SUB-08` · Covers: Journey · Mode: Both",
  "",
  "**Who:** Hafiz (TMC Engineer); Ali (TMC PM)",
  "",
  "## Steps",
  "",
  "1. Open Submittals and choose Add Submittal.",
  "2. Fill the Form and Send for Review.",
  "",
  "## Expected result",
  "",
  "The Draft moves to Internal Review with Ali.",
  "",
  "## Environment",
  "",
  "Lane 7 demo.",
].join("\n");

const issue = (description: unknown, labels = ["uat", "uat-part-sub", "uat-round-1"]): JiraIssue => ({
  key: "RP-725",
  fields: { summary: "SUB-08 Raise a MAR and send it for review", labels, description, status: { name: "To Do" } },
});

// The same description as Jira's REST v3 returns it (Atlassian Document Format).
const text = (t: string, strong = false) => ({ type: "text", text: t, ...(strong ? { marks: [{ type: "strong" }] } : {}) });
const adf = {
  type: "doc",
  content: [
    { type: "paragraph", content: [text("Who:", true), text(" Hafiz (TMC Engineer); Ali (TMC PM)")] },
    { type: "heading", attrs: { level: 2 }, content: [text("Steps")] },
    {
      type: "orderedList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [text("Open Submittals and choose Add Submittal.")] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [text("Fill the Form and Send for Review.")] }] },
      ],
    },
    { type: "heading", attrs: { level: 2 }, content: [text("Expected result")] },
    { type: "paragraph", content: [text("The Draft moves to Internal Review with Ali.")] },
  ],
};

const expected: Omit<SheetCase, "url"> = {
  key: "RP-725",
  id: "SUB-08",
  title: "Raise a MAR and send it for review",
  part: "SUB",
  round: "1",
  who: "Hafiz (TMC Engineer); Ali (TMC PM)",
  steps: ["Open Submittals and choose Add Submittal.", "Fill the Form and Send for Review."],
  expected: "The Draft moves to Internal Review with Ali.",
};

describe("caseFromIssue", () => {
  it("reads a Test Case written in markdown", () => {
    expect(caseFromIssue(issue(markdown), "https://uat.example")).toEqual({ ...expected, url: "https://uat.example/en" });
  });

  it("reads the same Test Case from Jira's document format", () => {
    expect(caseFromIssue(issue(adf), "https://uat.example")).toEqual({ ...expected, url: "https://uat.example/en" });
  });

  it("leaves part and round empty when the labels don't say", () => {
    const c = caseFromIssue(issue(markdown, ["uat"]), "https://uat.example");
    expect([c.part, c.round]).toEqual(["SUB", ""]);
  });
});

describe("casesFromScenarios", () => {
  it("reads the round's test-cases.json, the scenarios the Jira Test Cases were made from", () => {
    const scenarios = [{ id: "SUB-08", jira: "RP-725", part: "SUB", title: "Raise a MAR and send it for review", who: "Hafiz (TMC Engineer); Ali (TMC PM)",
      steps: "1) Open Submittals and choose Add Submittal. 2) Fill the Form and Send for Review.", expected: "The Draft moves to Internal Review with Ali.", round: "1" }];
    expect(casesFromScenarios(JSON.stringify(scenarios), "https://uat.example")).toEqual([{ ...expected, url: "https://uat.example/en" }]);
  });

  it("splits steps only on their own numbers, in order", () => {
    expect(numberedSteps("1) Open Rabaed Admin (lane 7, port 4750) on its own address. 2) Enter email and password. 3) Read the code.")).toEqual([
      "Open Rabaed Admin (lane 7, port 4750) on its own address.",
      "Enter email and password.",
      "Read the code.",
    ]);
    expect(numberedSteps("Open the Packages view.")).toEqual(["Open the Packages view."]);
  });

  it("takes the round from what a case waits for, as the Jira labels do", () => {
    expect(["Now", "RP-588: Packages UI (RP-659 to RP-662)", "RP-23: Add Signature UI (RP-665)", "RP-28: SNAG-10", "RP-27: INS", "RP-589: Import", "RP-999"].map(roundFromWaits)).toEqual(["0", "1", "2", "3", "4", "5", ""]);
  });
});

describe("searchIssues", () => {
  it("follows Jira's pages and sends the token only in the header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const pages = [{ issues: [issue(markdown)], nextPageToken: "p2", isLast: false }, { issues: [{ ...issue(markdown), key: "RP-726" }], isLast: true }];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 });
    }) as unknown as typeof fetch;
    const found = await searchIssues("labels = uat", { email: "a@b.test", token: "secret-token" }, fake);
    expect(found.map((i) => i.key)).toEqual(["RP-725", "RP-726"]);
    expect(JSON.parse(String(calls[1]!.init.body)).nextPageToken).toBe("p2");
    expect(calls.every((c) => !c.url.includes("secret-token") && !String(c.init.body).includes("secret-token"))).toBe(true);
  });
});

describe("startUrl", () => {
  it("sends Rabaed Admin cases to the Admin site and the rest to the web app", () => {
    expect(startUrl("ADM", "https://rabaed-uat-web.vercel.app")).toBe("https://rabaed-uat-admin.vercel.app");
    expect(startUrl("SUB", "https://rabaed-uat-web.vercel.app/")).toBe("https://rabaed-uat-web.vercel.app/en");
  });
});

describe("renderSheet", () => {
  const cases = [caseFromIssue(issue(markdown), "https://uat.example")];

  it("holds the cases, the zip and the Excel writer, so it opens offline", () => {
    const html = renderSheet({ round: "Round 1", cases, built: "2026-10-31" });
    expect(html).toContain('"id":"SUB-08"');
    expect(html).toContain("Round 1");
    expect(html).toContain("function buildXlsx");
    expect(html).toContain("zipSync");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain("/*__");
  });

  it("never holds a token from the environment", () => {
    const html = renderSheet({ round: "Round 1", cases, built: "2026-10-31" });
    expect(html).not.toMatch(/JIRA_API_TOKEN|Authorization|Basic [A-Za-z0-9+/=]{20}/);
  });

  it("escapes a case's text so it can't close the script", () => {
    const html = renderSheet({ round: "R", cases: [{ ...cases[0]!, title: "</script><b>x" }], built: "x" });
    expect(html).not.toContain("</script><b>x");
  });
});

describe("buildXlsx", () => {
  const png = fflate.strToU8("\x89PNG fake image bytes");
  const sheets = [
    { name: "Test Cases", widths: [10, 10, 40], table: [["Key", "ID", "Status"], ["RP-725", "SUB-08", "Pass"], ["RP-726", "SUB-09", "Fail"]] },
    {
      name: "Screenshots",
      widths: [10, 10, 70],
      table: [["Key", "ID", "Screenshot"], ["RP-726", "SUB-09", ""]],
      rowHeights: { 1: 180 },
      images: [{ row: 1, col: 2, data: png, ext: "png", width: 320, height: 240 }],
    },
  ];
  const files = fflate.unzipSync(buildXlsx(sheets, fflate));
  const str = (name: string) => fflate.strFromU8(files[name]!);

  it("writes a row per case", () => {
    expect(str("xl/worksheets/sheet1.xml").match(/<row /g)).toHaveLength(3);
    expect(str("xl/worksheets/sheet1.xml")).toContain("SUB-09");
  });

  it("embeds each screenshot in the workbook, anchored to its row", () => {
    expect(files["xl/media/image1.png"]).toEqual(png);
    expect(str("xl/drawings/drawing1.xml")).toContain("<xdr:row>1</xdr:row>");
    expect(str("xl/drawings/drawing1.xml")).toContain(`cx="${320 * 9525}"`);
    expect(str("xl/drawings/_rels/drawing1.xml.rels")).toContain("../media/image1.png");
    expect(str("xl/worksheets/_rels/sheet2.xml.rels")).toContain("../drawings/drawing1.xml");
    expect(str("xl/worksheets/sheet2.xml")).toContain('<drawing r:id="rId1"/>');
    expect(str("[Content_Types].xml")).toContain('Extension="png"');
    expect(str("xl/worksheets/sheet2.xml")).toContain('ht="180" customHeight="1"');
  });

  it("leaves a sheet with no screenshots without a drawing", () => {
    expect(files["xl/worksheets/_rels/sheet1.xml.rels"]).toBeUndefined();
    expect(str("xl/worksheets/sheet1.xml")).not.toContain("<drawing");
  });
});
