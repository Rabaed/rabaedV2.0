import { describe, expect, it } from "vitest";
import { countAsserts, hiddenAssertProblems, parseBaseline, repoHiddenAssertProblems, renderBaseline } from "./check-hidden-asserts.ts";

const db = "packages/db/test/a-rls.test.ts";
const api = "apps/api/test/a.test.ts";

describe("countAsserts", () => {
  it("counts the asserts an empty read passes: [], length 0, not.toContain, undefined, expectHidden", () => {
    const text = [
      "expect(await seen(c2, id)).toEqual([]);",
      "expect(rows).toHaveLength(0);",
      "expect(ids).not.toContain(id);",
      "expect(await stepAsSeen(c2, id)).toBeUndefined();",
      "await expectHidden(c2.get(`/v1/work-items/${id}`));",
    ].join("\n");
    expect(countAsserts(text)).toEqual({ empty: 5, text: 0 });
  });

  it("counts compares by text or count: a legalName, a name.en, a length above 0", () => {
    const text = ["expect(row.legalName.en).toBe('C1');", "expect(c.companyName.en).toBe('K1');", "expect(items).toHaveLength(3);"].join("\n");
    expect(countAsserts(text)).toEqual({ empty: 0, text: 3 });
  });

  it("doesn't count expectHiddenFrom, which proves the row first", () => {
    expect(countAsserts("await expectHiddenFrom({ read, target: id, seenBy: k1, hiddenFrom: c2 });")).toEqual({ empty: 0, text: 0 });
  });

  it("doesn't count a line marked as no hidden-from assert", () => {
    expect(countAsserts("expect(problems).toEqual([]); // not hidden-from: a list of errors")).toEqual({ empty: 0, text: 0 });
  });
});

describe("hiddenAssertProblems", () => {
  const files = (entries: Record<string, string>) => Object.entries(entries).map(([file, text]) => ({ file, text }));

  it("passes a file at its baseline", () => {
    const baseline = parseBaseline(`${db} empty 1\n`);
    expect(hiddenAssertProblems(files({ [db]: "expect(x).toEqual([]);" }), baseline)).toEqual([]);
  });

  it("refuses a new assert over the baseline, and one in a file it doesn't list", () => {
    const baseline = parseBaseline(`${db} empty 1\n`);
    expect(hiddenAssertProblems(files({ [db]: "expect(x).toEqual([]);\nexpect(y).toEqual([]);", [api]: "expect(n).toHaveLength(2);" }), baseline)).toEqual([
      `${db}: 2 "hidden" asserts that an empty read passes, 1 allowed: prove the row first with expectHiddenFrom (@rabaed/db/test-support), or mark a line that is no hidden-from assert \`// not hidden-from: <why>\` (RP-1095)`,
      `${api}: 1 compare by text or count, 0 allowed: compare by id (RP-1095)`,
    ]);
  });

  it("refuses a baseline above the count, so it only shrinks", () => {
    const baseline = parseBaseline(`${db} empty 3\n${db} text 1\n`);
    expect(hiddenAssertProblems(files({ [db]: "expect(x).toEqual([]);" }), baseline)).toEqual([
      `docs/visibility/hidden-asserts.txt:1: ${db} empty is 1 now: lower it to 1`,
      `docs/visibility/hidden-asserts.txt:2: ${db} text is 0 now: delete this line`,
    ]);
  });

  it("refuses a baseline line for a file that's gone", () => {
    expect(hiddenAssertProblems([], parseBaseline(`${db} empty 1`))).toEqual([`docs/visibility/hidden-asserts.txt:1: ${db} empty is 0 now: delete this line`]);
  });

  it("counts only test files at the two seams", () => {
    expect(hiddenAssertProblems(files({ "apps/web/src/a.test.ts": "expect(x).toEqual([]);", "apps/api/test/support/harness.ts": "expectHidden(res)" }), [])).toEqual([]);
  });
});

describe("parseBaseline and renderBaseline", () => {
  it("reads `file kind count` lines, skipping blanks and comments, and writes them back sorted", () => {
    const baseline = parseBaseline(`# heading\n\n${db} text 2\n${api} empty 4\n`);
    expect(baseline).toEqual([
      { file: db, kind: "text", count: 2, line: 3 },
      { file: api, kind: "empty", count: 4, line: 4 },
    ]);
    expect(renderBaseline(files2({ [db]: "expect(a).toHaveLength(2);", [api]: "expect(a).toEqual([]);" }))).toEqual([`${api} empty 1`, `${db} text 1`]);
  });

  it("refuses a line it can't read", () => {
    expect(() => parseBaseline(`${db} empties 2`)).toThrow("docs/visibility/hidden-asserts.txt:1: not `<file> empty|text <count>`");
  });
});

function files2(entries: Record<string, string>) {
  return Object.entries(entries).map(([file, text]) => ({ file, text }));
}

describe("the repository", () => {
  it("adds no hidden-from assert outside expectHiddenFrom, and no compare by text or count", () => {
    expect(repoHiddenAssertProblems(process.cwd())).toEqual([]);
  });
});
