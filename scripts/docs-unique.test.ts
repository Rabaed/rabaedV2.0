import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { duplicateAdrNumbers, duplicateGlossaryTerms } from "./docs-unique.ts";

const root = new URL("../", import.meta.url);

describe("duplicateAdrNumbers", () => {
  it("names a number two files share, added apart on two branches", () => {
    expect(duplicateAdrNumbers(["0022-a.md", "0023-from-main-2.md", "0023-from-main-4.md", "README.md"])).toEqual([
      "ADR 0023: 0023-from-main-2.md, 0023-from-main-4.md",
    ]);
  });

  it("passes distinct numbers", () => {
    expect(duplicateAdrNumbers(["0001-a.md", "0002-b.md"])).toEqual([]);
  });
});

describe("duplicateGlossaryTerms", () => {
  it("names a term defined twice, even in another case and section", () => {
    const glossary = ["### One", "**Package**:", "A group.", "", "### Two", "**package**:", "Another group.", "", "**Snag**:", "A defect."].join("\n");
    expect(duplicateGlossaryTerms(glossary)).toEqual(["Package: lines 2, 6"]);
  });

  it("ignores a bold term inside a definition", () => {
    expect(duplicateGlossaryTerms(["**Snag**:", "Unlike a **Snag**: a defect.", ""].join("\n"))).toEqual([]);
  });
});

describe("the docs on this branch", () => {
  it("give every ADR its own number", () => {
    expect(duplicateAdrNumbers(readdirSync(new URL("docs/adr/", root)))).toEqual([]);
  });

  it("define each glossary term once", () => {
    expect(duplicateGlossaryTerms(readFileSync(new URL("GLOSSARY.md", root), "utf8"))).toEqual([]);
  });
});
