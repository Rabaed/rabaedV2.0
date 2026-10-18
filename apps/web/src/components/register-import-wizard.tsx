"use client";

import {
  formatNumber,
  registerImportMaxBytes,
  type BilingualText,
  type Locale,
  type RegisterImport,
  type RegisterImportFields,
  type RegisterImportFile,
  type RegisterImportMapping,
  type RegisterSheet,
  type RegisterValues,
} from "@rabaed/domain";
import { Button, Checkbox, Icon, RadioGroup, Select, Tabs, TabsContent, TabsList, TabsTrigger, cn } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { ErrorRows, ImportRows } from "@/components/register-import-rows";
import { Link } from "@/i18n/navigation";
import { setupCall } from "@/lib/setup-call";

// The Submittal Register Import wizard (RP-637, RP-639; the owner's design RP-634, the
// Admin wizard's steps without Company & reason): Upload → Sheet & header row → Map
// fields (a field suggested for each column from its heading; Subject, Type, Trade,
// Scopes, Location, Paper ref and the simple Form fields of the Types; a fixed Type or
// Trade) → Map values (each different value of the ticked columns matched once) →
// Validate (every row's reasons, the counts) → Result. Nothing is created until the
// Member confirms. Assign & packages come with RP-640 and RP-644.

type Step = "upload" | "sheet" | "map" | "values" | "validate" | "result";
const stepper: Step[] = ["upload", "sheet", "map", "values", "validate"];

/** The Type's or the Trade's source: a column, or one value for every row. */
type Source = { from: "column"; column: number | null } | { from: "value"; value: string | null };

type Uploaded = RegisterImportFile & { sizeBytes: number };

/** The optional fields a column fills besides Subject, Type and Trade: Scopes, Location, Paper ref, `field:<key>`. */
type OtherField = string;

/** The values matched by hand on Map values: by field (`type`, `trade`, `location`, `scopes`, `field:<key>`), by the value's key. */
type Matches = Record<string, Record<string, string>>;

/** Whether a source names its column or its value. */
const sourceSet = (source: Source) => (source.from === "column" ? source.column !== null : source.value !== null);

/** A refusal's message key (`registerImport.errors.*`). */
const refusals: Record<string, string> = {
  unsupported_type: "unsupportedType",
  unreadable: "unreadable",
  not_utf8: "notUtf8",
  file_too_large: "tooLarge",
  unpacks_too_large: "tooLarge",
  too_many_rows: "tooManyRows",
  sheet_not_found: "unreadable",
  header_row_not_found: "headerRowNotFound",
  empty_header_row: "emptyHeaderRow",
  column_not_found: "columnNotFound",
  field_not_found: "fieldNotFound",
  nothing_to_import: "nothingToImport",
  preview_outdated: "previewOutdated",
  type_not_found: "typeNotFound",
  trade_not_found: "tradeNotFound",
  forbidden: "forbidden",
  not_found: "notFound",
  project_closed: "projectClosed",
};

/** A spreadsheet column's letter, as Excel names it: A … Z, AA … */
function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** The file's bytes as base64, for the JSON body. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Whether a field's values are matched to the Project's on Map values: the Type, Trade, Location, Scopes and choice fields. */
function matchesValues(field: string, fields: RegisterImportFields): boolean {
  if (field === "type" || field === "trade" || field === "location" || field === "scopes") return true;
  const form = field.startsWith("field:") ? fields.formFields.find((f) => `field:${f.key}` === field) : undefined;
  return form !== undefined && (form.type === "select" || form.type === "multi_select" || form.type === "option_list");
}

