import { locales, type BilingualText, type RegisterImport, type RegisterImportRow } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { filterImportRows, importLog, importSummary, mappedColumns, valuesMatched, wizardSteps } from "./register-import-summary.ts";

/** A name the same in every language: fixture data, not wording. */
const both = (text: string) => Object.fromEntries(locales.map((l) => [l, text])) as BilingualText;
const ids = { lena: "00000000-0000-4000-8000-000000000001", omar: "00000000-0000-4000-8000-000000000002", elec: "00000000-0000-4000-8000-0000000000e1" };

function row(rowNo: number, over: Partial<RegisterImportRow> = {}): RegisterImportRow {
  return {
    rowNo,
    cells: [],
    subject: `Item ${rowNo}`,
    type: { text: "MAR", match: { code: "MAR", name: both("Material Approval") } },
    trade: { text: "Elec.", match: { id: ids.elec, code: "EL", name: both("Electrical") } },
    location: { text: "", match: null },
    scopes: { text: "", matches: [] },
    paperRef: "",
    fields: [],
    assignee: { text: "", match: null },
    package: { text: "", match: null, new: null },
    reasons: [],
    created: false,
    workItemId: null,
    ...over,
  };
}

function imported(rows: RegisterImportRow[], over: Partial<RegisterImport> = {}): RegisterImport {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    fileName: "Register Rev4.xlsx",
    status: "previewed",
    runBy: { id: ids.lena, name: both("Lena") },
    rowsTotal: rows.length,
    rowsRejected: rows.filter((r) => r.reasons.length > 0).length,
    rowsCreated: null,
    projectId: "00000000-0000-4000-8000-00000000000b",
    defaultRaiser: { id: ids.lena, name: both("Lena") },
    sheet: "Register",
    headerRow: 3,
    headers: ["Ref", "Description", "Type", "Discipline", "Assign to", "Notes"],
    mapping: { subject: { column: 1 }, type: { column: 2 }, trade: { column: 3 }, assignTo: { column: 4 } },
    rows,
    rowsSuggested: 0,
    packages: [],
    original: true,
    ...over,
  };
}

/** Messages as their key and values, so a test reads what was asked for. */
const t = (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key);

describe("the wizard's steps (RP-1144)", () => {
  it("leave Map values out while no column is ticked to match its values", () => {
    expect(wizardSteps(0, "map")).toEqual(["upload", "sheet", "map", "assign", "validate"]);
    expect(wizardSteps(2, "map")).toEqual(["upload", "sheet", "map", "values", "assign", "validate"]);
  });

  it("keep Map values while the importer is on it", () => {
    expect(wizardSteps(0, "values")).toContain("values");
  });
});

describe("the columns a mapping reads", () => {
  it("are each mapped column once, by column, with the field it fills; a fixed Type or Trade reads none", () => {
    expect(
      mappedColumns({ subject: { column: 1 }, type: { value: "MAR" }, trade: { column: 3 }, assignTo: { column: 4 }, fields: [{ key: "brand", column: 0 }] }),
    ).toEqual([
      { column: 0, field: "field:brand" },
      { column: 1, field: "subject" },
      { column: 3, field: "trade" },
      { column: 4, field: "assignTo" },
    ]);
  });
});

