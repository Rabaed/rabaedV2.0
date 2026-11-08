import { formatNumber, registerFormFieldId, type BilingualText, type Locale, type RegisterImport, type RegisterImportMapping, type RegisterImportRow } from "@rabaed/domain";
import type { Translate } from "../workflow/workflow-builder-labels-from.ts";
import { reasonLines } from "./register-import-rows.tsx";

// What the Submittal Register Import shows of a preview or a record besides its rows (RP-1144, the
// kit's import-register screens): the wizard's steps, the columns a mapping reads, what will be
// imported, the validation log, and an import's rows as its page filters them. No time anywhere:
// when an import ran is when its Drafts were started (docs/visibility.md, scenario 61).

/** The wizard's steps in its stepper; Result follows them and is not one. */
export type WizardStep = "upload" | "sheet" | "map" | "values" | "assign" | "validate";

/** The stepper: Map values only while a column is ticked to match its values, or while the importer is on it. */
export function wizardSteps(tickedColumns: number, at: WizardStep | "result"): WizardStep[] {
  const values = tickedColumns > 0 || at === "values";
  return ["upload", "sheet", "map", ...(values ? (["values"] as const) : []), "assign", "validate"];
}

/** Each column a mapping reads, once, by column, with the field it fills (`field:<key>` for a Form field's); a fixed Type or Trade reads none. */
export function mappedColumns(mapping: RegisterImportMapping): { column: number; field: string }[] {
  const out: { column: number; field: string }[] = [{ column: mapping.subject.column, field: "subject" }];
  if ("column" in mapping.type) out.push({ column: mapping.type.column, field: "type" });
  if ("column" in mapping.trade) out.push({ column: mapping.trade.column, field: "trade" });
  for (const field of ["scopes", "location", "package", "paperRef", "assignTo"] as const) {
    const at = mapping[field];
    if (at) out.push({ column: at.column, field });
  }
  for (const f of mapping.fields ?? []) out.push({ column: f.column, field: registerFormFieldId(f.key) });
  return out.sort((a, b) => a.column - b.column);
}

/** One line of a count: what it counts, a Type's code, its name, and its good rows. */
export type CountLine = { key: string; code?: string; name: BilingualText; rows: number };

/** A count line's or a matched value's words in the reader's language: "MAR · Material Approval Request" for a Type. */
export const labelOf = (it: { code?: string; name: BilingualText }, locale: Locale) => (it.code ? `${it.code} · ${it.name[locale]}` : it.name[locale]);

function countBy(rows: RegisterImportRow[], of: (row: RegisterImportRow) => Omit<CountLine, "rows"> | null): CountLine[] {
  const counts = new Map<string, CountLine>();
  for (const row of rows) {
    const it = of(row);
    if (!it) continue;
    counts.set(it.key, { ...it, rows: (counts.get(it.key)?.rows ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.rows - a.rows);
}

/**
 * What will be imported (the kit's "What will be imported"): the good rows, each a Draft, by Type, by
 * Trade and by who raises it (its assignee, else the default raiser), most first; the import's
 * Packages; and how many go to none.
 */
export function importSummary(imported: RegisterImport) {
  const good = imported.rows.filter((r) => r.reasons.length === 0);
  return {
    drafts: good.length,
    byType: countBy(good, (r) => (r.type.match ? { key: r.type.match.code, code: r.type.match.code, name: r.type.match.name } : null)),
    byTrade: countBy(good, (r) => (r.trade.match ? { key: r.trade.match.id, name: r.trade.match.name } : null)),
    byRaiser: countBy(good, (r) => {
      const raiser = r.assignee.match ?? imported.defaultRaiser;
      return { key: raiser.id, name: raiser.name };
    }),
    packages: imported.packages,
    noPackage: good.filter((r) => r.package.match === null && r.package.new === null).length,
  };
}

/** One line of the validation log: an error (a row left out) or information. */
export type LogLine = { level: "error" | "info"; text: string };

/**
 * The validation log (the kit's Log tab): what was read and how it was mapped, each row's result
 * with its reasons, then the counts. In the reader's language, with no time (unlike the kit's).
 */
export function importLog(imported: RegisterImport, t: Translate, locale: Locale): LogLine[] {
  const n = (value: number) => formatNumber(value, locale);
  const mapped = mappedColumns(imported.mapping).length;
  const bad = imported.rows.filter((r) => r.reasons.length > 0).length;
  const lines: LogLine[] = [
    { level: "info", text: t("log.started", { file: imported.fileName, sheet: imported.sheet, row: n(imported.headerRow) }) },
    { level: "info", text: t("log.nothingYet") },
    {
      level: "info",
      text: t("log.mapping", { mapped: n(mapped), ignored: n(Math.max(0, imported.headers.length - mapped)), count: mapped }),
    },
  ];
  for (const row of imported.rows) {
    const subject = row.subject || t("log.noSubject");
    if (row.reasons.length === 0) lines.push({ level: "info", text: t("log.rowOk", { row: n(row.rowNo), subject }) });
    else {
      const reasons = reasonLines(row, imported.mapping, t, locale)
        .map((l) => l.text)
        .join("; ");
      lines.push({ level: "error", text: t("log.rowBad", { row: n(row.rowNo), subject, reasons }) });
    }
  }
  lines.push({
    level: "info",
    text: t("log.finished", { total: n(imported.rows.length), ready: n(imported.rows.length - bad), bad: n(bad), count: imported.rows.length }),
  });
  return lines;
}

/** Which of an import's rows its page shows. */
export type RowsShown = "all" | "created" | "rejected";

/** An import's rows on its page: all, the created or the rejected ones, found by Subject (any case) or row number. */
export function filterImportRows(rows: RegisterImportRow[], shown: RowsShown, query: string): RegisterImportRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (shown === "created" && !r.created) return false;
    if (shown === "rejected" && r.reasons.length === 0) return false;
    return q === "" || r.subject.toLowerCase().includes(q) || String(r.rowNo) === q;
  });
}

/** The values an import matched (its page's "Mapping used"): each different Type, Trade and Location cell once, with what it matched or none. */
export type ValueMatched = { field: "type" | "trade" | "location"; text: string; match: { code?: string; name: BilingualText } | null };

export function valuesMatched(imported: RegisterImport): ValueMatched[] {
  const out: ValueMatched[] = [];
  const add = (field: ValueMatched["field"], text: string, match: ValueMatched["match"]) => {
    if (text === "" || out.some((v) => v.field === field && v.text === text)) return;
    out.push({ field, text, match });
  };
  for (const field of ["type", "trade", "location"] as const) {
    for (const row of imported.rows) {
      if (field === "type") add(field, row.type.text, row.type.match ? { code: row.type.match.code, name: row.type.match.name } : null);
      else if (field === "trade") add(field, row.trade.text, row.trade.match ? { name: row.trade.match.name } : null);
      else add(field, row.location.text, row.location.match ? { name: row.location.match.name } : null);
    }
  }
  return out;
}
