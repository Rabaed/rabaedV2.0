import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { demoPeople } from "./demo-session.ts";
import { caseFromIssue, casesFromScenarios, DEMO_PEOPLE, numberedSteps, orderCases, PEOPLE_MAP, renderMarkdown, renderSheet, sectionsOf, roundFromWaits, searchIssues, sectionProblems, startUrl, tagProblems, vercelWording, type JiraIssue, type ScenarioRow, type SheetCase } from "./uat-sheet.ts";
import { buildXlsx } from "./uat-sheet/xlsx.mjs";
import { readEntry, recordEntry, testerCell, workFile } from "./uat-sheet/work.mjs";
import { UAT_ROLES } from "../apps/api/src/demo/uat-projects-plan.ts";

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
  partName: "Submittals",
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
    const html = renderSheet({ round: "R", cases: [...cases, { ...cases[0]!, key: "RP-726", id: "ADM-01", needs: ["owner"] }], built: "x", uatUrl: "https://uat.example" });
    expect(html).toContain('"uatUrl":"https://uat.example"');
    for (const text of ["How to start", "كيف تبدأ", "private window", "نافذة خاصة", "Cases the UAT owner runs", "يشغّلها مسؤول الاختبار", "section by section", "قسمًا قسمًا"]) expect(html).toContain(text);
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
    // The page's scripts share one global scope: a name two of them declare would stop the page.
    expect(() => new vm.Script(scripts.join("\n;\n"))).not.toThrow();
  });
});

describe("the Who's who panel (RP-1204)", () => {
  it("lists every demo person the sign-in script knows, and the Authorized Persons and Rabaed Engineer besides", () => {
    const emails = DEMO_PEOPLE.map((p) => p.email);
    for (const email of Object.values(demoPeople)) expect(emails).toContain(email);
    for (const email of ["layla.mansour@designconsultants.demo.rabaed.test", "hind.almutairi@alwaha.demo.rabaed.test", "engineer@rabaed.demo.rabaed.test"]) expect(emails).toContain(email);
    expect(new Set(DEMO_PEOPLE.map((p) => p.key)).size).toBe(DEMO_PEOPLE.length);
  });

  it("lists Tariq, Gulf Review Consultants' person, as outside Riyadh Gate Tower: he is on UAT 03 only, for PAR-17 (RP-1264)", () => {
    expect(DEMO_PEOPLE.find((p) => p.key === "tariq")?.email).toBe("tariq.alshehri@gulfreview.demo.rabaed.test");
    expect(PEOPLE_MAP.outside).toContain("tariq");
  });

  it("holds sign-in emails only, never a password", () => {
    for (const p of DEMO_PEOPLE) expect(Object.keys(p).some((k) => /pass|secret|token/i.test(k))).toBe(false);
    const html = renderSheet({ round: "R", cases: [], built: "x" });
    expect(html).not.toMatch(/DEMO_PASSWORD|\.env\.demo/);
  });

  it("puts every demo person on the map exactly once (RP-1206), and Omar and Sara as narrowed", () => {
    const placed = [...PEOPLE_MAP.companies.flatMap((c) => c.people), ...PEOPLE_MAP.outside];
    expect([...placed].sort()).toEqual(DEMO_PEOPLE.map((p) => p.key).sort());
    expect(DEMO_PEOPLE.filter((p) => p.narrowed).map((p) => p.key).sort()).toEqual(["omar", "sara"]);
    for (const [from, to] of PEOPLE_MAP.flow) for (const k of [from, to]) expect(PEOPLE_MAP.companies.map((c) => c.key)).toContain(k);
    expect(DEMO_PEOPLE.every((p) => p.covers.en && p.covers.ar)).toBe(true);
  });

  it("draws the map in the page, and says what each person covers in the Markdown", () => {
    const html = renderSheet({ round: "R", cases: [], built: "x" });
    expect(html).toContain('id="peopleMap"');
    expect(html).toContain('"peopleMap":{"project"');
    expect(renderMarkdown({ round: "R", cases: [], built: "x" })).toContain("| Sara | `sara@designconsultants.demo.rabaed.test` | Design Consultants LLC | Consultant, Mechanical only | Engineer | ME only · all towers |");
  });

  it("is in the page in English and Arabic", () => {
    const html = renderSheet({ round: "R", cases: [], built: "x" });
    expect(html).toContain('"email":"hafiz.hamdan@tmc.demo.rabaed.test"');
    for (const text of ["Who's who", "من هو من", "The owner gives you each sign-in"]) expect(html).toContain(text);
  });
});

