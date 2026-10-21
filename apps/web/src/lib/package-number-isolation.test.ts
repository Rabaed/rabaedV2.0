import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

// RP-975: a Document Number reads left to right (CLAUDE.md). In an Arabic sentence "PKG-007"
// can be reordered by the bidi algorithm unless it sits between LRI (U+2066) and PDI (U+2069),
// as "إزالة ⁦{number}⁩" already does.

const ar = JSON.parse(readFileSync(new URL("../../messages/ar.json", import.meta.url), "utf8"));
const t = createTranslator({ locale: "ar", messages: ar });

const packageNumbers = [
  "workItemViews.board.openPackage",
  "packages.delete.title",
  "packages.addItems.inOther",
  "packages.submit.title",
] as const;

describe("Package numbers in Arabic", () => {
  it.each(packageNumbers)("%s isolates the PKG number left to right", (key) => {
    expect(t(key, { number: "PKG-007", company: "C", name: "N" })).toContain("⁦PKG-007⁩");
  });
});
