import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caseFiles, casesOf,changedMessages, flattenMessages, keyUsed, literalPieces, missingFromBody, searchedTexts, textBroken, textUsed, touchedCases, verdict } from "./check-uat-touch.ts";

// A fixture case file in the shape of planning/uat/round-0/cases/*.ts.
const fixture = {
  file: "planning/uat/round-0/cases/FIX.ts",
  text: [
    "// A fixture case file: helpers first, then the cases.",
    "const helper = () => page.getByText(/^Send for review\\.$/);",
    'defineCase("FIX-01", async (t) => {',
    '  await page.getByRole("button", { name: "Save draft" }).click();',
    '  t.check("The heading reads \\"Submittals\\"", true);',
    "});",
    'defineCase("FIX-02", async (t) => {',
    '  await expect(page.getByText("3 documents attached")).toBeVisible();',
    '  const label = messages["projectTabs.snags"];',
    "});",
  ].join("\n"),
};

describe("changedMessages", () => {
  const before = JSON.stringify({ a: { save: "Save draft", gone: "Removed text" }, same: "Same" });
  const after = JSON.stringify({ a: { save: "Save as draft", added: "New text" }, same: "Same" });

  it("lists added, changed and removed messages by dotted key, with both texts", () => {
    expect(changedMessages("en", before, after)).toEqual([
      { key: "a.added", locale: "en", before: undefined, after: "New text" },
      { key: "a.gone", locale: "en", before: "Removed text", after: undefined },
      { key: "a.save", locale: "en", before: "Save draft", after: "Save as draft" },
    ]);
  });

  it("treats a missing file as empty and flattens only strings", () => {
    expect(changedMessages("ar", undefined, '{"x":"نص"}')).toEqual([{ key: "x", locale: "ar", before: undefined, after: "نص" }]);
    expect([...flattenMessages({ a: ["one", { b: "two" }], n: 3 })]).toEqual([
      ["a.0", "one"],
      ["a.1.b", "two"],
    ]);
  });
});

describe("matching", () => {
  it("matches a whole text, ignoring case, spaces and regex or string escapes", () => {
    expect(textUsed("Send for review.", "getByText(/^Send for review\\.$/)")).toBe(true);
    expect(textUsed('The heading reads "Submittals"', 't.check("The heading reads \\"Submittals\\"")')).toBe(true);
    expect(textUsed("Save   Draft", 'name: "save draft"')).toBe(true);
    expect(textUsed("Save draft", 'name: "Save as draft"')).toBe(false);
  });

  it("matches Arabic text", () => {
    expect(textUsed("إرسال للمراجعة", 'getByText("إرسال للمراجعة")')).toBe(true);
  });

  it("does not match a text under 4 characters", () => {
    expect(textUsed("Save", "Save")).toBe(true);
    expect(textUsed("OK", 'getByText("OK")')).toBe(false);
  });

  it("needs every literal piece of a text with placeholders", () => {
    expect(literalPieces("{count} documents attached")).toEqual(["documents attached"]);
    expect(literalPieces("{count, plural, one {# item} other {# items}} left in {project}")).toEqual(["item", "items", "left in"]);
    expect(textUsed("{count} documents attached", 'getByText("3 documents attached")')).toBe(true);
    expect(textUsed("Hello {name}, you have {count} tasks", 'getByText("Hello Ali, you have 2 tasks")')).toBe(true);
    expect(textUsed("Hello {name}, you have {count} tasks", 'getByText("Hello Ali")')).toBe(false);
    expect(textUsed("{name}", "anything")).toBe(false);
  });

  it("matches a key only as a whole quoted dotted word", () => {
    expect(keyUsed("projectTabs.snags", 'messages["projectTabs.snags"]')).toBe(true);
    expect(keyUsed("projectTabs.snag", 'messages["projectTabs.snags"]')).toBe(false);
    expect(keyUsed("projectTabs.snags", "projectTabsXsnags")).toBe(false);
  });
});

describe("casesOf", () => {
  it("splits at defineCase and names text before the first case after the file", () => {
    expect(casesOf(fixture).map((c) => c.id)).toEqual(["FIX-helpers", "FIX-01", "FIX-02"]);
  });
});

describe("harness files (RP-1184, Main 7)", () => {
  const harness = { file: "planning/uat/round-0/harness/helpers.ts", text: 'export const search = (page) => page.getByRole("button", { name: /search|بحث/i });' };

  it("names a harness file as harness/<file>, not as a helper of a case file", () => {
    expect(casesOf(harness).map((c) => c.id)).toEqual(["harness/helpers"]);
  });

  it("reports a changed Arabic or English message a harness helper searches for", () => {
    const messages = changedMessages("ar", '{"s":"بحث عن مستند"}', '{"s":"استعلام"}');
    expect(touchedCases(messages, [harness])).toEqual([{ id: "harness/helpers", file: harness.file, messages: ["ar:s"] }]);
  });

  it("matches the name string of a role query, a button label that drifted", () => {
    const role = { file: "planning/uat/round-0/cases/R.ts", text: 'defineCase("R-01", async () => { await page.getByRole("button", { name: "Issue code" }).click(); });' };
    const messages = changedMessages("en", '{"b":"Issue code"}', '{"b":"Revise"}');
    expect(touchedCases(messages, [role]).map((h) => h.id)).toEqual(["R-01"]);
  });
});

