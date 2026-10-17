"use client";

import { formatNumber, type Locale, type RegisterImportRow, type RegisterImportRowReason } from "@rabaed/domain";
import { Badge, EmptyState, Icon, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@rabaed/ui";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// The rows of a Submittal Register Import (RP-637): the wizard's Validate step (its
// errors, and what will be imported) and an import's own page (each row's result).

/** The value a reason names: what the row's cell held. */
function reasonValue(row: RegisterImportRow, reason: RegisterImportRowReason, locale: Locale): string {
  // A Trade it matched outside the Visibility is named as the Project names it.
  if (reason === "trade_outside_visibility" && row.trade.match) return row.trade.match.name[locale];
  return reason.startsWith("type_") ? row.type.text : row.trade.text;
}

/** Every reason a row is bad, one a line, each with the value it names. */
export function RowReasons({ row }: { row: RegisterImportRow }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("registerImport.reasons");
  return (
    <ul className="space-y-0.5">
      {row.reasons.map((reason) => (
        <li key={reason} className="flex items-start gap-1.5 text-[13px] font-medium text-danger-fg">
          <Icon name="circle-x" size={14} className="mt-0.5" />
          <span>{t(reason, { value: reasonValue(row, reason, locale) })}</span>
        </li>
      ))}
    </ul>
  );
}

/** The Subject as read, or a dash for an empty one. */
const subjectOf = (row: RegisterImportRow) => row.subject.trim() || "—";
/** A matched value's name in the reader's language, else the cell as read. */
const nameOr = (match: { name: { en: string; ar: string } } | null, text: string, locale: Locale) => match?.name[locale] ?? (text || "—");

/** The bad rows: Row, Subject, every reason, and where to fix it. */
export function ErrorRows({ rows, label, onFixMapping }: { rows: RegisterImportRow[]; label: string; onFixMapping?: () => void }) {
  const t = useTranslations("registerImport.rows");
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
          rows.map((row) => (
            <TableRow key={row.rowNo} className="bg-danger-tint/40">
              <TableCell className="tabular-nums text-muted">{row.rowNo}</TableCell>
              <TableCell className="max-w-96 font-semibold [overflow-wrap:anywhere]">{subjectOf(row)}</TableCell>
              <TableCell>
                <RowReasons row={row} />
              </TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-1.5 text-[12.5px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="file" size={14} />
                    {t("fixInFile")}
                  </span>
                  {onFixMapping && row.reasons.some((r) => r.startsWith("type_") || r.startsWith("trade_")) && (
                    <button type="button" onClick={onFixMapping} className="inline-flex items-center gap-1 rounded-xs border border-border px-2 py-0.5 font-semibold text-brand-fg hover:bg-hover">
                      {t("mapFields")}
                      <Icon name="arrow-right" size={14} />
                    </button>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

/**
 * The good rows as their Drafts will be: Row, Subject, Type and Trade. With `results`
 * (an import's own page), every row with its result: the Draft it created, linked where
 * the reader sees it, or its reasons.
 */
export function ImportRows({
  rows,
  label,
  locale,
  results = false,
}: {
  rows: RegisterImportRow[];
  label: string;
  locale: Locale;
  results?: boolean;
}) {
  const t = useTranslations("registerImport.rows");
  return (
    <Table label={label}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">{t("row")}</TableHead>
          <TableHead>{t("subject")}</TableHead>
          <TableHead>{t("type")}</TableHead>
          <TableHead>{t("trade")}</TableHead>
          {results && <TableHead>{t("result")}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={results ? 5 : 4}>
            <EmptyState icon="file" title={t("nothingToImport")} />
          </TableEmpty>
        ) : (
          rows.map((row) => (
            <TableRow key={row.rowNo}>
              <TableCell className="tabular-nums text-muted">{formatNumber(row.rowNo, locale)}</TableCell>
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
                <bdi>{nameOr(row.trade.match, row.trade.text, locale)}</bdi>
              </TableCell>
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
                    <RowReasons row={row} />
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
