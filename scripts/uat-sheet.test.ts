import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { caseFromIssue, casesFromScenarios, numberedSteps, orderCases, renderSheet, roundFromWaits, searchIssues, startUrl, tagProblems, vercelWording, type JiraIssue, type ScenarioRow, type SheetCase } from "./uat-sheet.ts";
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
  needs: [],
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

  it("carries the needs a scenario declares in needs, and refuses a need it does not know", () => {
    const row = { id: "NOT-03", jira: "RP-1", part: "NOT", title: "Email", steps: "1) Open the mailbox.", expected: "It arrived.", round: "0" };
    expect(casesFromScenarios(JSON.stringify([{ ...row, needs: ["mail", "owner"] }]), "https://uat.example")[0]!.needs).toEqual(["mail", "owner"]);
    expect(casesFromScenarios(JSON.stringify([row]), "https://uat.example")[0]!.needs).toEqual([]);
    expect(() => casesFromScenarios(JSON.stringify([{ ...row, needs: ["mails"] }]), "https://uat.example")).toThrow(/NOT-03.*mails/);
  });

  it("words a mail case for the Vercel UAT, where the mail goes to the real mailbox, not Mailpit", () => {
    const row = {
      id: "NOT-03", jira: "RP-1", part: "NOT", title: "Immediate email via Mailpit", round: "0", needs: ["mail", "owner"],
      steps: "1) Open Mailpit (lane 7). 2) Find the email for Step reached. 3) Read Mailpit again.", expected: "Mailpit shows one email, in Mailpit only once.",
    };
    const [c] = casesFromScenarios(JSON.stringify([row]), "https://uat.example");
    expect(c!.title).toBe("Immediate email via the mailbox");
    expect(c!.steps).toEqual(["Open the mailbox.", "Find the email for Step reached.", "Read the mailbox again."]);
    expect(c!.expected).toBe("The mailbox shows one email, in the mailbox only once.");
  });

  it("leaves the wording of a case without the mail need as written", () => {
    expect(vercelWording("Open Mailpit (lane 7).")).toBe("Open the mailbox.");
    const [c] = casesFromScenarios(JSON.stringify([{ id: "X-1", jira: "RP-1", part: "X", title: "t", steps: "1) Open Mailpit.", round: "0" }]), "https://uat.example");
    expect(c!.steps).toEqual(["Open Mailpit."]);
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

  it("hands each case needs to the page, with the owner badge and the mail note in English and Arabic", () => {
    const html = renderSheet({ round: "R", cases: [{ ...cases[0]!, needs: ["mail", "owner"] }], built: "x" });
    expect(html).toContain('"needs":["mail","owner"]');
    expect(html).toContain("Needs the UAT owner");
    expect(html).toContain("يحتاج إلى مسؤول الاختبار");
    expect(html).toContain("goes to the real mailbox");
    expect(html).toContain("يصل البريد إلى صندوق البريد الحقيقي");
  });

  it("opens with a How to start guide for the tester, in English and Arabic, with the UAT address (RP-1201)", () => {
    const html = renderSheet({ round: "R", cases, built: "x", uatUrl: "https://uat.example" });
    expect(html).toContain('"uatUrl":"https://uat.example"');
    for (const text of ["How to start", "كيف تبدأ", "private window", "نافذة خاصة", "Owner runs", "يشغّلها مسؤول الاختبار"]) expect(html).toContain(text);
  });

  it("gives the Excel export who runs each case and what it needs", () => {
    const html = renderSheet({ round: "R", cases, built: "x" });
    expect(html).toContain('"Needs", "Runs it"');
  });

  it("is a page whose script still parses", () => {
    const html = renderSheet({ round: "R", cases, built: "x" });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const code of scripts) expect(() => new vm.Script(code)).not.toThrow();
  });
});

describe("orderCases", () => {
  const ids = (list: SheetCase[]) => list.map((c) => c.id);
  const make = (id: string) => ({ ...caseFromIssue(issue(markdown), "https://uat.example"), id });
  const list = ["SUB-10", "SUB-2", "PAR-01"].map(make);

  it("keeps the scenarios file's order, the strategy's suggested order to run them in", () => {
    expect(ids(orderCases(list, true))).toEqual(["SUB-10", "SUB-2", "PAR-01"]);
  });

  it("sorts cases read from Jira by ID, numbers as numbers", () => {
    expect(ids(orderCases(list, false))).toEqual(["PAR-01", "SUB-2", "SUB-10"]);
  });
});

