import { describe, expect, it } from "vitest";
import { fallbackFonts } from "./fonts.ts";
import { goldenRecord } from "./golden-fixtures.ts";
import { recordHtml } from "./layout.ts";
import type { PdfRenderer } from "./render.ts";
import { UAT_MARK, uatMarkedRenderer, withUatMark } from "./uat-mark.ts";

// The "UAT" mark (RP-1042, ADR 0026): every PDF the UAT Records container makes says "UAT" in the
// corners of every page, so a UAT record can never pass as a real one. Its pages' text is read
// back in apps/api/test/uat-records.test.ts, on a whole record made by the UAT job.

const html = () => {
  const { data, images } = goldenRecord("A", "bilingual");
  return recordHtml(data, fallbackFonts(), new Map(), images);
};

describe("withUatMark", () => {
  it("prints UAT in the four corners of every page's margin, in the record's fonts", () => {
    const marked = withUatMark(html());
    const style = /<style id="uat-mark">([\s\S]*?)<\/style>/.exec(marked)?.[1] ?? "";
    for (const corner of ["top-left-corner", "top-right-corner", "bottom-left-corner", "bottom-right-corner"]) {
      expect(style).toMatch(new RegExp(`@${corner} \\{[^}]*content: "${UAT_MARK}"`));
    }
    expect(style).toContain("font-family: 'Record Thmanyah', 'Record Sans'");
    // After the record's own style, so nothing in it hides the mark.
    expect(marked.indexOf('<style id="uat-mark">')).toBeGreaterThan(marked.lastIndexOf("</style>", marked.indexOf('<style id="uat-mark">')));
    expect(marked.indexOf('<style id="uat-mark">')).toBeLessThan(marked.indexOf("</head>"));
  });

  it("is the Latin letters UAT, the same in Arabic and English records", () => {
    expect(UAT_MARK).toBe("UAT");
  });

  it("refuses HTML with no head, rather than printing a record without the mark", () => {
    expect(() => withUatMark("<p>no head</p>")).toThrow(/head/);
  });
});

describe("uatMarkedRenderer", () => {
  it("renders every HTML it is given with the mark", async () => {
    const seen: string[] = [];
    const inner: PdfRenderer = { render: async (h) => (seen.push(h), new Uint8Array([1])), close: async () => undefined };
    const renderer = uatMarkedRenderer(inner);
    await renderer.render(html());
    await renderer.render(html());
    expect(seen).toHaveLength(2);
    for (const h of seen) expect(h).toContain('<style id="uat-mark">');
  });
});
