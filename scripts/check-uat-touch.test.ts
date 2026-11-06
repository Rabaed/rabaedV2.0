import { describe, expect, it } from "vitest";
import { casesOf, changedMessages, flattenMessages, keyUsed, literalPieces, missingFromBody, textUsed, touchedCases, verdict } from "./check-uat-touch.ts";

// A fixture case file in the shape of planning/uat/round-0/cases/*.ts.
const fixture = {
  file: "planning/uat/round-0/cases/FIX.ts",
  text: [
    'import { defineCase } from "../harness/case.ts";',
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

describe("the PR body line", () => {
  const ids = ["FIX-01", "FIX-02"];

  it("is missing when the body has no line, and lists what a line leaves out", () => {
    expect(missingFromBody("Nothing here", ids)).toBeUndefined();
    expect(missingFromBody("UAT cases touched: FIX-01 (updated)", ids)).toEqual(["FIX-02"]);
    expect(missingFromBody("text\n> UAT cases touched: FIX-01, fix-02\nmore", ids)).toEqual([]);
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