describe("touchedCases", () => {
  it("names the cases that use a changed message, once each, with the messages", () => {
    const messages = changedMessages("en", '{"a":{"save":"Save draft","docs":"{count} documents attached","other":"Unused text here"}}', '{"a":{"save":"Save as draft","docs":"{count} documents attached!","other":"Unused text there"}}');
    expect(touchedCases(messages, [fixture])).toEqual([
      { id: "FIX-01", file: fixture.file, messages: ["en:a.save"] },
      { id: "FIX-02", file: fixture.file, messages: ["en:a.docs"] },
    ]);
  });

  it("finds a case that uses the key, and a helper that uses the text", () => {
    const messages = [
      ...changedMessages("en", '{"projectTabs":{"snags":"Snags"}}', '{"projectTabs":{"snags":"Snag list"}}'),
      ...changedMessages("en", '{"x":"Send for review."}', '{"x":"Send to review."}'),
    ];
    expect(touchedCases(messages, [fixture]).map((h) => h.id)).toEqual(["FIX-02", "FIX-helpers"]);
  });

  it("finds nothing when no case uses a changed message", () => {
    expect(touchedCases(changedMessages("en", '{"z":"Nobody uses this"}', '{"z":"Nobody uses that"}'), [fixture])).toEqual([]);
  });
});

