import type { PdfRenderer } from "./render.ts";

// The "UAT" mark (RP-1042, ADR 0026): every PDF the UAT Records container makes (the
// Documental Record, a Re-produce, a Working Copy, a Snag report) prints "UAT" in the four
// corners of every page, so a UAT record can never pass as a real one. The corners are the
// page's margin, outside the frame an appendix page is drawn into (appendix.ts), so the
// appendix's pages carry it too. It is printed in the record's own embedded fonts
// ('Record Sans' is always in them, fonts.ts), so the PDF/A-3 checks still pass. The
// renderer adds it to each page it draws, so no layout knows about it.

/** What every corner prints: the same in Arabic and English records. */
export const UAT_MARK = "UAT";

const CORNERS = ["top-left-corner", "top-right-corner", "bottom-left-corner", "bottom-right-corner"] as const;

const MARK_CSS = `@page {
${CORNERS.map(
  (c) =>
    `  @${c} { content: "${UAT_MARK}"; font-family: 'Record Thmanyah', 'Record Sans'; font-size: 11pt; font-weight: 700; color: #b00020; text-align: center; vertical-align: middle; }`,
).join("\n")}
}`;

/** The page's HTML with the mark, its style last in the head. Throws when it has no head. */
export function withUatMark(html: string): string {
  const at = html.indexOf("</head>");
  if (at < 0) throw new Error("the page has no </head> for the UAT mark");
  return `${html.slice(0, at)}<style id="uat-mark">\n${MARK_CSS}\n</style>\n${html.slice(at)}`;
}

/** `renderer`, with the mark on every page it draws. */
export function uatMarkedRenderer(renderer: PdfRenderer): PdfRenderer {
  return { render: (html) => renderer.render(withUatMark(html)), close: () => renderer.close() };
}