describe("tagProblems", () => {
  const good = { id: "NOT-03", title: "Immediate email via Mailpit", steps: "1) Open Mailpit.", expected: "The email arrived.", needs: ["mail"] };

  it("passes a case that declares what it mentions", () => {
    expect(tagProblems([good])).toEqual([]);
    expect(tagProblems([{ id: "NOT-06", title: "Digest", steps: "1) Ask the lane engineer to run the digest job. 2) Read Mailpit.", needs: ["mail", "job", "owner"] }])).toEqual([]);
    expect(tagProblems([{ id: "SUB-01", title: "Lighting Fixtures", steps: "1) Save Draft." }])).toEqual([]);
  });

  it("fails a case that mentions Mailpit without the mail need", () => {
    expect(tagProblems([{ ...good, needs: [] }])).toEqual(["NOT-03 mentions Mailpit: add mail to its needs"]);
    expect(tagProblems([{ ...good, needs: undefined }])).toHaveLength(1);
    expect(tagProblems([{ id: "ADM-01", steps: "1) Read the code from MAILPIT.", needs: ["owner"] }])).toEqual(["ADM-01 mentions Mailpit: add mail to its needs"]);
  });

  it("fails a case that mentions a job without the job need", () => {
    expect(tagProblems([{ id: "NOT-07", expected: "Needs the job run first.", needs: ["owner"] }])).toEqual(["NOT-07 mentions a job: add job to its needs"]);
    expect(tagProblems([{ id: "NOT-06", steps: "1) Run pnpm uat:run-job digest.", needs: ["owner"] }])).toEqual(["NOT-06 mentions a job: add job to its needs"]);
  });

  it("does not take the digest or weekly report settings of a Member for a job", () => {
    expect(tagProblems([{ id: "NOT-04", steps: "1) Set Step reached to Daily digest. 2) Open Weekly Step Age report.", needs: [] }])).toEqual([]);
  });

  it("fails a case that mentions lane 7, pnpm, a port or the lane engineer without the owner need", () => {
    expect(tagProblems([{ id: "PAR-01", steps: "1) Open lane 7 /en/sign-in.", needs: [] }])).toEqual(["PAR-01 mentions the lane's own machine: add owner to its needs"]);
    expect(tagProblems([{ id: "WF-15", steps: "1) Ask the lane engineer to age two items.", needs: ["setup"] }])).toHaveLength(1);
    expect(tagProblems([{ id: "ADM-09", steps: "1) Open an Admin URL on the web port.", needs: [] }])).toHaveLength(1);
    expect(tagProblems([{ id: "SUB-12", expected: "The report is sent.", steps: "1) Support the claim." }])).toEqual([]);
  });

  it("fails a need the sheet does not know", () => {
    expect(tagProblems([{ id: "X-1", needs: ["mail", "mails"] }])).toEqual(["X-1 declares an unknown need: mails"]);
  });

  it("fails a case that needs the AGE or FX fixtures or aged items without the setup need", () => {
    expect(tagProblems([{ id: "VIS-17", steps: "1) Ali Submits. 2) Needs AGE: age the item 5 weeks inside TMC.", needs: ["owner"] }])).toEqual(["VIS-17 needs a fixture or aged items: add setup to its needs"]);
    expect(tagProblems([{ id: "SNG-02", steps: "1) Needs FX-C2 (PAR-14).", needs: [] }])).toHaveLength(1);
    expect(tagProblems([{ id: "VIS-61", steps: "1) Filter the List while TMC has a long-lived Draft and aged items.", needs: ["owner"] }])).toHaveLength(1);
    expect(tagProblems([{ id: "WF-17", steps: "1) In the MAR Workflow (fixture FX-SB copy) add Assign to.", needs: [] }])).toHaveLength(1);
    expect(tagProblems([{ id: "VIS-17", steps: "1) Needs AGE.", needs: ["setup", "owner"] }])).toEqual([]);
  });

  it("lets a case that builds a fixture name it in its title, and does not take Step Age for the AGE fixture", () => {
    expect(tagProblems([{ id: "PAR-14", title: "Fixture FX-C2: narrow Beta Build to Tower 2", steps: "1) Set Beta Build to Tower 2 only.", needs: [] }])).toEqual([]);
    expect(tagProblems([{ id: "SUB-29", steps: "1) Only Step Age dots show age.", expected: "Lighting Fixtures stay.", needs: [] }])).toEqual([]);
  });

  it("passes every case of the real test-cases.json, and the sheet reads every one of them", () => {
    const text = readFileSync(resolve(import.meta.dirname, "../planning/uat/round-0/test-cases.json"), "utf8");
    const rows = JSON.parse(text) as ScenarioRow[];
    expect(tagProblems(rows)).toEqual([]);
    expect(casesFromScenarios(text, "https://uat.example")).toHaveLength(rows.length);
  });
});

describe("the sheet's colours", () => {
  // WCAG 2.x contrast of 12px text: at least 4.5:1.
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const css = readFileSync(resolve(import.meta.dirname, "uat-sheet/template.html"), "utf8");
  const rule = (selector: string) => new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  const accent = /--accent:\s*(#[0-9a-f]{6})/i.exec(css)![1]!;

  it("reads the owner badge at 4.5:1 or better", () => {
    const style = rule(".badge.owner");
    const color = /color:\s*(#[0-9a-f]{6})/i.exec(style)?.[1] ?? accent;
    const background = /background:\s*(#[0-9a-f]{6})/i.exec(style)![1]!;
    expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("reads the mail note and the other badges at 4.5:1 or better", () => {
    expect(contrast("#5d6678", /background:\s*(#[0-9a-f]{6})/i.exec(rule(".note"))![1]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#1d2433", /background:\s*(#[0-9a-f]{6})/i.exec(rule(".badge"))![1]!)).toBeGreaterThanOrEqual(4.5);
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
