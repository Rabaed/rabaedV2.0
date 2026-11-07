// The sheet's work (RP-1248): who ran each case. One tester's saved JSON may be loaded into another
// tester's sheet, so the name goes on every case result, not only at the top of the file.
// Inlined into the page by scripts/uat-sheet.ts (its `export`s dropped), and tested by uat-sheet.test.ts.

const WORK_STATUSES = ["pass", "fail", "blocked", "notrun"];

/**
 * An entry as it is saved: the name typed at the top now, else the name it was saved with before.
 * @param {{ status: string, comment: string, shots: string[], at: string, tester?: string }} entry
 * @param {string} tester
 */
export function recordEntry(entry, tester) {
  return { ...entry, tester: tester.trim() || entry.tester || "" };
}

const hasResult = (e) => Boolean(e.status || e.comment || e.shots.length);

/**
 * The work file the sheet saves and loads: every entry with a result, each with the name of who ran it.
 * @param {{ round: string, tester: string, at: string, entries: Iterable<[string, { status: string, comment: string, shots: string[], at: string, tester?: string }]>, shots: unknown[] }} work
 */
export function workFile({ round, tester, at, entries, shots }) {
  /** @type {Record<string, { status: string, comment: string, shots: string[], at: string, tester: string }>} */
  const out = {};
  for (const [key, e] of entries) if (hasResult(e)) out[key] = { ...e, tester: e.tester || tester };
  return { sheet: "rabaed-uat-sheet", round, tester, at, entries: out, shots };
}

/**
 * An entry of a loaded work file, as the sheet keeps it: only the four statuses, only screenshots the file
 * brought, and the name of who ran it (the entry's own, else the file's), since a hand-made or AI-made file may
 * hold anything.
 * @param {any} raw
 * @param {{ fileTester: unknown, shotOk: (id: string) => boolean, now: string }} context
 */
export function readEntry(raw, { fileTester, shotOk, now }) {
  return {
    status: WORK_STATUSES.includes(raw.status) ? raw.status : "",
    comment: String(raw.comment ?? ""),
    shots: (Array.isArray(raw.shots) ? raw.shots : []).filter((id) => shotOk(id)),
    tester: String(raw.tester ?? fileTester ?? ""),
    at: raw.at || now,
  };
}

/**
 * The Excel row's Tester: who ran the case, the sheet's name for an entry saved before names were kept, and
 * nothing for a case with no result.
 * @param {{ status: string, comment: string, shots: string[], tester?: string }} entry
 * @param {string} current
 */
export function testerCell(entry, current) {
  return hasResult(entry) ? entry.tester || current : "";
}
