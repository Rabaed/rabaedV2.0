import { describe, expect, it } from "vitest";
import { findAsserts, hiddenAssertProblems, parseBaseline, renderBaselines, repoHiddenAssertProblems, baselineFileFor } from "./check-hidden-asserts.ts";

const db = "packages/db/test/a-rls.test.ts";
const api = "apps/api/test/a.test.ts";
const dbBaseline = "docs/visibility/hidden-asserts/packages/db/test/a-rls.test.ts.txt";
const files = (entries: Record<string, string>) => Object.entries(entries).map(([file, text]) => ({ file, text }));
const baseline = (file: string, ...entries: string[]) => ({ file: baselineFileFor(file), text: `${entries.join("\n")}\n` });
/** A test file: `asserts` inside it("hidden", ...) inside describe("C2"). */
const testFile = (...asserts: string[]) => `describe("C2", () => {\n  it("hidden", async () => {\n${asserts.map((a) => `    ${a}`).join("\n")}\n  });\n});\n`;
const empty = "expect(x).toEqual([]);";
const emptyKey = "empty C2 > hidden :: expect(x).toEqual([]);";

describe("findAsserts", () => {
  it("finds the asserts an empty read passes: [], length 0, not.toContain, undefined, expectHidden", () => {
    const text = testFile(
      "expect(await seen(c2, id)).toEqual([]);",
      "expect(rows).toHaveLength(0);",
      "expect(ids).not.toContain(id);",
      "expect(await stepAsSeen(c2, id)).toBeUndefined();",
      "await expectHidden(c2.get(`/v1/work-items/${id}`));",
    );
    expect(findAsserts(db, text).map((a) => a.kind)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
  });

  it("finds compares by text or count: a legalName, a name.en, a length above 0", () => {
    const text = testFile("expect(row.legalName.en).toBe('C1');", "expect(c.companyName.en).toBe('K1');", "expect(items).toHaveLength(3);");
    expect(findAsserts(db, text).map((a) => a.kind)).toEqual(["text", "text", "text"]);
  });

  it("keys an assert by its test's titles and its line's text, and gives its line", () => {
    expect(findAsserts(db, testFile("expect(  x ).toEqual([]);  "))).toEqual([{ kind: "empty", titles: "C2 > hidden", key: "empty C2 > hidden :: expect( x ).toEqual([]);", line: 3 }]);
  });

  it("keys an assert outside any test as (top level), and keeps a template title's ${…}", () => {
    const text = `${empty}\nit(\`\${who} hidden\`, () => { ${empty} });`;
    expect(findAsserts(db, text).map((a) => a.key)).toEqual(["empty (top level) :: expect(x).toEqual([]);", "empty ${who} hidden :: it(`${who} hidden`, () => { expect(x).toEqual([]); });"]);
  });

  it("doesn't find expectHiddenFrom, which proves the row first, or a line marked as no hidden-from assert", () => {
    const text = testFile("await expectHiddenFrom({ read, target: id, seenBy: k1, hiddenFrom: c2 });", "expect(problems).toEqual([]); // not hidden-from: a list of errors");
    expect(findAsserts(db, text)).toEqual([]);
  });
});

describe("hiddenAssertProblems", () => {
  it("passes a file at its baseline", () => {
    expect(hiddenAssertProblems(files({ [db]: testFile(empty) }), [baseline(db, emptyKey)])).toEqual([]);
  });

  it("passes when the file around the assert changes: a line added above, another test added", () => {
    const text = `import { x } from "y";\n\n${testFile(empty)}\nit("another", () => {});\n`;
    expect(hiddenAssertProblems(files({ [db]: text }), [baseline(db, emptyKey)])).toEqual([]);
  });

  it("refuses a new assert in a file that also has a fix, so the two don't cancel out", () => {
    const text = testFile("expect(y).toEqual([]);");
    expect(hiddenAssertProblems(files({ [db]: text }), [baseline(db, emptyKey)])).toEqual([
      `${db}:3: a "hidden" assert that an empty read passes, in "C2 > hidden", not in ${dbBaseline}: prove the row first with expectHiddenFrom (@rabaed/db/test-support), or mark a line that is no hidden-from assert \`// not hidden-from: <why>\` (RP-1095)`,
      `${dbBaseline}:1: ${db} has no such assert now: delete this line (and the list, if it is its last)`,
    ]);
  });

  it("refuses a second copy of a listed assert in the same test", () => {
    expect(hiddenAssertProblems(files({ [db]: testFile(empty, empty) }), [baseline(db, emptyKey)])).toEqual([
      `${db}:4: a "hidden" assert that an empty read passes, in "C2 > hidden", not in ${dbBaseline}: prove the row first with expectHiddenFrom (@rabaed/db/test-support), or mark a line that is no hidden-from assert \`// not hidden-from: <why>\` (RP-1095)`,
    ]);
  });

  it("refuses an assert in a file with no baseline", () => {
    expect(hiddenAssertProblems(files({ [api]: "expect(n).toHaveLength(2);" }), [])).toEqual([
      `${api}:1: a compare by text or count, in "(top level)", not in docs/visibility/hidden-asserts/apps/api/test/a.test.ts.txt: compare by the row's uuid (RP-1095)`,
    ]);
  });

  it("refuses a baseline line with no assert left, so the list only shrinks", () => {
    expect(hiddenAssertProblems(files({ [db]: testFile(empty) }), [baseline(db, emptyKey, emptyKey)])).toEqual([
      `${dbBaseline}:2: ${db} has no such assert now: delete this line (and the list, if it is its last)`,
    ]);
  });

  it("refuses the baseline of a file that's gone, a baseline with no entry, and a file outside the layout", () => {
    const stray = { file: "docs/visibility/hidden-asserts/notes.md", text: "" };
    expect(hiddenAssertProblems([], [baseline(db, emptyKey), { file: baselineFileFor(api), text: "# nothing\n" }, stray])).toEqual([
      `${baselineFileFor(api)}: lists no assert: delete it`,
      "docs/visibility/hidden-asserts/notes.md: not a baseline: use <test path>.txt",
      `${dbBaseline}:1: ${db} has no such assert now: delete this line (and the list, if it is its last)`,
    ]);
  });

  it("counts only test files at the two seams", () => {
    expect(hiddenAssertProblems(files({ "apps/web/src/a.test.ts": empty, "apps/api/test/support/harness.ts": "expectHidden(res)" }), [])).toEqual([]);
  });
});

describe("parseBaseline and renderBaselines", () => {
  it("reads one `<kind> <titles> :: <line>` entry a line, skipping blanks and comments", () => {
    expect(parseBaseline(dbBaseline, `# heading\n\n${emptyKey}\n`)).toEqual([{ key: emptyKey, line: 3 }]);
  });

  it("refuses a line it can't read", () => {
    expect(() => parseBaseline(dbBaseline, "empties C2 :: x")).toThrow(`${dbBaseline}:1: not \`empty|text <titles> :: <line>\``);
  });

  it("writes one file per test file with asserts, entries in line order, and reads back as passing", () => {
    const sources = files({ [db]: testFile(empty, "expect(n).toHaveLength(2);"), [api]: 'it("x", () => {});' });
    const rendered = renderBaselines(sources);
    expect(rendered).toEqual([{ file: dbBaseline, text: `${emptyKey}\ntext C2 > hidden :: expect(n).toHaveLength(2);\n` }]);
    expect(hiddenAssertProblems(sources, rendered)).toEqual([]);
  });
});

describe("the repository", () => {
  it("adds no hidden-from assert outside expectHiddenFrom, and no compare by text or count", () => {
    expect(repoHiddenAssertProblems(process.cwd())).toEqual([]);
  });
});