describe("the person-run sheet, test-cases.json (RP-1234)", () => {
  const sheet = {
    file: "planning/uat/round-0/test-cases.json",
    text: JSON.stringify([
      { id: "SUB-01", jira: "RP-685", partName: "Submittals", title: "A new MAR is saved as a Draft", steps: '1) Open New Submittal. 2) Press "Save draft".', expected: 'The Draft is listed with "No number yet" and no Step Age dots.' },
      { id: "SUB-02", title: "Heading", steps: "Open the list.", expected: "The projectTabs.snags tab shows the open Snags." },
      { id: "SUB-03", title: "Unrelated", steps: "Nothing about messages.", expected: "Nothing changes." },
    ]),
  };

  it("makes each Test Case a unit named by its id", () => {
    expect(casesOf(sheet).map((c) => c.id)).toEqual(["SUB-01", "SUB-02", "SUB-03"]);
    expect(casesOf(sheet).every((c) => c.file === sheet.file)).toBe(true);
  });

  it("reads the words a tester looks for: title, steps and expected, not the ticket key or the part name", () => {
    const [first] = casesOf(sheet);
    expect(first!.source).toContain("Save draft");
    expect(first!.source).toContain("No number yet");
    expect(first!.source).not.toContain("RP-685");
    expect(first!.source).not.toContain("Submittals");
  });

  it("reports a case whose quoted button label or text changes, and one that names a key", () => {
    const messages = [
      ...changedMessages("en", '{"b":"Save draft"}', '{"b":"Save as draft"}'),
      ...changedMessages("en", '{"n":"No number yet"}', '{"n":"Not numbered"}'),
      ...changedMessages("en", '{"projectTabs":{"snags":"Snags"}}', '{"projectTabs":{"snags":"Snag list"}}'),
    ];
    expect(touchedCases(messages, [sheet])).toEqual([
      { id: "SUB-01", file: sheet.file, messages: ["en:b", "en:n"] },
      { id: "SUB-02", file: sheet.file, messages: ["en:projectTabs.snags"] },
    ]);
  });

  it("finds nothing when no Test Case uses a changed message", () => {
    expect(touchedCases(changedMessages("en", '{"z":"Nobody uses this"}', '{"z":"Nobody uses that"}'), [sheet])).toEqual([]);
  });

  it("is quiet about a sheet that is not a list of cases, and says which file is broken JSON", () => {
    expect(casesOf({ file: "planning/uat/round-0/test-cases.json", text: '{"cases":[]}' })).toEqual([]);
    expect(() => casesOf({ file: "planning/uat/round-0/test-cases.json", text: "{oops" })).toThrow(/planning\/uat\/round-0\/test-cases\.json/);
  });

  it("names a case once when the sheet and a defineCase block share its id, with both files", () => {
    const messages = changedMessages("en", '{"b":"Save draft"}', '{"b":"Save as draft"}');
    expect(touchedCases(messages, [fixture, sheet])).toEqual([
      { id: "FIX-01", file: fixture.file, messages: ["en:b"] },
      { id: "SUB-01", file: sheet.file, messages: ["en:b"] },
    ]);
    const shared = { file: "planning/uat/round-0/cases/SUB.ts", text: 'defineCase("SUB-01", async () => { await page.getByRole("button", { name: "Save draft" }).click(); });' };
    expect(touchedCases(messages, [shared, sheet])).toEqual([{ id: "SUB-01", file: `${shared.file}, ${sheet.file}`, messages: ["en:b"] }]);
  });

  it("reads the sheet from the working tree beside the cases", () => {
    const repo = mkdtempSync(join(tmpdir(), "uat-touch-"));
    try {
      mkdirSync(join(repo, "planning", "uat", "round-0"), { recursive: true });
      writeFileSync(join(repo, "planning", "uat", "round-0", "test-cases.json"), sheet.text);
      expect(caseFiles(repo)).toEqual([{ file: sheet.file, text: sheet.text }]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("the PR body line", () => {
  const ids = ["FIX-01", "FIX-02"];

  it("is missing when the body has no line, and lists what a line leaves out", () => {
    expect(missingFromBody("Nothing here", ids)).toBeUndefined();
    expect(missingFromBody("UAT cases touched: FIX-01 (updated)", ids)).toEqual(["FIX-02"]);
    expect(missingFromBody("text\n> UAT cases touched: FIX-01, fix-02\nmore", ids)).toEqual([]);
  });

  it("reads ids wrapped onto the next line, up to a blank line", () => {
    expect(missingFromBody("UAT cases touched: FIX-01,\nFIX-02 (updated)\n\nOther FIX-03", [...ids, "FIX-03"])).toEqual(["FIX-03"]);
  });

  it("does not take FIX-010 for FIX-01", () => {
    expect(missingFromBody("UAT cases touched: FIX-010", ["FIX-01"])).toEqual(["FIX-01"]);
  });

  it("passes with no hits, whatever the body says", () => {
    expect(verdict([], "")).toEqual({ ok: true, comment: "" });
  });

  it("fails a body without the line and comments the ids, with the marker", () => {
    const hits = [{ id: "FIX-01", file: fixture.file, messages: ["en:a.save"] }];
    const bad = verdict(hits, "no line");
    expect(bad.ok).toBe(false);
    expect(bad.comment).toContain("<!-- uat-touch -->");
    expect(bad.comment).toContain("`FIX-01`");
    expect(bad.comment).toContain("UAT cases touched: FIX-01");
    expect(verdict(hits, "UAT cases touched: FIX-01, still passes").ok).toBe(true);
  });

  it("only reports when there is no body to check", () => {
    const hits = [{ id: "FIX-01", file: fixture.file, messages: ["en:a.save"] }];
    expect(verdict(hits, undefined).ok).toBe(true);
    expect(verdict(hits, undefined).comment).toContain("`FIX-01`");
  });
});

describe("a case that looks for a piece of the old text", () => {
  const before = "We can't find this page. It may not exist.";
  const source = 'await expect(page.getByText(/can\'t find this page/i)).toBeVisible();\nawait page.getByText("It may not exist").click();';

  it("finds what a case searches, from strings and regex literals", () => {
    const found = searchedTexts(`${source}\nconst r = a || /We can.t find this page/i.test(x);`);
    expect(found.strings).toEqual(["it may not exist"]);
    expect(found.regexes.map(String)).toEqual(["/can't find this page/i", "/We can.t find this page/i"]);
  });

  it("is broken when a searched piece is in the old text and not the new", () => {
    expect(textBroken(before, "We cannot find this page. It may not exist.", source)).toBe(true);
    expect(textBroken(before, "Sorry. It may not exist.", source)).toBe(true);
    expect(textBroken(before, "Oops: We can't find this page. It may not exist.", source)).toBe(false);
    expect(textBroken(undefined, "We can't find this page.", source)).toBe(false);
    // A pattern that still matches the new text is not broken: the apostrophe is a wildcard.
    expect(textBroken(before, "We can’t find this page. It may not exist.", "x = /We can.t find this page/i;")).toBe(false);
    expect(textBroken(before, "We cannot find this page.", "x = /We can.t find this page/i;")).toBe(true);
  });

  it("does not build a pattern that backtracks without end", () => {
    expect(searchedTexts("x = /(a+)+ and more text/;").regexes).toEqual([]);
  });

  it("names the case in touchedCases", () => {
    const file = { file: "planning/uat/round-0/cases/NF.ts", text: `defineCase("NF-01", async () => {\n${source}\n});` };
    const messages = changedMessages("en", JSON.stringify({ m: before }), JSON.stringify({ m: "We cannot find this page. It may not exist." }));
    expect(touchedCases(messages, [file])).toEqual([{ id: "NF-01", file: file.file, messages: ["en:m"] }]);
  });
});