export function RegisterImportWizard({
  projectId,
  locale,
  types,
  trades,
  fields,
  initialPreview = null,
}: {
  projectId: string;
  locale: Locale;
  /** The Submittals Types the Member may raise, for one Type for every row. */
  types: { code: string; name: BilingualText }[];
  /** The Trades their Visibility covers, for one Trade for every row. */
  trades: { id: string; code: string; name: BilingualText }[];
  /** What a register may fill on the Project (RP-639): the Project's values and the Types' simple Form fields. */
  fields: RegisterImportFields;
  /** The Member's own preview, reopened at Validate (`?preview=`): confirm it, or start again with the register. */
  initialPreview?: RegisterImport | null;
}) {
  const t = useTranslations("registerImport");
  const [step, setStep] = useState<Step>(initialPreview ? "validate" : "upload");
  const [file, setFile] = useState<Uploaded | null>(null);
  const [sheet, setSheet] = useState<RegisterSheet | null>(null);
  const [subject, setSubject] = useState<number | null>(null);
  const [type, setType] = useState<Source>({ from: "column", column: null });
  const [trade, setTrade] = useState<Source>({ from: "column", column: null });
  /** Scopes, Location, Paper ref and Form fields, by column. */
  const [others, setOthers] = useState<Record<number, OtherField>>({});
  /** The columns ticked "Map field value": their values are matched on Map values. */
  const [ticked, setTicked] = useState<Record<number, boolean>>({});
  const [values, setValues] = useState<RegisterValues | null>(null);
  const [valueTab, setValueTab] = useState(0);
  const [matches, setMatches] = useState<Matches>({});
  const [preview, setPreview] = useState<RegisterImport | null>(initialPreview);
  const [created, setCreated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const n = (value: number) => formatNumber(value, locale);
  const refusal = (code: string) => t(`errors.${refusals[code] ?? "unavailable"}`, { size: n(registerImportMaxBytes / (1024 * 1024)) });

  /** A field's name on the Map fields step: Subject, Type… or "Form · its label (its Types)". */
  const fieldName = (field: string): string => {
    if (!field.startsWith("field:")) return t(`fields.${field}`);
    const form = fields.formFields.find((f) => `field:${f.key}` === field);
    return form ? t("map.formField", { label: form.label[locale], types: form.types.join(" · ") }) : field;
  };

  /** Reads the register again for a sheet and header row; the mapping starts afresh from the columns' suggestions. */
  async function read(uploaded: Uploaded, choice: { sheet?: string; headerRow?: number }) {
    setBusy(true);
    setError(null);
    const result = await setupCall("POST", `/projects/${projectId}/register-imports/read`, {
      file: { fileName: uploaded.fileName, content: uploaded.content },
      ...choice,
    });
    setBusy(false);
    if (!result.ok) {
      setError(refusal(result.error));
      return false;
    }
    const read = result.body as RegisterSheet;
    setSheet(read);
    // The suggestions only: the importer changes any of them.
    const suggested = (field: string) => {
      const column = read.suggestions.findIndex((s) => s?.field === field);
      return column === -1 ? null : column;
    };
    setSubject(suggested("subject"));
    setType((s) => (s.from === "column" ? { from: "column", column: suggested("type") } : s));
    setTrade((s) => (s.from === "column" ? { from: "column", column: suggested("trade") } : s));
    const rest: Record<number, OtherField> = {};
    const ticks: Record<number, boolean> = {};
    read.suggestions.forEach((s, column) => {
      if (!s) return;
      if (s.field !== "subject" && s.field !== "type" && s.field !== "trade") rest[column] = s.field;
      ticks[column] = matchesValues(s.field, fields);
    });
    setOthers(rest);
    setTicked(ticks);
    setMatches({});
    setValues(null);
    return true;
  }

  async function choose(chosen: File | undefined) {
    if (!chosen) return;
    if (chosen.size > registerImportMaxBytes) {
      setError(refusal("file_too_large"));
      return;
    }
    const uploaded = { fileName: chosen.name, content: await base64Of(chosen), sizeBytes: chosen.size };
    setFile(uploaded);
    setPreview(null);
    if (await read(uploaded, {})) setStep("sheet");
  }

  /** The mapping as the API takes it, with the values matched by hand; null until Subject, Type and Trade are given. */
  const mapping = (withMatches = true): RegisterImportMapping | null => {
    if (subject === null) return null;
    const typeOf = type.from === "column" ? (type.column === null ? null : { column: type.column }) : type.value === null ? null : { value: type.value };
    const tradeOf =
      trade.from === "column" ? (trade.column === null ? null : { column: trade.column }) : trade.value === null ? null : { value: trade.value };
    if (!typeOf || !tradeOf) return null;
    const columnOf = (field: string) => {
      const entry = Object.entries(others).find(([, f]) => f === field);
      return entry ? { column: Number(entry[0]) } : undefined;
    };
    const formFields = Object.entries(others)
      .filter(([, f]) => f.startsWith("field:"))
      .map(([column, f]) => ({ key: f.slice("field:".length), column: Number(column) }));
    const byHand = (field: string) => (Object.keys(matches[field] ?? {}).length > 0 ? matches[field] : undefined);
    const fieldMatches = Object.fromEntries(formFields.flatMap((f) => (byHand(`field:${f.key}`) ? [[f.key, byHand(`field:${f.key}`)!]] : [])));
    const valueMatches = {
      ...(byHand("type") ? { type: byHand("type") } : {}),
      ...(byHand("trade") ? { trade: byHand("trade") } : {}),
      ...(byHand("location") ? { location: byHand("location") } : {}),
      ...(byHand("scopes") ? { scopes: byHand("scopes") } : {}),
      ...(Object.keys(fieldMatches).length > 0 ? { fields: fieldMatches } : {}),
    };
    return {
      subject: { column: subject },
      type: typeOf,
      trade: tradeOf,
      ...(columnOf("scopes") ? { scopes: columnOf("scopes") } : {}),
      ...(columnOf("location") ? { location: columnOf("location") } : {}),
      ...(columnOf("paperRef") ? { paperRef: columnOf("paperRef") } : {}),
      ...(formFields.length > 0 ? { fields: formFields } : {}),
      ...(withMatches && Object.keys(valueMatches).length > 0 ? { values: valueMatches } : {}),
    };
  };

  /** Map values: reads each ticked column's values, each matched as the API matches it; a suggestion is pre-chosen, to confirm. */
  async function loadValues() {
    const chosen = mapping();
    if (!file || !sheet || !chosen) return;
    setBusy(true);
    setError(null);
    const result = await setupCall("POST", `/projects/${projectId}/register-imports/values`, {
      file: { fileName: file.fileName, content: file.content },
      sheet: sheet.sheet,
      headerRow: sheet.headerRow,
      mapping: chosen,
    });
    setBusy(false);
    if (!result.ok) {
      setError(refusal(result.error));
      return;
    }
    const read = result.body as RegisterValues;
    const shown = { fields: read.fields.filter((f) => ticked[f.column]) };
    setValues(shown);
    setValueTab(0);
    setMatches((was) => {
      const next: Matches = { ...was };
      for (const f of shown.fields) {
        for (const v of f.values) {
          if ((v.how === "suggested" || v.how === "manual") && v.match) next[f.field] = { ...next[f.field], [v.key]: v.match };
        }
      }
      return next;
    });
    setStep("values");
  }

  async function validate() {
    const chosen = mapping();
    if (!file || !sheet || !chosen) return;
    setBusy(true);
    setError(null);
    const result = await setupCall("POST", `/projects/${projectId}/register-imports`, {
      file: { fileName: file.fileName, content: file.content },
      sheet: sheet.sheet,
      headerRow: sheet.headerRow,
      mapping: chosen,
    });
    setBusy(false);
    if (!result.ok) {
      setError(refusal(result.error));
      return;
    }
    const previewed = result.body as RegisterImport;
    setPreview(previewed);
    setStep("validate");
    // A reload reopens this preview at Validate.
    window.history.replaceState(null, "", `?preview=${previewed.id}`);
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const result = await setupCall("POST", `/register-imports/${preview.id}/confirm`, {});
    setBusy(false);
    if (!result.ok) {
      setError(refusal(result.error));
      return;
    }
    setCreated((result.body as { rowsCreated: number }).rowsCreated);
    setStep("result");
  }

  function startAgain() {
    setStep("upload");
    setFile(null);
    setSheet(null);
    setPreview(null);
    setCreated(null);
    setError(null);
    setType({ from: "column", column: null });
    setTrade({ from: "column", column: null });
    setOthers({});
    setTicked({});
    setMatches({});
    setValues(null);
  }

  const back = (to: Step) => (
    <Button variant="secondary" onClick={() => setStep(to)} disabled={busy}>
      {t("back")}
    </Button>
  );

  /** Which field a column is mapped to. */
  const fieldOf = (column: number): string =>
    subject === column
      ? "subject"
      : type.from === "column" && type.column === column
        ? "type"
        : trade.from === "column" && trade.column === column
          ? "trade"
          : (others[column] ?? "none");
  /** Maps `column` to `field` (each field takes one column), or unmaps it; a value field is ticked to match its values. */
  function mapColumn(column: number, field: string) {
    const clear = (f: string) => {
      if (f === "subject") setSubject(null);
      else if (f === "type") setType({ from: "column", column: null });
      else if (f === "trade") setTrade({ from: "column", column: null });
    };
    clear(fieldOf(column));
    if (field !== "none") clear(field);
    setOthers((was) => {
      const next = Object.fromEntries(Object.entries(was).filter(([c, f]) => Number(c) !== column && f !== field));
      return field === "subject" || field === "type" || field === "trade" || field === "none" ? next : { ...next, [column]: field };
    });
    if (field === "subject") setSubject(column);
    if (field === "type") setType({ from: "column", column });
    if (field === "trade") setTrade({ from: "column", column });
    setTicked((was) => ({ ...was, [column]: field !== "none" && matchesValues(field, fields) }));
  }

  /** The fields a column can fill, each once, with the required ones starred. */
  const fieldOptions = [
    { value: "none", label: t("map.dontMap") },
    { value: "subject", label: `${t("fields.subject")} *` },
    { value: "type", label: `${t("fields.type")} *` },
    { value: "trade", label: `${t("fields.trade")} *` },
    { value: "scopes", label: t("fields.scopes") },
    { value: "location", label: t("fields.location") },
    { value: "paperRef", label: t("fields.paperRef") },
    ...fields.formFields.map((f) => ({ value: `field:${f.key}`, label: fieldName(`field:${f.key}`) })),
  ];

  /** The Project's values a value field's value may be matched to, as Map values offers them. */
  const valueOptions = (field: string): { value: string; label: string }[] => {
    if (field === "type") return fields.types.map((ty) => ({ value: ty.code, label: `${ty.code} · ${ty.name[locale]}` }));
    if (field === "trade") return fields.trades.map((tr) => ({ value: tr.id, label: tr.name[locale] }));
    if (field === "location") return fields.locations.map((l) => ({ value: l.id, label: l.path[locale] }));
    if (field === "scopes") {
      const tradeName = (id: string) => fields.trades.find((tr) => tr.id === id)?.name[locale] ?? "";
      return fields.scopes.map((s) => ({ value: s.id, label: `${s.name[locale]} · ${tradeName(s.tradeId)}` }));
    }
    const form = fields.formFields.find((f) => `field:${f.key}` === field);
    return (form?.options ?? []).map((o) => ({ value: o.value, label: o.label[locale] }));
  };

  /** A value's match now: the one chosen by hand, else the API's exact one. */
  const matchOf = (field: string, value: RegisterValues["fields"][number]["values"][number]) =>
    matches[field]?.[value.key] ?? (value.how === "exact" ? value.match : null);

  const fileCard = (detail: ReactNode, action?: ReactNode) =>
    file && (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3">
        <Icon name="table" className="text-success-fg" />
        <bdi className="font-semibold">{file.fileName}</bdi>
        <span className="text-[13px] text-muted">{detail}</span>
        {action && <span className="ms-auto">{action}</span>}
      </div>
    );

  const currentValues = values?.fields[valueTab];
  const tickedColumns = Object.entries(ticked).filter(([column, on]) => on && fieldOf(Number(column)) !== "none").length;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {step !== "result" && (
        <ol aria-label={t("steps")} className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {stepper.map((s, index) => {
            const at = stepper.indexOf(step);
            const done = index < at;
            return (
              <li key={s} aria-current={s === step ? "step" : undefined} className="flex items-center gap-2 text-[14px]">
                {index > 0 && <span aria-hidden className="h-px w-6 bg-border" />}
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-[12px] font-bold",
                    done ? "bg-success text-on-primary" : s === step ? "bg-primary text-on-primary" : "bg-neutral-tint text-muted",
                  )}
                >
                  {done ? <Icon name="check" size={14} /> : n(index + 1)}
                </span>
                <span className={cn(s === step ? "font-semibold text-text" : "text-text-secondary")}>{t(`step.${s}`)}</span>
              </li>
            );
          })}
        </ol>
      )}

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-md bg-danger-tint px-4 py-3 text-[14px] text-danger-fg">
          <Icon name="alert-triangle" size={16} />
          {error}
        </p>
      )}

      {step === "upload" && (
        <section aria-labelledby="upload-heading" className="flex flex-col gap-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void choose(e.dataTransfer.files[0]);
            }}
            className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border-strong bg-surface px-6 py-12 text-center"
          >
            <span className="inline-flex size-14 items-center justify-center rounded-md bg-success-tint text-success-fg">
              <Icon name="table" size={28} />
            </span>
            <h2 id="upload-heading" className="text-[16px] font-semibold">
              {t("upload.drop")}
            </h2>
            <p className="text-[13px] text-muted">
              <bdi dir="ltr">.xlsx · .csv</bdi>
            </p>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only"
              aria-label={t("upload.browse")}
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            <Button onClick={() => input.current?.click()} disabled={busy}>
              <Icon name="upload" />
              {t("upload.browse")}
            </Button>
          </div>
          <p className="flex items-start gap-2 text-[13px] text-muted">
            <Icon name="info-circle" size={16} className="mt-0.5" />
            {t("upload.anyLayout")}
          </p>
          <p className="flex items-start gap-2 text-[13px] text-muted">
            <Icon name="info-circle" size={16} className="mt-0.5" />
            {t("upload.asText")}
          </p>
        </section>
      )}

      {step === "sheet" && sheet && file && (
        <section aria-label={t("step.sheet")} className="flex flex-col gap-4">
          {fileCard(
            t("sheet.fileDetail", { worksheets: sheet.sheets.length, n: n(sheet.sheets.length), size: n(Math.max(0.1, Math.round((file.sizeBytes / (1024 * 1024)) * 10) / 10)) }),
            <Button variant="ghost" size="sm" onClick={startAgain}>
              {t("changeFile")}
            </Button>,
          )}
          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="flex flex-col gap-4 self-start rounded-md border border-border bg-surface p-3">
              <div role="group" aria-labelledby="sheets-label" className="flex flex-col gap-1">
                <h2 id="sheets-label" className="px-1 text-[12px] font-bold text-text-secondary">
                  {t("sheet.sheet")}
                </h2>
                {sheet.sheets.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    aria-pressed={s.name === sheet.sheet}
                    disabled={busy}
                    onClick={() => void read(file, { sheet: s.name })}
                    className={cn(
                      "flex items-center gap-2 rounded-sm px-2.5 py-2 text-start text-[14px] hover:bg-hover",
                      s.name === sheet.sheet && "bg-brand-tint font-semibold text-brand-fg",
                    )}
                  >
                    <Icon name="table" size={16} />
                    <bdi className="truncate">{s.name}</bdi>
                    <span className="ms-auto text-[12px] text-muted">{t("sheet.rows", { count: s.rows, n: n(s.rows) })}</span>
                  </button>
                ))}
              </div>
              <label className="flex flex-col gap-1.5 text-[12px] font-bold text-text-secondary">
                {t("sheet.headerRow")}
                <Select
                  aria-label={t("sheet.headerRow")}
                  value={String(sheet.headerRow)}
                  onValueChange={(value) => void read(file, { sheet: sheet.sheet, headerRow: Number(value) })}
                  options={sheet.top.map((r) => ({ value: String(r.rowNo), label: n(r.rowNo) }))}
                />
              </label>
              <p className="text-[13px] text-muted">{t("sheet.headerHelp")}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <SheetGrid sheet={sheet} label={t("sheet.preview")} n={n} />
              <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-3 rounded-xs bg-brand-tint ring-1 ring-brand" />
                  {t("sheet.headerLegend")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-3 rounded-xs bg-[repeating-linear-gradient(135deg,var(--color-surface-subtle)_0_2px,var(--color-surface)_2px_4px)] ring-1 ring-border" />
                  {t("sheet.skipped")}
                </span>
                <span className="ms-auto">{t("sheet.showing", { shown: n(sheet.top.length), rows: n(sheet.dataRows), count: sheet.dataRows })}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {back("upload")}
            <Button onClick={() => setStep("map")} disabled={busy || sheet.headers.every((h) => h === "")}>
              {t("next")}
              <Icon name="arrow-right" />
            </Button>
          </div>
        </section>
      )}

      {step === "map" && sheet && file && (
        <section aria-label={t("step.map")} className="flex flex-col gap-4">
          {fileCard(
            t("map.fileDetail", { worksheet: sheet.sheet, headerRow: n(sheet.headerRow), rows: n(sheet.dataRows), columns: n(sheet.headers.length) }),
          )}
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            {(["subject", "type", "trade"] as const).map((field) => {
              const mapped = field === "subject" ? subject !== null : sourceSet(field === "type" ? type : trade);
              return (
                <span
                  key={field}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold",
                    mapped ? "bg-success-tint text-success-fg" : "bg-neutral-tint text-text-secondary",
                  )}
                >
                  <Icon name={mapped ? "circle-check" : "circle"} size={14} />
                  {t(`fields.${field}`)}
                </span>
              );
            })}
            {t("map.required")}
          </p>
          <div role="region" aria-label={t("map.caption")} tabIndex={0} className="overflow-x-auto rounded-md border border-border bg-surface">
            <table className="w-full min-w-[640px] text-[14px]">
              <caption className="sr-only">{t("map.caption")}</caption>
              <thead>
                <tr className="border-b border-border text-start text-[12.5px] font-bold text-text-secondary">
                  <th scope="col" className="px-4 py-3 text-start">
                    {t("map.column")}
                  </th>
                  <th scope="col" className="w-10" />
                  <th scope="col" className="px-4 py-3 text-start">
                    {t("map.field")}
                  </th>
                  <th scope="col" className="w-32 px-4 py-3 text-center">
                    {t("map.matchValues")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sheet.headers.map((header, column) => {
                  const field = fieldOf(column);
                  const suggestion = sheet.suggestions[column];
                  const name = header || columnLetter(column);
                  return (
                    <tr key={column} className="border-b border-border-subtle last:border-0">
                      <th scope="row" className="px-4 py-3 text-start font-semibold">
                        <bdi>{name}</bdi>
                        {sheet.examples[column] && (
                          <span className="block text-[12.5px] font-normal text-muted">
                            {t("map.example")} <bdi>{sheet.examples[column]}</bdi>
                          </span>
                        )}
                      </th>
                      <td aria-hidden className="text-muted">
                        <Icon name="arrow-right" size={16} />
                      </td>
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-3">
                          <Select
                            className="min-w-0 flex-1"
                            aria-label={t("map.fieldFor", { column: name })}
                            value={field}
                            onValueChange={(value) => mapColumn(column, value)}
                            options={fieldOptions}
                          />
                          {suggestion && suggestion.field === field && (
                            <span className="inline-flex w-14 shrink-0 items-center gap-1 text-[12.5px] font-bold text-success-fg" title={t("map.suggested")}>
                              <Icon name="star" size={13} />
                              <span className="sr-only">{t("map.suggested")}</span>
                              {t("map.score", { score: n(suggestion.score) })}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <Checkbox
                          aria-label={t("map.matchValuesFor", { column: name })}
                          checked={field !== "none" && matchesValues(field, fields) && (ticked[column] ?? false)}
                          disabled={field === "none" || !matchesValues(field, fields)}
                          onCheckedChange={(on) => setTicked((was) => ({ ...was, [column]: on === true }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="flex flex-wrap items-start gap-2 rounded-md bg-info-tint px-4 py-3 text-[13px] text-info-fg">
            <Icon name="info-circle" size={16} className="mt-0.5" />
            <span className="flex-1">{t("map.valuesHelp")}</span>
          </p>
          <p className="flex items-start gap-2 text-[13px] text-muted">
            <Icon name="forms" size={16} className="mt-0.5" />
            {t("map.formFieldsHelp")}
          </p>
          <p className="flex items-start gap-2 text-[13px] text-muted">
            <Icon name="info-circle" size={16} className="mt-0.5" />
            {t("map.paperRefHelp")}
          </p>
          <section aria-labelledby="fixed-heading" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
            <h2 id="fixed-heading" className="text-[11.5px] font-bold tracking-[0.06em] text-muted uppercase">
              {t("map.oneValue")}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              <FixedChoice
                label={t("fields.type")}
                source={type}
                headers={sheet.headers}
                onChange={setType}
                fromColumn={(column) => t("map.fromColumn", { column })}
                sameForEvery={t("map.sameForEvery")}
                choose={t("map.choose")}
                options={types.map((ty) => ({ value: ty.code, label: `${ty.code} · ${ty.name[locale]}` }))}
              />
              <FixedChoice
                label={t("fields.trade")}
                source={trade}
                headers={sheet.headers}
                onChange={setTrade}
                fromColumn={(column) => t("map.fromColumn", { column })}
                sameForEvery={t("map.sameForEvery")}
                choose={t("map.choose")}
                options={trades.map((tr) => ({ value: tr.id, label: tr.name[locale] }))}
              />
            </div>
          </section>
          <div className="flex items-center justify-between">
            {back("sheet")}
            <Button onClick={() => void (tickedColumns > 0 ? loadValues() : validate())} disabled={busy || mapping(false) === null}>
              {tickedColumns > 0 ? t("map.nextValues") : t("map.validate")}
              <Icon name="arrow-right" />
            </Button>
          </div>
        </section>
      )}

      {step === "values" && values && file && (
        <section aria-label={t("step.values")} className="flex flex-col gap-4">
          {values.fields.length === 0 ? (
            <p className="rounded-md border border-border bg-surface px-4 py-6 text-center text-[14px] text-muted">{t("values.nothing")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
                <ol aria-label={t("values.fields")} className="flex flex-wrap items-center gap-1">
                  {values.fields.map((f, index) => (
                    <li key={f.field} className="flex items-center gap-1">
                      {index > 0 && <Icon name="chevron-right" size={14} className="text-muted" />}
                      <button
                        type="button"
                        aria-current={index === valueTab ? "step" : undefined}
                        onClick={() => setValueTab(index)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-[14px] font-semibold hover:bg-hover",
                          index === valueTab ? "bg-brand-tint text-brand-fg" : "text-text-secondary",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex size-5 items-center justify-center rounded-full text-[11px]",
                            index === valueTab ? "bg-primary text-on-primary" : "bg-neutral-tint text-muted",
                          )}
                        >
                          {n(index + 1)}
                        </span>
                        {fieldName(f.field)}
                      </button>
                    </li>
                  ))}
                </ol>
                <span className="ms-auto text-[13px] text-muted">{t("values.fieldOf", { at: n(valueTab + 1), of: n(values.fields.length) })}</span>
              </div>
              {currentValues && (
                <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1">
                      <h2 className="flex items-center gap-2 text-[16px] font-bold">
                        <bdi>{sheet?.headers[currentValues.column] || columnLetter(currentValues.column)}</bdi>
                        <Icon name="arrow-right" size={16} className="text-muted" />
                        {fieldName(currentValues.field)}
                      </h2>
                      <p className="text-[13px] text-muted">
                        {t("values.summary", {
                          values: n(currentValues.values.length),
                          count: currentValues.values.length,
                          rows: n(currentValues.values.reduce((sum, v) => sum + v.rows, 0)),
                        })}
                      </p>
                    </div>
                    {(() => {
                      const unmatched = currentValues.values.filter((v) => matchOf(currentValues.field, v) === null).length;
                      return unmatched === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-success-tint px-2 py-1 text-[12.5px] font-bold text-success-fg">
                          <Icon name="check" size={14} />
                          {t("values.allMatched")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-danger-tint px-2 py-1 text-[12.5px] font-bold text-danger-fg">
                          <Icon name="alert-triangle" size={14} />
                          {t("values.unmatched", { count: unmatched, n: n(unmatched) })}
                        </span>
                      );
                    })()}
                  </div>
                  <div role="region" aria-label={t("values.caption")} tabIndex={0} className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-[14px]">
                      <caption className="sr-only">{t("values.caption")}</caption>
                      <thead>
                        <tr className="bg-surface-subtle text-[12.5px] font-bold text-text-secondary">
                          <th scope="col" className="px-3 py-3 text-start">
                            {t("values.inRegister")}
                          </th>
                          <th scope="col" className="w-8" />
                          <th scope="col" className="px-3 py-3 text-start">
                            {t("values.rabaedValue")}
                          </th>
                          <th scope="col" className="w-24 px-3 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {currentValues.values.map((v) => {
                          const chosen = matchOf(currentValues.field, v);
                          const suggested = v.how === "suggested" && chosen === v.match;
                          return (
                            <tr key={v.key} className={cn("border-t border-border-subtle", suggested && "bg-success-tint/50", chosen === null && "bg-danger-tint/40")}>
                              <th scope="row" className="px-3 py-2.5 text-start font-semibold">
                                <bdi>{v.text}</bdi>
                                <span className="block text-[12.5px] font-normal text-muted">{t("values.rows", { count: v.rows, n: n(v.rows) })}</span>
                              </th>
                              <td aria-hidden className="text-muted">
                                <Icon name="arrow-right" size={16} />
                              </td>
                              <td className="px-3 py-2">
                                <Select
                                  aria-label={t("values.matchFor", { value: v.text })}
                                  value={chosen ?? "none"}
                                  onValueChange={(value) =>
                                    setMatches((was) => {
                                      const field = { ...was[currentValues.field] };
                                      if (value === "none") delete field[v.key];
                                      else field[v.key] = value;
                                      return { ...was, [currentValues.field]: field };
                                    })
                                  }
                                  options={[{ value: "none", label: t("values.notMatched") }, ...valueOptions(currentValues.field)]}
                                />
                              </td>
                              <td className="px-3 py-2 text-center text-[12.5px]">
                                {chosen === null ? (
                                  <span className="font-semibold text-danger-fg">{t("values.none")}</span>
                                ) : v.how === "exact" && !matches[currentValues.field]?.[v.key] ? (
                                  <span className="text-muted">{t("values.exact")}</span>
                                ) : suggested ? (
                                  <span className="inline-flex items-center gap-1 font-bold text-success-fg">
                                    <Icon name="star" size={13} />
                                    <span className="sr-only">{t("map.suggested")}</span>
                                    {t("map.score", { score: n(v.score ?? 0) })}
                                  </span>
                                ) : (
                                  <span className="text-muted">{t("values.byHand")}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <p className="flex items-start gap-2 text-[13px] text-muted">
                <Icon name="info-circle" size={16} className="mt-0.5" />
                {t("values.help")}
              </p>
            </>
          )}
          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={() => (valueTab > 0 ? setValueTab(valueTab - 1) : setStep("map"))} disabled={busy}>
              {t("back")}
            </Button>
            {valueTab < values.fields.length - 1 ? (
              <Button onClick={() => setValueTab(valueTab + 1)} disabled={busy}>
                {t("values.next", { field: fieldName(values.fields[valueTab + 1]!.field) })}
                <Icon name="arrow-right" />
              </Button>
            ) : (
              <Button onClick={() => void validate()} disabled={busy || mapping() === null}>
                {t("map.validate")}
                <Icon name="arrow-right" />
              </Button>
            )}
          </div>
        </section>
      )}

      {step === "validate" && preview && (
        <section aria-label={t("step.validate")} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Count value={n(preview.rowsTotal)} label={t("validate.checked")} />
            <Count value={n(preview.rowsTotal - preview.rowsRejected)} label={t("validate.ready")} tone="success" />
            <Count value={n(preview.rowsRejected)} label={t("validate.leftOut")} tone="danger" />
          </div>
          {preview.rowsRejected > 0 && (
            <p className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-[14px]">
              <Icon name="alert-triangle" size={18} className="text-danger-fg" />
              <span className="flex-1">{t("validate.fixHint", { good: n(preview.rowsTotal - preview.rowsRejected), count: preview.rowsTotal - preview.rowsRejected })}</span>
              {file && (
                <Button variant="ghost" size="sm" onClick={() => void validate()} disabled={busy}>
                  <Icon name="refresh" />
                  {t("validate.again")}
                </Button>
              )}
            </p>
          )}
          <Tabs defaultValue={preview.rowsRejected > 0 ? "errors" : "imported"}>
            <TabsList aria-label={t("validate.tabs")}>
              <TabsTrigger value="errors" count={n(preview.rowsRejected)}>
                {t("validate.errors")}
              </TabsTrigger>
              <TabsTrigger value="imported" count={n(preview.rowsTotal - preview.rowsRejected)}>
                {t("validate.imported")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="errors" className="pt-4">
              <div className="overflow-hidden rounded-md border border-border bg-surface">
                <ErrorRows
                  rows={preview.rows.filter((r) => r.reasons.length > 0)}
                  label={t("validate.errors")}
                  mapping={preview.mapping}
                  onFixMapping={file ? () => setStep("map") : undefined}
                  onFixValues={file && values ? () => setStep("values") : undefined}
                />
              </div>
            </TabsContent>
            <TabsContent value="imported" className="pt-4">
              <div className="overflow-x-auto rounded-md border border-border bg-surface">
                <ImportRows rows={preview.rows.filter((r) => r.reasons.length === 0)} label={t("validate.imported")} locale={locale} mapping={preview.mapping} />
              </div>
            </TabsContent>
          </Tabs>
          <div className="flex items-center justify-between">
            {back(file && sheet ? (values ? "values" : "map") : "upload")}
            <Button onClick={() => void confirm()} disabled={busy || preview.rowsTotal === preview.rowsRejected}>
              <Icon name="check" />
              {t("validate.confirm", { count: preview.rowsTotal - preview.rowsRejected, n: n(preview.rowsTotal - preview.rowsRejected) })}
            </Button>
          </div>
        </section>
      )}

      {step === "result" && preview && created !== null && (
        <section aria-labelledby="result-heading" className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-10 text-center">
          <span className="inline-flex size-16 items-center justify-center rounded-full bg-success-tint text-success-fg">
            <Icon name="circle-check" size={32} />
          </span>
          <h2 id="result-heading" className="text-h4 font-semibold">
            {t("result.created", { count: created, n: n(created) })}
          </h2>
          <p className="text-[14px] text-muted">
            <bdi>{preview.fileName}</bdi>
          </p>
          <dl className="flex gap-8 rounded-md bg-surface-subtle px-5 py-3 text-[13px]">
            <div>
              <dt className="text-muted">{t("result.draftsLabel")}</dt>
              <dd className="font-bold">{n(created)}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("result.leftOut")}</dt>
              <dd className="font-bold text-danger-fg">{n(preview.rowsRejected)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href={`/projects/${projectId}/work-items/imports/${preview.id}`}
              className="inline-flex h-9 items-center gap-2 rounded-sm bg-primary px-3.5 text-[14px] font-semibold text-on-primary hover:bg-primary-hover"
            >
              <Icon name="list" />
              {t("result.open", { count: created, n: n(created) })}
            </Link>
            <Button variant="ghost" onClick={startAgain}>
              {t("result.another")}
            </Button>
          </div>
          {preview.rowsRejected > 0 && <p className="text-[13px] text-muted">{t("result.leftOutHelp")}</p>}
        </section>
      )}
    </div>
  );
}

/** One count of the Validate step, its number large in its tone. */
function Count({ value, label, tone = "neutral" }: { value: string; label: string; tone?: "neutral" | "success" | "danger" }) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface px-4 py-3",
        tone === "success" && "border-s-4 border-s-success",
        tone === "danger" && "border-s-4 border-s-danger",
      )}
    >
      <p className={cn("text-[28px] leading-tight font-bold tabular-nums", tone === "success" && "text-success-fg", tone === "danger" && "text-danger-fg")}>{value}</p>
      <p className="text-[13px] text-muted">{label}</p>
    </div>
  );
}

/** The Type's or the Trade's source: the column mapped to it, or one value for every row. */
function FixedChoice({
  label,
  source,
  headers,
  onChange,
  fromColumn,
  sameForEvery,
  choose,
  options,
}: {
  label: string;
  source: Source;
  headers: string[];
  onChange: (source: Source) => void;
  fromColumn: (column: string) => string;
  sameForEvery: string;
  choose: string;
  options: { value: string; label: string }[];
}) {
  const column = source.from === "column" && source.column !== null ? headers[source.column] || columnLetter(source.column) : null;
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2 rounded-sm bg-surface-subtle p-3">
      <p className="text-[14px] font-semibold">{label}</p>
      <RadioGroup
        aria-label={label}
        value={source.from}
        onValueChange={(from) => onChange(from === "column" ? { from: "column", column: null } : { from: "value", value: null })}
        options={[
          { value: "column", label: column ? fromColumn(column) : fromColumn("—") },
          { value: "value", label: sameForEvery },
        ]}
      />
      {source.from === "value" && (
        <Select aria-label={label} placeholder={choose} value={source.value ?? undefined} onValueChange={(value) => onChange({ from: "value", value })} options={options} />
      )}
    </div>
  );
}

/** The chosen sheet's top rows as a grid, the header row marked and the rows above it skipped. */
function SheetGrid({ sheet, label, n }: { sheet: RegisterSheet; label: string; n: (value: number) => string }) {
  const width = Math.max(1, ...sheet.top.map((r) => r.cells.length));
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-auto rounded-md border border-border bg-surface">
      <table className="w-full min-w-max text-[13.5px]">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="bg-surface-subtle text-[12px] text-muted">
            <th scope="col" className="w-10 border-e border-border-subtle px-2 py-1.5" />
            {Array.from({ length: width }, (_, column) => (
              <th key={column} scope="col" className="border-e border-border-subtle px-3 py-1.5 font-semibold">
                {columnLetter(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.top.map((row) => {
            const header = row.rowNo === sheet.headerRow;
            const skipped = row.rowNo < sheet.headerRow;
            return (
              <tr
                key={row.rowNo}
                className={cn(
                  "border-t border-border-subtle",
                  header && "bg-brand-tint font-semibold text-brand-fg",
                  // Skipped rows hatched, as the design draws them.
                  skipped && "bg-[repeating-linear-gradient(135deg,var(--color-surface-subtle)_0_6px,var(--color-surface)_6px_12px)] text-muted",
                )}
              >
                <th scope="row" className={cn("border-e border-border-subtle px-2 py-1.5 text-center text-[12px] font-normal", header ? "bg-primary text-on-primary" : "text-muted")}>
                  {n(row.rowNo)}
                </th>
                {Array.from({ length: width }, (_, column) => (
                  <td key={column} dir="auto" className="max-w-64 truncate border-e border-border-subtle px-3 py-1.5 text-start">
                    <bdi>{row.cells[column] ?? ""}</bdi>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