describe("sections and the Markdown for an AI (RP-1204)", () => {
  const make = (id: string, part: string, needs: SheetCase["needs"] = []): SheetCase => ({ ...caseFromIssue(issue(markdown), "https://uat.example"), id, key: `RP-${id}`, part, partName: part, needs });
  const cases = [make("SUB-1", "SUB"), make("WF-1", "WF"), make("SUB-2", "SUB"), make("ADM-1", "ADM", ["owner"]), make("VIS-1", "VIS", ["mail"])];

  it("groups the tester's cases by Part, numbered in the order the Parts first come, and puts the owner's cases last", () => {
    const s = sectionsOf(cases);
    expect(s.map((x) => [x.n, x.part, x.cases.map((c) => c.id)])).toEqual([
      [1, "SUB", ["SUB-1", "SUB-2"]],
      [2, "WF", ["WF-1"]],
      [3, "VIS", ["VIS-1"]],
      [0, "OWNER", ["ADM-1"]],
    ]);
    expect(s[0]!.name).toEqual({ en: "Submittals", ar: "التقديمات" });
  });

  it("puts each role's section first (RP-1248): who to sign in as and the UAT Project to open, then the Parts, then the owner's", () => {
    const hafiz = (id: string, part: string) => ({ ...make(id, part), role: "01" });
    const s = sectionsOf([...cases, hafiz("SUB-9", "SUB"), hafiz("VIS-9", "VIS")]);
    expect(s.map((x) => [x.n, x.part, x.cases.map((c) => c.id)])).toEqual([
      [1, "UAT01", ["SUB-9", "VIS-9"]],
      [2, "SUB", ["SUB-1", "SUB-2"]],
      [3, "WF", ["WF-1"]],
      [4, "VIS", ["VIS-1"]],
      [0, "OWNER", ["ADM-1"]],
    ]);
    expect(s[0]!.name).toEqual({ en: "Sign in as Hafiz · open UAT 01 · Contractor Engineer (Hafiz)", ar: "سجّل الدخول باسم حافظ · افتح UAT 01 · مهندس المقاول (حافظ)" });
    expect(s[0]!.project).toEqual(UAT_ROLES[0]!.name);
  });

  it("refuses a case whose role has no UAT Project, and a role case only the UAT owner can run", () => {
    expect(() => sectionsOf([{ ...make("SUB-9", "SUB"), role: "99" }])).toThrow(/SUB-9.*99/);
    expect(() => sectionsOf([{ ...make("SUB-9", "SUB", ["owner"]), role: "01" }])).toThrow(/SUB-9.*owner/);
  });

  it("reads a scenario's role, and hands the sections to the page so it draws the same ones", () => {
    const row = { id: "SUB-01", jira: "RP-685", part: "SUB", title: "t", role: "01" };
    const [c] = casesFromScenarios(JSON.stringify([row, { ...row, id: "SUB-02", jira: "RP-686", role: undefined }]), "https://uat.example");
    expect(c!.role).toBe("01");
    const html = renderSheet({ round: "R", cases: casesFromScenarios(JSON.stringify([row]), "https://uat.example"), built: "x" });
    expect(html).toContain('"sections":[{"id":"s-UAT01","n":1,"part":"UAT01"');
    expect(html).not.toMatch(/const SECTIONS = \(\(\) =>/);
  });

  it("marks a case that can't be run twice, once per Reset UAT, in the page and the Markdown (RP-1264)", () => {
    const row = { id: "PAR-17", jira: "RP-1265", part: "PAR", title: "Withdraw", role: "03", once: true };
    const [c, other] = casesFromScenarios(JSON.stringify([row, { ...row, id: "PAR-10", jira: "RP-870", once: undefined }]), "https://uat.example");
    expect(c!.once).toBe(true);
    expect(other!.once).toBeUndefined();
    const md = renderMarkdown({ round: "R", cases: [c!, other!], built: "x" });
    expect(md.match(/- \*\*Once per Reset UAT:\*\*/g)).toHaveLength(1);
    expect(md).toContain("- **Once per Reset UAT:** what it does can't be undone, so it runs once after each Reset UAT.");
    const html = renderSheet({ round: "R", cases: [c!], built: "x" });
    expect(html).toContain('"once":true');
    expect(html).toContain("Once per Reset UAT");
    expect(html).toContain("مرة واحدة بعد كل إعادة تهيئة");
    // The test cases mark each one-shot case: those whose seeded item or Participant a run uses up.
    const scenarios = JSON.parse(readFileSync(resolve(import.meta.dirname, "../planning/uat/round-0/test-cases.json"), "utf8")) as ScenarioRow[];
    expect(scenarios.filter((s) => s.once).map((s) => s.id).sort()).toEqual(["PAR-08", "PAR-17", "SUB-21", "VIS-24"]);
  });

  it("tells the tester to open a UAT Project from Projects, never Home, in English and Arabic and in the Markdown", () => {
    const html = renderSheet({ round: "R", cases, built: "x" });
    expect(html).toContain("open it from Projects, not from Home");
    expect(html).toContain("افتحه من المشاريع لا من الرئيسية");
    const md = renderMarkdown({ round: "R", cases: [{ ...make("SUB-9", "SUB"), role: "01" }], built: "x" });
    expect(md).toContain("## 1. Sign in as Hafiz · open UAT 01 · Contractor Engineer (Hafiz) (1 cases)");
    expect(md).toContain("open it from Projects, not from Home");
  });

  it("writes every case under its numbered section, with the people and no password", () => {
    const md = renderMarkdown({ round: "Round X", cases, built: "2026-11-01", uatUrl: "https://uat.example/" });
    expect(md).toContain("# Rabaed UAT test sheet: Round X");
    expect(md).toContain("https://uat.example/en");
    for (const h of ["## 1. Submittals (2 cases)", "## 2. Workflows (1 cases)", "## Cases the UAT owner runs (1 cases)", "### SUB-1 ", "`RP-ADM-1`", "hafiz.hamdan@tmc.demo.rabaed.test"]) expect(md).toContain(h);
    expect(md).not.toMatch(/password\s*[:=]|DEMO_PASSWORD/i);
  });

  it("ends with the JSON to hand back, which is the sheet's own work file", () => {
    const md = renderMarkdown({ round: "Round X", cases, built: "x" });
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md)![1]!);
    expect(json.sheet).toBe("rabaed-uat-sheet");
    expect(json.round).toBe("Round X");
    expect(Object.values(json.entries).every((e) => ["pass", "fail", "blocked", "notrun"].includes((e as { status: string }).status))).toBe(true);
  });

  it("puts the Markdown in the page, so the sheet can hand it over too", () => {
    const html = renderSheet({ round: "R", cases, built: "x" });
    expect(html).toContain("Download for an AI (.md)");
    expect(html).toContain("# Rabaed UAT test sheet: R");
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

describe("every case in exactly one section (RP-1250)", () => {
  const row = (id: string, extra: Partial<ScenarioRow> = {}): ScenarioRow => ({ id, jira: `RP-${id}`, part: id.split("-")[0]!, title: "t", ...extra });

  it("passes a role case, an owner's case and a leftover with its reason", () => {
    expect(sectionProblems([row("SUB-1", { role: "01" }), row("ADM-1", { needs: ["owner"] }), row("VIS-1", { leftover: "Needs Hafiz and Ali together." })])).toEqual([]);
  });

  it("fails a case with no section, so a new case can't be added without one", () => {
    expect(sectionProblems([row("SUB-1")])).toEqual(["SUB-1 is in no role's section: give it a role, the owner need, or a leftover reason"]);
  });

  it("fails a case in two sections, and a role with no UAT Project", () => {
    expect(sectionProblems([row("SUB-1", { role: "01", leftover: "x" }), row("ADM-1", { needs: ["owner"], leftover: "x" }), row("SUB-2", { role: "11" })])).toEqual([
      "SUB-1 has a role and a leftover reason: one section only",
      "ADM-1 is the owner's and has a leftover reason: one section only",
      "SUB-2 names UAT role 11, which has no UAT Project",
    ]);
  });

  it("fails an empty leftover reason and a case ID used twice", () => {
    expect(sectionProblems([row("SUB-1", { leftover: " " }), row("SUB-2", { role: "01" }), row("SUB-2", { role: "02" })])).toEqual([
      "SUB-1 is in no role's section: give it a role, the owner need, or a leftover reason",
      "SUB-2 is in the sheet twice",
    ]);
  });

  it("holds for the real test-cases.json: each case in the ten role sections, the owner's, or the listed leftovers, and in exactly one section of the sheet", () => {
    const text = readFileSync(resolve(import.meta.dirname, "../planning/uat/round-0/test-cases.json"), "utf8");
    expect(sectionProblems(JSON.parse(text) as ScenarioRow[])).toEqual([]);
    const cases = casesFromScenarios(text, "https://uat.example");
    const placed = sectionsOf(cases).flatMap((s) => s.cases.map((c) => c.key));
    expect(placed.sort()).toEqual(cases.map((c) => c.key).sort());
  });

  it("names a leftover's reason in the Markdown, so the owner sees why it has no role", () => {
    const [c] = casesFromScenarios(JSON.stringify([row("VIS-1", { leftover: "Needs Hafiz and Ali together." })]), "https://uat.example");
    expect(c!.leftover).toBe("Needs Hafiz and Ali together.");
    expect(renderMarkdown({ round: "R", cases: [c!], built: "x" })).toContain("- **Left for the owner:** Needs Hafiz and Ali together.");
  });
});

describe("the app's wording in a case (RP-1232)", () => {
  const root = resolve(import.meta.dirname, "..");
  const label = (lang: "en" | "ar") => {
    const messages = JSON.parse(readFileSync(join(root, `apps/web/messages/${lang}.json`), "utf8"));
    return messages.snagList.mobile.flow.camera.takePhoto as string;
  };

  it("SNG-13 names the New Snag camera button as the app words it, in English and Arabic", () => {
    const rows = JSON.parse(readFileSync(join(root, "planning/uat/round-0/test-cases.json"), "utf8")) as ScenarioRow[];
    const snag = rows.find((r) => r.id === "SNG-13")!;
    expect(snag.expected).toContain(`${label("en")} / ${label("ar")}`);
  });
});

describe("the Activity Feed is not a tab (RP-1259)", () => {
  const rows = JSON.parse(readFileSync(resolve(import.meta.dirname, "../planning/uat/round-0/test-cases.json"), "utf8")) as ScenarioRow[];

  it("no step sends the tester to an Activity or Activity Feed tab: since RP-1142 the feed is the Dashboard's panel and its View all page", () => {
    const tabSteps = rows.filter((r) => /(?:>|,)\s*Activity\b(?! Feed panel)/.test(r.steps ?? "")).map((r) => r.id);
    expect(tabSteps).toEqual([]);
  });

  it("SUB-28, UX-08, VIS-01 and VIS-57 reach the feed from Dashboard › Activity Feed panel › View all", () => {
    for (const id of ["SUB-28", "UX-08", "VIS-01", "VIS-57"]) {
      const steps = rows.find((r) => r.id === id)!.steps!;
      expect(steps, id).toMatch(/Dashboard(?: ›|'s) Activity Feed panel (?:›|and its) View all/);
    }
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

  // The needs tags (owner, set-up, job, mail; RP-1199) are `.tag.need` since RP-1204's redesign; the plain tags `.tag`.
  const pair = (selector: string) => {
    const style = rule(selector);
    return [/[^-]color:\s*(#[0-9a-f]{6})/i.exec(style)?.[1] ?? accent, /background:\s*(#[0-9a-f]{6})/i.exec(style)![1]!] as const;
  };

  it("reads the needs tags (the owner's among them) at 4.5:1 or better", () => {
    expect(contrast(...pair(".tag.need"))).toBeGreaterThanOrEqual(4.5);
  });

  it("reads the mail note and the plain tags at 4.5:1 or better", () => {
    expect(contrast(...pair(".note"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(...pair(".tag"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("who ran each case (RP-1248): the tester's name on every result", () => {
  const e = (status: string, extra: Record<string, unknown> = {}) => ({ status, comment: "", shots: [], at: "07/11/2026, 10:00:00", ...extra });

  it("records the name typed at the top on each case as it is saved, and keeps an earlier name when none is typed", () => {
    expect(recordEntry(e("pass"), " Ahmad ")).toMatchObject({ status: "pass", tester: "Ahmad" });
    expect(recordEntry(e("fail", { tester: "Ahmad" }), "")).toMatchObject({ tester: "Ahmad" });
    expect(recordEntry(e("fail", { tester: "Ahmad" }), "Sami")).toMatchObject({ tester: "Sami" });
  });

  it("writes the name on every entry of the saved JSON, the sheet's name where an entry has none", () => {
    const out = workFile({ round: "R", tester: "Ahmad", at: "2026-11-07T10:00:00Z", entries: [["RP-1", e("pass", { tester: "Sami" })], ["RP-2", e("fail")], ["RP-3", e("")]], shots: [] });
    expect(out).toMatchObject({ sheet: "rabaed-uat-sheet", round: "R", tester: "Ahmad" });
    expect(out.entries["RP-1"].tester).toBe("Sami");
    expect(out.entries["RP-2"].tester).toBe("Ahmad");
    expect(out.entries["RP-3"]).toBeUndefined();
  });

  it("keeps each entry's name when a saved JSON is loaded, else the file's name", () => {
    const shotOk = (id: string) => id === "RP-1:1";
    expect(readEntry({ status: "pass", comment: "ok", shots: ["RP-1:1", "x"], tester: "Sami", at: "t" }, { fileTester: "Ahmad", shotOk, now: "n" })).toEqual({ status: "pass", comment: "ok", shots: ["RP-1:1"], tester: "Sami", at: "t" });
    expect(readEntry({ status: "fail" }, { fileTester: "Ahmad", shotOk, now: "n" })).toEqual({ status: "fail", comment: "", shots: [], tester: "Ahmad", at: "n" });
    expect(readEntry({ status: "maybe", tester: 7 }, { fileTester: undefined, shotOk, now: "n" })).toMatchObject({ status: "", tester: "7" });
  });

  it("puts the name in the Excel row of every case with a result, and none in a row with nothing recorded", () => {
    expect(testerCell(e("pass", { tester: "Sami" }), "Ahmad")).toBe("Sami");
    expect(testerCell(e("pass"), "Ahmad")).toBe("Ahmad");
    expect(testerCell(e(""), "Ahmad")).toBe("");
  });

  it("is in the page, which uses it to save, load and export", () => {
    const html = renderSheet({ round: "R", cases: [], built: "x" });
    for (const name of ["function recordEntry", "function workFile", "function readEntry", "function testerCell"]) expect(html).toContain(name);
    expect(html).not.toContain("/*__WORK__*/");
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