describe("what will be imported", () => {
  const omar = { id: ids.omar, name: both("Omar") };
  const preview = imported(
    [
      row(4),
      row(5, { type: { text: "SAR", match: { code: "SAR", name: both("Shop Drawing") } }, assignee: { text: "omar@tmc.test", match: omar } }),
      row(6, { assignee: { text: "", match: omar }, package: { text: "", match: null, new: "Lobby" } }),
      row(7, { reasons: ["trade_unknown"], trade: { text: "HVAC-2", match: null } }),
    ],
    { packages: [{ package: null, newName: "Lobby", rows: 1 }] },
  );

  it("counts only the good rows, by Type, Trade and who raises them (the default raiser for the rest), most first", () => {
    const summary = importSummary(preview);
    expect(summary.drafts).toBe(3);
    expect(summary.byType).toEqual([
      { key: "MAR", code: "MAR", name: both("Material Approval"), rows: 2 },
      { key: "SAR", code: "SAR", name: both("Shop Drawing"), rows: 1 },
    ]);
    expect(summary.byTrade).toEqual([{ key: ids.elec, name: both("Electrical"), rows: 3 }]);
    expect(summary.byRaiser).toEqual([
      { key: ids.omar, name: both("Omar"), rows: 2 },
      { key: ids.lena, name: both("Lena"), rows: 1 },
    ]);
  });

  it("names the import's Packages, and how many good rows go to none", () => {
    const summary = importSummary(preview);
    expect(summary.packages).toEqual(preview.packages);
    expect(summary.noPackage).toBe(2);
  });
});

describe("the validation log (RP-1144)", () => {
  const preview = imported([row(4), row(7, { subject: "", reasons: ["subject_missing"] })]);

  it("says what was read and how it was mapped, then each row's result, then the counts, with no time", () => {
    const lines = importLog(preview, t, "en");
    expect(lines[0]).toEqual({ level: "info", text: 'log.started {"file":"Register Rev4.xlsx","sheet":"Register","row":"3"}' });
    expect(lines[1]).toEqual({ level: "info", text: "log.nothingYet" });
    expect(lines[2]).toEqual({ level: "info", text: 'log.mapping {"mapped":"4","ignored":"2","count":4}' });
    expect(lines[3]).toEqual({ level: "info", text: 'log.rowOk {"row":"4","subject":"Item 4"}' });
    expect(lines[4]?.level).toBe("error");
    expect(lines[4]?.text).toMatch(/^log\.rowBad \{"row":"7","subject":"log\.noSubject","reasons":"reasons\.subject_missing/);
    expect(lines.at(-1)).toEqual({ level: "info", text: 'log.finished {"total":"2","ready":"1","bad":"1","count":2}' });
    expect(lines.map((l) => l.text).join("\n")).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("an import's rows on its page", () => {
  const rows = [row(4), row(12, { subject: "Fan coil units", reasons: ["trade_unknown"] }), row(27, { subject: "Insulation – B1", created: true })];

  it("shows all, the created or the rejected ones", () => {
    expect(filterImportRows(rows, "all", "").map((r) => r.rowNo)).toEqual([4, 12, 27]);
    expect(filterImportRows(rows, "created", "").map((r) => r.rowNo)).toEqual([27]);
    expect(filterImportRows(rows, "rejected", "").map((r) => r.rowNo)).toEqual([12]);
  });

  it("finds a row by its Subject, whatever the case, or by its row number", () => {
    expect(filterImportRows(rows, "all", "fan").map((r) => r.rowNo)).toEqual([12]);
    expect(filterImportRows(rows, "all", " 27 ").map((r) => r.rowNo)).toEqual([27]);
    expect(filterImportRows(rows, "rejected", "insulation")).toEqual([]);
  });
});

describe("the values an import matched", () => {
  it("are each different Type, Trade and Location cell once, with what it matched or none", () => {
    const record = imported([
      row(4, { location: { text: "Lvl 3", match: { id: ids.omar, code: "T1-03", name: both("Tower 1 / Floor 3") } } }),
      row(5, { trade: { text: "Elec.", match: { id: ids.elec, code: "EL", name: both("Electrical") } } }),
      row(6, { trade: { text: "HVAC-2", match: null }, reasons: ["trade_unknown"] }),
    ]);
    expect(valuesMatched(record)).toEqual([
      { field: "type", text: "MAR", match: { code: "MAR", name: both("Material Approval") } },
      { field: "trade", text: "Elec.", match: { name: both("Electrical") } },
      { field: "trade", text: "HVAC-2", match: null },
      { field: "location", text: "Lvl 3", match: { name: both("Tower 1 / Floor 3") } },
    ]);
  });
});
