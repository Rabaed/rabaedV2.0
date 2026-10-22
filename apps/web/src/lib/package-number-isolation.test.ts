import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

// RP-975: a Document Number reads left to right (CLAUDE.md). In an Arabic sentence "PKG-007"
// can be reordered by the bidi algorithm unless it sits between LRI (U+2066) and PDI (U+2069).
// Every Arabic message that prints a `{number}` (a Document Number) isolates it.

const ar = JSON.parse(readFileSync(new URL("../../messages/ar.json", import.meta.url), "utf8"));
const t = createTranslator({ locale: "ar", messages: ar });

function keysPrintingNumber(node: unknown, path: string[] = []): string[] {
  if (typeof node === "string") return node.includes("{number}") ? [path.join(".")] : [];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => keysPrintingNumber(value, [...path, key]));
}

const numbered = keysPrintingNumber(ar);

describe("Document Numbers in Arabic", () => {
  it("covers the Package messages", () => {
    expect(numbered).toEqual(
      expect.arrayContaining([
        "workItemViews.board.openPackage",
        "packages.delete.title",
        "packages.addItems.inOther",
        "packages.submit.title",
      ]),
    );
  });

  it.each(numbered)("%s isolates the number left to right", (key) => {
    expect(t(key, { number: "PKG-007", company: "C", name: "N" })).toContain("\u2066PKG-007\u2069");
  });

  // The Register Import names a matched Package by its label, "PKG-007 \u00b7 name" (packageLabel).
  it("registerImport.reasons.package_not_open isolates the Package label", () => {
    expect(t("registerImport.reasons.package_not_open", { value: "PKG-007 \u00b7 N", status: "S" })).toContain("\u2066PKG-007 \u00b7 N\u2069");
  });
});
