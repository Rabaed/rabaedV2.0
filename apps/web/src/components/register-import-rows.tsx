"use client";

import { formatNumber, type BilingualText, type Locale, type RegisterImportMapping, type RegisterImportRow, type RegisterImportRowReason } from "@rabaed/domain";
import { Badge, EmptyState, Icon, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// The rows of a Submittal Register Import (RP-637, RP-639, RP-640): the wizard's Validate step
// (its errors, and what will be imported) and an import's own page (each row's result).

/** The value a reason names: what the row's cell held. */
function reasonValue(row: RegisterImportRow, reason: RegisterImportRowReason, locale: Locale): string {
  // A value it matched outside the Visibility is named as the Project names it.
  if (reason === "trade_outside_visibility" && row.trade.match) return row.trade.match.name[locale];
  if (reason === "location_outside_visibility" && row.location.match) return row.location.match.name[locale];
  // The assignee by their name, or the email as read (one that named nobody who may take it).
  if (reason.startsWith("assignee_")) return row.assignee.match?.name[locale] ?? row.assignee.text;
  if (reason.startsWith("type_")) return row.type.text;
  if (reason.startsWith("trade_")) return row.trade.text;
  if (reason.startsWith("scope_")) return row.scopes.text;
  if (reason.startsWith("location_")) return row.location.text;
  return row.paperRef;
}

/** Every reason a row is bad, one a line, each with the value it names; a Form value that doesn't fit names its field. */
export function RowReasons({ row, mapping }: { row: RegisterImportRow; mapping: RegisterImportMapping }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("registerImport.reasons");
  const labelOf = (key: string) => mapping.fields?.find((f) => f.key === key)?.label?.[locale] ?? key;
  const reasonText = (reason: RegisterImportRowReason) => {
    const value = reasonValue(row, reason, locale);
    // An assignee picked on the Assign step who can no longer take rows has no email to quote.
    if (reason === "assignee_unknown" && value === "") return t("assignee_unknown_picked");
    if (reason === "assignee_cannot_create") return t(reason, { value, type: row.type.match?.code ?? row.type.text });
    if (reason === "assignee_outside_visibility") {
      const values = [row.trade.match?.name[locale], row.location.match?.name[locale]].filter(Boolean).join(" · ");
      return t(reason, { value, values });
    }
    return t(reason, { value });
  };
  const lines = row.reasons.flatMap((reason) =>
    reason === "field_invalid"
      ? row.fields.filter((f) => f.invalid).map((f) => ({ key: `${reason}:${f.key}`, text: t(reason, { value: f.text, field: labelOf(f.key) }) }))
      : [{ key: reason, text: reasonText(reason) }],
  );
  return (
    <ul className="space-y-0.5">
      {lines.map((line) => (
        <li key={line.key} className="flex items-start gap-1.5 text-[13px] font-medium text-danger-fg">
          <Icon name="circle-x" size={14} className="mt-0.5" />
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The Subject as read, or a dash for an empty one. */
const subjectOf = (row: RegisterImportRow) => row.subject.trim() || "—";
/** A matched value's name in the reader's language, else the cell as read. */
const nameOr = (match: { name: { en: string; ar: string } } | null, text: string, locale: Locale) => match?.name[locale] ?? (text || "—");

/**
 * Where each reason is fixed: in the register; in the register or Map fields (a column
 * mapped to the wrong field); on Map values (a value matched to nothing); on Assign (an
 * assignee who can't take the row, RP-640); or not by this Member (a Type they may not
 * raise, a value outside their Visibility).
 */
const fixOf: Record<RegisterImportRowReason, "file" | "mapping" | "values" | "assign" | "notYours"> = {
  subject_missing: "file",
  subject_too_long: "file",
  type_missing: "mapping",
  type_unknown: "values",
  type_not_allowed: "notYours",
  trade_missing: "mapping",
  trade_unknown: "values",
  trade_outside_visibility: "notYours",
  scope_unknown: "values",
  scope_not_under_trade: "file",
  location_unknown: "values",
  location_outside_visibility: "notYours",
  field_invalid: "file",
  paper_ref_too_long: "file",
  paper_ref_repeated: "file",
  paper_ref_taken: "file",
  assignee_unknown: "assign",
  assignee_cannot_create: "assign",
  assignee_outside_visibility: "assign",
};

/** The bad rows: Row, Subject, every reason, and where to fix it. */
export function ErrorRows({
  rows,
  label,
  mapping,
  onFixMapping,
  onFixValues,
  onFixAssign,
}: {
  rows: RegisterImportRow[];
  label: string;
  mapping: RegisterImportMapping;
  onFixMapping?: () => void;
  onFixValues?: () => void;
  onFixAssign?: () => void;
}) {
  const t = useTranslations("registerImport.rows");
  const locale = useLocale() as Locale;
  const fixButton = (onClick: () => void, text: string) => (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-xs border border-border px-2 py-0.5 font-semibold text-brand-fg hover:bg-hover">
      {text}
      <Icon name="arrow-right" size={14} />
    </button>
  );
  return (
    <Table label={label}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">{t("row")}</TableHead>
          <TableHead>{t("subject")}</TableHead>
          <TableHead className="min-w-64">{t("errors")}</TableHead>
          <TableHead className="w-48">{t("whereToFix")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={4}>
            <EmptyState icon="circle-check" title={t("noErrors")} />
          </TableEmpty>
        ) : (
          rows.map((row) => {
            const fixes = new Set(row.reasons.map((reason) => fixOf[reason]));
            return (
              <TableRow key={row.rowNo} className="bg-danger-tint/40">
                <TableCell className="tabular-nums text-muted">{formatNumber(row.rowNo, locale)}</TableCell>
                <TableCell className="max-w-96 font-semibold [overflow-wrap:anywhere]">{subjectOf(row)}</TableCell>
                <TableCell className="py-2.5">
                  <RowReasons row={row} mapping={mapping} />
                </TableCell>
                <TableCell className="py-2.5">
                  <span className="flex flex-col items-start gap-1.5 text-[12.5px] text-muted">
                    {(fixes.has("file") || fixes.has("mapping") || fixes.has("values")) && (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="file" size={14} />
                        {t("fixInFile")}
                      </span>
                    )}
                    {onFixMapping && fixes.has("mapping") && fixButton(onFixMapping, t("mapFields"))}
                    {fixes.has("values") && (onFixValues ?? onFixMapping) && fixButton((onFixValues ?? onFixMapping)!, t(onFixValues ? "mapValues" : "mapFields"))}
                    {fixes.has("assign") &&
                      (onFixAssign ? (
                        fixButton(onFixAssign, t("assign"))
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {/* eslint-disable-next-line rabaed/no-avoid-terms -- Tabler's icon name, not copy */}
                          <Icon name="user" size={14} />
                          {t("assign")}
                        </span>
                      ))}
                    {fixes.has("notYours") && (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="lock" size={14} />
                        {t("notYours")}
                      </span>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

/**
 * The good rows as their Drafts will be: Row, Subject, Type and Trade, the Paper ref,
 * Location and Scopes when mapped, and who raises each when rows are assigned (RP-640:
 * the assignee, else `importer`). With `results` (an import's own page), every row with
 * its result: the Draft it created, linked where the reader sees it, or its reasons.
 */
export function ImportRows({
  rows,
  label,
  locale,
  mapping,
  importer,
  results = false,
}: {
  rows: RegisterImportRow[];
  label: string;
  locale: Locale;
  mapping: RegisterImportMapping;
  /** Who imported it: the raiser of every row not assigned. */
  importer: BilingualText;
  results?: boolean;
}) {
  const t = useTranslations("registerImport.rows");
  const columns = {
    paperRef: mapping.paperRef !== undefined,
    location: mapping.location !== undefined,
    scopes: mapping.scopes !== undefined,
    raiser: mapping.assignTo !== undefined || mapping.assign !== undefined,
  };
  const span = 4 + Number(results) + Object.values(columns).filter(Boolean).length;
  return (
    <Table label={label}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">{t("row")}</TableHead>
          {columns.paperRef && <TableHead>{t("paperRef")}</TableHead>}
          <TableHead>{t("subject")}</TableHead>
          <TableHead>{t("type")}</TableHead>
          <TableHead>{t("trade")}</TableHead>
          {columns.location && <TableHead>{t("location")}</TableHead>}
          {columns.scopes && <TableHead>{t("scopes")}</TableHead>}
          {columns.raiser && <TableHead>{t("raiser")}</TableHead>}
          {results && <TableHead>{t("result")}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={span}>
            <EmptyState icon="file" title={t("nothingToImport")} />
          </TableEmpty>
        ) : (
          rows.map((row) => (
            <TableRow key={row.rowNo}>
              <TableCell className="tabular-nums text-muted">{formatNumber(row.rowNo, locale)}</TableCell>
              {columns.paperRef && (
                <TableCell className="text-[13px]">
                  {/* A paper number reads left to right, like a Document Number. */}
                  {row.paperRef ? <bdi dir="ltr" className="font-mono">{row.paperRef}</bdi> : <span className="text-muted">—</span>}
                </TableCell>
              )}
              <TableCell className="max-w-96 font-semibold [overflow-wrap:anywhere]">{subjectOf(row)}</TableCell>
              <TableCell>
                {row.type.match ? (
                  <Badge>
                    <bdi>{row.type.match.code}</bdi>
                  </Badge>
                ) : (
                  <bdi>{row.type.text || "—"}</bdi>
                )}
              </TableCell>
              <TableCell>
                {results ? (
                  // The record: the cell as read, and the Trade it matched when they differ.
                  <span className="flex flex-col">
                    <bdi>{row.trade.text || "—"}</bdi>
                    {row.trade.match && row.trade.match.name[locale] !== row.trade.text && (
                      <small className="text-[12px] text-muted">
                        <bdi>{row.trade.match.name[locale]}</bdi>
                      </small>
                    )}
                  </span>
                ) : (
                  <bdi>{nameOr(row.trade.match, row.trade.text, locale)}</bdi>
                )}
              </TableCell>
              {columns.location && (
                <TableCell>
                  <bdi>{nameOr(row.location.match, row.location.text, locale)}</bdi>
                </TableCell>
              )}
              {columns.scopes && (
                <TableCell className="max-w-64 [overflow-wrap:anywhere]">
                  {row.scopes.matches.length > 0 ? row.scopes.matches.map((s) => s.name[locale]).join(locale === "ar" ? "، " : ", ") : <span className="text-muted">—</span>}
                </TableCell>
              )}
              {columns.raiser && (
                <TableCell>
                  <span className="flex flex-col">
                    <span className="font-medium">{(row.assignee.match?.name ?? importer)[locale]}</span>
                    {row.assignee.text && (
                      <small className="text-[12px] text-muted">
                        <bdi dir="ltr">{row.assignee.text}</bdi>
                      </small>
                    )}
                  </span>
                </TableCell>
              )}
              {results && (
                <TableCell>
                  {row.workItemId ? (
                    <Link href={`/work-items/${row.workItemId}`} className="inline-flex items-center gap-1 font-semibold text-brand-fg underline-offset-4 hover:underline">
                      <Icon name="circle-check" size={14} />
                      {t("openDraft")}
                    </Link>
                  ) : row.created ? (
                    <span className="inline-flex items-center gap-1 text-muted">
                      <Icon name="circle-check" size={14} />
                      {t("draftCreated")}
                    </span>
                  ) : (
                    <RowReasons row={row} mapping={mapping} />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
