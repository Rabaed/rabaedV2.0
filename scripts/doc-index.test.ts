import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { docHeadings, indexedDocs, indexEntries, indexProblems } from "./doc-index.ts";

const doc = (index: string[], body: string[]) =>
  ["# Design", "", "Intro.", "", "## Contents", "", ...index, "", ...body].join("\n");

const body = ["## 1. Model", "", "Text.", "", "### Example: MAR", "", "#### Too deep", "", "```sql", "## not a heading", "```", "", "## 2. State", ""];

describe("docHeadings", () => {
  it("reads the ## and ### headings in order, outside code fences, leaving out the index's own", () => {
    expect(docHeadings(doc([], body))).toEqual([
      { level: 2, text: "1. Model" },
      { level: 3, text: "Example: MAR" },
      { level: 2, text: "2. State" },
    ]);
  });
});

describe("indexEntries", () => {
  it("reads each entry's heading, level (by indent) and hint", () => {
    const index = ["- **1. Model**: read when you add a Type", "  - **Example: MAR**: read when you need a worked example"];
    expect(indexEntries(doc(index, body))).toEqual([
      { level: 2, text: "1. Model", hint: "read when you add a Type" },
      { level: 3, text: "Example: MAR", hint: "read when you need a worked example" },
    ]);
  });
});

describe("indexProblems", () => {
  const full = ["- **1. Model**: read when a", "  - **Example: MAR**: read when b", "- **2. State**: read when c"];

  it("finds nothing wrong when the index lists every heading, in order, each with a hint", () => {
    expect(indexProblems("docs/x.md", doc(full, body))).toEqual([]);
  });

  it("asks for an index when the doc has none", () => {
    expect(indexProblems("docs/x.md", ["# Design", ...body].join("\n"))).toEqual(["docs/x.md has no `## Contents` index at the top"]);
  });

  it("names a heading the index lacks, and an entry with no heading", () => {
    const stale = ["- **1. Model**: read when a", "  - **Example: MAR**: read when b", "- **3. Gone**: read when c"];
    expect(indexProblems("docs/x.md", doc(stale, body))).toEqual([
      'docs/x.md: the index lacks "## 2. State"',
      'docs/x.md: the index lists "## 3. Gone", which is not a heading',
    ]);
  });

  it("names an entry at the wrong level, and entries out of order", () => {
    const wrong = ["- **1. Model**: read when a", "- **Example: MAR**: read when b", "- **2. State**: read when c"];
    expect(indexProblems("docs/x.md", doc(wrong, body))).toEqual(['docs/x.md: the index lists "Example: MAR" as ##, but it is a ### heading']);
    const swapped = ["- **2. State**: read when c", "- **1. Model**: read when a", "  - **Example: MAR**: read when b"];
    expect(indexProblems("docs/x.md", doc(swapped, body))).toEqual(["docs/x.md: the index is not in the headings' order"]);
  });

  it("asks for a read-when hint on every entry", () => {
    const bare = ["- **1. Model**: about models", "  - **Example: MAR**: read when b", "- **2. State**: read when c"];
    expect(indexProblems("docs/x.md", doc(bare, body))).toEqual(['docs/x.md: the entry "1. Model" needs a hint starting "read when"']);
  });
});

describe("the repository", () => {
  it.each(indexedDocs)("%s has a contents index that matches its headings", (file) => {
    expect(indexProblems(file, readFileSync(file, "utf8"))).toEqual([]);
  });
});
