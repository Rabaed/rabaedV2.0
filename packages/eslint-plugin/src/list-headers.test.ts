// RP-921: every List's column headers, in English and Arabic, use the glossary's terms.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allowedMessages, avoidInNames, avoidInText } from "./avoid-rules.ts";
import { avoidTermInCopy } from "./avoid-terms.ts";

type Messages = { [key: string]: string | Messages };
const read = (locale: "en" | "ar"): Messages =>
  JSON.parse(readFileSync(new URL(`../../../apps/web/messages/${locale}.json`, import.meta.url), "utf8")) as Messages;

/** Every List header: each string under a `columns` object, by key path. */
function headers(messages: Messages, path: string[] = []): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]): [string, string][] => {
    if (typeof value === "string") return path.at(-1) === "columns" ? [[[...path, key].join("."), value]] : [];
    return headers(value, [...path, key]);
  });
}

/** What docs/visibility.md forbids beside the glossary: the holder column is "With", never "Current owner". */
const forbidden = { en: ["current owner"], ar: ["المسؤول الحالي"] };

describe("List headers (RP-921)", () => {
  for (const locale of ["en", "ar"] as const) {
    const all = headers(read(locale));

    it(`${locale}: finds the Lists' headers`, () => {
      expect(all.map(([path]) => path)).toContain("workItemViews.list.columns.owner");
    });

    it(`${locale}: no header uses an _Avoid_ term, except the owner's anatomy words in the allowlist`, () => {
      const hits = all
        .filter(([path]) => !(path in allowedMessages))
        .map(([path, text]) => [path, avoidTermInCopy(text, avoidInText, avoidInNames)?.term] as const)
        .filter(([, term]) => term);
      expect(hits).toEqual([]);
    });

    it(`${locale}: no header says "Current owner" (docs/visibility.md: the List's "With" column)`, () => {
      const hits = all.filter(([, text]) => forbidden[locale].some((phrase) => text.toLowerCase().includes(phrase)));
      expect(hits).toEqual([]);
    });
  }

  it("the List's holder column reads as its \"With\" filter does, in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      const list = (read(locale).workItemViews as Messages).list as Messages;
      expect((list.columns as Messages).owner).toBe(list.with);
    }
  });
});
